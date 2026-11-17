import { PrismaClient } from '@prisma/client';
import { PasswordService } from '../auth/password.service';

export interface NewOrganization {
  name: string;
  currencyCode: string;
  timezone: string;
  countryCode: string;
  taxName: string;
  taxRateBp: number;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** Reads and checks the settings for a new organization from environment variables. */
export function newOrganizationFromEnv(env: NodeJS.ProcessEnv): NewOrganization {
  const need = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`${key} is required.`);
    return value;
  };
  const currencyCode = need('ORG_CURRENCY').toUpperCase();
  if (!Intl.supportedValuesOf('currency').includes(currencyCode)) throw new Error(`ORG_CURRENCY "${currencyCode}" is not a known currency code.`);
  const timezone = need('ORG_TIMEZONE');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new Error(`ORG_TIMEZONE "${timezone}" is not a known time zone (use a name such as Asia/Dubai).`);
  }
  const countryCode = need('ORG_COUNTRY').toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('ORG_COUNTRY must be a two-letter country code, for example AE.');
  const taxRateBp = Number(need('ORG_TAX_RATE_BP'));
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new Error('ORG_TAX_RATE_BP must be a whole number of basis points from 0 to 10000 (500 = 5%).');
  }
  const ownerEmail = need('OWNER_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('OWNER_EMAIL is not a valid email address.');
  return {
    name: need('ORG_NAME'),
    currencyCode,
    timezone,
    countryCode,
    taxName: need('ORG_TAX_NAME'),
    taxRateBp,
    ownerName: need('OWNER_NAME'),
    ownerEmail,
    ownerPassword: need('OWNER_PASSWORD'),
  };
}

/**
 * Creates an organization with its main branch, default tax rate and owner account. There is no
 * public sign-up: this is how a business gets its first user. Everyone else is invited from the app.
 *
 * Runs with the owner connection. Refuses if the email already has an account, so running it twice
 * changes nothing. The password is hashed here and never logged.
 */
export async function createOrganization(databaseUrl: string, input: NewOrganization): Promise<{ organizationId: string }> {
  const passwords = new PasswordService();
  passwords.assertAcceptable(input.ownerPassword, { email: input.ownerEmail });
  const passwordHash = await passwords.hash(input.ownerPassword);
  const currencyExponent = new Intl.NumberFormat('en', { style: 'currency', currency: input.currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } })) {
        throw new Error(`An account for ${input.ownerEmail} already exists — nothing was created.`);
      }
      const org = await tx.organization.create({
        data: { name: input.name, countryCode: input.countryCode, currencyCode: input.currencyCode, currencyExponent, timezone: input.timezone },
      });
      await tx.branch.create({ data: { organizationId: org.id, name: 'Main', code: 'MAIN', isDefault: true } });
      await tx.taxRate.create({ data: { organizationId: org.id, name: input.taxName, rateBp: input.taxRateBp, isDefault: true } });
      const user = await tx.user.create({ data: { email: input.ownerEmail, fullName: input.ownerName, passwordHash } });
      await tx.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
      await tx.auditLog.create({
        data: { organizationId: org.id, actorUserId: user.id, action: 'organization.created', entityType: 'organization', entityId: org.id, after: { name: input.name, by: 'maintenance create-organization' } },
      });
      return { organizationId: org.id };
    });
  } finally {
    await prisma.$disconnect();
  }
}
