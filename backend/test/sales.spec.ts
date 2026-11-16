import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bearer,
  CONFIDENTIAL_KEYS,
  createOrg,
  createProduct,
  createTestApp,
  createUser,
  hasKeyDeep,
  login,
  ownerDb,
  resetDb,
  type SeededOrg,
  type SeededUser,
  type TestApp,
} from './helpers';

const api = '/api/v1';
let t: TestApp;
let db: Client;
let org: SeededOrg;
let managerUser: SeededUser;
let ahmedUser: SeededUser;
let manager: Record<string, string>;
let ahmed: Record<string, string>;
let bracelet: string; // cost 2,800.00 · 30% / 15% · 24 in stock → list 3,640.00, floor 3,220.00, ceiling 4,480.00
let tennis: string; //   cost 6,200.00 · 28% / 15% ·  4 in stock → list 7,936.00, floor 7,130.00
let cuff: string; //     cost 2,450.00 · 30% / 15% · 17 in stock → floor 2,817.50
let customerId: string;

type Res = Awaited<ReturnType<TestApp['app']['inject']>>;
const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: 'GET', url: `${api}${url}`, headers });
const post = (url: string, headers: Record<string, string>, payload: unknown = {}, key = randomUUID()) =>
  t.app.inject({ method: 'POST', url: `${api}${url}`, headers: { ...headers, 'idempotency-key': key }, payload: payload as object });
const data = (res: Res, status = 201) => {
  expect(res.statusCode, res.body).toBe(status);
  return res.json().data;
};
const sale = (over: Record<string, unknown> = {}) => ({
  customerId,
  lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 364000 }],
  ...over,
});
const stockOf = async (productId: string) =>
  (await db.query('SELECT quantity FROM stock_levels WHERE product_id = $1', [productId])).rows[0].quantity as number;
const count = async (table: string, where = 'true') => (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n as number;
const year = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(t.clock.now());
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t.clock.now());
const plusDays = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const relogin = async () => {
  manager = bearer((await login(t, managerUser)).accessToken);
  ahmed = bearer((await login(t, ahmedUser)).accessToken);
};

/** The ledger must always explain the stock level exactly (business rule S1). */
async function expectLedgerConsistent(): Promise<void> {
  const rows = (
    await db.query(`SELECT s.product_id, s.quantity, COALESCE(SUM(m.quantity_delta), 0)::int AS ledger
                    FROM stock_levels s LEFT JOIN stock_movements m ON m.product_id = s.product_id AND m.branch_id = s.branch_id
                    GROUP BY s.product_id, s.quantity`)
  ).rows;
  for (const r of rows) expect(r.ledger, `ledger for ${r.product_id}`).toBe(r.quantity);
}

/** Cached amounts on the invoice must equal what the payment and return rows add up to. */
async function expectInvoiceConsistent(id: string): Promise<void> {
  const row = (
    await db.query(
      `SELECT i.paid_minor::int AS paid, i.returned_minor::int AS returned,
              COALESCE((SELECT SUM(CASE kind WHEN 'PAYMENT' THEN amount_minor ELSE -amount_minor END) FROM payments WHERE invoice_id = i.id), 0)::int AS paid_rows,
              COALESCE((SELECT SUM(total_minor) FROM sales_returns WHERE invoice_id = i.id), 0)::int AS returned_rows
       FROM invoices i WHERE i.id = $1`,
      [id],
    )
  ).rows[0];
  // A cancelled invoice shows nothing as paid: its refund row cancels its payments.
  expect(row.paid).toBe(row.paid_rows);
  expect(row.returned).toBe(row.returned_rows);
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
  t.clock.reset();
  await resetDb(db);
  org = await createOrg(db);
  await db.query(`UPDATE organizations SET country_code = 'AE' WHERE id = $1`, [org.id]);
  managerUser = await createUser(db, org, 'MANAGER');
  ahmedUser = await createUser(db, org, 'SALES');
  await relogin();
  bracelet = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', quantity: 24, costMinor: 280000 })).id;
  tennis = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-DB-008', name: 'Diamond Tennis Bracelet', quantity: 4, costMinor: 620000, defaultMarkupBp: 2800 })).id;
  cuff = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-RC-021', name: 'Rose Gold Cuff', quantity: 17, costMinor: 245000 })).id;
  customerId = data(await post('/customers', ahmed, { name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412', taxRegistrationNumber: '100123456700003' })).id;
});

describe('pricing preview', () => {
  it("computes totals exactly, reproducing the reference's own quotation (2,989.00 − 150.00, VAT 5%)", async () => {
    const res = data(await post('/pricing/preview', ahmed, { lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 298900 }], discountMinor: 15000 }), 200);
    expect(res).toMatchObject({ subtotalMinor: 298900, discountMinor: 15000, tax: { name: 'VAT 5%', rateBp: 500, amountMinor: 14195 }, totalMinor: 298095, valid: true });
    expect(res.lines).toEqual([{ productId: cuff, quantity: 1, unitPriceMinor: 298900, lineTotalMinor: 298900, available: 17, issues: [] }]);
  });

  it('reports every problem at once instead of failing on the first', async () => {
    const res = data(
      await post('/pricing/preview', ahmed, {
        lines: [
          { productId: bracelet, quantity: 1, unitPriceMinor: 300000 }, // below 3,220.00
          { productId: bracelet, quantity: 1, unitPriceMinor: 500000 }, // above 4,480.00
          { productId: tennis, quantity: 3, unitPriceMinor: 793600 },
          { productId: tennis, quantity: 2, unitPriceMinor: 800000 }, // 3 + 2 > 4 in stock
          { productId: randomUUID(), quantity: 1, unitPriceMinor: 100 },
        ],
      }),
      200,
    );
    expect(res.valid).toBe(false);
    expect(res.lines.map((l: { issues: unknown[] }) => l.issues)).toEqual([
      [{ code: 'PRICE_BELOW_MINIMUM', floorPriceMinor: 322000 }],
      [{ code: 'PRICE_ABOVE_MAXIMUM', ceilingPriceMinor: 448000 }],
      [],
      [{ code: 'INSUFFICIENT_STOCK', available: 4 }],
      [{ code: 'PRODUCT_UNAVAILABLE' }],
    ]);
  });

  it('rejects invalid discounts (the reference accepted negative and oversized ones)', async () => {
    const line = { productId: bracelet, quantity: 1, unitPriceMinor: 364000 };
    expect((await post('/pricing/preview', ahmed, { lines: [line], discountMinor: -500 })).statusCode).toBe(400);
    expect((await post('/pricing/preview', ahmed, { lines: [line], discountMinor: 100.5 })).statusCode).toBe(400);
    const over = await post('/pricing/preview', ahmed, { lines: [line], discountMinor: 364001 });
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toMatchObject({ code: 'DISCOUNT_EXCEEDS_SUBTOTAL', details: [{ subtotalMinor: 364000 }] });
    expect(data(await post('/pricing/preview', ahmed, { lines: [line], discountMinor: 364000 }), 200)).toMatchObject({ tax: { amountMinor: 0 }, totalMinor: 0 });
  });

  it('applies a chosen tax rate and refuses an inactive one', async () => {
    const zero = (await db.query(`INSERT INTO tax_rates (id, organization_id, name, rate_bp, updated_at) VALUES (gen_random_uuid(), $1, 'Zero rated 0%', 0, now()) RETURNING id`, [org.id])).rows[0].id;
    const line = { productId: bracelet, quantity: 1, unitPriceMinor: 364000 };
    expect(data(await post('/pricing/preview', ahmed, { lines: [line], taxRateId: zero }), 200)).toMatchObject({ tax: { name: 'Zero rated 0%', amountMinor: 0 }, totalMinor: 364000 });
    await db.query('UPDATE tax_rates SET is_active = false WHERE id = $1', [zero]);
    expect((await post('/pricing/preview', ahmed, { lines: [line], taxRateId: zero })).json().error.code).toBe('TAX_RATE_INACTIVE');
  });

  it('lists the active tax rates for the cart, default first, within the organization only', async () => {
    await db.query(`INSERT INTO tax_rates (id, organization_id, name, rate_bp, updated_at) VALUES (gen_random_uuid(), $1, 'Zero rated 0%', 0, now()), (gen_random_uuid(), $1, 'Old rate', 700, now())`, [org.id]);
    await db.query(`UPDATE tax_rates SET is_active = false WHERE name = 'Old rate'`);
    const other = await createOrg(db, 'Other Jewellers');
    await db.query(`UPDATE tax_rates SET name = 'Their VAT' WHERE organization_id = $1`, [other.id]);
    const rates = data(await get('/tax-rates', ahmed), 200);
    expect(rates.map((r: { name: string; rateBp: number; isDefault: boolean }) => [r.name, r.rateBp, r.isDefault])).toEqual([['VAT 5%', 500, true], ['Zero rated 0%', 0, false]]);
    expect((await t.app.inject({ method: 'GET', url: `${api}/tax-rates` })).statusCode).toBe(401);
  });

  it('never reveals cost or markup to the sales role', async () => {
    const res = await post('/pricing/preview', ahmed, { lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 300000 }] });
    expect(hasKeyDeep(res.json(), CONFIDENTIAL_KEYS)).toBeNull();
  });
});

