import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minorToDecimal, toCsv } from '../src/reports/csv';
import { bearer, CONFIDENTIAL_KEYS, createOrg, createProduct, createTestApp, createUser, hasKeyDeep, login, ownerDb, resetDb, type SeededOrg, type SeededUser, type TestApp } from './helpers';

const api = '/api/v1';
const BOM = String.fromCharCode(0xfeff);
let t: TestApp;
let db: Client;
let org: SeededOrg;
let managerUser: SeededUser;
let ahmedUser: SeededUser;
let manager: Record<string, string>;
let ahmed: Record<string, string>;
let bracelet: string; // cost 2,800.00 · list 3,640.00 · 24 in stock
let tennis: string; //   cost 6,200.00 · list 7,936.00 ·  4 in stock
let cuff: string; //     cost 2,450.00 · list 3,185.00 · 17 in stock
let customerId: string;
let partialInvoice: { id: string; number: string };

type Res = Awaited<ReturnType<TestApp['app']['inject']>>;
const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: 'GET', url: `${api}${url}`, headers });
const post = (url: string, headers: Record<string, string>, payload: unknown = {}) =>
  t.app.inject({ method: 'POST', url: `${api}${url}`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload: payload as object });
const data = (res: Res, status = 200) => {
  expect(res.statusCode, res.body).toBe(status);
  return res.json().data;
};
const fails = (res: Res, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error.code).toBe(code);
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t.clock.now());
const plusDays = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const period = () => `from=${today()}&to=${today()}`;
const relogin = async () => {
  manager = bearer((await login(t, managerUser)).accessToken);
  ahmed = bearer((await login(t, ahmedUser)).accessToken);
};

/**
 * One day of trading, worked by hand (VAT 5%):
 *  1. Ahmed sells 2 bracelets, 280.00 discount → net 7,000.00, tax 350.00, total 7,350.00; 3,000.00 received. Cost 5,600.00.
 *  2. The manager sells 1 cuff → net 3,185.00, tax 159.25, total 3,344.25; paid in full. Cost 2,450.00.
 *  3. Ahmed sells 1 tennis bracelet on credit (8,332.80); the manager cancels it → out of every figure.
 *  4. One bracelet of sale 1 comes back and is restocked → credit 3,500.00 net + 175.00 tax = 3,675.00,
 *     taken off the balance (4,350.00 → 675.00), nothing refunded.
 */
async function tradingDay(): Promise<void> {
  partialInvoice = data(
    await post('/invoices', ahmed, {
      customerId,
      lines: [{ productId: bracelet, quantity: 2, unitPriceMinor: 364000 }],
      discountMinor: 28000,
      payment: { amountMinor: 300000, method: 'CASH' },
    }),
    201,
  );
  data(await post('/invoices', manager, { customerId, lines: [{ productId: cuff, quantity: 1, unitPriceMinor: 318500 }], payment: { amountMinor: 334425, method: 'BANK_TRANSFER' } }), 201);
  const cancelled = data(await post('/invoices', ahmed, { customerId, lines: [{ productId: tennis, quantity: 1, unitPriceMinor: 793600 }] }), 201);
  data(await post(`/invoices/${cancelled.id}/cancel`, manager, { reason: 'Entered by mistake' }), 200);
  data(await post(`/invoices/${partialInvoice.id}/returns`, manager, { reason: 'Clasp broken', lines: [{ lineNo: 1, quantity: 1, restock: true }] }), 201);
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
  await db.query(`UPDATE users SET full_name = 'Ahmed Karim' WHERE id = $1`, [ahmedUser.userId]);
  await db.query(`UPDATE users SET full_name = 'Maya Manager' WHERE id = $1`, [managerUser.userId]);
  await relogin();
  bracelet = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', quantity: 24, costMinor: 280000 })).id;
  tennis = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-DB-008', name: 'Diamond Tennis Bracelet', quantity: 4, costMinor: 620000, defaultMarkupBp: 2800 })).id;
  cuff = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-RC-021', name: 'Rose Gold Cuff', quantity: 17, costMinor: 245000 })).id;
  customerId = data(await post('/customers', ahmed, { name: 'Maya Farah', company: 'Maison Luxe', mobile: '+971558204412' }), 201).id;
});

