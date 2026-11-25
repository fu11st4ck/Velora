import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createOrg, createTestApp, createUser, ownerDb, resetDb, type SeededUser, type TestApp } from './helpers';

const api = '/api/v1';
const ORIGIN = 'http://localhost:4200'; // APP_BASE_URL default in tests
const WEB = { origin: ORIGIN, 'x-velora-client': 'web' };
let t: TestApp;
let db: Client;
let user: SeededUser;

type Res = Awaited<ReturnType<TestApp['app']['inject']>>;
const post = (path: string, headers: Record<string, string>, payload?: object) =>
  t.app.inject({ method: 'POST', url: `${api}/auth/web/${path}`, headers, ...(payload ? { payload } : {}) });
const login = (headers: Record<string, string> = WEB) => post('login', headers, { email: user.email, password: user.password, deviceName: 'Chrome on Mac' });
const cookieOf = (res: Res) => res.cookies.find((c) => c.name === '__Secure-velora_rt');
const withCookie = (value: string, headers: Record<string, string> = WEB) => ({ ...headers, cookie: `__Secure-velora_rt=${value}` });
const me = (accessToken: string) => t.app.inject({ method: 'GET', url: `${api}/auth/me`, headers: bearer(accessToken) });

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
  const org = await createOrg(db);
  user = await createUser(db, org, 'SALES');
});

describe('browser sessions', () => {
  it('signs in with the refresh token only in an HttpOnly, Secure, SameSite=Strict cookie', async () => {
    const res = await login();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json().data;
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('refreshToken');
    expect(body.membership.role).toBe('SALES');
    const cookie = cookieOf(res)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/v1/auth/web' });
    expect(new Date(cookie.expires!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect((await me(body.accessToken)).statusCode).toBe(200);
  });

  it('is refused unless the request comes from the web app (origin and client header)', async () => {
    const attempts: Record<string, string>[] = [{}, { origin: ORIGIN }, { 'x-velora-client': 'web' }, { origin: 'https://evil.example', 'x-velora-client': 'web' }];
    for (const headers of attempts) {
      const res = await login(headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(403);
      expect(cookieOf(res)).toBeUndefined();
    }
    const { value } = cookieOf(await login())!;
    expect((await post('refresh', withCookie(value, { origin: 'https://evil.example', 'x-velora-client': 'web' }))).statusCode).toBe(403);
    expect((await post('logout', withCookie(value, {}))).statusCode).toBe(403);
  });

  it('refreshes from the cookie alone and rotates it; a replayed old cookie ends the session', async () => {
    const first = cookieOf(await login())!.value;
    const refreshed = await post('refresh', withCookie(first));
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json().data).not.toHaveProperty('refreshToken');
    const second = cookieOf(refreshed)!.value;
    expect(second).not.toBe(first);
    const access = refreshed.json().data.accessToken as string;
    expect((await me(access)).statusCode).toBe(200);

    // Someone replays the old cookie: the whole session is closed, and the cookie is removed.
    const replay = await post('refresh', withCookie(first));
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('SESSION_REVOKED');
    expect(cookieOf(replay)?.value).toBe('');
    expect((await post('refresh', withCookie(second))).statusCode).toBe(401);
    expect((await me(access)).statusCode).toBe(401);
  });

  it('refuses a refresh without a cookie, or with a malformed one', async () => {
    for (const headers of [WEB, withCookie('short'), withCookie('x'.repeat(300))]) {
      const res = await post('refresh', headers);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('SESSION_REVOKED');
    }
  });

  it('the cookie never authorises anything else', async () => {
    const { value } = cookieOf(await login())!;
    const res = await t.app.inject({ method: 'GET', url: `${api}/auth/me`, headers: withCookie(value) });
    expect(res.statusCode).toBe(401);
  });

  it('signs out without needing a valid access token, closing the session at once', async () => {
    const res = await login();
    const access = res.json().data.accessToken as string;
    const { value } = cookieOf(res)!;
    t.clock.advance(60 * 60_000); // the access token has expired by now
    const out = await post('logout', withCookie(value));
    expect(out.statusCode).toBe(204);
    expect(cookieOf(out)?.value).toBe('');
    expect((await post('refresh', withCookie(value))).statusCode).toBe(401);
    t.clock.reset();
    expect((await me(access)).statusCode).toBe(401);
    // Signing out again, or with no cookie, is harmless.
    expect((await post('logout', WEB)).statusCode).toBe(204);
  });

  it('lists the browser among the signed-in devices', async () => {
    const access = (await login()).json().data.accessToken as string;
    const sessions = await t.app.inject({ method: 'GET', url: `${api}/auth/sessions`, headers: bearer(access) });
    expect(sessions.json().data).toMatchObject([{ deviceName: 'Chrome on Mac', isCurrent: true }]);
  });

  it('leaves the mobile sign-in unchanged', async () => {
    const res = await t.app.inject({ method: 'POST', url: `${api}/auth/login`, payload: { email: user.email, password: user.password } });
    expect(res.json().data.refreshToken).toEqual(expect.any(String));
    expect(cookieOf(res)).toBeUndefined();
  });
});

describe('emailed links open in a browser', () => {
  it('password reset links to the web app over its own address', async () => {
    await t.app.inject({ method: 'POST', url: `${api}/auth/forgot-password`, payload: { email: user.email } });
    expect(t.mail.sent.at(-1)!.text).toMatch(/http:\/\/localhost:4200\/reset-password\?token=[A-Za-z0-9_-]{20,}\n/);
    expect(t.mail.sent.at(-1)!.text).not.toContain('velora://');
  });
});
