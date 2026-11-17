import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, CONFIDENTIAL_KEYS, createOrg, createProduct, createTestApp, createUser, hasKeyDeep, login, ownerDb, resetDb, type SeededOrg, type SeededUser, type TestApp } from './helpers';

const api = '/api/v1';
let t: TestApp;
let db: Client;
let org: SeededOrg;
let ownerUser: SeededUser;
let managerUser: SeededUser;
let salesUser: SeededUser;
let owner: Record<string, string>;
let manager: Record<string, string>;
let sales: Record<string, string>;

type Res = Awaited<ReturnType<TestApp['app']['inject']>>;
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method, url: `${api}${url}`, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const data = (res: Res, status = 200) => {
  expect(res.statusCode, res.body).toBe(status);
  return res.json().data;
};
const fails = (res: Res, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
  return res.json().error;
};
const audit = async (action: string) => (await db.query('SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at', [action])).rows;
const signIn = (email: string, password: string, deviceName?: string) =>
  t.app.inject({ method: 'POST', url: `${api}/auth/login`, payload: { email, password, ...(deviceName ? { deviceName } : {}) } });
const refresh = (refreshToken: string) => t.app.inject({ method: 'POST', url: `${api}/auth/refresh`, payload: { refreshToken } });

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
  t.mail.failing = false;
  await resetDb(db);
  org = await createOrg(db);
  ownerUser = await createUser(db, org, 'OWNER');
  managerUser = await createUser(db, org, 'MANAGER');
  salesUser = await createUser(db, org, 'SALES');
  owner = bearer((await login(t, ownerUser)).accessToken);
  manager = bearer((await login(t, managerUser)).accessToken);
  sales = bearer((await login(t, salesUser)).accessToken);
});

