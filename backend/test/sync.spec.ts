import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkConsistency, purgeExpired } from '../src/maintenance/consistency';
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
  t.app.inject({ method, url: `${api}${url}`, headers: { ...headers, ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
const data = (res: Res, status = 200) => {
  expect(res.statusCode, res.body).toBe(status);
  return res.json().data;
};
interface Changes {
  data: { products?: { upserted: { id: string; sku: string; quantity: number }[]; archivedIds: string[] }; customers?: { upserted: { id: string; name: string }[]; archivedIds: string[] } };
  meta: { next: string; hasMore: boolean; serverTime: string };
}
const sync = async (headers: Record<string, string>, query = ''): Promise<Changes> => {
  const res = await call('GET', `/sync/changes${query}`, headers);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
/** Moves every change so far out of the overlap window, as if it happened a minute ago. */
const age = async () => {
  for (const table of ['products', 'customers', 'stock_levels', 'organizations']) {
    await db.query(`UPDATE ${table} SET updated_at = updated_at - interval '1 minute'`);
  }
};

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
  await resetDb(db);
  org = await createOrg(db);
  await db.query(`UPDATE organizations SET country_code = 'AE' WHERE id = $1`, [org.id]);
  ownerUser = await createUser(db, org, 'OWNER');
  managerUser = await createUser(db, org, 'MANAGER');
  salesUser = await createUser(db, org, 'SALES');
  owner = bearer((await login(t, ownerUser)).accessToken);
  manager = bearer((await login(t, managerUser)).accessToken);
  sales = bearer((await login(t, salesUser)).accessToken);
});

describe('sync changes', () => {
  it('gives a full snapshot first, without archived rows, following the role field policy', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', quantity: 24 });
    await createProduct(db, org, managerUser.memberId, { sku: 'OLD-1', quantity: 0, archived: true });
    const maya = data(await call('POST', '/customers', sales, { name: 'Maya Farah', mobile: '+971558204412' }), 201);
    const gone = data(await call('POST', '/customers', sales, { name: 'Gone Away' }), 201);
    expect((await call('DELETE', `/customers/${gone.id}`, manager)).statusCode).toBe(204);

    const forSales = await sync(sales);
    expect(forSales.data.products).toMatchObject({ upserted: [{ id: bracelet.id, sku: 'VLR-BR-001', quantity: 24, listPriceMinor: 364000 }], archivedIds: [] });
    expect(forSales.data.customers).toMatchObject({ upserted: [{ id: maya.id, name: 'Maya Farah' }], archivedIds: [] });
    expect(hasKeyDeep(forSales, CONFIDENTIAL_KEYS)).toBeNull();
    expect(forSales.meta.hasMore).toBe(false);
    expect(Math.abs(new Date(forSales.meta.serverTime).getTime() - Date.now())).toBeLessThan(60_000);

    expect((await sync(manager)).data.products!.upserted[0]).toMatchObject({ costMinor: 280000, defaultMarkupBp: 3000 });
    expect((await call('GET', '/sync/changes', {})).statusCode).toBe(401);
  });

  it('then sends only what changed: edits, stock movements, new and archived rows', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', quantity: 24 });
    const cuff = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-RC-021', quantity: 17, costMinor: 245000 });
    const maya = data(await call('POST', '/customers', sales, { name: 'Maya Farah' }), 201);
    await age();
    const first = await sync(sales);
    expect(first.data.products!.upserted).toHaveLength(2);

    // Nothing happened: nothing is sent, however often the client asks.
    const idle = await sync(sales, `?since=${first.meta.next}`);
    expect(idle.data).toEqual({ products: { upserted: [], archivedIds: [] }, customers: { upserted: [], archivedIds: [] } });

    // A sale changes stock only — the product row itself is untouched.
    data(await call('POST', '/invoices', sales, { customerId: maya.id, lines: [{ productId: bracelet.id, quantity: 2, unitPriceMinor: 364000 }] }), 201);
    data(await call('PATCH', `/customers/${maya.id}`, sales, { name: 'Maya F. Farah' }));
    const arjun = data(await call('POST', '/customers', sales, { name: 'Arjun Mehta' }), 201);
    await db.query(`UPDATE stock_levels SET quantity = 0 WHERE product_id = $1`, [cuff.id]);
    await db.query(`DELETE FROM stock_movements WHERE product_id = $1`, [cuff.id]);
    expect((await call('DELETE', `/products/${cuff.id}`, manager)).statusCode, 'archive').toBe(204);

    const delta = await sync(sales, `?since=${idle.meta.next}`);
    expect(delta.data.products).toMatchObject({ upserted: [{ id: bracelet.id, quantity: 22 }], archivedIds: [cuff.id] });
    expect(delta.data.customers!.upserted.map((c) => c.name).sort()).toEqual(['Arjun Mehta', 'Maya F. Farah']);
    expect(delta.data.customers!.upserted.map((c) => c.id)).toContain(arjun.id);
  });

  it('never skips a change that commits just after a page was read', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001' });
    const first = await sync(sales); // the product was created within the overlap window
    // A change stamped slightly *before* the previous read, committed after it.
    await db.query(`UPDATE products SET name = 'Late Commit', updated_at = now() - interval '3 seconds' WHERE id = $1`, [bracelet.id]);
    const next = await sync(sales, `?since=${first.meta.next}`);
    expect(next.data.products!.upserted).toMatchObject([{ id: bracelet.id, name: 'Late Commit' }]);
    // Once it is older than the window it is not sent again.
    await age();
    const settled = await sync(sales, `?since=${next.meta.next}`);
    expect((await sync(sales, `?since=${settled.meta.next}`)).data.products!.upserted).toEqual([]);
  });

  it('pages through a large catalogue without losing or repeating rows', async () => {
    for (let i = 0; i < 7; i++) await createProduct(db, org, managerUser.memberId, { sku: `P-${i}` });
    await db.query(`UPDATE products SET updated_at = now() - interval '1 hour' WHERE sku IN ('P-0','P-1','P-2')`); // identical timestamps
    await age();
    const seen: string[] = [];
    let since = '';
    for (let page = 0; page < 10; page++) {
      const res = await sync(sales, `?limit=3&entities=products${since}`);
      expect(res.data.customers).toBeUndefined();
      seen.push(...res.data.products!.upserted.map((p) => p.sku));
      since = `&since=${res.meta.next}`;
      if (!res.meta.hasMore) break;
    }
    expect(seen.sort()).toEqual(['P-0', 'P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6']);
  });

  it('re-sends products when a setting that changes their prices or stock status changes', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', quantity: 10 });
    await age();
    const first = await sync(sales);
    expect(first.data.products!.upserted[0]).toMatchObject({ stockStatus: 'IN_STOCK', ceilingPriceMinor: 448000 });
    data(await call('PATCH', '/organization', owner, { lowStockThreshold: 12, maxMarkupBp: 5000 }));
    const next = await sync(sales, `?since=${first.meta.next}`);
    expect(next.data.products!.upserted).toMatchObject([{ id: bracelet.id, stockStatus: 'LOW', ceilingPriceMinor: 420000 }]);
  });

  it('rejects a token that is malformed, tampered with or made for another role', async () => {
    await createProduct(db, org, managerUser.memberId);
    const { meta } = await sync(manager);
    for (const since of ['garbage', Buffer.from('{"v":2}').toString('base64url'), meta.next.slice(0, -4)]) {
      const res = await call('GET', `/sync/changes?since=${since}`, manager);
      expect(res.statusCode, since).toBe(400);
      expect(res.json().error.details).toEqual([{ field: 'since', rule: 'invalid_token' }]);
    }
    // A manager's position must not be continued by a sales session: its cache would keep cost fields.
    expect((await call('GET', `/sync/changes?since=${meta.next}`, sales)).statusCode).toBe(400);
    for (const query of ['?limit=0', '?limit=501', '?entities=invoices']) {
      expect((await call('GET', `/sync/changes${query}`, manager)).statusCode, query).toBe(400);
    }
  });

  it('stays inside the organization', async () => {
    const other = await createOrg(db, 'Other Jewellers');
    const stranger = await createUser(db, other, 'MANAGER');
    await createProduct(db, other, stranger.memberId, { sku: 'THEIRS' });
    await createProduct(db, org, managerUser.memberId, { sku: 'OURS' });
    expect((await sync(manager)).data.products!.upserted.map((p) => p.sku)).toEqual(['OURS']);
  });
});