describe('scenario 1 — successful sale', () => {
  it('issues the invoice, takes the stock, records the payment and audits it, in one step', async () => {
    const inv = data(
      await post('/invoices', ahmed, {
        customerId,
        lines: [
          { productId: bracelet, quantity: 2, unitPriceMinor: 364000 },
          { productId: cuff, quantity: 1, unitPriceMinor: 298900 },
        ],
        discountMinor: 15000,
        payment: { amountMinor: 1062495, method: 'CASH' },
        notes: 'Gift wrapped',
      }),
    );
    // subtotal 10,269.00 − 150.00 = 10,119.00; VAT 5% = 505.95; total 10,624.95
    expect(inv).toMatchObject({
      number: `INV-${year()}-00001`,
      status: 'ISSUED',
      currencyCode: 'AED',
      subtotalMinor: 1026900,
      discountMinor: 15000,
      tax: { name: 'VAT 5%', rateBp: 500, amountMinor: 50595 },
      totalMinor: 1062495,
      paidMinor: 1062495,
      paymentStatus: 'PAID',
      notes: 'Gift wrapped',
    });
    expect(inv.totalMinor).toBe(1026900 - 15000 + 50595);
  });

  it('snapshots customer and product details and never sends cost to the salesperson', async () => {
    const res = await post('/invoices', ahmed, sale({ payment: { amountMinor: 382200, method: 'CASH' } }));
    const inv = data(res);
    expect(inv).toMatchObject({
      totalMinor: 382200,
      paidMinor: 382200,
      balanceMinor: 0,
      paymentStatus: 'PAID',
      isOverdue: false,
      dueDate: null,
      customer: { id: customerId, name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412', taxRegistrationNumber: '100123456700003' },
      salesperson: { memberId: ahmedUser.memberId, fullName: 'SALES User' },
      lines: [{ lineNo: 1, productId: bracelet, name: 'Alhambra Gold Bracelet', sku: 'VLR-BR-001', quantity: 1, returnedQuantity: 0, unitPriceMinor: 364000, lineTotalMinor: 364000 }],
      payments: [{ kind: 'PAYMENT', method: 'CASH', amountMinor: 382200, recordedBy: { memberId: ahmedUser.memberId } }],
      returns: [],
    });
    expect(hasKeyDeep(res.json(), CONFIDENTIAL_KEYS)).toBeNull();

    expect(await stockOf(bracelet)).toBe(23);
    const move = (await db.query(`SELECT type, quantity_delta, balance_after, unit_cost_minor::int AS cost, invoice_id FROM stock_movements WHERE type = 'SALE'`)).rows;
    expect(move).toEqual([{ type: 'SALE', quantity_delta: -1, balance_after: 23, cost: 280000, invoice_id: inv.id }]);
    expect((await db.query(`SELECT after FROM audit_logs WHERE action = 'invoice.issue'`)).rows[0].after).toMatchObject({ number: inv.number, totalMinor: '382200', receivedMinor: '382200', method: 'CASH' });
    await expectLedgerConsistent();

    // Later edits to the customer or product do not change the issued invoice.
    await t.app.inject({ method: 'PATCH', url: `${api}/customers/${customerId}`, headers: ahmed, payload: { name: 'Renamed' } });
    await db.query(`UPDATE products SET name = 'Renamed product' WHERE id = $1`, [bracelet]);
    const again = data(await get(`/invoices/${inv.id}`, ahmed), 200);
    expect(again.customer.name).toBe('Maya Farah');
    expect(again.lines[0].name).toBe('Alhambra Gold Bracelet');
  });

  it('shows the manager cost and profit for the same invoice', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ lines: [{ productId: tennis, quantity: 1, unitPriceMinor: 744000 }] })));
    const seen = data(await get(`/invoices/${inv.id}`, manager), 200);
    expect(seen.lines[0]).toMatchObject({ unitCostMinor: 620000, markupBp: 2000 });
    expect(seen.profit).toEqual({ costMinor: 620000, grossProfitMinor: 124000, marginBp: 1666 });
  });

  it('requires an idempotency key, and a retry issues nothing new', async () => {
    expect((await t.app.inject({ method: 'POST', url: `${api}/invoices`, headers: ahmed, payload: sale() })).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = randomUUID();
    const first = await post('/invoices', ahmed, sale(), key);
    const retry = await post('/invoices', ahmed, sale(), key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await count('invoices')).toBe(1);
    expect(await stockOf(bracelet)).toBe(23);
  });
});