describe('organization profile and settings', () => {
  it('shows the profile to everyone and the markup policy only to managers and owners', async () => {
    const forSales = data(await call('GET', '/organization', sales));
    expect(forSales).toMatchObject({ name: 'Test Jewellers', currencyCode: 'AED', currencyExponent: 2, timezone: 'Asia/Dubai', defaultCreditDays: 30 });
    expect(hasKeyDeep(forSales, CONFIDENTIAL_KEYS)).toBeNull();
    expect(forSales).not.toHaveProperty('regionalSettingsLocked');
    expect(data(await call('GET', '/organization', manager))).toMatchObject({
      maxMarkupBp: 6000,
      defaultMarkupBp: 3000,
      defaultMinMarkupBp: 1500,
      regionalSettingsLocked: false,
    });
  });

  it('lets only the owner change it, and audits what changed', async () => {
    const body = { name: 'Velora Fine Jewellery', invoiceFooter: 'Thank you.', phone: ' +971 4 555 0100 ', defaultCreditDays: 14 };
    fails(await call('PATCH', '/organization', manager, body), 403, 'FORBIDDEN');
    fails(await call('PATCH', '/organization', sales, body), 403, 'FORBIDDEN');
    const updated = data(await call('PATCH', '/organization', owner, body));
    expect(updated).toMatchObject({ name: 'Velora Fine Jewellery', invoiceFooter: 'Thank you.', phone: '+971 4 555 0100', defaultCreditDays: 14 });
    expect(data(await call('PATCH', '/organization', owner, { phone: '' })).phone).toBeNull();

    const [first, second] = await audit('organization.updated');
    expect(first.actor_user_id).toBe(ownerUser.userId);
    expect(first.before).toEqual({ name: 'Test Jewellers', invoiceFooter: null, phone: null, defaultCreditDays: 30 });
    expect(first.after).toEqual(body && { ...body, phone: '+971 4 555 0100' });
    expect(second.after).toEqual({ phone: null });
    // The new credit period reaches the app through the profile.
    expect(data(await call('GET', '/auth/me', sales)).settings.defaultCreditDays).toBe(14);
  });

  it('writes no audit entry when nothing changes', async () => {
    data(await call('PATCH', '/organization', owner, { name: 'Test Jewellers', defaultCreditDays: 30 }));
    expect(await audit('organization.updated')).toHaveLength(0);
  });

  it('rejects invalid values and unknown fields', async () => {
    for (const body of [{ defaultCreditDays: 366 }, { quotationValidityDays: 0 }, { lowStockThreshold: -1 }, { name: '  ' }, { email: 'nope' }, { countryCode: 'UAE' }, { currencyExponent: 3 }, { allowOfflineSales: true }]) {
      fails(await call('PATCH', '/organization', owner, body), 400, 'VALIDATION_ERROR');
    }
    fails(await call('PATCH', '/organization', owner, { currencyCode: 'ZZZ' }), 400, 'VALIDATION_ERROR');
    fails(await call('PATCH', '/organization', owner, { timezone: 'Mars/Phobos' }), 400, 'VALIDATION_ERROR');
  });

  it('keeps the markup policy ordered and above what products already use', async () => {
    fails(await call('PATCH', '/organization', owner, { defaultMinMarkupBp: 3500 }), 422, 'MARKUP_POLICY_INVALID');
    fails(await call('PATCH', '/organization', owner, { maxMarkupBp: 2000 }), 422, 'MARKUP_POLICY_INVALID');
    await createProduct(db, org, managerUser.memberId, { defaultMarkupBp: 4500 });
    const error = fails(await call('PATCH', '/organization', owner, { maxMarkupBp: 4000 }), 422, 'MARKUP_POLICY_INVALID');
    expect(error.details).toEqual([{ field: 'maxMarkupBp', productCount: 1 }]);
    expect(data(await call('PATCH', '/organization', owner, { maxMarkupBp: 4500, defaultMarkupBp: 2500, defaultMinMarkupBp: 1000 }))).toMatchObject({
      maxMarkupBp: 4500,
      defaultMarkupBp: 2500,
      defaultMinMarkupBp: 1000,
    });
  });

  it('allows a new currency and time zone only until prices or documents depend on them', async () => {
    expect(data(await call('PATCH', '/organization', owner, { currencyCode: 'kwd', timezone: 'Asia/Kuwait' }))).toMatchObject({
      currencyCode: 'KWD',
      currencyExponent: 3,
      timezone: 'Asia/Kuwait',
    });
    // Prices exist in three decimals now: a two-decimal currency would misread them.
    await createProduct(db, org, managerUser.memberId);
    fails(await call('PATCH', '/organization', owner, { currencyCode: 'AED' }), 409, 'SETTING_LOCKED');
    expect(data(await call('PATCH', '/organization', owner, { currencyCode: 'BHD' })).currencyCode).toBe('BHD');

    const customerId = randomUUID();
    await db.query(`INSERT INTO customers (id, organization_id, name, updated_at) VALUES ($1, $2, 'Maya', now())`, [customerId, org.id]);
    await db.query(
      `INSERT INTO quotations (id, organization_id, branch_id, number, customer_id, salesperson_id, currency_code, subtotal_minor, tax_name, tax_rate_bp, tax_minor, total_minor, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'QT-1', $3, $4, 'BHD', 0, 'VAT', 0, 0, 0, now())`,
      [org.id, org.branchId, customerId, managerUser.memberId],
    );
    const error = fails(await call('PATCH', '/organization', owner, { currencyCode: 'KWD', timezone: 'Asia/Dubai' }), 409, 'SETTING_LOCKED');
    expect(error.details).toEqual([{ field: 'currencyCode' }, { field: 'timezone' }]);
    expect(data(await call('GET', '/organization', owner)).regionalSettingsLocked).toBe(true);
    // Other settings stay editable.
    expect(data(await call('PATCH', '/organization', owner, { city: 'Manama' })).city).toBe('Manama');
  });
});

