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
let manager: Record<string, string>;
let sales: Record<string, string>;

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) =>
  t.app.inject({ method, url: `${api}${url}`, headers, ...(payload === undefined ? {} : { payload: payload as object }) });
const idem = (headers: Record<string, string>, key = randomUUID()) => ({ ...headers, 'idempotency-key': key });

const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Pearl Drop Ring',
  costMinor: 100055,
  defaultMarkupBp: 3000,
  minMarkupBp: 1500,
  openingQuantity: 2,
  ...over,
});

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
});

describe('create product', () => {
  it('creates the product, its stock and the first ledger entry together', async () => {
    const res = await call('POST', '/products', idem(manager), valid({ sku: 'VLR-PR-001', barcode: '6291041500213', weight: { value: '3.5', unit: 'G' }, supplierName: 'Al Noor Gold', reorderLevel: 1 }));
    expect(res.statusCode).toBe(201);
    const p = res.json().data;
    expect(p).toMatchObject({
      sku: 'VLR-PR-001',
      barcode: '6291041500213',
      name: 'Pearl Drop Ring',
      weight: { value: '3.5', unit: 'G' },
      quantity: 2,
      stockStatus: 'IN_STOCK',
      reorderLevel: 1,
      effectiveReorderLevel: 1,
      costMinor: 100055,
      listPriceMinor: 130072, // 1000.55 × 1.30 = 1300.715 → 1300.72
      floorPriceMinor: 115063, // × 1.15 = 1150.6325 → 1150.63
      ceilingPriceMinor: 160088, // × 1.60
      version: 1,
      isActive: true,
    });

    const moves = (await db.query('SELECT type, quantity_delta, balance_after, unit_cost_minor, supplier_name, created_by_id FROM stock_movements')).rows;
    // Business rule S4: stock entered at creation is OPENING, later deliveries are PURCHASE_RECEIPT.
    expect(moves).toEqual([
      { type: 'OPENING', quantity_delta: 2, balance_after: 2, unit_cost_minor: '100055', supplier_name: 'Al Noor Gold', created_by_id: managerUser.memberId },
    ]);
    const audit = (await db.query(`SELECT action, entity_id FROM audit_logs WHERE action = 'product.create'`)).rows;
    expect(audit).toEqual([{ action: 'product.create', entity_id: p.id }]);
  });

  it('generates a SKU when none is given and records no movement for zero opening stock', async () => {
    const res = await call('POST', '/products', idem(manager), valid({ openingQuantity: 0 }));
    expect(res.statusCode).toBe(201);
    expect(res.json().data.sku).toMatch(/^SKU-\d{6}$/);
    expect(res.json().data).toMatchObject({ quantity: 0, stockStatus: 'OUT' });
    expect((await db.query('SELECT 1 FROM stock_movements')).rowCount).toBe(0);
  });

  it('rejects a duplicate SKU regardless of case (the reference accepted duplicates)', async () => {
    await call('POST', '/products', idem(manager), valid({ sku: 'VLR-BR-001' }));
    const res = await call('POST', '/products', idem(manager), valid({ sku: 'vlr-br-001' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'SKU_TAKEN', details: [{ field: 'sku' }] });
    expect((await db.query('SELECT 1 FROM products')).rowCount).toBe(1);
  });

  it('rejects a duplicate barcode', async () => {
    await call('POST', '/products', idem(manager), valid({ barcode: '123' }));
    const res = await call('POST', '/products', idem(manager), valid({ barcode: '123' }));
    expect(res.json().error.code).toBe('BARCODE_TAKEN');
  });

  it('lets only one of two simultaneous creates with the same SKU succeed', async () => {
    const results = await Promise.all([1, 2].map(() => call('POST', '/products', idem(manager), valid({ sku: 'RACE-1' }))));
    expect(results.map((r) => r.statusCode).sort(), results.map((r) => r.body).join(' | ')).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json().error.code).toBe('SKU_TAKEN');
    expect((await db.query('SELECT 1 FROM products')).rowCount).toBe(1);
  });

  it('enforces minimum ≤ default ≤ maximum markup (the reference accepted min 40 / default 10)', async () => {
    for (const over of [{ minMarkupBp: 4000, defaultMarkupBp: 1000 }, { defaultMarkupBp: 6001 }]) {
      const res = await call('POST', '/products', idem(manager), valid(over));
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({ code: 'MARKUP_POLICY_INVALID', details: [{ maxMarkupBp: 6000 }] });
    }
    expect((await call('POST', '/products', idem(manager), valid({ minMarkupBp: 6000, defaultMarkupBp: 6000 }))).statusCode).toBe(201);
  });

  it('validates each field', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: '   ' }, 'name'],
      [{ costMinor: -1 }, 'costMinor'],
      [{ costMinor: 10.5 }, 'costMinor'],
      [{ costMinor: '100' }, 'costMinor'],
      [{ openingQuantity: -1 }, 'openingQuantity'],
      [{ openingQuantity: 1.5 }, 'openingQuantity'],
      [{ sku: 'has space' }, 'sku'],
      [{ weight: { value: '1.2345', unit: 'G' } }, 'weight.value'],
      [{ weight: { value: '5', unit: 'PCS' } }, 'weight.unit'],
      [{ reorderLevel: -1 }, 'reorderLevel'],
      [{ quantity: 5 }, 'quantity'],
    ];
    for (const [over, field] of cases) {
      const res = await call('POST', '/products', idem(manager), valid(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
      expect(res.json().error.details.map((d: { field: string }) => d.field), JSON.stringify(over)).toContain(field);
    }
    expect((await db.query('SELECT 1 FROM products')).rowCount).toBe(0);
  });

  it('requires an idempotency key and replays instead of creating twice', async () => {
    expect((await call('POST', '/products', manager, valid())).json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = randomUUID();
    const first = await call('POST', '/products', idem(manager, key), valid());
    const second = await call('POST', '/products', idem(manager, key), valid());
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect((await db.query('SELECT 1 FROM products')).rowCount).toBe(1);
    expect((await db.query('SELECT 1 FROM stock_movements')).rowCount).toBe(1);
  });

  it('is refused for the sales role', async () => {
    const res = await call('POST', '/products', idem(sales), valid());
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

describe('cost confidentiality (business rule P7)', () => {
  it('never sends cost, markup or supplier fields to the sales role', async () => {
    const created = (await call('POST', '/products', idem(manager), valid({ sku: 'CONF-1', supplierName: 'Secret Supplier' }))).json().data;
    for (const url of ['/products', '/products?q=CONF', `/products/${created.id}`, `/inventory/movements?productId=${created.id}`, '/auth/me']) {
      const res = await call('GET', url, sales);
      expect(res.statusCode, url).toBe(200);
      expect(hasKeyDeep(res.json(), CONFIDENTIAL_KEYS), url).toBeNull();
      expect(res.body, url).not.toContain('Secret Supplier');
    }
  });

  it('gives sales the selling prices instead', async () => {
    const created = (await call('POST', '/products', idem(manager), valid())).json().data;
    const seen = (await call('GET', `/products/${created.id}`, sales)).json().data;
    expect(seen).toMatchObject({ listPriceMinor: 130072, floorPriceMinor: 115063, ceilingPriceMinor: 160088, quantity: 2 });
  });

  it('shows managers the cost fields', async () => {
    const created = (await call('POST', '/products', idem(manager), valid())).json().data;
    const list = (await call('GET', '/products', manager)).json().data;
    expect(list[0]).toMatchObject({ id: created.id, costMinor: 100055, defaultMarkupBp: 3000, minMarkupBp: 1500 });
  });
});

describe('list products', () => {
  beforeEach(async () => {
    // Mirrors the reference catalogue: threshold 8 → Bangle (8) and Tennis (4) are low.
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', quantity: 24, createdAt: '2026-01-01T00:00:00Z' });
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BG-014', name: 'Classic Gold Bangle', quantity: 8, createdAt: '2026-01-02T00:00:00Z' });
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-DB-008', name: 'Diamond Tennis Bracelet', quantity: 4, barcode: '6291041500213', createdAt: '2026-01-03T00:00:00Z' });
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-RC-021', name: 'rose Gold Cuff', quantity: 17, createdAt: '2026-01-04T00:00:00Z' });
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-SO-099', name: 'Sold Out Pendant', quantity: 0, createdAt: '2026-01-05T00:00:00Z' });
    await createProduct(db, org, managerUser.memberId, { sku: 'VLR-OLD-01', name: 'Archived Brooch', quantity: 0, archived: true });
  });
  const names = async (qs: string, headers = sales) => {
    const res = await call('GET', `/products${qs}`, headers);
    expect(res.statusCode, qs).toBe(200);
    return (res.json().data as { name: string }[]).map((p) => p.name);
  };

  it('lists active products by name, case-insensitively, with counts per stock status', async () => {
    const res = await call('GET', '/products', sales);
    expect(res.json().data.map((p: { name: string }) => p.name)).toEqual([
      'Alhambra Gold Bracelet', 'Classic Gold Bangle', 'Diamond Tennis Bracelet', 'rose Gold Cuff', 'Sold Out Pendant',
    ]);
    expect(res.json().meta).toEqual({ nextCursor: null, hasMore: false, counts: { all: 5, inStock: 2, low: 2, out: 1 } });
  });

  it('filters by stock status, separating "out" from "low" (the reference labelled zero stock as low)', async () => {
    expect(await names('?stockStatus=in_stock')).toEqual(['Alhambra Gold Bracelet', 'rose Gold Cuff']);
    expect(await names('?stockStatus=low')).toEqual(['Classic Gold Bangle', 'Diamond Tennis Bracelet']);
    expect(await names('?stockStatus=out')).toEqual(['Sold Out Pendant']);
    expect(await names('?stockStatus=attention')).toEqual(['Classic Gold Bangle', 'Diamond Tennis Bracelet', 'Sold Out Pendant']);
    expect(await names('?sellable=true')).not.toContain('Sold Out Pendant');
  });

  it('uses a product reorder level in place of the organization threshold', async () => {
    await db.query(`UPDATE products SET reorder_level = 30 WHERE sku = 'VLR-BR-001'`);
    await db.query(`UPDATE products SET reorder_level = 2 WHERE sku = 'VLR-DB-008'`);
    expect(await names('?stockStatus=low')).toEqual(['Alhambra Gold Bracelet', 'Classic Gold Bangle']);
  });

  it('searches name, SKU and barcode as literal text', async () => {
    expect(await names('?q=gold')).toEqual(['Alhambra Gold Bracelet', 'Classic Gold Bangle', 'rose Gold Cuff']);
    expect(await names('?q=vlr-rc')).toEqual(['rose Gold Cuff']);
    expect(await names('?q=62910415')).toEqual(['Diamond Tennis Bracelet']);
    expect(await names('?q=zzz')).toEqual([]);
    // Wildcards and quotes are data, not syntax.
    expect(await names('?q=%25')).toEqual([]);
    expect(await names('?q=_')).toEqual([]);
    expect(await names(`?q=${encodeURIComponent("'; DROP TABLE products;--")}`)).toEqual([]);
    expect((await db.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(6);
  });

  it('keeps counts for the search while a status filter is applied', async () => {
    const res = await call('GET', '/products?q=gold&stockStatus=low', sales);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().meta.counts).toEqual({ all: 3, inStock: 2, low: 1, out: 0 });
  });

  it('sorts by each supported order', async () => {
    expect((await names('?sort=-name'))[0]).toBe('Sold Out Pendant');
    expect(await names('?sort=quantity')).toEqual(['Sold Out Pendant', 'Diamond Tennis Bracelet', 'Classic Gold Bangle', 'rose Gold Cuff', 'Alhambra Gold Bracelet']);
    expect((await names('?sort=-quantity'))[0]).toBe('Alhambra Gold Bracelet');
    expect(await names('?sort=-createdAt')).toEqual(['Sold Out Pendant', 'rose Gold Cuff', 'Diamond Tennis Bracelet', 'Classic Gold Bangle', 'Alhambra Gold Bracelet']);
    expect((await call('GET', '/products?sort=price', sales)).statusCode).toBe(400);
  });

  it.each(['name', '-name', 'quantity', '-quantity', '-createdAt'])('pages through sort=%s without skipping or repeating', async (sort) => {
    const all = await names(`?sort=${sort}`);
    const paged: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await call('GET', `/products?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ''}`, sales);
      expect(res.statusCode).toBe(200);
      paged.push(...res.json().data.map((p: { name: string }) => p.name));
      cursor = res.json().meta.nextCursor;
      expect(res.json().meta.hasMore).toBe(cursor !== null);
      pages++;
    } while (cursor && pages < 10);
    expect(paged).toEqual(all);
    expect(pages).toBe(3);
  });

  it('pages correctly through rows with equal sort values', async () => {
    await db.query(`UPDATE stock_levels SET quantity = 5`);
    const first = await call('GET', '/products?sort=quantity&limit=3', sales);
    const second = await call('GET', `/products?sort=quantity&limit=3&cursor=${first.json().meta.nextCursor}`, sales);
    const ids = [...first.json().data, ...second.json().data].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('rejects a malformed cursor and out-of-range limits', async () => {
    expect((await call('GET', '/products?cursor=garbage', sales)).json().error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'cursor' }] });
    expect((await call('GET', '/products?limit=0', sales)).statusCode).toBe(400);
    expect((await call('GET', '/products?limit=101', sales)).statusCode).toBe(400);
  });

  it('shows archived products only to managers who ask', async () => {
    expect(await names('?includeArchived=true', manager)).toContain('Archived Brooch');
    expect(await names('', manager)).not.toContain('Archived Brooch');
    expect(await names('?includeArchived=true', sales)).not.toContain('Archived Brooch');
  });
});

describe('product detail, edit and archive', () => {
  let id: string;
  beforeEach(async () => {
    id = (await createProduct(db, org, managerUser.memberId, { sku: 'VLR-BR-001', name: 'Alhambra Gold Bracelet', quantity: 24 })).id;
  });

  it('returns stock per branch', async () => {
    const res = await call('GET', `/products/${id}`, manager);
    expect(res.json().data).toMatchObject({ quantity: 24, stockByBranch: [{ branchId: org.branchId, branchName: 'Main', quantity: 24 }] });
  });

  it('answers 404 for unknown ids and ids that are not UUIDs', async () => {
    expect((await call('GET', `/products/${randomUUID()}`, manager)).statusCode).toBe(404);
    expect((await call('GET', '/products/not-a-uuid', manager)).json().error.code).toBe('NOT_FOUND');
  });

  it('edits fields, bumps the version and audits before/after', async () => {
    const res = await call('PATCH', `/products/${id}`, manager, { version: 1, name: 'Alhambra Bracelet', minMarkupBp: 2000, reorderLevel: 30, barcode: ' 999 ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ name: 'Alhambra Bracelet', minMarkupBp: 2000, defaultMarkupBp: 3000, reorderLevel: 30, stockStatus: 'LOW', barcode: '999', version: 2, quantity: 24 });
    const audit = (await db.query(`SELECT before, after FROM audit_logs WHERE action = 'product.update'`)).rows[0];
    expect(audit.before).toMatchObject({ name: 'Alhambra Gold Bracelet', minMarkupBp: 1500 });
    expect(audit.after).toMatchObject({ name: 'Alhambra Bracelet', minMarkupBp: 2000 });
  });

  it('refuses a stale version, so one editor cannot silently overwrite another', async () => {
    await call('PATCH', `/products/${id}`, manager, { version: 1, name: 'First edit' });
    const stale = await call('PATCH', `/products/${id}`, manager, { version: 1, name: 'Second edit' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'VERSION_CONFLICT', details: [{ currentVersion: 2 }] });
    expect((await call('GET', `/products/${id}`, manager)).json().data.name).toBe('First edit');
  });

  it('applies exactly one of two simultaneous edits', async () => {
    const results = await Promise.all(['A', 'B'].map((name) => call('PATCH', `/products/${id}`, manager, { version: 1, name })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await call('GET', `/products/${id}`, manager)).json().data.version).toBe(2);
  });

  it('cannot change cost or quantity through an edit', async () => {
    for (const body of [{ version: 1, costMinor: 1 }, { version: 1, quantity: 999 }, { version: 1, openingQuantity: 5 }]) {
      expect((await call('PATCH', `/products/${id}`, manager, body)).statusCode).toBe(400);
    }
    expect((await call('GET', `/products/${id}`, manager)).json().data).toMatchObject({ costMinor: 280000, quantity: 24 });
  });

  it('validates the merged markup policy and SKU uniqueness on edit', async () => {
    expect((await call('PATCH', `/products/${id}`, manager, { version: 1, minMarkupBp: 3500 })).json().error.code).toBe('MARKUP_POLICY_INVALID');
    await createProduct(db, org, managerUser.memberId, { sku: 'OTHER-1' });
    expect((await call('PATCH', `/products/${id}`, manager, { version: 1, sku: 'other-1' })).json().error.code).toBe('SKU_TAKEN');
    // Changing only the case of its own SKU is allowed.
    expect((await call('PATCH', `/products/${id}`, manager, { version: 1, sku: 'vlr-br-001' })).statusCode).toBe(200);
  });

  it('archives only when no stock is on hand, and is idempotent', async () => {
    const blocked = await call('DELETE', `/products/${id}`, manager);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: 'PRODUCT_HAS_STOCK', details: [{ quantity: 24 }] });

    await db.query('UPDATE stock_levels SET quantity = 0 WHERE product_id = $1', [id]);
    expect((await call('DELETE', `/products/${id}`, manager)).statusCode).toBe(204);
    expect((await call('DELETE', `/products/${id}`, manager)).statusCode).toBe(204);
    expect((await db.query('SELECT archived_at IS NOT NULL AS archived, is_active FROM products WHERE id = $1', [id])).rows[0]).toEqual({ archived: true, is_active: false });
    expect((await call('PATCH', `/products/${id}`, manager, { version: 2, name: 'x' })).json().error.code).toBe('INVALID_STATE');
    expect((await db.query(`SELECT 1 FROM audit_logs WHERE action = 'product.archive'`)).rowCount).toBe(1);
  });

  it('accepts a bodiless DELETE that still carries a JSON content type, as mobile HTTP clients send', async () => {
    await db.query('UPDATE stock_levels SET quantity = 0 WHERE product_id = $1', [id]);
    const res = await t.app.inject({ method: 'DELETE', url: `${api}/products/${id}`, headers: { ...manager, 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(204);
  });

  it('keeps edit and archive away from the sales role', async () => {
    expect((await call('PATCH', `/products/${id}`, sales, { version: 1, name: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', `/products/${id}`, sales)).statusCode).toBe(403);
  });
});

describe('tenant isolation', () => {
  it("treats another organization's products as non-existent on every route", async () => {
    const other = await createOrg(db, 'Other Jewellers');
    const otherManager = await createUser(db, other, 'MANAGER');
    const theirs = await createProduct(db, other, otherManager.memberId, { sku: 'THEIRS-1', name: 'Their Ring', quantity: 5 });

    expect((await call('GET', '/products', manager)).json().data).toEqual([]);
    expect((await call('GET', '/products?q=Their', manager)).json().meta.counts.all).toBe(0);
    expect((await call('GET', `/products/${theirs.id}`, manager)).statusCode).toBe(404);
    expect((await call('PATCH', `/products/${theirs.id}`, manager, { version: 1, name: 'hijack' })).statusCode).toBe(404);
    expect((await call('DELETE', `/products/${theirs.id}`, manager)).statusCode).toBe(404);
    expect((await call('POST', '/inventory/receipts', idem(manager), { productId: theirs.id, quantity: 1, unitCostMinor: 1 })).statusCode).toBe(404);
    expect((await call('POST', '/inventory/adjustments', idem(manager), { productId: theirs.id, quantityDelta: -1, reason: 'steal' })).statusCode).toBe(404);
    expect((await call('GET', `/inventory/movements?productId=${theirs.id}`, manager)).json().data).toEqual([]);
    // The same SKU can exist in both organizations.
    expect((await call('POST', '/products', idem(manager), valid({ sku: 'THEIRS-1' }))).statusCode).toBe(201);

    const untouched = (await db.query('SELECT p.name, s.quantity FROM products p JOIN stock_levels s ON s.product_id = p.id WHERE p.id = $1', [theirs.id])).rows[0];
    expect(untouched).toEqual({ name: 'Their Ring', quantity: 5 });
  });
});
