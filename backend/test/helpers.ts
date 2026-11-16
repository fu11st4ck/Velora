import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MemberRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { configureApp, createAdapter } from '../src/app.factory';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { MailService, type OutgoingMail } from '../src/mail/mail.service';

export class TestClock extends Clock {
  private offsetMs = 0;
  override now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
}

export class CapturingMail {
  readonly sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  clock: TestClock;
  mail: CapturingMail;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const clock = new TestClock();
  const mail = new CapturingMail();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(false), { logger: false });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, clock, mail, close: () => app.close() };
}

/** Connection as the schema owner: bypasses row-level security, for arranging and inspecting test data only. */
export async function ownerDb(): Promise<Client> {
  const client = new Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
  await client.connect();
  return client;
}

/** Connection as the restricted application role, for testing database-level protections directly. */
export async function appDb(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

export async function resetDb(db: Client): Promise<void> {
  await db.query('TRUNCATE organizations, users CASCADE');
}

export interface SeededOrg {
  id: string;
  branchId: string;
  taxRateId: string;
}

export async function createOrg(db: Client, name = 'Test Jewellers'): Promise<SeededOrg> {
  const id = randomUUID();
  const branchId = randomUUID();
  const taxRateId = randomUUID();
  await db.query(
    `INSERT INTO organizations (id, name, currency_code, timezone, updated_at) VALUES ($1, $2, 'AED', 'Asia/Dubai', now())`,
    [id, name],
  );
  await db.query(
    `INSERT INTO branches (id, organization_id, name, code, is_default, updated_at) VALUES ($1, $2, 'Main', 'MAIN', true, now())`,
    [branchId, id],
  );
  await db.query(
    `INSERT INTO tax_rates (id, organization_id, name, rate_bp, is_default, updated_at) VALUES ($1, $2, 'VAT 5%', 500, true, now())`,
    [taxRateId, id],
  );
  return { id, branchId, taxRateId };
}

export interface SeededUser {
  userId: string;
  memberId: string;
  email: string;
  password: string;
}

// Cheap hash parameters keep the suite fast; production parameters are exercised by PasswordService tests.
const FAST = { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 } as const;

export async function createUser(
  db: Client,
  org: SeededOrg,
  role: MemberRole,
  overrides: { email?: string; password?: string; userActive?: boolean; memberActive?: boolean } = {},
): Promise<SeededUser> {
  const userId = randomUUID();
  const memberId = randomUUID();
  const email = overrides.email ?? `${role.toLowerCase()}-${userId.slice(0, 8)}@example.com`;
  const password = overrides.password ?? 'correct-horse-battery';
  await db.query(
    `INSERT INTO users (id, email, password_hash, full_name, is_active, updated_at) VALUES ($1, $2, $3, $4, $5, now())`,
    [userId, email, await argon2.hash(password, FAST), `${role} User`, overrides.userActive ?? true],
  );
  await db.query(
    `INSERT INTO organization_members (id, organization_id, user_id, role, is_active, updated_at)
     VALUES ($1, $2, $3, $4::"MemberRole", $5, now())`,
    [memberId, org.id, userId, role, overrides.memberActive ?? true],
  );
  return { userId, memberId, email, password };
}

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export async function login(t: TestApp, user: Pick<SeededUser, 'email' | 'password'>): Promise<Session> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: user.email, password: user.password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return res.json().data as Session;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

import { randomUUID as uuid } from 'node:crypto';

export interface SeededProduct {
  id: string;
  sku: string;
}

/** Inserts a product with stock and its opening ledger entry directly, bypassing the API. */
export async function createProduct(
  db: Client,
  org: SeededOrg,
  memberId: string,
  p: Partial<{ sku: string; name: string; quantity: number; costMinor: number; defaultMarkupBp: number; minMarkupBp: number; reorderLevel: number | null; barcode: string | null; archived: boolean; createdAt: string }> = {},
): Promise<SeededProduct> {
  const id = uuid();
  const sku = p.sku ?? `T-${id.slice(0, 8)}`;
  const quantity = p.quantity ?? 10;
  const cost = p.costMinor ?? 280000;
  await db.query(
    `INSERT INTO products (id, organization_id, sku, barcode, name, cost_minor, default_markup_bp, min_markup_bp, reorder_level, archived_at, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()), now())`,
    [id, org.id, sku, p.barcode ?? null, p.name ?? `Product ${sku}`, cost, p.defaultMarkupBp ?? 3000, p.minMarkupBp ?? 1500, p.reorderLevel ?? null, p.archived ? new Date() : null, !p.archived, p.createdAt ?? null],
  );
  await db.query(
    `INSERT INTO stock_levels (id, organization_id, product_id, branch_id, quantity, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
    [org.id, id, org.branchId, quantity],
  );
  if (quantity > 0) {
    await db.query(
      `INSERT INTO stock_movements (id, organization_id, product_id, branch_id, type, quantity_delta, balance_after, unit_cost_minor, created_by_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'OPENING', $4, $4, $5, $6)`,
      [org.id, id, org.branchId, quantity, cost, memberId],
    );
  }
  return { id, sku };
}

/** True when any key anywhere in the JSON value matches one of the names. */
export function hasKeyDeep(value: unknown, names: readonly string[]): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = hasKeyDeep(v, names);
      if (hit) return hit;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (names.includes(k)) return k;
      const hit = hasKeyDeep(v, names);
      if (hit) return hit;
    }
  }
  return null;
}

/** Fields that reveal cost, markup, profit or purchasing details (business rule P7). */
export const CONFIDENTIAL_KEYS = ['costMinor', 'unitCostMinor', 'defaultMarkupBp', 'minMarkupBp', 'maxMarkupBp', 'markupBp', 'supplierName', 'profit', 'grossProfitMinor', 'cogsMinor', 'marginBp', 'inventoryValueMinor'] as const;
