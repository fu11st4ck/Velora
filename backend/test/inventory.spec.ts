import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createOrg, createProduct, createTestApp, createUser, login, ownerDb, resetDb, type SeededOrg, type SeededUser, type TestApp } from './helpers';

const api = '/api/v1';
let t: TestApp;
let db: Client;
let org: SeededOrg;
let managerUser: SeededUser;
let manager: Record<string, string>;
let sales: Record<string, string>;
let productId: string;

const post = (url: string, headers: Record<string, string>, payload: unknown, key = randomUUID()) =>
  t.app.inject({ method: 'POST', url: `${api}${url}`, headers: { ...headers, 'idempotency-key': key }, payload: payload as object });
const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: 'GET', url: `${api}${url}`, headers });
const state = async (id = productId) =>
  (await db.query(`SELECT p.cost_minor::int AS cost, s.quantity FROM products p JOIN stock_levels s ON s.product_id = p.id WHERE p.id = $1`, [id])).rows[0] as { cost: number; quantity: number };

/** The ledger must always explain the stock level exactly (business rule S1). */
async function expectLedgerConsistent(): Promise<void> {
  const rows = (
    await db.query(`
      SELECT s.product_id, s.quantity, COALESCE(SUM(m.quantity_delta), 0)::int AS ledger,
             (SELECT balance_after FROM stock_movements l WHERE l.product_id = s.product_id AND l.branch_id = s.branch_id
              ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_balance
      FROM stock_levels s LEFT JOIN stock_movements m ON m.product_id = s.product_id AND m.branch_id = s.branch_id
      GROUP BY s.product_id, s.branch_id, s.quantity`)
  ).rows;
  for (const r of rows) {
    expect(r.ledger, `ledger sum for ${r.product_id}`).toBe(r.quantity);
    if (r.last_balance !== null) expect(r.last_balance).toBe(r.quantity);
  }
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
  managerUser = await createUser(db, org, 'MANAGER');
  manager = bearer((await login(t, managerUser)).accessToken);
  sales = bearer((await login(t, await createUser(db, org, 'SALES'))).accessToken);
  productId = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', quantity: 24, costMinor: 280000 })).id;
});

