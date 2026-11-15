import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createOrg, createTestApp, createUser, login, ownerDb, resetDb, type SeededOrg, type TestApp } from './helpers';

const api = '/api/v1';
let t: TestApp;
let db: Client;
let org: SeededOrg;

beforeAll(async () => {
  t = await createTestApp();
  db = await ownerDb();
});
afterAll(async () => {
  await t.close();
  await db.end();
});
beforeEach(async () => {
  t.clock.reset();
  t.mail.sent.length = 0;
  await resetDb(db);
  org = await createOrg(db);
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method: 'POST', url: `${api}${url}`, payload: payload as object, headers });
const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url: `${api}${url}`, headers });

describe('sign in', () => {
  it('returns tokens, user and membership in the success envelope', async () => {
    const user = await createUser(db, org, 'MANAGER');
    const res = await post('/auth/login', { email: user.email, password: user.password, deviceName: 'Pixel 9' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.accessToken.split('.')).toHaveLength(3);
    expect(data.refreshToken).toMatch(/^vr_/);
    expect(data.user).toEqual({ id: user.userId, fullName: 'MANAGER User', email: user.email });
    expect(data.membership).toEqual({
      memberId: user.memberId,
      role: 'MANAGER',
      branchId: null,
      organization: { id: org.id, name: 'Test Jewellers' },
    });
    expect(JSON.stringify(data)).not.toContain('passwordHash');
  });

  it('stores only a hash of the refresh token', async () => {
    const user = await createUser(db, org, 'SALES');
    const s = await login(t, user);
    const rows = await db.query('SELECT token_hash FROM refresh_tokens');
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).not.toContain(s.refreshToken);
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is case-insensitive on email', async () => {
    const user = await createUser(db, org, 'SALES', { email: 'ahmed@example.com' });
    const res = await post('/auth/login', { email: 'Ahmed@Example.COM', password: user.password });
    expect(res.statusCode).toBe(200);
  });

  it('answers identically for a wrong password and an unknown account', async () => {
    const user = await createUser(db, org, 'SALES');
    const wrong = await post('/auth/login', { email: user.email, password: 'not-the-password' });
    const unknown = await post('/auth/login', { email: 'nobody@example.com', password: 'not-the-password' });
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
      expect(res.json().error.requestId).toBeTruthy();
    }
  });

  it('locks the account for 15 minutes after 5 failures, then allows sign in again', async () => {
    const user = await createUser(db, org, 'SALES');
    for (let i = 0; i < 5; i++) {
      expect((await post('/auth/login', { email: user.email, password: 'wrong-password' })).statusCode).toBe(401);
    }
    const locked = await post('/auth/login', { email: user.email, password: user.password });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    t.clock.advance(15 * 60_000 + 1000);
    expect((await post('/auth/login', { email: user.email, password: user.password })).statusCode).toBe(200);
  });

  it('refuses a disabled user and a disabled membership', async () => {
    const a = await createUser(db, org, 'SALES', { userActive: false });
    const b = await createUser(db, org, 'SALES', { memberActive: false });
    for (const u of [a, b]) {
      const res = await post('/auth/login', { email: u.email, password: u.password });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('ACCOUNT_DISABLED');
    }
  });

  it('records successful and failed sign-ins in the audit log', async () => {
    const user = await createUser(db, org, 'SALES');
    await post('/auth/login', { email: user.email, password: 'wrong-password' });
    await login(t, user);
    const rows = await db.query('SELECT action, organization_id FROM audit_logs ORDER BY created_at');
    expect(rows.rows.map((r) => r.action)).toEqual(['auth.login_failed', 'auth.login']);
    expect(rows.rows[1].organization_id).toBe(org.id);
  });
});