describe('scenario 2 — insufficient inventory', () => {
  it('rejects the sale with per-line availability and leaves no trace', async () => {
    const res = await post('/invoices', ahmed, {
      customerId,
      lines: [
        { productId: bracelet, quantity: 1, unitPriceMinor: 364000 },
        { productId: tennis, quantity: 5, unitPriceMinor: 793600 },
      ],
      payment: { amountMinor: 100, method: 'CASH' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: [{ lineNo: 2, productId: tennis, requested: 5, available: 4 }] });
    expect(await stockOf(bracelet)).toBe(24);
    expect(await stockOf(tennis)).toBe(4);
    for (const table of ['invoices', 'invoice_items', 'payments']) expect(await count(table), table).toBe(0);
    expect(await count('stock_movements', `type = 'SALE'`)).toBe(0);
    expect(await count('audit_logs', `action = 'invoice.issue'`)).toBe(0);
    // The number was not consumed: the next invoice is still the first.
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`INV-${year()}-00001`);
  });

  it('counts the same product across lines (the reference oversold 8 of 4 this way)', async () => {
    const res = await post('/invoices', ahmed, {
      customerId,
      lines: [
        { productId: tennis, quantity: 4, unitPriceMinor: 744000 },
        { productId: tennis, quantity: 4, unitPriceMinor: 775000 },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(await stockOf(tennis)).toBe(4);
  });

  it('allows the same product on two lines when stock covers both', async () => {
    const inv = data(await post('/invoices', ahmed, { customerId, lines: [{ productId: tennis, quantity: 2, unitPriceMinor: 744000 }, { productId: tennis, quantity: 2, unitPriceMinor: 775000 }] }));
    expect(inv.lines).toHaveLength(2);
    expect(await stockOf(tennis)).toBe(0);
    expect((await db.query(`SELECT balance_after FROM stock_movements WHERE type = 'SALE' ORDER BY balance_after DESC`)).rows.map((r) => r.balance_after)).toEqual([2, 0]);
  });
});

describe('scenarios 3, 4, 5 — partial, full and credit payment', () => {
  it('partial payment: status PARTIAL with a due date; paying the rest makes it PAID', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ payment: { amountMinor: 100000, method: 'BANK_TRANSFER', reference: 'FT26319XK2' } })));
    expect(inv).toMatchObject({ paymentStatus: 'PARTIAL', paidMinor: 100000, balanceMinor: 282200, creditDays: 30, dueDate: plusDays(30) });
    expect(inv.payments[0]).toMatchObject({ method: 'BANK_TRANSFER', reference: 'FT26319XK2' });

    const pay = data(await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 282200, method: 'CASH' }));
    expect(pay.payment).toMatchObject({ kind: 'PAYMENT', method: 'CASH', amountMinor: 282200 });
    expect(pay.invoice).toMatchObject({ paymentStatus: 'PAID', paidMinor: 382200, balanceMinor: 0 });
    expect(pay.invoice.payments).toHaveLength(2);
    await expectInvoiceConsistent(inv.id);
  });

  it('full payment: PAID with no due date; another payment is refused', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ payment: { amountMinor: 382200, method: 'CASH' }, creditDays: 10 })));
    expect(inv).toMatchObject({ paymentStatus: 'PAID', dueDate: null, creditDays: null });
    const res = await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 1, method: 'CASH' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVOICE_ALREADY_PAID');
  });

  it('credit sale: UNPAID, due after the credit period, and overdue only after the due date', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ creditDays: 7 })));
    expect(inv).toMatchObject({ paymentStatus: 'UNPAID', paidMinor: 0, balanceMinor: 382200, creditDays: 7, dueDate: plusDays(7), isOverdue: false, payments: [] });

    t.clock.advance(7 * 86_400_000);
    await relogin();
    expect(data(await get(`/invoices/${inv.id}`, ahmed), 200).isOverdue, 'on the due date').toBe(false);
    t.clock.advance(86_400_000);
    await relogin();
    expect(data(await get(`/invoices/${inv.id}`, ahmed), 200).isOverdue, 'the day after').toBe(true);
    // Paying it off ends the overdue state.
    const paid = data(await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 382200, method: 'CASH' }));
    expect(paid.invoice).toMatchObject({ isOverdue: false, paymentStatus: 'PAID' });
  });

  it('accepts an explicit due date and rejects one in the past', async () => {
    expect(data(await post('/invoices', ahmed, sale({ dueDate: plusDays(45) }))).dueDate).toBe(plusDays(45));
    const res = await post('/invoices', ahmed, sale({ dueDate: plusDays(-1) }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details).toEqual([{ field: 'dueDate', rule: 'notInPast' }]);
  });

  it('refuses overpayment, zero and negative amounts (the reference accepted them)', async () => {
    const over = await post('/invoices', ahmed, sale({ payment: { amountMinor: 382201, method: 'CASH' } }));
    expect(over.json().error).toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE', details: [{ balanceMinor: 382200 }] });
    expect(await count('invoices')).toBe(0);

    const inv = data(await post('/invoices', ahmed, sale()));
    for (const amountMinor of [0, -50, 10.5]) {
      expect((await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor, method: 'CASH' })).statusCode, String(amountMinor)).toBe(400);
    }
    expect((await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 100, method: 'CREDIT' })).statusCode).toBe(400);
    const tooMuch = await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 382201, method: 'CASH' });
    expect(tooMuch.json().error).toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE', details: [{ balanceMinor: 382200 }] });
    expect(await count('payments')).toBe(0);
  });

  it('refuses a payment dated in the future or before the invoice', async () => {
    const inv = data(await post('/invoices', ahmed, sale()));
    const future = new Date(t.clock.now().getTime() + 3_600_000).toISOString();
    const before = new Date(t.clock.now().getTime() - 86_400_000).toISOString();
    expect((await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 100, method: 'CASH', receivedAt: future })).json().error.details).toEqual([{ field: 'receivedAt', rule: 'notInFuture' }]);
    expect((await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 100, method: 'CASH', receivedAt: before })).json().error.details).toEqual([{ field: 'receivedAt', rule: 'notBeforeInvoice' }]);
  });
});

