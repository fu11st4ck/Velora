/**
 * Demo data taken from the reference application (docs/product-discovery.md §1).
 * Development and staging only: runs when SEED_DEMO=true and refuses to run in production.
 * Connects as the owner role (DATABASE_MIGRATION_URL) because it writes across tenant tables.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const PRODUCTS = [
  { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', description: '18K yellow gold bracelet with five clover motifs.', weight: '12.8', quantity: 24, costMinor: 280000n, defaultMarkupBp: 3000, minMarkupBp: 1500 },
  { sku: 'VLR-BG-014', name: 'Classic Gold Bangle', description: 'Polished 18K gold bangle with a secure clasp.', weight: '9.4', quantity: 8, costMinor: 215000n, defaultMarkupBp: 3000, minMarkupBp: 1800 },
  { sku: 'VLR-DB-008', name: 'Diamond Tennis Bracelet', description: 'Fine line bracelet with lab-grown round diamonds.', weight: '7.2', quantity: 4, costMinor: 620000n, defaultMarkupBp: 2800, minMarkupBp: 1500 },
  { sku: 'VLR-RC-021', name: 'Rose Gold Cuff', description: 'Minimal open cuff in warm 18K rose gold.', weight: '10.1', quantity: 17, costMinor: 245000n, defaultMarkupBp: 3000, minMarkupBp: 1500 },
] as const;

const USERS = [
  { email: 'owner@velora.example', fullName: 'Sujan Karki', role: 'OWNER' },
  { email: 'manager@velora.example', fullName: 'Maya Manager', role: 'MANAGER' },
  { email: 'ahmed@velora.example', fullName: 'Ahmed Khan', role: 'SALES' },
] as const;

async function main(): Promise<void> {
  if (process.env.SEED_DEMO !== 'true') {
    console.log('SEED_DEMO is not "true" — nothing seeded.');
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10) throw new Error('Set SEED_PASSWORD (at least 10 characters) for the demo accounts.');
  if (await prisma.organization.findFirst({ where: { name: 'Velora Fine Jewellery LLC' } })) {
    console.log('Demo organization already exists — nothing seeded.');
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  const year = new Date().getUTCFullYear();

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: 'Velora Fine Jewellery LLC',
        legalName: 'Velora Fine Jewellery LLC',
        phone: '+971567252392',
        city: 'Dubai',
        countryCode: 'AE',
        currencyCode: 'AED',
        currencyExponent: 2,
        timezone: 'Asia/Dubai',
        invoiceFooter: 'Thank you for choosing Velora Fine Jewellery.',
      },
    });
    const branch = await tx.branch.create({ data: { organizationId: org.id, name: 'Main showroom', code: 'MAIN', isDefault: true } });
    await tx.taxRate.createMany({
      data: [
        { organizationId: org.id, name: 'VAT 5%', rateBp: 500, isDefault: true },
        { organizationId: org.id, name: 'Zero rated 0%', rateBp: 0 },
      ],
    });
    await tx.documentSequence.createMany({
      data: [
        { organizationId: org.id, type: 'INVOICE', year, prefix: 'INV' },
        { organizationId: org.id, type: 'QUOTATION', year, prefix: 'QT' },
        { organizationId: org.id, type: 'CREDIT_NOTE', year, prefix: 'CN' },
      ],
    });

    let ownerMemberId = '';
    for (const u of USERS) {
      const user = await tx.user.create({ data: { email: u.email, fullName: u.fullName, passwordHash } });
      const member = await tx.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: u.role } });
      if (u.role === 'OWNER') ownerMemberId = member.id;
    }

    for (const p of PRODUCTS) {
      const product = await tx.product.create({
        data: {
          organizationId: org.id,
          sku: p.sku,
          name: p.name,
          description: p.description,
          weightValue: p.weight,
          weightUnit: 'G',
          costMinor: p.costMinor,
          defaultMarkupBp: p.defaultMarkupBp,
          minMarkupBp: p.minMarkupBp,
        },
      });
      await tx.stockLevel.create({ data: { organizationId: org.id, productId: product.id, branchId: branch.id, quantity: p.quantity } });
      await tx.stockMovement.create({
        data: {
          organizationId: org.id,
          productId: product.id,
          branchId: branch.id,
          type: 'OPENING',
          quantityDelta: p.quantity,
          balanceAfter: p.quantity,
          unitCostMinor: p.costMinor,
          referenceNote: 'Demo opening stock',
          createdById: ownerMemberId,
        },
      });
    }
  });
  console.log(`Seeded demo organization with ${PRODUCTS.length} products and accounts: ${USERS.map((u) => u.email).join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
