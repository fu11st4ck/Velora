import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, CONFIDENTIAL_KEYS, createOrg, createTestApp, createUser, hasKeyDeep, login, ownerDb, resetDb, type SeededOrg, type SeededUser, type TestApp } from './helpers';

const api = '/api/v1';
let t: TestApp;
let db: Client;
let org: SeededOrg;
let managerUser: SeededUser;
let salesUser: SeededUser;
let manager: Record<string, string>;
let sales: Record<string, string>;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method, url: `${api}${url}`, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const create = (headers: Record<string, string>, body: unknown, key = randomUUID()) =>
  call('POST', '/customers', { ...headers, 'idempotency-key': key }, body);

/** Inserts an issued invoice directly, to exercise customer balances before the sales API exists. */
async function invoice(customerId: string, salespersonId: string, o: { total: number; paid?: number; returned?: number; dueInDays?: number; cancelled?: boolean }) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO invoices (id, organization_id, branch_id, number, status, customer_id, salesperson_id, currency_code,
       subtotal_minor, discount_minor, tax_name, tax_rate_bp, tax_minor, total_minor, cost_minor, paid_minor, returned_minor,
       payment_status, due_date, cancelled_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::"InvoiceStatus", $6, $7, 'AED', $8, 0, 'VAT 0%', 0, 0, $8, 0, $9, $10, 'PARTIAL',
       (now() AT TIME ZONE 'Asia/Dubai')::date + $11::int, $12, now())`,
    [id, org.id, org.branchId, `INV-${id.slice(0, 8)}`, o.cancelled ? 'CANCELLED' : 'ISSUED', customerId, salespersonId, o.total, o.paid ?? 0, o.returned ?? 0, o.dueInDays ?? 30, o.cancelled ? new Date() : null],
  );
}

beforeAll(async () => {
  t = await createTestApp();
  db = await ownerDb();
});
afterAll(async () => {
  await t.close();
  await db.end();
});
beforeEach(async () => {
  await resetDb(db);
  org = await createOrg(db);
  await db.query(`UPDATE organizations SET country_code = 'AE' WHERE id = $1`, [org.id]);
  managerUser = await createUser(db, org, 'MANAGER');
  salesUser = await createUser(db, org, 'SALES');
  manager = bearer((await login(t, managerUser)).accessToken);
  sales = bearer((await login(t, salesUser)).accessToken);
});

describe('create customer', () => {
  it('stores the details, normalizes the mobile number and audits the creation', async () => {
    const res = await create(sales, { name: ' Maya Farah ', company: 'Maison Luxe', mobile: '055 820 4412', email: 'maya@maisonluxe.example', address: 'Dubai, UAE', taxRegistrationNumber: '100123456700003' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({
      name: 'Maya Farah',
      company: 'Maison Luxe',
      mobile: '+971558204412',
      email: 'maya@maisonluxe.example',
      address: 'Dubai, UAE',
      taxRegistrationNumber: '100123456700003',
      archivedAt: null,
    });
    expect((await db.query(`SELECT action FROM audit_logs WHERE action = 'customer.create'`)).rowCount).toBe(1);
  });

  it('accepts a company without a person, and an international number as typed', async () => {
    const res = await create(sales, { company: 'ABC Trading', mobile: '+44 20 7946 0958' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ name: null, company: 'ABC Trading', mobile: '+442079460958' });
  });

  it('requires a name or a company (the reference marked only the name as required)', async () => {
    for (const body of [{}, { name: '  ', company: '' }, { mobile: '+971501234567' }]) {
      const res = await create(sales, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'name', rule: 'nameOrCompanyRequired' }] });
    }
    expect((await db.query('SELECT 1 FROM customers')).rowCount).toBe(0);
  });

  it('rejects an invalid phone number and an invalid email (the reference accepted both)', async () => {
    const phone = await create(sales, { name: 'A', mobile: '12345' });
    expect(phone.statusCode).toBe(400);
    expect(phone.json().error.details).toEqual([{ field: 'mobile', rule: 'phone' }]);
    const email = await create(sales, { name: 'A', email: 'not-an-email' });
    expect(email.statusCode).toBe(400);
    expect(email.json().error.details).toEqual([{ field: 'email', rule: 'isEmail' }]);
    expect((await create(sales, { name: 'A', unknownField: 1 })).statusCode).toBe(400);
  });

  it('keeps a client-generated id, replays the same request and refuses to reuse the id', async () => {
    const id = randomUUID();
    const key = randomUUID();
    const first = await create(sales, { id, name: 'Offline Customer' }, key);
    const replay = await create(sales, { id, name: 'Offline Customer' }, key);
    expect(first.json().data.id).toBe(id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(first.json());
    const clash = await create(sales, { id, name: 'Someone Else' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('CUSTOMER_EXISTS');
    expect((await db.query('SELECT 1 FROM customers')).rowCount).toBe(1);
  });

  it('requires an idempotency key', async () => {
    expect((await call('POST', '/customers', sales, { name: 'A' })).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('list and search customers', () => {
  beforeEach(async () => {
    await create(sales, { name: 'Arjun Mehta', company: 'ABC Trading', mobile: '+971 50 555 0184' });
    await create(sales, { name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971 55 820 4412', email: 'maya@maisonluxe.example' });
    await create(sales, { name: 'noura Al Mansoori', mobile: '+971 56 290 7218' });
    await create(sales, { company: 'Zenith Gems LLC' });
  });
  const names = async (qs: string) => {
    const res = await call('GET', `/customers${qs}`, sales);
    expect(res.statusCode, qs).toBe(200);
    return (res.json().data as { name: string | null; company: string | null }[]).map((c) => c.name ?? c.company);
  };

  it('lists by displayed name, case-insensitively', async () => {
    expect(await names('')).toEqual(['Arjun Mehta', 'Maya Farah', 'noura Al Mansoori', 'Zenith Gems LLC']);
  });

  it('searches name, company, email and phone digits as literal text', async () => {
    expect(await names('?q=maison')).toEqual(['Maya Farah']);
    expect(await names('?q=mansoori')).toEqual(['noura Al Mansoori']);
    expect(await names('?q=maisonluxe.example')).toEqual(['Maya Farah']);
    expect(await names('?q=zenith')).toEqual(['Zenith Gems LLC']);
    // Phone search ignores spacing and the local leading zero.
    expect(await names(`?q=${encodeURIComponent('050 555')}`)).toEqual(['Arjun Mehta']);
    expect(await names('?q=8204412')).toEqual(['Maya Farah']);
    expect(await names('?q=%25')).toEqual([]);
    expect(await names('?q=_')).toEqual([]);
  });

  it('finds an existing customer by exact mobile number in any spelling', async () => {
    expect(await names(`?mobile=${encodeURIComponent('055 820 4412')}`)).toEqual(['Maya Farah']);
    expect(await names(`?mobile=${encodeURIComponent('+971558204412')}`)).toEqual(['Maya Farah']);
    expect(await names(`?mobile=${encodeURIComponent('0501111111')}`)).toEqual([]);
    expect(await names('?mobile=abc')).toEqual([]);
  });

  it('pages without skipping or repeating, in both sort orders', async () => {
    for (const sort of ['name', '-createdAt']) {
      const all = await names(`?sort=${sort}`);
      const first = await call('GET', `/customers?sort=${sort}&limit=3`, sales);
      const second = await call('GET', `/customers?sort=${sort}&limit=3&cursor=${first.json().meta.nextCursor}`, sales);
      const paged = [...first.json().data, ...second.json().data].map((c: { name: string | null; company: string | null }) => c.name ?? c.company);
      expect(paged, sort).toEqual(all);
      expect(first.json().meta.hasMore).toBe(true);
      expect(second.json().meta).toEqual({ nextCursor: null, hasMore: false });
    }
    expect((await names('?sort=-createdAt'))[0]).toBe('Zenith Gems LLC');
    expect((await call('GET', '/customers?sort=balance', sales)).statusCode).toBe(400);
  });
});

describe('customer detail and balances', () => {
  let id: string;
  beforeEach(async () => {
    id = (await create(sales, { name: 'Maya Farah', company: 'Maison Luxe' })).json().data.id;
  });

  it('shows zero balances for a customer with no invoices', async () => {
    const res = await call('GET', `/customers/${id}`, manager);
    expect(res.json().data.summary).toEqual({ invoicedMinor: 0, outstandingMinor: 0, overdueMinor: 0, invoiceCount: 0, lastInvoiceAt: null });
  });

  it('totals issued invoices: invoiced, outstanding and overdue, ignoring cancelled ones', async () => {
    await invoice(id, managerUser.memberId, { total: 781200 }); // unpaid, not yet due
    await invoice(id, managerUser.memberId, { total: 382200, paid: 382200 }); // paid
    await invoice(id, managerUser.memberId, { total: 500000, paid: 100000, returned: 50000, dueInDays: -1 }); // overdue 3,500.00
    await invoice(id, managerUser.memberId, { total: 999900, cancelled: true });
    const { summary } = (await call('GET', `/customers/${id}`, manager)).json().data;
    expect(summary).toMatchObject({ invoicedMinor: 1663400, outstandingMinor: 1131200, overdueMinor: 350000, invoiceCount: 3 });
    expect(summary.lastInvoiceAt).toBeTruthy();
  });

  it('is not overdue on the due date itself', async () => {
    await invoice(id, managerUser.memberId, { total: 100000, dueInDays: 0 });
    expect((await call('GET', `/customers/${id}`, manager)).json().data.summary).toMatchObject({ outstandingMinor: 100000, overdueMinor: 0 });
  });

  it("shows the sales role totals for its own invoices only", async () => {
    await invoice(id, managerUser.memberId, { total: 781200 });
    await invoice(id, salesUser.memberId, { total: 100000, paid: 40000 });
    const res = await call('GET', `/customers/${id}`, sales);
    expect(res.json().data.summary).toMatchObject({ invoicedMinor: 100000, outstandingMinor: 60000, invoiceCount: 1 });
    expect(hasKeyDeep(res.json(), CONFIDENTIAL_KEYS)).toBeNull();
  });

  it('answers 404 for unknown ids', async () => {
    expect((await call('GET', `/customers/${randomUUID()}`, manager)).statusCode).toBe(404);
    expect((await call('GET', '/customers/not-a-uuid', manager)).statusCode).toBe(404);
  });
});

describe('edit and archive', () => {
  let id: string;
  beforeEach(async () => {
    id = (await create(sales, { name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412', email: 'maya@maisonluxe.example' })).json().data.id;
  });

  it('changes only the fields sent, clears a field sent as blank, and audits before/after', async () => {
    const res = await call('PATCH', `/customers/${id}`, sales, { mobile: '050 555 0184', email: '', address: 'Abu Dhabi' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971505550184', email: null, address: 'Abu Dhabi' });
    const audit = (await db.query(`SELECT before, after FROM audit_logs WHERE action = 'customer.update'`)).rows[0];
    expect(audit.before).toMatchObject({ mobile: '+971558204412', email: 'maya@maisonluxe.example' });
    expect(audit.after).toMatchObject({ mobile: '+971505550184', email: null });
  });

  it('keeps the name-or-company rule and phone validation when editing', async () => {
    expect((await call('PATCH', `/customers/${id}`, sales, { name: '' })).statusCode).toBe(200); // company remains
    const res = await call('PATCH', `/customers/${id}`, sales, { company: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ field: 'name', rule: 'nameOrCompanyRequired' }]);
    expect((await call('PATCH', `/customers/${id}`, sales, { mobile: '123' })).json().error.details).toEqual([{ field: 'mobile', rule: 'phone' }]);
    expect((await call('GET', `/customers/${id}`, sales)).json().data).toMatchObject({ name: null, company: 'Maison Luxe', mobile: '+971558204412' });
  });

  it('lets a manager archive; the customer leaves lists but stays readable, and cannot be edited', async () => {
    expect((await call('DELETE', `/customers/${id}`, sales)).statusCode).toBe(403);
    expect((await call('DELETE', `/customers/${id}`, manager)).statusCode).toBe(204);
    expect((await call('DELETE', `/customers/${id}`, manager)).statusCode).toBe(204);
    expect((await call('GET', '/customers', manager)).json().data).toEqual([]);
    expect((await call('GET', `/customers?mobile=${encodeURIComponent('+971558204412')}`, manager)).json().data).toEqual([]);
    expect((await call('GET', `/customers/${id}`, manager)).json().data.archivedAt).toBeTruthy();
    expect((await call('PATCH', `/customers/${id}`, manager, { name: 'x' })).json().error.code).toBe('INVALID_STATE');
    expect((await db.query('SELECT 1 FROM customers')).rowCount).toBe(1);
    expect((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'customer.archive'`)).rowCount).toBe(1);
  });
});

describe('tenant isolation', () => {
  it("treats another organization's customers as non-existent", async () => {
    const other = await createOrg(db, 'Other Jewellers');
    const otherSales = bearer((await login(t, await createUser(db, other, 'MANAGER'))).accessToken);
    const theirs = (await create(otherSales, { name: 'Their Customer', mobile: '+971501112233' })).json().data;

    expect((await call('GET', '/customers', manager)).json().data).toEqual([]);
    expect((await call('GET', '/customers?q=Their', manager)).json().data).toEqual([]);
    expect((await call('GET', `/customers?mobile=${encodeURIComponent('+971501112233')}`, manager)).json().data).toEqual([]);
    expect((await call('GET', `/customers/${theirs.id}`, manager)).statusCode).toBe(404);
    expect((await call('PATCH', `/customers/${theirs.id}`, manager, { name: 'hijack' })).statusCode).toBe(404);
    expect((await call('DELETE', `/customers/${theirs.id}`, manager)).statusCode).toBe(404);
    expect((await db.query('SELECT name, archived_at FROM customers WHERE id = $1', [theirs.id])).rows[0]).toEqual({ name: 'Their Customer', archived_at: null });
  });
});