describe('scenario 9 — duplicate payment submission', () => {
  it('records one payment when the same request is sent again, or five times at once', async () => {
    const inv = data(await post('/invoices', ahmed, sale()));
    const key = randomUUID();
    const body = { amountMinor: 100000, method: 'CASH' };
    const first = await post(`/invoices/${inv.id}/payments`, ahmed, body, key);
    const again = await post(`/invoices/${inv.id}/payments`, ahmed, body, key);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.json()).toEqual(first.json());

    const key2 = randomUUID();
    const burst = await Promise.all(Array.from({ length: 5 }, () => post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 50000, method: 'CASH' }, key2)));
    expect(burst.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(await count('payments')).toBe(2);
    expect(data(await get(`/invoices/${inv.id}`, ahmed), 200)).toMatchObject({ paidMinor: 150000, balanceMinor: 232200 });

    const reused = await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 999, method: 'CASH' }, key);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await expectInvoiceConsistent(inv.id);
  });

  it('never accepts more than the balance when different payments race', async () => {
    const inv = data(await post('/invoices', ahmed, sale())); // balance 3,822.00
    const results = await Promise.all(Array.from({ length: 6 }, () => post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 100000, method: 'CASH' })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode === 422).every((r) => r.json().error.code === 'PAYMENT_EXCEEDS_BALANCE')).toBe(true);
    expect(data(await get(`/invoices/${inv.id}`, ahmed), 200)).toMatchObject({ paidMinor: 300000, balanceMinor: 82200, paymentStatus: 'PARTIAL' });
    await expectInvoiceConsistent(inv.id);
  });
});

describe('scenario 10 — concurrent stock updates', () => {
  it('sells the last units exactly once when eight sales race for four pieces', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => post('/invoices', ahmed, { customerId, lines: [{ productId: tennis, quantity: 1, unitPriceMinor: 793600 }] })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(4);
    const rejected = results.filter((r) => r.statusCode !== 201);
    expect(rejected.every((r) => r.statusCode === 409 && r.json().error.code === 'INSUFFICIENT_STOCK')).toBe(true);
    expect(await stockOf(tennis)).toBe(0);
    await expectLedgerConsistent();
    // Numbers are consecutive with no gaps, even though four attempts were rolled back.
    const numbers = (await db.query('SELECT number FROM invoices ORDER BY number')).rows.map((r) => r.number);
    expect(numbers).toEqual([1, 2, 3, 4].map((n) => `INV-${year()}-0000${n}`));
  });

  it('does not deadlock when sales list the same products in opposite orders', async () => {
    const a = { customerId, lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 364000 }, { productId: cuff, quantity: 1, unitPriceMinor: 318500 }] };
    const b = { customerId, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }, { productId: bracelet, quantity: 1, unitPriceMinor: 364000 }] };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/invoices', ahmed, i % 2 ? a : b)));
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    expect(await stockOf(bracelet)).toBe(14);
    expect(await stockOf(cuff)).toBe(7);
    await expectLedgerConsistent();
  });

  it('keeps stock right when a sale and a stock adjustment race', async () => {
    const results = await Promise.all([
      post('/invoices', ahmed, { customerId, lines: [{ productId: tennis, quantity: 3, unitPriceMinor: 793600 }] }),
      post('/inventory/adjustments', manager, { productId: tennis, quantityDelta: -3, reason: 'Count correction' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await stockOf(tennis)).toBe(1);
    await expectLedgerConsistent();
  });
});

describe('price limits', () => {
  it('stops the sales role below the lowest price, even with a reason', async () => {
    const res = await post('/invoices', ahmed, sale({ lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 321999, belowMinimumReason: 'Loyal customer' }] }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: 'PRICE_BELOW_MINIMUM', details: [{ lineNo: 1, floorPriceMinor: 322000 }] });
    expect(data(await post('/invoices', ahmed, sale({ lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 322000 }] }))).totalMinor).toBe(338100);
  });

  it('lets a manager go below with a reason, and records the reason', async () => {
    const without = await post('/invoices', manager, sale({ lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 300000 }] }));
    expect(without.json().error.code).toBe('PRICE_BELOW_MINIMUM');
    const inv = data(await post('/invoices', manager, sale({ lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 300000, belowMinimumReason: 'Display piece, small scratch' }] })));
    expect(inv.lines[0]).toMatchObject({ unitPriceMinor: 300000, markupBp: 714 });
    const audit = (await db.query(`SELECT after FROM audit_logs WHERE action = 'invoice.issue'`)).rows[0].after;
    expect(audit.belowMinimum).toEqual([{ lineNo: 1, unitPriceMinor: '300000', reason: 'Display piece, small scratch' }]);
  });

  it('stops everyone above the highest price', async () => {
    const res = await post('/invoices', manager, sale({ lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 448001 }] }));
    expect(res.json().error).toMatchObject({ code: 'PRICE_ABOVE_MAXIMUM', details: [{ ceilingPriceMinor: 448000 }] });
  });

  it('refuses archived products and archived customers', async () => {
    await db.query(`UPDATE products SET archived_at = now(), is_active = false WHERE id = $1`, [cuff]);
    expect((await post('/invoices', ahmed, sale({ lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }] }))).json().error.code).toBe('PRODUCT_UNAVAILABLE');
    await db.query(`UPDATE customers SET archived_at = now() WHERE id = $1`, [customerId]);
    expect((await post('/invoices', ahmed, sale())).json().error.code).toBe('CUSTOMER_ARCHIVED');
    expect((await post('/invoices', ahmed, sale({ customerId: randomUUID() }))).statusCode).toBe(404);
  });
});

