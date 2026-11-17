import { Injectable } from '@nestjs/common';
import type { MemberRole, Organization, Prisma, TaxRate } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { AuditService } from '../audit/audit.service';
import { canSeeCost, hasPermission } from '../authz/permissions';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../common/config';
import { DomainError, Errors } from '../common/errors';
import type { RequestContext } from '../common/request-context';
import { MailService } from '../mail/mail.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { CreateTaxRateDto, InviteMemberDto, UpdateMemberDto, UpdateOrganizationDto, UpdateTaxRateDto } from './dto';

/** How long an invitation's set-password link works. */
export const INVITATION_TTL_DAYS = 7;

const POLICY_FIELDS = ['maxMarkupBp', 'defaultMarkupBp', 'defaultMinMarkupBp'] as const;

/** Number of decimal places of a currency, or null when the code is not a known currency. */
function currencyExponent(code: string): number | null {
  try {
    if (!Intl.supportedValuesOf('currency').includes(code)) return null;
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

function isTimezone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ───────── Organization profile and settings ─────────

  get(ctx: RequestContext) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      return this.view(ctx.role, org, await this.hasDocuments(tx));
    });
  }

  update(ctx: RequestContext, dto: UpdateOrganizationDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      // Serializes concurrent settings changes.
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${ctx.organizationId}::uuid FOR UPDATE`;
      const before = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
      const locked = await this.hasDocuments(tx);

      const data: Prisma.OrganizationUpdateInput = {};
      const changed: Record<string, [unknown, unknown]> = {};
      for (const [key, value] of Object.entries(dto) as [keyof UpdateOrganizationDto, unknown][]) {
        if (value === undefined || before[key] === value) continue;
        (data as Record<string, unknown>)[key] = value;
        changed[key] = [before[key], value];
      }
      if (Object.keys(changed).length === 0) return this.view(ctx.role, before, locked);

      if (('currencyCode' in changed || 'timezone' in changed) && locked) {
        throw new DomainError(
          'SETTING_LOCKED',
          409,
          'Currency and time zone cannot be changed after the first quotation or invoice.',
          Object.keys(changed).filter((k) => k === 'currencyCode' || k === 'timezone').map((field) => ({ field })),
        );
      }
      if (dto.currencyCode !== undefined && 'currencyCode' in changed) {
        const exponent = currencyExponent(dto.currencyCode);
        if (exponent === null) throw Errors.validation('currencyCode', 'unknown_currency');
        // Amounts are stored in minor units, so the exponent may only change together with the currency
        // and only while nothing has been priced in the old one.
        if (exponent !== before.currencyExponent && (await tx.product.count()) > 0) {
          throw new DomainError('SETTING_LOCKED', 409, 'This currency uses a different number of decimals than the prices already entered.', [
            { field: 'currencyCode' },
          ]);
        }
        data.currencyExponent = exponent;
      }
      if (dto.timezone !== undefined && 'timezone' in changed && !isTimezone(dto.timezone)) {
        throw Errors.validation('timezone', 'unknown_timezone');
      }

      if (POLICY_FIELDS.some((f) => f in changed)) {
        const max = dto.maxMarkupBp ?? before.maxMarkupBp;
        const def = dto.defaultMarkupBp ?? before.defaultMarkupBp;
        const min = dto.defaultMinMarkupBp ?? before.defaultMinMarkupBp;
        if (min > def || def > max) throw Errors.markupPolicyInvalid(max);
        if (max < before.maxMarkupBp) {
          const above = await tx.product.count({ where: { archivedAt: null, defaultMarkupBp: { gt: max } } });
          if (above > 0) {
            throw new DomainError(
              'MARKUP_POLICY_INVALID',
              422,
              `${above} ${above === 1 ? 'product has' : 'products have'} a default markup above this maximum. Lower those first.`,
              [{ field: 'maxMarkupBp', productCount: above }],
            );
          }
        }
      }

      const after = await tx.organization.update({ where: { id: ctx.organizationId }, data });
      await this.audit.record(tx, {
        ...this.actor(ctx),
        action: 'organization.updated',
        entityType: 'organization',
        entityId: ctx.organizationId,
        before: Object.fromEntries(Object.entries(changed).map(([k, [b]]) => [k, b as Prisma.InputJsonValue])),
        after: Object.fromEntries(Object.entries(changed).map(([k, [, a]]) => [k, a as Prisma.InputJsonValue])),
      });
      return this.view(ctx.role, after, locked);
    });
  }

  private async hasDocuments(tx: Tx): Promise<boolean> {
    const [invoice, quotation] = await Promise.all([
      tx.invoice.findFirst({ select: { id: true } }),
      tx.quotation.findFirst({ select: { id: true } }),
    ]);
    return invoice !== null || quotation !== null;
  }

  private view(role: MemberRole, org: Organization, regionalSettingsLocked: boolean) {
    return {
      id: org.id,
      name: org.name,
      legalName: org.legalName,
      taxRegistrationNumber: org.taxRegistrationNumber,
      phone: org.phone,
      email: org.email,
      addressLine: org.addressLine,
      city: org.city,
      countryCode: org.countryCode,
      invoiceFooter: org.invoiceFooter,
      currencyCode: org.currencyCode,
      currencyExponent: org.currencyExponent,
      timezone: org.timezone,
      locale: org.locale,
      lowStockThreshold: org.lowStockThreshold,
      defaultCreditDays: org.defaultCreditDays,
      quotationValidityDays: org.quotationValidityDays,
      allowOfflineSales: org.allowOfflineSales,
      // Markup policy reveals pricing; managers and owners only (business rule P7).
      ...(canSeeCost(role)
        ? {
            maxMarkupBp: org.maxMarkupBp,
            defaultMarkupBp: org.defaultMarkupBp,
            defaultMinMarkupBp: org.defaultMinMarkupBp,
            regionalSettingsLocked,
          }
        : {}),
    };
  }

  // ───────── Team ─────────

  listMembers(ctx: RequestContext) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      const members = await tx.organizationMember.findMany({
        include: { user: { select: { fullName: true, email: true, lastLoginAt: true } } },
        orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      });
      return members.map(memberView);
    });
  }

  async invite(ctx: RequestContext, dto: InviteMemberDto) {
    // Until the invited person chooses a password nobody can sign in: the stored hash is of random bytes.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString('base64url'));
    const invitation = this.tokens.newOpaqueToken();
    const now = this.clock.now();

    const { member, organizationName } = await this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      // v1: one organization per account, so any existing account with this email is a conflict.
      if (await tx.user.findUnique({ where: { email: dto.email }, select: { id: true } })) throw memberExists();
      const org = await tx.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
      let user;
      try {
        user = await tx.user.create({ data: { email: dto.email, fullName: dto.fullName, passwordHash } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') throw memberExists();
        throw error;
      }
      const created = await tx.organizationMember.create({
        data: { organizationId: ctx.organizationId, userId: user.id, role: dto.role },
        include: { user: { select: { fullName: true, email: true, lastLoginAt: true } } },
      });
      await tx.passwordResetToken.create({
        data: { userId: user.id, tokenHash: invitation.hash, expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000) },
      });
      await this.audit.record(tx, {
        ...this.actor(ctx),
        action: 'team.member_invited',
        entityType: 'organization_member',
        entityId: created.id,
        after: { email: dto.email, role: dto.role },
      });
      return { member: created, organizationName: org.name };
    });

    const invitationEmailSent = await this.mail.send({
      to: dto.email,
      subject: `You have been invited to ${organizationName} on Velora`,
      text:
        `Hello ${dto.fullName},\n\nYou have been added to ${organizationName} on Velora. ` +
        `Open this link on your phone to choose your password. It works once and expires in ${INVITATION_TTL_DAYS} days.\n\n` +
        `${this.config.MOBILE_DEEP_LINK_BASE}reset-password?token=${invitation.token}\n\n` +
        `If the link has expired, use "Forgot password" on the sign-in screen with this email address.`,
    });
    // The account exists either way. When the email could not be sent, the owner is told, and the
    // invited person can get a link with "Forgot password" once email works.
    return { ...memberView(member), invitationEmailSent };
  }

  updateMember(ctx: RequestContext, memberId: string, dto: UpdateMemberDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      // Locks the organization's members, so two concurrent changes cannot remove the last owner.
      await tx.$queryRaw`SELECT id FROM organization_members WHERE organization_id = ${ctx.organizationId}::uuid FOR UPDATE`;
      const before = await tx.organizationMember.findFirst({ where: { id: memberId } });
      if (!before) throw Errors.notFound('Team member');
      const role = dto.role ?? before.role;
      const isActive = dto.isActive ?? before.isActive;
      if (role === before.role && isActive === before.isActive) return memberView(await this.memberWithUser(tx, memberId));

      const wasActiveOwner = before.role === 'OWNER' && before.isActive;
      if (wasActiveOwner && !(role === 'OWNER' && isActive)) {
        const owners = await tx.organizationMember.count({ where: { role: 'OWNER', isActive: true } });
        if (owners <= 1) {
          throw new DomainError('LAST_OWNER', 409, 'The business needs at least one active owner. Make someone else an owner first.');
        }
      }
      await tx.organizationMember.update({ where: { id: memberId }, data: { role, isActive } });
      // Sign the member out everywhere: the next sign-in carries the new role, or is refused.
      await tx.refreshToken.updateMany({
        where: { memberId, revokedAt: null },
        data: { revokedAt: this.clock.now(), revokeReason: isActive ? 'role_changed' : 'membership_disabled' },
      });
      await this.audit.record(tx, {
        ...this.actor(ctx),
        action: 'team.member_updated',
        entityType: 'organization_member',
        entityId: memberId,
        before: { role: before.role, isActive: before.isActive },
        after: { role, isActive },
      });
      return memberView(await this.memberWithUser(tx, memberId));
    });
  }

  private memberWithUser(tx: Tx, id: string) {
    return tx.organizationMember.findUniqueOrThrow({
      where: { id },
      include: { user: { select: { fullName: true, email: true, lastLoginAt: true } } },
    });
  }

  // ───────── Tax rates ─────────

  listTaxRates(ctx: RequestContext, includeInactive: boolean) {
    // Inactive rates matter only to whoever manages settings.
    const all = includeInactive && hasPermission(ctx.role, 'settings.read');
    return this.prisma.tenantTx(ctx.organizationId, async (tx) =>
      (
        await tx.taxRate.findMany({
          where: all ? {} : { isActive: true },
          orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { rateBp: 'desc' }, { name: 'asc' }],
        })
      ).map(taxRateView),
    );
  }

  createTaxRate(ctx: RequestContext, dto: CreateTaxRateDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      await this.lockTaxRates(tx, ctx);
      await this.assertNameFree(tx, dto.name, null);
      if (dto.isDefault) await tx.taxRate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const rate = await tx.taxRate.create({
        data: { organizationId: ctx.organizationId, name: dto.name, rateBp: dto.rateBp, isDefault: dto.isDefault ?? false },
      });
      await this.audit.record(tx, {
        ...this.actor(ctx),
        action: 'tax_rate.created',
        entityType: 'tax_rate',
        entityId: rate.id,
        after: { name: rate.name, rateBp: rate.rateBp, isDefault: rate.isDefault },
      });
      return taxRateView(rate);
    });
  }

  updateTaxRate(ctx: RequestContext, id: string, dto: UpdateTaxRateDto) {
    return this.prisma.tenantTx(ctx.organizationId, async (tx) => {
      await this.lockTaxRates(tx, ctx);
      const before = await tx.taxRate.findFirst({ where: { id } });
      if (!before) throw Errors.notFound('Tax rate');
      const name = dto.name ?? before.name;
      const isActive = dto.isActive ?? before.isActive;
      const isDefault = dto.isDefault ?? before.isDefault;

      if (name !== before.name) await this.assertNameFree(tx, name, id);
      // The business always has exactly one default rate: it is replaced, never removed.
      if (before.isDefault && (!isDefault || !isActive)) {
        throw new DomainError('DEFAULT_RATE_REQUIRED', 409, 'Choose another default tax rate first.');
      }
      if (isDefault && !isActive) throw Errors.taxRateInactive();
      if (isDefault && !before.isDefault) await tx.taxRate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });

      const after = await tx.taxRate.update({ where: { id }, data: { name, isActive, isDefault } });
      await this.audit.record(tx, {
        ...this.actor(ctx),
        action: 'tax_rate.updated',
        entityType: 'tax_rate',
        entityId: id,
        before: { name: before.name, isDefault: before.isDefault, isActive: before.isActive },
        after: { name, isDefault, isActive },
      });
      return taxRateView(after);
    });
  }

  private async lockTaxRates(tx: Tx, ctx: RequestContext): Promise<void> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${ctx.organizationId}::uuid FOR UPDATE`;
  }

  private async assertNameFree(tx: Tx, name: string, exceptId: string | null): Promise<void> {
    const taken = await tx.taxRate.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    if (taken) throw new DomainError('DUPLICATE_NAME', 409, 'Another tax rate already has this name.', [{ field: 'name' }]);
  }

  // ───────── Own sessions ─────────

  /** The caller's signed-in devices. A session is a refresh-token family with a token that still works. */
  async listSessions(ctx: RequestContext) {
    const now = this.clock.now();
    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId: ctx.userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { familyId: true, deviceName: true, ipAddress: true, createdAt: true, expiresAt: true, rotatedAt: true },
    });
    const sessions = new Map<string, { id: string; deviceName: string | null; ipAddress: string | null; signedInAt: Date; lastActiveAt: Date; live: boolean }>();
    for (const t of tokens) {
      const s = sessions.get(t.familyId) ?? { id: t.familyId, deviceName: t.deviceName, ipAddress: null, signedInAt: t.createdAt, lastActiveAt: t.createdAt, live: false };
      s.lastActiveAt = t.createdAt;
      s.ipAddress = t.ipAddress;
      s.deviceName = t.deviceName ?? s.deviceName;
      if (!t.rotatedAt && t.expiresAt > now) s.live = true;
      sessions.set(t.familyId, s);
    }
    return [...sessions.values()]
      .filter((s) => s.live)
      .map(({ live: _live, ...s }) => ({ ...s, isCurrent: s.id === ctx.familyId }))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  /** Signs one of the caller's own devices out. */
  async revokeSession(ctx: RequestContext, familyId: string): Promise<void> {
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { userId: ctx.userId, familyId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokeReason: 'revoked_by_user' },
    });
    if (revoked.count === 0) throw Errors.notFound('Session');
    await this.prisma.tenantTx(ctx.organizationId, (tx) =>
      this.audit.record(tx, { ...this.actor(ctx), action: 'auth.session_revoked', entityType: 'user', entityId: ctx.userId, after: { familyId } }),
    );
  }

  private actor(ctx: RequestContext) {
    return { organizationId: ctx.organizationId, actorUserId: ctx.userId, ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
  }
}

const memberExists = () => new DomainError('MEMBER_EXISTS', 409, 'This email address already has an account.', [{ field: 'email' }]);

function memberView(m: {
  id: string;
  userId: string;
  role: MemberRole;
  isActive: boolean;
  createdAt: Date;
  user: { fullName: string; email: string; lastLoginAt: Date | null };
}) {
  return {
    memberId: m.id,
    userId: m.userId,
    fullName: m.user.fullName,
    email: m.user.email,
    role: m.role,
    isActive: m.isActive,
    // Invited, but has not signed in yet.
    isPending: m.user.lastLoginAt === null,
    lastLoginAt: m.user.lastLoginAt,
    createdAt: m.createdAt,
  };
}

function taxRateView(r: TaxRate) {
  return { id: r.id, name: r.name, rateBp: r.rateBp, isDefault: r.isDefault, isActive: r.isActive };
}