describe('sales summary', () => {
  it('matches the worked example for a manager', async () => {
    await tradingDay();
    expect(data(await get(`/reports/sales-summary?${period()}`, manager))).toEqual({
      from: today(),
      to: today(),
      invoiceCount: 2,
      invoicedMinor: 1069425, // 7,350.00 + 3,344.25
      netSalesMinor: 668500, // 7,000.00 + 3,185.00 − 3,500.00
      taxMinor: 33425, // 350.00 + 159.25 − 175.00
      discountMinor: 28000,
      returnsMinor: 367500,
      cogsMinor: 525000, // 5,600.00 + 2,450.00 − 2,800.00 restocked
      grossProfitMinor: 143500,
      marginBp: 2147, // 1,435.00 / 6,685.00 = 21.466…%
      receivedMinor: 634425, // 3,000.00 + 3,344.25
      outstandingNowMinor: 67500,
      overdueNowMinor: 0,
    });
  });

  it('gives a salesperson their own sales only, without cost or profit', async () => {
    await tradingDay();
    const own = data(await get(`/reports/sales-summary?${period()}`, ahmed));
    expect(own).toMatchObject({ invoiceCount: 1, invoicedMinor: 735000, netSalesMinor: 350000, taxMinor: 17500, receivedMinor: 300000, outstandingNowMinor: 67500 });
    expect(hasKeyDeep(own, CONFIDENTIAL_KEYS)).toBeNull();
    // Asking for someone else's figures changes nothing for the sales role.
    expect(data(await get(`/reports/sales-summary?${period()}&salespersonId=${managerUser.memberId}`, ahmed))).toEqual(own);
    // A manager may filter by salesperson.
    expect(data(await get(`/reports/sales-summary?${period()}&salespersonId=${managerUser.memberId}`, manager))).toMatchObject({
      invoiceCount: 1,
      netSalesMinor: 318500,
      grossProfitMinor: 73500,
      outstandingNowMinor: 0,
    });
  });

  it('is all zeros, with no margin, for a period without sales', async () => {
    await tradingDay();
    const empty = data(await get(`/reports/sales-summary?from=${plusDays(-10)}&to=${plusDays(-1)}`, manager));
    expect(empty).toMatchObject({ invoiceCount: 0, invoicedMinor: 0, netSalesMinor: 0, cogsMinor: 0, grossProfitMinor: 0, marginBp: null, receivedMinor: 0 });
    // What is owed today does not depend on the period.
    expect(empty.outstandingNowMinor).toBe(67500);
  });

  it("counts a sale on the business's calendar day, not the server's", async () => {
    const invoice = data(await post('/invoices', ahmed, { customerId, lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 364000 }] }), 201);
    // 00:30 in Dubai is still the previous day in UTC.
    await db.query(`UPDATE invoices SET issued_at = ($2::date::timestamp AT TIME ZONE 'Asia/Dubai') + interval '30 minutes' WHERE id = $1`, [invoice.id, today()]);
    expect(data(await get(`/reports/sales-summary?${period()}`, manager)).invoiceCount).toBe(1);
    expect(data(await get(`/reports/sales-summary?from=${plusDays(-1)}&to=${plusDays(-1)}`, manager)).invoiceCount).toBe(0);
  });

  it('puts a later return and a later payment in the period they happened', async () => {
    const invoice = data(await post('/invoices', ahmed, { customerId, lines: [{ productId: bracelet, quantity: 2, unitPriceMinor: 364000 }] }), 201);
    const saleDay = today();
    t.clock.advance(3 * 86_400_000);
    await relogin();
    data(await post(`/invoices/${invoice.id}/payments`, ahmed, { amountMinor: 100000, method: 'CASH' }), 201);
    data(await post(`/invoices/${invoice.id}/returns`, manager, { reason: 'Changed mind', lines: [{ lineNo: 1, quantity: 1, restock: false }] }), 201);

    expect(data(await get(`/reports/sales-summary?from=${saleDay}&to=${saleDay}`, manager))).toMatchObject({ invoiceCount: 1, netSalesMinor: 728000, returnsMinor: 0, receivedMinor: 0, cogsMinor: 560000 });
    // The returned piece was not restocked, so its cost stays in cost of goods sold.
    expect(data(await get(`/reports/sales-summary?${period()}`, manager))).toMatchObject({ invoiceCount: 0, netSalesMinor: -364000, returnsMinor: 382200, receivedMinor: 100000, cogsMinor: 0, marginBp: null });
  });

  it('validates the period', async () => {
    for (const query of ['', `from=${today()}`, 'from=2026-02-30&to=2026-03-01', `from=${today()}&to=${plusDays(-1)}`, `from=${plusDays(-400)}&to=${today()}`, `${period()}&salespersonId=abc`]) {
      fails(await get(`/reports/sales-summary?${query}`, manager), 400, 'VALIDATION_ERROR');
    }
    expect((await get(`/reports/sales-summary?from=${plusDays(-366)}&to=${today()}`, manager)).statusCode).toBe(200);
    expect((await get(`/reports/sales-summary?${period()}`, {})).statusCode).toBe(401);
  });
});

