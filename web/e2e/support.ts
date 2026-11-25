import { createRequire } from 'node:module';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { E2E } from './env';

const requireFromBackend = createRequire(join(__dirname, '..', '..', 'backend', 'package.json'));
const { Client } = requireFromBackend('pg') as typeof import('pg');
const argon2 = requireFromBackend('argon2') as typeof import('argon2');

/** Runs SQL as the schema owner, for arranging data the UI cannot create yet. */
export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: E2E.ownerUrl });
  await db.connect();
  try {
    return (await db.query(text, values)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A fresh user in the demo organization, so tests that lock or reset accounts never touch the demo ones. */
export async function createUser(role: 'OWNER' | 'MANAGER' | 'SALES', password = 'temporary-pass-4417'): Promise<{ email: string; password: string; userId: string }> {
  const [org] = await sql<{ id: string }>(`SELECT id FROM organizations WHERE name = 'Velora Fine Jewellery LLC'`);
  const userId = randomUUID();
  const email = `e2e-${userId.slice(0, 8)}@velora.example`;
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 1024, timeCost: 2, parallelism: 1 });
  await sql(`INSERT INTO users (id, email, password_hash, full_name, updated_at) VALUES ($1, $2, $3, 'Test Person', now())`, [userId, email, hash]);
  await sql(`INSERT INTO organization_members (id, organization_id, user_id, role, updated_at) VALUES (gen_random_uuid(), $1, $2, $3::"MemberRole", now())`, [org!.id, userId, role]);
  return { email, password, userId };
}

/** A reset link token for a user, stored the way the API stores it (SHA-256). */
export async function resetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await sql(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, now() + interval '1 hour')`, [userId, hash]);
  return token;
}

export async function signIn(page: Page, email: string, password = E2E.password): Promise<void> {
  if (!page.url().includes('/sign-in')) await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  // Signed in once the app shell (its account menu) is on screen.
  await expect(page.getByTestId('account-menu')).toBeVisible();
}

/** Navigates inside the running app (no page load), as a link would. */
export async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
}

/** Calls the API directly, as another device would (mobile sign-in: tokens in the body). */
export async function apiLogin(email: string, password = E2E.password): Promise<string> {
  const res = await fetch(`http://localhost:${E2E.apiPort}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceName: 'Other device' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
}

export async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = randomUUID();
  }
  const res = await fetch(`http://localhost:${E2E.apiPort}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as T };
}

/** Creates a product through the API (as another device would) and returns it. */
export async function createProduct(token: string, fields: Record<string, unknown> = {}): Promise<{ id: string; name: string; sku: string; version: number }> {
  const name = `E2E Ring ${randomUUID().slice(0, 8)}`;
  const res = await api<{ data: { id: string; name: string; sku: string; version: number } }>(token, 'POST', '/products', {
    name, costMinor: 100000, defaultMarkupBp: 3000, minMarkupBp: 1500, openingQuantity: 10, ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** Creates a customer through the API (as another device would). */
export async function createCustomer(token: string, fields: Record<string, unknown> = {}): Promise<{ id: string; name: string | null; company: string | null; mobile: string | null }> {
  const res = await api<{ data: { id: string; name: string | null; company: string | null; mobile: string | null } }>(token, 'POST', '/customers', {
    name: `E2E Customer ${randomUUID().slice(0, 8)}`, ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** "AED 1,234.50" — the way the app formats AED amounts (2 decimals, en grouping). */
export function aed(minor: number): string {
  const sign = minor < 0 ? '−' : '';
  const abs = Math.abs(minor);
  return `${sign}AED ${Math.trunc(abs / 100).toLocaleString('en')}.${String(abs % 100).padStart(2, '0')}`;
}

/** Issues an invoice through the API (as another device would): one line at 1,300.00 (+5% VAT). */
export async function createInvoice(
  token: string,
  productId: string,
  customerId: string,
  fields: Record<string, unknown> = {},
): Promise<{ id: string; number: string; totalMinor: number; balanceMinor: number }> {
  const res = await api<{ data: { id: string; number: string; totalMinor: number; balanceMinor: number } }>(token, 'POST', '/invoices', {
    customerId, lines: [{ productId, quantity: 1, unitPriceMinor: 130000 }], ...fields,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** Waits for the API to email `to` (via the test SMTP sink) and returns the decoded message body. */
export async function emailTo(to: string, timeoutMs = 10_000): Promise<string> {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = join(__dirname, '.mail');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = (await readdir(dir).catch(() => [] as string[])).sort().reverse();
    for (const f of files) {
      const raw = await readFile(join(dir, f), 'utf8');
      if (raw.startsWith(`X-Sink-To: ${to}`) || raw.split('\r\n', 1)[0]!.includes(to)) {
        // Undo quoted-printable soft breaks and escapes so links read whole.
        return raw.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}