describe('receive stock', () => {
  it('adds quantity, re-averages cost and writes the ledger and audit entries', async () => {
    const res = await post('/inventory/receipts', manager, { productId, quantity: 10, unitCostMinor: 290000, supplierName: 'Al Noor Gold', referenceNote: 'PO 2231' });
    expect(res.statusCode).toBe(201);
    const { movement, product } = res.json().data;
    expect(movement).toMatchObject({
      type: 'PURCHASE_RECEIPT',
      quantityDelta: 10,
      balanceAfter: 34,
      unitCostMinor: 290000,
      supplierName: 'Al Noor Gold',
      referenceNote: 'PO 2231',
      productSku: 'VLR-BR-001',
      createdBy: { memberId: managerUser.memberId, fullName: 'MANAGER User' },
    });
    // (24 × 2800.00 + 10 × 2900.00) / 34 = 2829.4117… → 2829.41
    expect(product).toMatchObject({ quantity: 34, costMinor: 282941, listPriceMinor: 367823, version: 1 });
    expect(await state()).toEqual({ cost: 282941, quantity: 34 });
    const audit = (await db.query(`SELECT before, after FROM audit_logs WHERE action = 'inventory.receive'`)).rows[0];
    expect(audit.before).toEqual({ quantity: 24, costMinor: '280000' });
    expect(audit.after).toMatchObject({ quantity: 34, costMinor: '282941', received: 10 });
    await expectLedgerConsistent();
  });

  it('takes the receipt cost when nothing is on hand', async () => {
    const empty = (await createProduct(db, org, managerUser.memberId, { quantity: 0, costMinor: 999 })).id;
    const res = await post('/inventory/receipts', manager, { productId: empty, quantity: 3, unitCostMinor: 150000 });
    expect(res.json().data.product).toMatchObject({ quantity: 3, costMinor: 150000 });
  });

  it('validates quantity and cost', async () => {
    for (const body of [{ quantity: 0, unitCostMinor: 1 }, { quantity: -5, unitCostMinor: 1 }, { quantity: 1.5, unitCostMinor: 1 }, { quantity: 1, unitCostMinor: -1 }, { quantity: 1 }]) {
      expect((await post('/inventory/receipts', manager, { productId, ...body })).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await state()).toEqual({ cost: 280000, quantity: 24 });
  });

  it('is applied once when the same request is retried, even simultaneously', async () => {
    const key = randomUUID();
    const body = { productId, quantity: 10, unitCostMinor: 290000 };
    const results = await Promise.all([1, 2, 3, 4].map(() => post('/inventory/receipts', manager, body, key)));
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201, 201]);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(3);
    // Replays carry the same content (JSON key order is not significant).
    for (const r of results) expect(r.json()).toEqual(results[0]?.json());
    expect(await state()).toEqual({ cost: 282941, quantity: 34 });
    await expectLedgerConsistent();
  });

  it('keeps quantity and cost exact under 8 concurrent receipts', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => post('/inventory/receipts', manager, { productId, quantity: 2, unitCostMinor: 280000 })));
    expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(201));
    // Same unit cost as on hand, so any lost update would show up as a wrong quantity or a drifted cost.
    expect(await state()).toEqual({ cost: 280000, quantity: 40 });
    const balances = (await db.query(`SELECT balance_after FROM stock_movements WHERE type = 'PURCHASE_RECEIPT' ORDER BY balance_after`)).rows.map((r) => r.balance_after);
    expect(balances).toEqual([26, 28, 30, 32, 34, 36, 38, 40]);
    await expectLedgerConsistent();
  });

  it('is refused for archived products and for the sales role', async () => {
    const archived = (await createProduct(db, org, managerUser.memberId, { quantity: 0, archived: true })).id;
    expect((await post('/inventory/receipts', manager, { productId: archived, quantity: 1, unitCostMinor: 1 })).json().error.code).toBe('PRODUCT_ARCHIVED');
    expect((await post('/inventory/receipts', sales, { productId, quantity: 1, unitCostMinor: 1 })).statusCode).toBe(403);
  });
});