describe('sales by salesperson', () => {
  it('ranks the team by net sales, for managers only', async () => {
    await tradingDay();
    fails(await get(`/reports/sales-by-salesperson?${period()}`, ahmed), 403, 'FORBIDDEN');
    expect(data(await get(`/reports/sales-by-salesperson?${period()}`, manager))).toEqual([
      { memberId: ahmedUser.memberId, fullName: 'Ahmed Karim', invoiceCount: 1, invoicedMinor: 735000, netSalesMinor: 350000, grossProfitMinor: 70000 },
      { memberId: managerUser.memberId, fullName: 'Maya Manager', invoiceCount: 1, invoicedMinor: 334425, netSalesMinor: 318500, grossProfitMinor: 73500 },
    ]);
    expect(data(await get(`/reports/sales-by-salesperson?from=${plusDays(-5)}&to=${plusDays(-1)}`, manager))).toEqual([]);
  });
});

describe('payment status', () => {
  it('breaks invoices down by status, with overdue as a separate subset', async () => {
    await tradingDay();
    const issued = today();
    expect(data(await get(`/reports/payment-status?${period()}`, manager))).toEqual([
      { status: 'PAID', count: 1, totalMinor: 334425, balanceMinor: 0 },
      { status: 'PARTIAL', count: 1, totalMinor: 735000, balanceMinor: 67500 },
      { status: 'UNPAID', count: 0, totalMinor: 0, balanceMinor: 0 },
      { status: 'OVERDUE', count: 0, totalMinor: 0, balanceMinor: 0 },
    ]);
    expect(data(await get(`/reports/payment-status?${period()}`, ahmed)).map((r: { count: number }) => r.count)).toEqual([0, 1, 0, 0]);

    t.clock.advance(31 * 86_400_000); // past the 30-day credit period
    await relogin();
    const later = data(await get(`/reports/payment-status?from=${issued}&to=${issued}`, manager));
    expect(later[3]).toEqual({ status: 'OVERDUE', count: 1, totalMinor: 735000, balanceMinor: 67500 });
    expect(later[1].count).toBe(1);
    expect(data(await get(`/reports/sales-summary?from=${issued}&to=${issued}`, manager)).overdueNowMinor).toBe(67500);
  });
});