describe('scenario 6 and 8 — cancellation and stock restoration', () => {
  it('refunds what was received, restores the stock and keeps the number', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ lines: [{ productId: bracelet, quantity: 2, unitPriceMinor: 364000 }], payment: { amountMinor: 300000, method: 'CASH' } })));
    expect(await stockOf(bracelet)).toBe(22);

    expect((await post(`/invoices/${inv.id}/cancel`, ahmed, { reason: 'Customer changed mind' })).statusCode).toBe(403);
    const needsMethod = await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'Customer changed mind' });
    expect(needsMethod.json().error).toMatchObject({ code: 'REFUND_METHOD_REQUIRED', details: [{ refundMinor: 300000 }] });
    expect((await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'x' })).statusCode).toBe(400);

    const cancelled = data(await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'Customer changed mind', refundMethod: 'CASH' }), 200);
    expect(cancelled).toMatchObject({
      number: inv.number,
      status: 'CANCELLED',
      paidMinor: 0,
      isOverdue: false,
      cancellation: { reason: 'Customer changed mind', by: { memberId: managerUser.memberId, fullName: 'MANAGER User' } },
    });
    expect(cancelled.payments.map((p: { kind: string; amountMinor: number }) => [p.kind, p.amountMinor])).toEqual([['PAYMENT', 300000], ['REFUND', 300000]]);
    expect(await stockOf(bracelet)).toBe(24);
    const moves = (await db.query(`SELECT type, quantity_delta, balance_after FROM stock_movements WHERE invoice_id = $1 ORDER BY created_at, id`, [inv.id])).rows;
    expect(moves).toEqual([
      { type: 'SALE', quantity_delta: -2, balance_after: 22 },
      { type: 'SALE_CANCELLATION', quantity_delta: 2, balance_after: 24 },
    ]);
    expect((await db.query(`SELECT cost_minor::int AS c FROM products WHERE id = $1`, [bracelet])).rows[0].c).toBe(280000);
    await expectLedgerConsistent();
    await expectInvoiceConsistent(inv.id);

    // A cancelled invoice cannot be changed again.
    for (const [path, body] of [['cancel', { reason: 'again' }], ['payments', { amountMinor: 100, method: 'CASH' }], ['returns', { reason: 'late', lines: [{ lineNo: 1, quantity: 1 }] }]] as const) {
      const res = await post(`/invoices/${inv.id}/${path}`, manager, body);
      expect(res.statusCode, path).toBe(409);
      expect(res.json().error.code, path).toBe('INVOICE_CANCELLED');
    }
    // The next invoice takes the next number; the cancelled one keeps its own.
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`INV-${year()}-00002`);
  });

  it('cancels an unpaid invoice without a refund', async () => {
    const inv = data(await post('/invoices', ahmed, sale()));
    const cancelled = data(await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'Entered by mistake' }), 200);
    expect(cancelled.payments).toEqual([]);
    expect(await stockOf(bracelet)).toBe(24);
  });

  it('re-averages cost when restored stock was sold at a different cost', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ lines: [{ productId: bracelet, quantity: 4, unitPriceMinor: 364000 }] })));
    // Stock received after the sale at a higher cost: 20 × 2,800 + 10 × 3,100 → average 2,900.00
    data(await post('/inventory/receipts', manager, { productId: bracelet, quantity: 10, unitCostMinor: 310000 }));
    data(await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'Order withdrawn' }), 200);
    // 30 × 2,900 + 4 × 2,800 = 98,200 / 34 = 2,888.2352… → 2,888.24
    expect((await db.query(`SELECT cost_minor::int AS c FROM products WHERE id = $1`, [bracelet])).rows[0].c).toBe(288824);
    expect(await stockOf(bracelet)).toBe(34);
  });
});