describe('a closed session stops working at once', () => {
  const me = (headers: Record<string, string>) => call('GET', '/auth/me', headers);
  const revoked = (res: Res) => {
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json().error.code).toBe('SESSION_REVOKED');
  };

  it('after signing out', async () => {
    const session = await login(t, salesUser);
    expect((await me(bearer(session.accessToken))).statusCode).toBe(200);
    expect((await call('POST', '/auth/logout', bearer(session.accessToken), { refreshToken: session.refreshToken })).statusCode).toBe(204);
    revoked(await me(bearer(session.accessToken)));
    // Other devices of the same person are unaffected.
    expect((await me(sales)).statusCode).toBe(200);
  });

  it('after a role change or removal of access, without waiting for the token to expire', async () => {
    data(await call('PATCH', `/organization/members/${salesUser.memberId}`, owner, { role: 'MANAGER' }));
    revoked(await me(sales));
    revoked(await call('GET', '/products', sales));

    data(await call('PATCH', `/organization/members/${managerUser.memberId}`, owner, { isActive: false }));
    revoked(await call('POST', '/invoices', manager, {}));
  });

  it('on other devices after a password change, and on a device signed out remotely', async () => {
    const phone = await login(t, salesUser);
    const tablet = await login(t, salesUser);
    expect((await call('POST', '/auth/change-password', bearer(phone.accessToken), { currentPassword: salesUser.password, newPassword: 'ruby-anklet-4417' })).statusCode).toBe(204);
    expect((await me(bearer(phone.accessToken))).statusCode).toBe(200);
    revoked(await me(bearer(tablet.accessToken)));

    const laptop = await login(t, { email: salesUser.email, password: 'ruby-anklet-4417' });
    const sessions = data(await call('GET', '/auth/sessions', bearer(phone.accessToken)));
    const other = sessions.find((s: { isCurrent: boolean }) => !s.isCurrent);
    expect((await call('DELETE', `/auth/sessions/${other.id}`, bearer(phone.accessToken))).statusCode).toBe(204);
    revoked(await me(bearer(laptop.accessToken)));
  });
});