describe('inventory valuation', () => {
  it('values stock at cost, largest first, with totals and paging', async () => {
    await tradingDay(); // bracelets 24 − 2 + 1 = 23 · cuffs 16 · tennis 4 (cancellation restored it)
    fails(await get('/reports/inventory-valuation', ahmed), 403, 'FORBIDDEN');
    const first = (await get('/reports/inventory-valuation?limit=2', manager)).json();
    expect(first.data).toEqual([
      { productId: bracelet, name: 'Alhambra Gold Bracelet', sku: 'VLR-BR-001', quantity: 23, costMinor: 280000, valueMinor: 6440000 },
      { productId: cuff, name: 'Rose Gold Cuff', sku: 'VLR-RC-021', quantity: 16, costMinor: 245000, valueMinor: 3920000 },
    ]);
    expect(first.meta).toMatchObject({ summary: { units: 43, valueMinor: 12840000, productCount: 3 }, hasMore: true });
    const second = (await get(`/reports/inventory-valuation?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`, manager)).json();
    expect(second.data.map((r: { sku: string }) => r.sku)).toEqual(['VLR-DB-008']);
    expect(second.meta).toMatchObject({ hasMore: false, nextCursor: null });

    const byName = (await get('/reports/inventory-valuation?sort=name&limit=1', manager)).json();
    const nextByName = (await get(`/reports/inventory-valuation?sort=name&limit=5&cursor=${encodeURIComponent(byName.meta.nextCursor)}`, manager)).json();
    expect([...byName.data, ...nextByName.data].map((r: { sku: string }) => r.sku)).toEqual(['VLR-BR-001', 'VLR-DB-008', 'VLR-RC-021']);
    fails(await get('/reports/inventory-valuation?sort=cost', manager), 400, 'VALIDATION_ERROR');
  });

  it('leaves archived products out', async () => {
    await createProduct(db, org, managerUser.memberId, { sku: 'OLD-1', quantity: 0, archived: true });
    expect((await get('/reports/inventory-valuation', manager)).json().meta.summary.productCount).toBe(3);
  });
});