describe('team', () => {
  const invite = (body: unknown, headers = owner) => call('POST', '/organization/members', headers, body);
  const tokenFrom = (text: string) => /token=([\w-]+)/.exec(text)![1]!;

  it('lists staff for managers and owners, without secrets', async () => {
    fails(await call('GET', '/organization/members', sales), 403, 'FORBIDDEN');
    const members = data(await call('GET', '/organization/members', manager));
    expect(members.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'MANAGER', 'SALES']);
    expect(members[0]).toMatchObject({ memberId: ownerUser.memberId, email: ownerUser.email, isActive: true, isPending: false });
    expect(hasKeyDeep(members, ['passwordHash', 'password_hash', 'failedLoginCount'])).toBeNull();
  });

  it('invites a salesperson who chooses a password from the emailed link and signs in', async () => {
    fails(await invite({ fullName: 'Lina Haddad', email: 'lina@example.com', role: 'SALES' }, manager), 403, 'FORBIDDEN');
    const member = data(await invite({ fullName: ' Lina Haddad ', email: ' Lina@Example.com ', role: 'SALES' }), 201);
    expect(member).toMatchObject({ fullName: 'Lina Haddad', email: 'lina@example.com', role: 'SALES', isActive: true, isPending: true, invitationEmailSent: true });

    expect(t.mail.sent).toHaveLength(1);
    const mail = t.mail.sent[0]!;
    expect(mail.to).toBe('lina@example.com');
    expect(mail.subject).toContain('Test Jewellers');
    // Nobody can sign in until a password is chosen.
    expect((await signIn('lina@example.com', 'correct-horse-battery')).statusCode).toBe(401);

    const set = await t.app.inject({ method: 'POST', url: `${api}/auth/reset-password`, payload: { token: tokenFrom(mail.text), newPassword: 'ruby-anklet-4417' } });
    expect(set.statusCode, set.body).toBe(204);
    const session = data(await signIn('lina@example.com', 'ruby-anklet-4417'));
    expect(session.membership).toMatchObject({ role: 'SALES', organization: { id: org.id } });
    const listed = data(await call('GET', '/organization/members', owner)).find((m: { email: string }) => m.email === 'lina@example.com');
    expect(listed.isPending).toBe(false);

    const [entry] = await audit('team.member_invited');
    expect(entry.after).toEqual({ email: 'lina@example.com', role: 'SALES' });
    expect(JSON.stringify(entry)).not.toContain(tokenFrom(mail.text));
  });

  it('still creates the account when the email cannot be sent, and says so', async () => {
    t.mail.failing = true;
    const member = data(await invite({ fullName: 'Lina Haddad', email: 'lina@example.com', role: 'SALES' }), 201);
    expect(member).toMatchObject({ email: 'lina@example.com', isPending: true, invitationEmailSent: false });
    // "Forgot password" gives them a link once email works again — and never reveals a failure.
    const forgot = () => t.app.inject({ method: 'POST', url: `${api}/auth/forgot-password`, payload: { email: 'lina@example.com' } });
    expect((await forgot()).statusCode).toBe(202);
    t.mail.failing = false;
    expect((await forgot()).statusCode).toBe(202);
    const set = await t.app.inject({ method: 'POST', url: `${api}/auth/reset-password`, payload: { token: tokenFrom(t.mail.sent[0]!.text), newPassword: 'ruby-anklet-4417' } });
    expect(set.statusCode, set.body).toBe(204);
    expect((await signIn('lina@example.com', 'ruby-anklet-4417')).statusCode).toBe(200);
  });

  it('keeps the invitation link valid for seven days, then refuses it', async () => {
    data(await invite({ fullName: 'Lina Haddad', email: 'lina@example.com', role: 'MANAGER' }), 201);
    const token = tokenFrom(t.mail.sent[0]!.text);
    t.clock.advance(7 * 86_400_000 + 60_000);
    const late = await t.app.inject({ method: 'POST', url: `${api}/auth/reset-password`, payload: { token, newPassword: 'ruby-anklet-4417' } });
    expect(late.statusCode).toBe(422);
    expect(late.json().error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('refuses a duplicate email, an owner invitation and bad input', async () => {
    fails(await invite({ fullName: 'Someone Else', email: salesUser.email.toUpperCase(), role: 'SALES' }), 409, 'MEMBER_EXISTS');
    fails(await invite({ fullName: 'Second Owner', email: 'o2@example.com', role: 'OWNER' }), 400, 'VALIDATION_ERROR');
    fails(await invite({ fullName: 'X', email: 'x@example.com', role: 'SALES' }), 400, 'VALIDATION_ERROR');
    fails(await invite({ fullName: 'No Email', email: 'nope', role: 'SALES' }), 400, 'VALIDATION_ERROR');
    expect(t.mail.sent).toHaveLength(0);
    expect((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(3);
  });

  it('changing a role signs the member out; the next sign-in carries the new role', async () => {
    const session = await login(t, salesUser);
    fails(await call('PATCH', `/organization/members/${salesUser.memberId}`, manager, { role: 'MANAGER' }), 403, 'FORBIDDEN');
    const updated = data(await call('PATCH', `/organization/members/${salesUser.memberId}`, owner, { role: 'MANAGER' }));
    expect(updated).toMatchObject({ memberId: salesUser.memberId, role: 'MANAGER', isActive: true });

    const refused = await refresh(session.refreshToken);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('SESSION_REVOKED');
    const again = bearer((await login(t, salesUser)).accessToken);
    expect(data(await call('GET', '/auth/me', again)).permissions).toContain('product.read_cost');

    const [entry] = await audit('team.member_updated');
    expect(entry.before).toEqual({ role: 'SALES', isActive: true });
    expect(entry.after).toEqual({ role: 'MANAGER', isActive: true });
  });

  it('deactivating a member ends their access until they are reactivated', async () => {
    const session = await login(t, salesUser);
    data(await call('PATCH', `/organization/members/${salesUser.memberId}`, owner, { isActive: false }));
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    const refused = await signIn(salesUser.email, salesUser.password);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('ACCOUNT_DISABLED');

    data(await call('PATCH', `/organization/members/${salesUser.memberId}`, owner, { isActive: true }));
    expect((await signIn(salesUser.email, salesUser.password)).statusCode).toBe(200);
  });

  it('never leaves the business without an active owner', async () => {
    fails(await call('PATCH', `/organization/members/${ownerUser.memberId}`, owner, { role: 'MANAGER' }), 409, 'LAST_OWNER');
    fails(await call('PATCH', `/organization/members/${ownerUser.memberId}`, owner, { isActive: false }), 409, 'LAST_OWNER');
    // With a second owner, the first may step down.
    data(await call('PATCH', `/organization/members/${managerUser.memberId}`, owner, { role: 'OWNER' }));
    expect(data(await call('PATCH', `/organization/members/${ownerUser.memberId}`, owner, { role: 'MANAGER' })).role).toBe('MANAGER');
    const roles = (await db.query(`SELECT role::text FROM organization_members WHERE organization_id = $1 AND is_active ORDER BY role`, [org.id])).rows.map((r) => r.role);
    expect(roles.filter((r) => r === 'OWNER')).toHaveLength(1);
  });

  it('keeps one owner when two owners step down at the same moment', async () => {
    data(await call('PATCH', `/organization/members/${managerUser.memberId}`, owner, { role: 'OWNER' }));
    const second = bearer((await login(t, managerUser)).accessToken);
    const results = await Promise.all([
      call('PATCH', `/organization/members/${ownerUser.memberId}`, owner, { role: 'SALES' }),
      call('PATCH', `/organization/members/${managerUser.memberId}`, second, { role: 'SALES' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await db.query(`SELECT count(*)::int AS n FROM organization_members WHERE role = 'OWNER' AND is_active`)).rows[0].n).toBe(1);
  });

  it("cannot see or change another organization's staff", async () => {
    const other = await createOrg(db, 'Other Jewellers');
    const stranger = await createUser(db, other, 'SALES');
    fails(await call('PATCH', `/organization/members/${stranger.memberId}`, owner, { isActive: false }), 404, 'NOT_FOUND');
    fails(await call('PATCH', '/organization/members/not-a-uuid', owner, { isActive: false }), 404, 'NOT_FOUND');
    const emails = data(await call('GET', '/organization/members', owner)).map((m: { email: string }) => m.email);
    expect(emails).not.toContain(stranger.email);
  });
});

describe('tax rates', () => {
  const list = async (headers: Record<string, string>, query = '') => data(await call('GET', `/tax-rates${query}`, headers)) as { id: string; name: string; isDefault: boolean; isActive: boolean }[];

  it('lets the owner add a rate; names are unique whatever the letter case', async () => {
    fails(await call('POST', '/tax-rates', manager, { name: 'Zero rated', rateBp: 0 }), 403, 'FORBIDDEN');
    const zero = data(await call('POST', '/tax-rates', owner, { name: ' Zero rated ', rateBp: 0 }), 201);
    expect(zero).toMatchObject({ name: 'Zero rated', rateBp: 0, isDefault: false, isActive: true });
    fails(await call('POST', '/tax-rates', owner, { name: 'ZERO RATED', rateBp: 0 }), 409, 'DUPLICATE_NAME');
    fails(await call('POST', '/tax-rates', owner, { name: 'Too much', rateBp: 10001 }), 400, 'VALIDATION_ERROR');
    fails(await call('POST', '/tax-rates', owner, { name: 'Half', rateBp: 2.5 }), 400, 'VALIDATION_ERROR');
    expect((await list(sales)).map((r) => r.name)).toEqual(['VAT 5%', 'Zero rated']);
    expect((await audit('tax_rate.created'))[0].after).toEqual({ name: 'Zero rated', rateBp: 0, isDefault: false });
  });

  it('always has exactly one default rate: it is replaced, never removed', async () => {
    const vat15 = data(await call('POST', '/tax-rates', owner, { name: 'VAT 15%', rateBp: 1500, isDefault: true }), 201);
    expect((await list(owner)).filter((r) => r.isDefault).map((r) => r.id)).toEqual([vat15.id]);
    expect(data(await call('GET', '/auth/me', sales)).settings.defaultTaxRate).toMatchObject({ id: vat15.id, rateBp: 1500 });

    fails(await call('PATCH', `/tax-rates/${vat15.id}`, owner, { isActive: false }), 409, 'DEFAULT_RATE_REQUIRED');
    fails(await call('PATCH', `/tax-rates/${vat15.id}`, owner, { isDefault: false }), 409, 'DEFAULT_RATE_REQUIRED');
    data(await call('PATCH', `/tax-rates/${org.taxRateId}`, owner, { isDefault: true }));
    expect((await list(owner)).filter((r) => r.isDefault).map((r) => r.id)).toEqual([org.taxRateId]);
  });

  it('renames and deactivates a rate; the percentage itself cannot be edited', async () => {
    const zero = data(await call('POST', '/tax-rates', owner, { name: 'Zero rated', rateBp: 0 }), 201);
    fails(await call('PATCH', `/tax-rates/${zero.id}`, owner, { rateBp: 100 }), 400, 'VALIDATION_ERROR');
    fails(await call('PATCH', `/tax-rates/${zero.id}`, owner, { name: 'vat 5%' }), 409, 'DUPLICATE_NAME');
    fails(await call('PATCH', `/tax-rates/${zero.id}`, manager, { name: 'Exports' }), 403, 'FORBIDDEN');
    expect(data(await call('PATCH', `/tax-rates/${zero.id}`, owner, { name: 'Exports', isActive: false }))).toMatchObject({ name: 'Exports', isActive: false });

    expect((await list(sales)).map((r) => r.name)).toEqual(['VAT 5%']);
    expect((await list(sales, '?includeInactive=true')).map((r) => r.name)).toEqual(['VAT 5%']);
    expect((await list(manager, '?includeInactive=true')).map((r) => r.name)).toEqual(['VAT 5%', 'Exports']);
    fails(await call('PATCH', `/tax-rates/${zero.id}`, owner, { isDefault: true }), 422, 'TAX_RATE_INACTIVE');
    fails(await call('PATCH', `/tax-rates/${randomUUID()}`, owner, { name: 'Ghost' }), 404, 'NOT_FOUND');
  });

  it("does not touch another organization's rates", async () => {
    const other = await createOrg(db, 'Other Jewellers');
    fails(await call('PATCH', `/tax-rates/${other.taxRateId}`, owner, { name: 'Mine now' }), 404, 'NOT_FOUND');
    // The same name may exist in two organizations.
    data(await call('POST', '/tax-rates', owner, { name: 'Zero rated', rateBp: 0 }), 201);
    const otherOwner = bearer((await login(t, await createUser(db, other, 'OWNER'))).accessToken);
    data(await call('POST', '/tax-rates', otherOwner, { name: 'Zero rated', rateBp: 0, isDefault: true }), 201);
    expect((await list(owner)).find((r) => r.isDefault)?.id).toBe(org.taxRateId);
  });
});

describe('own sessions', () => {
  it('lists signed-in devices, marks the current one and signs another out', async () => {
    const user = await createUser(db, org, 'SALES');
    const phone = data(await signIn(user.email, user.password, 'Pixel 9'));
    t.clock.advance(60_000);
    const tablet = data(await signIn(user.email, user.password, 'iPad'));
    // Using the phone again rotates its token; it is still one session.
    t.clock.advance(60_000);
    const phoneAgain = data(await refresh(phone.refreshToken));

    const sessions = data(await call('GET', '/auth/sessions', bearer(phoneAgain.accessToken)));
    expect(sessions.map((s: { deviceName: string; isCurrent: boolean }) => [s.deviceName, s.isCurrent])).toEqual([['Pixel 9', true], ['iPad', false]]);
    expect(new Date(sessions[0].lastActiveAt).getTime()).toBeGreaterThan(new Date(sessions[0].signedInAt).getTime());
    expect(hasKeyDeep(sessions, ['tokenHash', 'refreshToken'])).toBeNull();

    const ipad = sessions[1].id as string;
    // Another person cannot end it.
    fails(await call('DELETE', `/auth/sessions/${ipad}`, sales), 404, 'NOT_FOUND');
    expect((await call('DELETE', `/auth/sessions/${ipad}`, bearer(phoneAgain.accessToken))).statusCode).toBe(204);
    expect((await refresh(tablet.refreshToken)).statusCode).toBe(401);
    expect(data(await call('GET', '/auth/sessions', bearer(phoneAgain.accessToken)))).toHaveLength(1);
    fails(await call('DELETE', `/auth/sessions/${ipad}`, bearer(phoneAgain.accessToken)), 404, 'NOT_FOUND');
    expect((await audit('auth.session_revoked'))[0].after).toEqual({ familyId: ipad });
  });
});