describe('maintenance', () => {
  const check = () => checkConsistency((sql) => db.query(sql));

  it('finds nothing wrong after real trading', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', quantity: 24 });
    const customer = data(await call('POST', '/customers', sales, { name: 'Maya Farah' }), 201);
    const line = { productId: bracelet.id, quantity: 2, unitPriceMinor: 364000 };
    const partial = data(await call('POST', '/invoices', sales, { customerId: customer.id, lines: [line], discountMinor: 28000, payment: { amountMinor: 300000, method: 'CASH' } }), 201);
    data(await call('POST', `/invoices/${partial.id}/returns`, manager, { reason: 'Clasp broken', lines: [{ lineNo: 1, quantity: 1, restock: true }] }), 201);
    const paid = data(await call('POST', '/invoices', sales, { customerId: customer.id, lines: [{ ...line, quantity: 1 }], payment: { amountMinor: 382200, method: 'CASH' } }), 201);
    data(await call('POST', `/invoices/${paid.id}/cancel`, manager, { reason: 'Mistake', refundMethod: 'CASH' }));
    data(await call('POST', '/inventory/adjustments', manager, { productId: bracelet.id, quantityDelta: -1, reason: 'Damaged in display' }), 201);
    expect(await check()).toEqual([]);
  });

  it('reports each kind of damage with the record it concerns', async () => {
    const bracelet = await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', quantity: 24 });
    const customer = data(await call('POST', '/customers', sales, { name: 'Maya Farah' }), 201);
    const invoice = data(await call('POST', '/invoices', sales, { customerId: customer.id, lines: [{ productId: bracelet.id, quantity: 2, unitPriceMinor: 364000 }], payment: { amountMinor: 100000, method: 'CASH' } }), 201);

    // The kind of edits a well-meaning person might make directly in the database.
    await db.query(`UPDATE stock_levels SET quantity = quantity + 5 WHERE product_id = $1`, [bracelet.id]);
    await db.query(`UPDATE invoices SET paid_minor = paid_minor + 50000 WHERE id = $1`, [invoice.id]);
    await db.query(`UPDATE tax_rates SET is_default = false WHERE organization_id = $1`, [org.id]);
    await db.query(`UPDATE organization_members SET is_active = false WHERE id = $1`, [ownerUser.memberId]);

    // (Totals that do not add up are already refused by a database constraint.)
    await expect(db.query(`UPDATE invoices SET total_minor = total_minor - 1 WHERE id = $1`, [invoice.id])).rejects.toThrow(/invoices_totals_chk/);

    const findings = await check();
    expect(findings.map((f) => f.check).sort()).toEqual(['has_active_owner', 'invoice_paid_matches_payments', 'one_default_tax_rate', 'stock_matches_ledger']);
    expect(findings.find((f) => f.check === 'stock_matches_ledger')).toEqual({ check: 'stock_matches_ledger', organizationId: org.id, entityId: bracelet.id, detail: 'stock level 27, ledger total 22' });
    expect(findings.find((f) => f.check === 'invoice_paid_matches_payments')).toMatchObject({ entityId: invoice.id, detail: 'paid 150000, payment rows 100000' });
  });

  it('purges only what has expired', async () => {
    const session = await login(t, salesUser);
    await call('POST', '/customers', sales, { name: 'Kept For Replay' });
    await t.app.inject({ method: 'POST', url: `${api}/auth/forgot-password`, payload: { email: salesUser.email } });
    const count = async (table: string) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
    const before = { keys: await count('idempotency_keys'), refresh: await count('refresh_tokens'), reset: await count('password_reset_tokens') };
    expect(before.keys).toBeGreaterThan(0);
    const purge = (now: Date) => purgeExpired(async (sql, values) => db.query(sql, values), now);

    expect(await purge(new Date())).toEqual({ idempotencyKeys: 0, refreshTokens: 0, passwordResetTokens: 0 });
    // Eight days on: idempotency records (kept 7 days) go; sessions are still valid.
    expect(await purge(new Date(Date.now() + 8 * 86_400_000))).toEqual({ idempotencyKeys: before.keys, refreshTokens: 0, passwordResetTokens: 0 });
    expect((await t.app.inject({ method: 'POST', url: `${api}/auth/refresh`, payload: { refreshToken: session.refreshToken } })).statusCode).toBe(200);
    // A year on: every token expired more than a month ago.
    const later = await purge(new Date(Date.now() + 365 * 86_400_000));
    expect(later.refreshTokens).toBe(before.refresh + 1); // + the token issued by the refresh above
    expect(later.passwordResetTokens).toBe(before.reset);
    expect(await count('refresh_tokens')).toBe(0);
  });
});