describe('scenario 7 and 8 — returns', () => {
  /** 3 bracelets at 3,640.00 with 100.00 discount: net 10,820.00, VAT 541.00, total 11,361.00 */
  const sold = async (payment?: Record<string, unknown>) =>
    data(await post('/invoices', ahmed, { customerId, lines: [{ productId: bracelet, quantity: 3, unitPriceMinor: 364000 }], discountMinor: 10000, ...(payment ? { payment } : {}) }));

  it('credits the returned share, restocks it, and leaves no rounding residue across returns', async () => {
    const inv = await sold();
    expect(inv).toMatchObject({ totalMinor: 1136100, tax: { amountMinor: 54100 } });
    expect((await post(`/invoices/${inv.id}/returns`, ahmed, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }] })).statusCode).toBe(403);

    const first = data(await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }] }));
    // 10,820.00 / 3 = 3,606.666… → 3,606.67; 541.00 / 3 = 180.333… → 180.33
    expect(first.return).toMatchObject({ number: `CN-${year()}-00001`, subtotalMinor: 360667, taxMinor: 18033, totalMinor: 378700, refundMinor: 0, lines: [{ lineNo: 1, quantity: 1, restock: true }] });
    expect(first.invoice).toMatchObject({ returnedMinor: 378700, balanceMinor: 757400, paymentStatus: 'UNPAID' });
    expect(first.invoice.lines[0].returnedQuantity).toBe(1);
    expect(await stockOf(bracelet)).toBe(22);

    const second = data(await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 2 }] }));
    // The final units take exactly what is left: 10,820.00 − 3,606.67 and 541.00 − 180.33.
    expect(second.return).toMatchObject({ number: `CN-${year()}-00002`, subtotalMinor: 721333, taxMinor: 36067, totalMinor: 757400 });
    expect(second.invoice).toMatchObject({ returnedMinor: 1136100, balanceMinor: 0, paymentStatus: 'PAID' });
    expect(await stockOf(bracelet)).toBe(24);
    await expectLedgerConsistent();
    await expectInvoiceConsistent(inv.id);

    const over = await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Too many', lines: [{ lineNo: 1, quantity: 1 }] });
    expect(over.statusCode).toBe(422);
    expect(over.json().error).toMatchObject({ code: 'RETURN_QUANTITY_EXCEEDS_SOLD', details: [{ lineNo: 1, requested: 1, returnable: 0 }] });
    expect((await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'After returns' })).json().error.code).toBe('INVOICE_HAS_RETURNS');
  });

  it('refunds only what exceeds the balance, and asks how when a refund is due', async () => {
    const inv = await sold({ amountMinor: 1000000, method: 'CASH' }); // balance 1,361.00
    const needs = await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }] });
    expect(needs.statusCode).toBe(422);
    // credit 3,787.00 − balance 1,361.00 = 2,426.00 to refund
    expect(needs.json().error).toMatchObject({ code: 'REFUND_METHOD_REQUIRED', details: [{ refundMinor: 242600 }] });
    expect(await count('sales_returns')).toBe(0);
    expect(await stockOf(bracelet)).toBe(21);

    const done = data(await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }], refund: { method: 'BANK_TRANSFER', reference: 'RF-1' } }));
    expect(done.return.refundMinor).toBe(242600);
    expect(done.invoice).toMatchObject({ paidMinor: 757400, returnedMinor: 378700, balanceMinor: 0, paymentStatus: 'PAID' });
    expect(done.invoice.payments.at(-1)).toMatchObject({ kind: 'REFUND', method: 'BANK_TRANSFER', amountMinor: 242600, reference: 'RF-1' });
    await expectInvoiceConsistent(inv.id);
  });

  it('does not restock damaged items, and keeps their cost in the sale', async () => {
    const inv = await sold();
    const res = data(await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Arrived damaged', lines: [{ lineNo: 1, quantity: 1, restock: false }] }));
    expect(res.return.lines[0].restock).toBe(false);
    expect(await stockOf(bracelet)).toBe(21);
    expect(await count('stock_movements', `type = 'CUSTOMER_RETURN'`)).toBe(0);
    // Net sales 10,820.00 − 3,606.67 = 7,213.33; cost stays 3 × 2,800.00 because nothing came back.
    expect(data(await get(`/invoices/${inv.id}`, manager), 200).profit).toMatchObject({ costMinor: 840000, grossProfitMinor: 721333 - 840000 });
    await expectLedgerConsistent();
  });

  it('reduces cost of goods for restocked returns', async () => {
    const inv = await sold();
    data(await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }] }));
    expect(data(await get(`/invoices/${inv.id}`, manager), 200).profit).toEqual({ costMinor: 560000, grossProfitMinor: 721333 - 560000, marginBp: 2236 });
  });

  it('validates the lines of a return', async () => {
    const inv = await sold();
    expect((await post(`/invoices/${inv.id}/returns`, manager, { reason: 'x', lines: [{ lineNo: 1, quantity: 1 }] })).statusCode).toBe(400);
    expect((await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [] })).statusCode).toBe(400);
    expect((await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1 }, { lineNo: 1, quantity: 1 }] })).json().error.details).toEqual([{ field: 'lines', rule: 'duplicateLine' }]);
    expect((await post(`/invoices/${inv.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 9, quantity: 1 }] })).json().error.code).toBe('RETURN_QUANTITY_EXCEEDS_SOLD');
    expect(await count('sales_returns')).toBe(0);
  });
});

describe('refunds as corrections', () => {
  it('lets a manager reverse a mis-recorded payment with a note', async () => {
    const inv = data(await post('/invoices', ahmed, sale({ payment: { amountMinor: 382200, method: 'CASH' } })));
    expect((await post(`/invoices/${inv.id}/refunds`, ahmed, { amountMinor: 100, method: 'CASH', note: 'not allowed' })).statusCode).toBe(403);
    expect((await post(`/invoices/${inv.id}/refunds`, manager, { amountMinor: 100, method: 'CASH' })).statusCode).toBe(400);
    expect((await post(`/invoices/${inv.id}/refunds`, manager, { amountMinor: 382201, method: 'CASH', note: 'too much' })).json().error.code).toBe('REFUND_EXCEEDS_PAID');
    const res = data(await post(`/invoices/${inv.id}/refunds`, manager, { amountMinor: 82200, method: 'CASH', note: 'Entered 3,822 instead of 3,000' }));
    expect(res.invoice).toMatchObject({ paidMinor: 300000, balanceMinor: 82200, paymentStatus: 'PARTIAL' });
    expect(res.invoice.dueDate).toBeNull(); // was paid in full at issue; follow-up handled by staff
    expect(await count('payments')).toBe(2);
    await expectInvoiceConsistent(inv.id);
  });
});

describe('quotations', () => {
  const quote = (over: Record<string, unknown> = {}) => ({ customerId, lines: [{ productId: tennis, quantity: 6, unitPriceMinor: 793600 }], ...over });

  it('fixes prices without checking, reserving or changing stock', async () => {
    const q = data(await post('/quotations', ahmed, quote({ discountMinor: 10000 })));
    expect(q).toMatchObject({ number: `QT-${year()}-00001`, status: 'OPEN', validUntil: plusDays(14), subtotalMinor: 4761600, discountMinor: 10000, invoice: null });
    expect(q.totalMinor).toBe(4751600 + 237580);
    expect(await stockOf(tennis)).toBe(4);
    expect(await count('stock_movements', `type = 'SALE'`)).toBe(0);
    expect(hasKeyDeep(q, CONFIDENTIAL_KEYS)).toBeNull();
  });

  it('numbers quotations, invoices and credit notes independently', async () => {
    data(await post('/quotations', ahmed, quote()));
    data(await post('/invoices', ahmed, sale()));
    expect(data(await post('/quotations', ahmed, quote())).number).toBe(`QT-${year()}-00002`);
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`INV-${year()}-00002`);
  });

  it('applies the same price limits as invoices', async () => {
    expect((await post('/quotations', ahmed, quote({ lines: [{ productId: tennis, quantity: 1, unitPriceMinor: 700000 }] }))).json().error.code).toBe('PRICE_BELOW_MINIMUM');
    expect((await post('/quotations', ahmed, quote({ validUntil: plusDays(-1) }))).json().error.details).toEqual([{ field: 'validUntil', rule: 'notInPast' }]);
  });

  it('expires after its validity date without being edited', async () => {
    const q = data(await post('/quotations', ahmed, quote({ validUntil: plusDays(2) })));
    t.clock.advance(3 * 86_400_000);
    await relogin();
    expect(data(await get(`/quotations/${q.id}`, ahmed), 200).status).toBe('EXPIRED');
    expect((await db.query('SELECT status FROM quotations WHERE id = $1', [q.id])).rows[0].status).toBe('OPEN');
  });

  it('can be cancelled once', async () => {
    const q = data(await post('/quotations', ahmed, quote()));
    expect(data(await post(`/quotations/${q.id}/cancel`, ahmed, { reason: 'Customer declined' }), 200).status).toBe('CANCELLED');
    const again = await post(`/quotations/${q.id}/cancel`, ahmed, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('INVALID_STATE');
  });

  it('converts to an invoice exactly once, re-checking stock at that moment', async () => {
    const q = data(await post('/quotations', ahmed, quote()));
    const short = await post('/invoices', ahmed, { customerId, quotationId: q.id, lines: [{ productId: tennis, quantity: 6, unitPriceMinor: 793600 }] });
    expect(short.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(data(await get(`/quotations/${q.id}`, ahmed), 200).status).toBe('OPEN');

    const body = { customerId, quotationId: q.id, lines: [{ productId: tennis, quantity: 2, unitPriceMinor: 793600 }] };
    const results = await Promise.all([post('/invoices', ahmed, body), post('/invoices', ahmed, body), post('/invoices', ahmed, body)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    const inv = results.find((r) => r.statusCode === 201)?.json().data;
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error.code === 'QUOTATION_ALREADY_CONVERTED' && r.json().error.details[0].invoiceId === inv.id)).toBe(true);
    expect(inv.quotation).toEqual({ id: q.id, number: q.number });
    expect(data(await get(`/quotations/${q.id}`, ahmed), 200)).toMatchObject({ status: 'CONVERTED', invoice: { id: inv.id, number: inv.number } });
    expect(await stockOf(tennis)).toBe(2);
    expect((await post(`/quotations/${q.id}/cancel`, ahmed, {})).json().error.code).toBe('INVALID_STATE');
  });
});

describe('document numbering', () => {
  it('starts a new sequence each year, by the organization timezone', async () => {
    // 20:30 UTC on 31 December is already 00:30 on 1 January in Dubai.
    const target = Date.UTC(Number(year()), 11, 31, 20, 30);
    t.clock.advance(target - t.clock.now().getTime());
    await relogin();
    const nextYear = String(Number(new Date(target).getUTCFullYear()) + 1);
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`INV-${nextYear}-00001`);
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`INV-${nextYear}-00002`);
  });

  it('keeps a configured prefix', async () => {
    await db.query(`INSERT INTO document_sequences (id, organization_id, type, year, prefix, last_number) VALUES (gen_random_uuid(), $1, 'INVOICE', 2020, 'VLR', 41)`, [org.id]);
    expect(data(await post('/invoices', ahmed, sale())).number).toBe(`VLR-${year()}-00001`);
  });
});

describe('scenario 14 — access to documents', () => {
  it("hides one salesperson's documents from another, and everything from other organizations", async () => {
    const colleague = bearer((await login(t, await createUser(db, org, 'SALES'))).accessToken);
    const inv = data(await post('/invoices', ahmed, sale({ payment: { amountMinor: 100, method: 'CASH' } })));
    const q = data(await post('/quotations', ahmed, { customerId, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }] }));

    for (const who of [colleague]) {
      expect((await get(`/invoices/${inv.id}`, who)).statusCode).toBe(404);
      expect((await get(`/quotations/${q.id}`, who)).statusCode).toBe(404);
      expect((await post(`/invoices/${inv.id}/payments`, who, { amountMinor: 100, method: 'CASH' })).statusCode).toBe(404);
      expect((await post(`/quotations/${q.id}/cancel`, who, {})).statusCode).toBe(404);
      expect((await post('/invoices', who, { customerId, quotationId: q.id, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }] })).statusCode).toBe(404);
      expect(data(await get('/documents', who), 200)).toEqual([]);
    }
    expect(data(await get(`/invoices/${inv.id}`, manager), 200).number).toBe(inv.number);

    const other = await createOrg(db, 'Other Jewellers');
    const outsider = bearer((await login(t, await createUser(db, other, 'OWNER'))).accessToken);
    expect((await get(`/invoices/${inv.id}`, outsider)).statusCode).toBe(404);
    expect((await post(`/invoices/${inv.id}/cancel`, outsider, { reason: 'not mine' })).statusCode).toBe(404);
    expect((await post(`/invoices/${inv.id}/returns`, outsider, { reason: 'not mine', lines: [{ lineNo: 1, quantity: 1 }] })).statusCode).toBe(404);
    expect(data(await get('/documents', outsider), 200)).toEqual([]);
    // Their products and customers cannot be used on our invoice, nor ours on theirs.
    expect((await post('/invoices', outsider, sale())).statusCode).toBe(404);
    expect(await count('payments')).toBe(1);
  });

  it('requires authentication on every sales route', async () => {
    for (const [method, url] of [['GET', '/documents'], ['POST', '/invoices'], ['POST', '/quotations'], ['POST', '/pricing/preview'], ['GET', `/invoices/${randomUUID()}`]] as const) {
      const res = await t.app.inject({ method, url: `${api}${url}`, payload: {} });
      expect(res.statusCode, url).toBe(401);
    }
  });
});

describe('PDF documents', () => {
  const pdf = (url: string, headers: Record<string, string>, extra: Record<string, string> = {}) =>
    t.app.inject({ method: 'GET', url: `${api}${url}`, headers: { ...headers, ...extra } });
  /** Text of a PDF via poppler's pdftotext, to check what the customer can read. */
  const textOf = async (body: Buffer) => {
    const { execFileSync } = await import('node:child_process');
    return execFileSync('pdftotext', ['-layout', '-', '-'], { input: body }).toString();
  };

  it('renders an invoice the customer can read, without cost, markup or profit', async () => {
    await db.query(`UPDATE organizations SET legal_name = 'Test Jewellers LLC', city = 'Dubai', phone = '+971567252392', tax_registration_number = '100999888700003', invoice_footer = 'Thank you for choosing us.' WHERE id = $1`, [org.id]);
    const inv = data(
      await post('/invoices', manager, {
        customerId,
        lines: [{ productId: bracelet, quantity: 2, unitPriceMinor: 364000 }, { productId: cuff, quantity: 1, unitPriceMinor: 298900 }],
        discountMinor: 15000,
        payment: { amountMinor: 500000, method: 'BANK_TRANSFER', reference: 'FT26319XK2' },
        notes: 'Gift wrapped',
      }),
    );
    const res = await pdf(`/invoices/${inv.id}/pdf`, manager);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`${inv.number}.pdf`);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    const text = await textOf(res.rawPayload);
    for (const expected of [
      'TAX INVOICE', inv.number, 'Test Jewellers LLC', 'TRN 100999888700003', 'Maison Luxe', 'Maya Farah', 'TRN 100123456700003',
      'Alhambra Gold Bracelet', 'VLR-BR-001', 'Rose Gold Cuff', '3,640.00', '7,280.00', '2,989.00',
      'AED 10,269.00', '- AED 150.00', 'VAT 5%', 'AED 505.95', 'AED 10,624.95', 'AED 5,000.00', 'AED 5,624.95',
      'Partially paid', 'Bank transfer', 'Ref FT26319XK2', 'Gift wrapped', 'Thank you for choosing us.',
    ]) {
      expect(text, expected).toContain(expected);
    }
    // The reference printed the seller's profit percentage on every line of the customer's invoice.
    for (const secret of ['profit', 'Profit', 'markup', 'Markup', 'Cost', '2,800.00', '2,450.00', '30%']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('serves a new version after a payment, and 304 while unchanged', async () => {
    const inv = data(await post('/invoices', ahmed, sale()));
    const first = await pdf(`/invoices/${inv.id}/pdf`, ahmed);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    expect((await pdf(`/invoices/${inv.id}/pdf`, ahmed, { 'if-none-match': etag })).statusCode).toBe(304);
    expect(await textOf(first.rawPayload)).toContain('Payment due');

    data(await post(`/invoices/${inv.id}/payments`, ahmed, { amountMinor: 382200, method: 'CASH' }));
    const second = await pdf(`/invoices/${inv.id}/pdf`, ahmed, { 'if-none-match': etag });
    expect(second.statusCode).toBe(200);
    expect(second.headers.etag).not.toBe(etag);
    expect(await textOf(second.rawPayload)).toContain('Paid in full');
  });

  it('marks a cancelled invoice and renders a quotation with its validity', async () => {
    const inv = data(await post('/invoices', ahmed, sale()));
    data(await post(`/invoices/${inv.id}/cancel`, manager, { reason: 'Entered twice' }), 200);
    expect(await textOf((await pdf(`/invoices/${inv.id}/pdf`, manager)).rawPayload)).toContain('CANCELLED');

    const q = data(await post('/quotations', ahmed, { customerId, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }] }));
    const res = await pdf(`/quotations/${q.id}/pdf`, ahmed);
    expect(res.statusCode).toBe(200);
    const text = await textOf(res.rawPayload);
    expect(text).toContain('QUOTATION');
    expect(text).toContain(q.number);
    expect(text).toContain('Valid until');
    expect(text).not.toContain('Balance due');
  });

  it('keeps long invoices readable across pages', async () => {
    const lines = Array.from({ length: 24 }, () => ({ productId: bracelet, quantity: 1, unitPriceMinor: 364000 }));
    const inv = data(await post('/invoices', ahmed, { customerId, lines }));
    const res = await pdf(`/invoices/${inv.id}/pdf`, ahmed);
    const text = await textOf(res.rawPayload);
    expect(text.split('Alhambra Gold Bracelet').length - 1).toBe(24);
    expect(text).toContain('AED 91,728.00'); // 24 × 3,640.00 × 1.05
    expect(text.split('\f').length).toBeGreaterThan(2); // more than one page
  });

  it("is not available for another salesperson's or organization's documents", async () => {
    const inv = data(await post('/invoices', manager, sale()));
    expect((await pdf(`/invoices/${inv.id}/pdf`, ahmed)).statusCode).toBe(404);
    expect((await pdf(`/invoices/${randomUUID()}/pdf`, manager)).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `${api}/invoices/${inv.id}/pdf` })).statusCode).toBe(401);
  });
});

describe('documents list', () => {
  let paid: string, partial: string, unpaid: string, cancelled: string, openQuote: string;
  beforeEach(async () => {
    paid = data(await post('/invoices', ahmed, sale({ payment: { amountMinor: 382200, method: 'CASH' } }))).id;
    partial = data(await post('/invoices', manager, sale({ payment: { amountMinor: 100000, method: 'CASH' } }))).id;
    unpaid = data(await post('/invoices', ahmed, sale({ creditDays: 0 }))).id;
    cancelled = data(await post('/invoices', ahmed, sale())).id;
    data(await post(`/invoices/${cancelled}/cancel`, manager, { reason: 'Entered twice' }), 200);
    openQuote = data(await post('/quotations', ahmed, { customerId, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }] })).id;
  });
  const ids = async (qs: string, who = manager) => (data(await get(`/documents${qs}`, who), 200) as { id: string }[]).map((d) => d.id);

  it('lists quotations and invoices together, newest first', async () => {
    const res = await get('/documents', manager);
    const docs = res.json().data;
    expect(docs.map((d: { id: string }) => d.id)).toEqual([openQuote, cancelled, unpaid, partial, paid]);
    expect(docs[0]).toMatchObject({ type: 'QUOTATION', number: `QT-${year()}-00001`, quotationStatus: 'OPEN', validUntil: plusDays(14), lineCount: 1, totalMinor: 334425 });
    expect(docs[3]).toMatchObject({
      type: 'INVOICE',
      status: 'ISSUED',
      paymentStatus: 'PARTIAL',
      balanceMinor: 282200,
      isOverdue: false,
      customer: { id: customerId, name: 'Maya Farah', company: 'Maison Luxe' },
      salesperson: { memberId: managerUser.memberId, fullName: 'MANAGER User' },
    });
    expect(hasKeyDeep(res.json(), CONFIDENTIAL_KEYS)).toBeNull();
  });

  it('filters by status and type', async () => {
    expect(await ids('?status=paid')).toEqual([paid]);
    expect(await ids('?status=partial')).toEqual([partial]);
    expect(await ids('?status=unpaid')).toEqual([unpaid]);
    expect(await ids('?status=cancelled')).toEqual([cancelled]);
    expect(await ids('?status=quotation_open')).toEqual([openQuote]);
    expect(await ids('?status=unpaid,partial')).toEqual([unpaid, partial]);
    expect(await ids('?status=paid&status=quotation_open')).toEqual([openQuote, paid]);
    expect(await ids('?type=quotation')).toEqual([openQuote]);
    expect(await ids('?type=invoice')).toHaveLength(4);
    expect(await ids('?type=quotation&status=paid')).toEqual([]);
    expect((await get('/documents?status=nope', manager)).statusCode).toBe(400);
  });

  it('finds overdue invoices once their due date has passed', async () => {
    expect(await ids('?status=overdue')).toEqual([]);
    t.clock.advance(86_400_000);
    await relogin();
    expect(await ids('?status=overdue')).toEqual([unpaid]); // due today; the partial one is due in 30 days
    expect((data(await get('/documents?status=overdue', manager), 200) as { isOverdue: boolean }[])[0]?.isOverdue).toBe(true);
    expect(await ids('?status=quotation_expired')).toEqual([]);
    t.clock.advance(14 * 86_400_000);
    await relogin();
    expect(await ids('?status=quotation_expired')).toEqual([openQuote]);
    expect(await ids('?status=quotation_open')).toEqual([]);
  });

  it('searches number, customer and phone; filters by customer, salesperson and date', async () => {
    expect(await ids(`?q=INV-${year()}-00002`)).toEqual([partial]);
    expect(await ids('?q=maison')).toHaveLength(5);
    expect(await ids('?q=8204412')).toHaveLength(5);
    expect(await ids('?q=nobody')).toEqual([]);
    expect(await ids(`?customerId=${randomUUID()}`)).toEqual([]);
    expect(await ids(`?salespersonId=${managerUser.memberId}`)).toEqual([partial]);
    expect(await ids(`?from=${today()}&to=${today()}`)).toHaveLength(5);
    expect(await ids(`?from=${plusDays(1)}`)).toEqual([]);
    expect(await ids(`?to=${plusDays(-1)}`)).toEqual([]);
    expect((await get('/documents?from=2026-13-45', manager)).statusCode).toBe(400);
  });

  it('shows the sales role only its own documents, whatever it asks for', async () => {
    expect(await ids('', ahmed)).toEqual([openQuote, cancelled, unpaid, paid]);
    expect(await ids(`?salespersonId=${managerUser.memberId}`, ahmed)).toEqual([openQuote, cancelled, unpaid, paid]);
  });

  it('pages without skipping or repeating', async () => {
    const first = await get('/documents?limit=2', manager);
    const second = await get(`/documents?limit=2&cursor=${first.json().meta.nextCursor}`, manager);
    const third = await get(`/documents?limit=2&cursor=${second.json().meta.nextCursor}`, manager);
    expect([...first.json().data, ...second.json().data, ...third.json().data].map((d: { id: string }) => d.id)).toEqual([openQuote, cancelled, unpaid, partial, paid]);
    expect(third.json().meta).toEqual({ nextCursor: null, hasMore: false });
  });

  it('feeds the customer balances shown on the customer screen', async () => {
    const summary = data(await get(`/customers/${customerId}`, manager), 200).summary;
    // Issued: paid 3,822 + partial 3,822 + unpaid 3,822; the cancelled one is excluded.
    expect(summary).toMatchObject({ invoicedMinor: 1146600, outstandingMinor: 664400, invoiceCount: 3 });
  });
});