describe('CSV exports', () => {
  const csv = (url: string, headers: Record<string, string>) => get(url, { ...headers, accept: 'text/csv' });

  it('exports one row per invoice for managers, with amounts as plain decimals', async () => {
    await tradingDay();
    fails(await csv(`/reports/sales-summary?${period()}`, ahmed), 403, 'FORBIDDEN');
    const res = await csv(`/reports/sales-summary?${period()}`, manager);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="velora-sales-${today()}-to-${today()}.csv"`);
    const lines = res.body.replace(BOM, '').trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Invoice,Date,Customer,Company,Salesperson,Currency,Subtotal,Discount,Tax,Total,Returned,Paid,Balance,Payment status,Cost of goods');
    expect(lines[1]).toBe(`${partialInvoice.number},${today()},Maya Farah,Maison Luxe,Ahmed Karim,AED,7280.00,280.00,350.00,7350.00,3675.00,3000.00,675.00,PARTIAL,5600.00`);
    expect(lines[2]).toContain(',Maya Manager,AED,3185.00,0.00,159.25,3344.25,0.00,3344.25,0.00,PAID,2450.00');
  });

  it('exports the stock valuation', async () => {
    fails(await csv('/reports/inventory-valuation', ahmed), 403, 'FORBIDDEN');
    const res = await csv('/reports/inventory-valuation', manager);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.body.replace(BOM, '').trimEnd().split('\r\n')).toEqual([
      'SKU,Product,Quantity,Currency,Unit cost,Value',
      'VLR-BR-001,Alhambra Gold Bracelet,24,AED,2800.00,67200.00',
      'VLR-DB-008,Diamond Tennis Bracelet,4,AED,6200.00,24800.00',
      'VLR-RC-021,Rose Gold Cuff,17,AED,2450.00,41650.00',
    ]);
  });

  it('quotes special characters and neutralises spreadsheet formulas', () => {
    const body = toCsv(['Name', 'Note'], [['Maison "Luxe", LLC', '=HYPERLINK("http://x")'], ['Line\nbreak', '+971'], [null, 12]]).toString('utf8');
    expect(body).toBe(BOM + 'Name,Note\r\n"Maison ""Luxe"", LLC","\'=HYPERLINK(""http://x"")"\r\n"Line\nbreak",\'+971\r\n,12\r\n');
  });

  it('formats minor units for any currency exponent without floating point', () => {
    expect(minorToDecimal(364000n, 2)).toBe('3640.00');
    expect(minorToDecimal(5n, 2)).toBe('0.05');
    expect(minorToDecimal(-67500n, 2)).toBe('-675.00');
    expect(minorToDecimal(1234567n, 3)).toBe('1234.567');
    expect(minorToDecimal(1500n, 0)).toBe('1500');
    expect(minorToDecimal(9007199254740993n, 2)).toBe('90071992547409.93');
  });
});

describe('dashboard', () => {
  it('gives a manager the whole business on one screen', async () => {
    await tradingDay();
    const d = data(await get('/dashboard/summary', manager));
    expect(d).toMatchObject({
      currencyCode: 'AED',
      todaySales: { invoicedMinor: 1069425, invoiceCount: 2, yesterdayInvoicedMinor: 0, changeBp: null },
      stock: { units: 43, productCount: 3, lowCount: 1, outCount: 0 },
      outstanding: { balanceMinor: 67500, invoiceCount: 1, overdueMinor: 0, overdueCount: 0 },
      monthProfit: { netSalesMinor: 668500, grossProfitMinor: 143500, marginBp: 2147 },
      inventoryValueMinor: 12840000,
      attentionProducts: [{ id: tennis, name: 'Diamond Tennis Bracelet', sku: 'VLR-DB-008', quantity: 4, stockStatus: 'LOW' }],
    });
    expect(d.recentDocuments).toHaveLength(3);
    expect(d.recentDocuments[0]).toMatchObject({ type: 'INVOICE', status: 'CANCELLED' });
    expect(new Date(d.asOf).getTime()).toBeCloseTo(t.clock.now().getTime(), -4);
  });

  it('gives a salesperson their own sales and no cost-based figures', async () => {
    await tradingDay();
    const d = data(await get('/dashboard/summary', ahmed));
    expect(d.todaySales).toMatchObject({ invoicedMinor: 735000, invoiceCount: 1 });
    expect(d.outstanding).toMatchObject({ balanceMinor: 67500, invoiceCount: 1 });
    expect(d.stock.units).toBe(43);
    expect(d).not.toHaveProperty('monthProfit');
    expect(hasKeyDeep(d, CONFIDENTIAL_KEYS)).toBeNull();
    expect(d.recentDocuments).toHaveLength(2);
    expect(d.recentDocuments.every((doc: { salesperson: { memberId: string } }) => doc.salesperson.memberId === ahmedUser.memberId)).toBe(true);
  });

  it("compares today with yesterday's full day", async () => {
    await tradingDay();
    t.clock.advance(86_400_000);
    await relogin();
    data(await post('/invoices', manager, { customerId, lines: [{ productId: bracelet, quantity: 1, unitPriceMinor: 364000 }] }), 201);
    const { todaySales } = data(await get('/dashboard/summary', manager));
    // 3,822.00 today against 10,694.25 yesterday: −64.26%.
    expect(todaySales).toEqual({ invoicedMinor: 382200, invoiceCount: 1, yesterdayInvoicedMinor: 1069425, changeBp: -6426 });
  });

  it('lists out-of-stock products first among those needing attention', async () => {
    await createProduct(db, org, managerUser.memberId, { sku: 'GONE-1', name: 'Sold Out Pendant', quantity: 0 });
    await createProduct(db, org, managerUser.memberId, { sku: 'OWN-LVL', name: 'Custom Level Ring', quantity: 10, reorderLevel: 12 });
    const d = data(await get('/dashboard/summary', manager));
    expect(d.stock).toMatchObject({ productCount: 5, lowCount: 2, outCount: 1 });
    expect(d.attentionProducts.map((p: { sku: string; stockStatus: string }) => [p.sku, p.stockStatus])).toEqual([['GONE-1', 'OUT'], ['VLR-DB-008', 'LOW'], ['OWN-LVL', 'LOW']]);
  });

  it('starts empty for a new business and never shows another organization', async () => {
    await tradingDay();
    const other = await createOrg(db, 'Other Jewellers');
    const stranger = bearer((await login(t, await createUser(db, other, 'OWNER'))).accessToken);
    expect(data(await get('/dashboard/summary', stranger))).toMatchObject({
      todaySales: { invoicedMinor: 0, invoiceCount: 0, changeBp: null },
      stock: { units: 0, productCount: 0, lowCount: 0, outCount: 0 },
      outstanding: { balanceMinor: 0, invoiceCount: 0 },
      monthProfit: { netSalesMinor: 0, grossProfitMinor: 0, marginBp: null },
      inventoryValueMinor: 0,
      attentionProducts: [],
      recentDocuments: [],
    });
    expect(data(await get(`/reports/sales-summary?${period()}`, stranger)).invoiceCount).toBe(0);
    expect((await get('/reports/inventory-valuation', stranger)).json().data).toEqual([]);
    expect((await get('/dashboard/summary', {})).statusCode).toBe(401);
  });
});
