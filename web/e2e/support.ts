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

export async function api<T>(token: string, method: string, path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`http://localhost:${E2E.apiPort}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as T };
}