describe('adjust stock', () => {
  it('removes stock with a reason at the current cost', async () => {
    const res = await post('/inventory/adjustments', manager, { productId, quantityDelta: -2, reason: 'Damaged in display' });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.movement).toMatchObject({ type: 'ADJUSTMENT_OUT', quantityDelta: -2, balanceAfter: 22, unitCostMinor: 280000, reason: 'Damaged in display' });
    expect(res.json().data.product).toMatchObject({ quantity: 22, costMinor: 280000 });
    await expectLedgerConsistent();
  });

  it('adds stock with a reason and leaves cost unchanged', async () => {
    const res = await post('/inventory/adjustments', manager, { productId, quantityDelta: 3, reason: 'Count correction' });
    expect(res.json().data.movement).toMatchObject({ type: 'ADJUSTMENT_IN', quantityDelta: 3, balanceAfter: 27 });
    expect(await state()).toEqual({ cost: 280000, quantity: 27 });
  });

  it('refuses to take more than is on hand and changes nothing', async () => {
    const res = await post('/inventory/adjustments', manager, { productId, quantityDelta: -25, reason: 'Count correction' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: [{ productId, requested: 25, available: 24 }] });
    expect(await state()).toEqual({ cost: 280000, quantity: 24 });
    expect((await db.query(`SELECT 1 FROM stock_movements WHERE type::text LIKE 'ADJUSTMENT%'`)).rowCount).toBe(0);
    expect((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'inventory.adjust'`)).rowCount).toBe(0);
  });

  it('allows taking stock exactly to zero', async () => {
    const res = await post('/inventory/adjustments', manager, { productId, quantityDelta: -24, reason: 'Stock written off' });
    expect(res.json().data.product).toMatchObject({ quantity: 0, stockStatus: 'OUT' });
  });

  it('never goes negative when 10 removals of 5 race for 24 units', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => post('/inventory/adjustments', manager, { productId, quantityDelta: -5, reason: 'Concurrent count' })));
    const ok = results.filter((r) => r.statusCode === 201);
    const rejected = results.filter((r) => r.statusCode === 409);
    expect(ok).toHaveLength(4);
    expect(rejected).toHaveLength(6);
    expect(rejected.every((r) => r.json().error.code === 'INSUFFICIENT_STOCK')).toBe(true);
    expect((await state()).quantity).toBe(4);
    await expectLedgerConsistent();
  });

  it('requires a reason and a non-zero whole quantity', async () => {
    for (const body of [{ quantityDelta: -1 }, { quantityDelta: -1, reason: '  ' }, { quantityDelta: -1, reason: 'ab' }, { quantityDelta: 0, reason: 'nothing' }, { quantityDelta: 1.5, reason: 'fraction' }]) {
      expect((await post('/inventory/adjustments', manager, { productId, ...body })).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('is refused for the sales role', async () => {
    expect((await post('/inventory/adjustments', sales, { productId, quantityDelta: -1, reason: 'not allowed' })).statusCode).toBe(403);
    expect((await state()).quantity).toBe(24);
  });
});

describe('stock history', () => {
  beforeEach(async () => {
    await post('/inventory/receipts', manager, { productId, quantity: 10, unitCostMinor: 290000, supplierName: 'Al Noor Gold' });
    await post('/inventory/adjustments', manager, { productId, quantityDelta: -2, reason: 'Damaged in display' });
    await post('/inventory/adjustments', manager, { productId, quantityDelta: 1, reason: 'Found in safe' });
  });

  it('lists movements newest first with balances that chain', async () => {
    const res = await get(`/inventory/movements?productId=${productId}`, manager);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((m: { type: string; quantityDelta: number; balanceAfter: number }) => [m.type, m.quantityDelta, m.balanceAfter])).toEqual([
      ['ADJUSTMENT_IN', 1, 33],
      ['ADJUSTMENT_OUT', -2, 32],
      ['PURCHASE_RECEIPT', 10, 34],
      ['OPENING', 24, 24],
    ]);
    expect(res.json().meta).toEqual({ nextCursor: null, hasMore: false });
  });

  it('filters by type and pages without gaps', async () => {
    const adjustments = await get(`/inventory/movements?productId=${productId}&type=ADJUSTMENT_IN&type=ADJUSTMENT_OUT`, manager);
    expect(adjustments.json().data).toHaveLength(2);
    expect((await get(`/inventory/movements?type=PURCHASE_RECEIPT,OPENING`, manager)).json().data).toHaveLength(2);
    expect((await get(`/inventory/movements?type=NOPE`, manager)).statusCode).toBe(400);

    const first = await get(`/inventory/movements?limit=3`, manager);
    expect(first.json().meta.hasMore).toBe(true);
    const second = await get(`/inventory/movements?limit=3&cursor=${first.json().meta.nextCursor}`, manager);
    expect([...first.json().data, ...second.json().data].map((m: { type: string }) => m.type)).toEqual(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PURCHASE_RECEIPT', 'OPENING']);
    expect(second.json().meta.hasMore).toBe(false);
  });

  it('shows the sales role quantities but not costs or suppliers', async () => {
    const res = await get(`/inventory/movements?productId=${productId}`, sales);
    const receipt = res.json().data.find((m: { type: string }) => m.type === 'PURCHASE_RECEIPT');
    expect(receipt).toMatchObject({ quantityDelta: 10, balanceAfter: 34 });
    expect(receipt).not.toHaveProperty('unitCostMinor');
    expect(receipt).not.toHaveProperty('supplierName');
    expect(res.body).not.toContain('Al Noor');
  });
});