describe('request validation', () => {
  it('rejects unknown fields and reports each invalid field', async () => {
    const res = await post('/auth/login', { email: 'not-an-email', password: 'x', isAdmin: true });
    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual(
      expect.arrayContaining([
        { field: 'email', rule: 'isEmail' },
        { field: 'isAdmin', rule: 'whitelistValidation' },
      ]),
    );
  });

  it('rejects malformed JSON with the error envelope', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `${api}/auth/login`,
      payload: '{"email":',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('answers unknown routes with NOT_FOUND', async () => {
    const res = await get('/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});

describe('access tokens', () => {
  it('requires a token on protected routes', async () => {
    const none = await get('/auth/me');
    const garbage = await get('/auth/me', bearer('not.a.token'));
    for (const res of [none, garbage]) {
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('TOKEN_INVALID');
    }
  });

  it('rejects a token signed by another key', async () => {
    const user = await createUser(db, org, 'SALES');
    const other = await createTestApp(); // generates its own ephemeral key pair
    const foreign = await login(other, user);
    await other.close();
    const res = await get('/auth/me', bearer(foreign.accessToken));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_INVALID');
  });

  it('expires after 15 minutes with TOKEN_EXPIRED', async () => {
    const user = await createUser(db, org, 'SALES');
    const s = await login(t, user);
    t.clock.advance(14 * 60_000);
    expect((await get('/auth/me', bearer(s.accessToken))).statusCode).toBe(200);
    t.clock.advance(2 * 60_000);
    const res = await get('/auth/me', bearer(s.accessToken));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });
});

describe('GET /auth/me', () => {
  it('returns permissions and settings; managers see the markup ceiling', async () => {
    const manager = await createUser(db, org, 'MANAGER');
    const res = await get('/auth/me', bearer((await login(t, manager)).accessToken));
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.permissions).toContain('product.manage');
    expect(data.permissions).not.toContain('team.manage');
    expect(data.settings).toMatchObject({
      currencyCode: 'AED',
      currencyExponent: 2,
      timezone: 'Asia/Dubai',
      maxMarkupBp: 6000,
      defaultCreditDays: 30,
      lowStockThreshold: 8,
      allowOfflineSales: false,
      defaultTaxRate: { name: 'VAT 5%', rateBp: 500 },
    });
  });

  it('never tells the sales role the markup ceiling or grants it cost access', async () => {
    const sales = await createUser(db, org, 'SALES');
    const { data } = (await get('/auth/me', bearer((await login(t, sales)).accessToken))).json();
    expect(data.settings).not.toHaveProperty('maxMarkupBp');
    expect(data.permissions).not.toContain('product.read_cost');
    expect(data.permissions).toEqual(expect.arrayContaining(['sale.create', 'document.read_own']));
  });
});

describe('refresh token rotation', () => {
  it('issues a new pair and the new refresh token works', async () => {
    const user = await createUser(db, org, 'SALES');
    const s1 = await login(t, user);
    const r = await post('/auth/refresh', { refreshToken: s1.refreshToken });
    expect(r.statusCode).toBe(200);
    const s2 = r.json().data;
    expect(s2.refreshToken).not.toBe(s1.refreshToken);
    expect((await get('/auth/me', bearer(s2.accessToken))).statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: s2.refreshToken })).statusCode).toBe(200);
  });

  it('treats reuse of a rotated token as theft and revokes the whole session', async () => {
    const user = await createUser(db, org, 'SALES');
    const s1 = await login(t, user);
    const s2 = (await post('/auth/refresh', { refreshToken: s1.refreshToken })).json().data;

    const replay = await post('/auth/refresh', { refreshToken: s1.refreshToken });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_REVOKED');

    // The legitimate holder's newer token is revoked too.
    const after = await post('/auth/refresh', { refreshToken: s2.refreshToken });
    expect(after.statusCode).toBe(401);
    const audit = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.refresh_reuse_detected'`);
    expect(audit.rowCount).toBe(1);
  });

  it('lets only one of two simultaneous refreshes succeed', async () => {
    const user = await createUser(db, org, 'SALES');
    const s = await login(t, user);
    const results = await Promise.all([
      post('/auth/refresh', { refreshToken: s.refreshToken }),
      post('/auth/refresh', { refreshToken: s.refreshToken }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  });

  it('rejects unknown and expired refresh tokens', async () => {
    const user = await createUser(db, org, 'SALES');
    const s = await login(t, user);
    expect((await post('/auth/refresh', { refreshToken: 'vr_does-not-exist-000000' })).json().error.code).toBe('SESSION_REVOKED');
    t.clock.advance(31 * 86_400_000);
    expect((await post('/auth/refresh', { refreshToken: s.refreshToken })).json().error.code).toBe('SESSION_REVOKED');
  });

  it('picks up a role change on the next refresh and stops when the membership is disabled', async () => {
    const user = await createUser(db, org, 'SALES');
    const s1 = await login(t, user);
    await db.query(`UPDATE organization_members SET role = 'MANAGER' WHERE id = $1`, [user.memberId]);
    const s2 = (await post('/auth/refresh', { refreshToken: s1.refreshToken })).json().data;
    const me = (await get('/auth/me', bearer(s2.accessToken))).json().data;
    expect(me.membership.role).toBe('MANAGER');

    await db.query(`UPDATE organization_members SET is_active = false WHERE id = $1`, [user.memberId]);
    const res = await post('/auth/refresh', { refreshToken: s2.refreshToken });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('sign out', () => {
  it('revokes the session so its refresh token no longer works', async () => {
    const user = await createUser(db, org, 'SALES');
    const s = await login(t, user);
    const out = await post('/auth/logout', { refreshToken: s.refreshToken }, bearer(s.accessToken));
    expect(out.statusCode).toBe(204);
    expect((await post('/auth/refresh', { refreshToken: s.refreshToken })).statusCode).toBe(401);
  });

  it("cannot revoke another user's session", async () => {
    const a = await createUser(db, org, 'SALES');
    const b = await createUser(db, org, 'SALES');
    const sa = await login(t, a);
    const sb = await login(t, b);
    await post('/auth/logout', { refreshToken: sb.refreshToken }, bearer(sa.accessToken));
    expect((await post('/auth/refresh', { refreshToken: sb.refreshToken })).statusCode).toBe(200);
  });
});

describe('password reset', () => {
  const tokenFrom = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] as string;

  it('gives the same answer whether or not the account exists, and mails only real accounts', async () => {
    const user = await createUser(db, org, 'SALES');
    const real = await post('/auth/forgot-password', { email: user.email });
    const fake = await post('/auth/forgot-password', { email: 'nobody@example.com' });
    expect(real.statusCode).toBe(202);
    expect(fake.statusCode).toBe(202);
    expect(real.json()).toEqual(fake.json());
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]?.to).toBe(user.email);
  });

  it('sets the new password, works once, and signs out every session', async () => {
    const user = await createUser(db, org, 'SALES');
    const session = await login(t, user);
    await post('/auth/forgot-password', { email: user.email });
    const token = tokenFrom(t.mail.sent[0]?.text ?? '');

    const done = await post('/auth/reset-password', { token, newPassword: 'a-brand-new-passphrase' });
    expect(done.statusCode).toBe(204);
    expect((await post('/auth/refresh', { refreshToken: session.refreshToken })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: user.email, password: user.password })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: user.email, password: 'a-brand-new-passphrase' })).statusCode).toBe(200);

    const again = await post('/auth/reset-password', { token, newPassword: 'another-good-passphrase' });
    expect(again.statusCode).toBe(422);
    expect(again.json().error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('expires the link after 60 minutes', async () => {
    const user = await createUser(db, org, 'SALES');
    await post('/auth/forgot-password', { email: user.email });
    const token = tokenFrom(t.mail.sent[0]?.text ?? '');
    t.clock.advance(61 * 60_000);
    const res = await post('/auth/reset-password', { token, newPassword: 'a-brand-new-passphrase' });
    expect(res.json().error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('rejects weak passwords with the rule that failed', async () => {
    const user = await createUser(db, org, 'SALES', { email: 'ahmedkhan@example.com' });
    await post('/auth/forgot-password', { email: user.email });
    const token = tokenFrom(t.mail.sent[0]?.text ?? '');
    const cases: [string, string][] = [
      ['short', 'min_length_10'],
      ['password123', 'too_common'],
      ['aaaaaaaaaaaa', 'too_repetitive'],
      ['xx-ahmedkhan-2026', 'contains_email'],
    ];
    for (const [newPassword, rule] of cases) {
      const res = await post('/auth/reset-password', { token, newPassword });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'WEAK_PASSWORD', details: [{ field: 'newPassword', rule }] });
    }
    // The token is still usable after rejected attempts.
    expect((await post('/auth/reset-password', { token, newPassword: 'a-brand-new-passphrase' })).statusCode).toBe(204);
  });
});

describe('change password', () => {
  it('requires the current password, keeps this session and ends the others', async () => {
    const user = await createUser(db, org, 'MANAGER');
    const here = await login(t, user);
    const elsewhere = await login(t, user);

    const bad = await post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'a-brand-new-passphrase' }, bearer(here.accessToken));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('CURRENT_PASSWORD_INCORRECT');

    const ok = await post('/auth/change-password', { currentPassword: user.password, newPassword: 'a-brand-new-passphrase' }, bearer(here.accessToken));
    expect(ok.statusCode).toBe(204);
    expect((await post('/auth/refresh', { refreshToken: here.refreshToken })).statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: elsewhere.refreshToken })).statusCode).toBe(401);
  });
});

describe('health', () => {
  it('answers liveness and readiness without a token', async () => {
    expect((await get('/health/live')).json()).toEqual({ data: { status: 'ok' } });
    expect((await get('/health/ready')).statusCode).toBe(200);
  });
});
