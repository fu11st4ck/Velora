import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appDb, createOrg, createUser, ownerDb, resetDb, type SeededOrg, type SeededUser } from './helpers';

/**
 * Database-level protections, exercised with raw SQL so they hold even if application code has a bug.
 * `owner` arranges data; `app` is the restricted role the API connects as.
 */
let owner: Client;
let app: Client;
let a: SeededOrg;
let b: SeededOrg;
let aManager: SeededUser;

async function product(orgId: string, sku: string, extra: Partial<{ min: number; def: number; cost: number }> = {}) {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO products (id, organization_id, sku, name, cost_minor, default_markup_bp, min_markup_bp, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [id, orgId, sku, `Product ${sku}`, extra.cost ?? 280000, extra.def ?? 3000, extra.min ?? 1500],
  );
  return id;
}

/** Runs statements as the application role inside one transaction pinned to an organization. */
async function asTenant<T>(orgId: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN');
  try {
    if (orgId) await app.query(`SELECT set_config('app.organization_id', $1, true)`, [orgId]);
    return await fn();
  } finally {
    await app.query('ROLLBACK');
  }
}

beforeAll(async () => {
  owner = await ownerDb();
  app = await appDb();
});
afterAll(async () => {
  await owner.end();
  await app.end();
});
beforeEach(async () => {
  await resetDb(owner);
  a = await createOrg(owner, 'Org A');
  b = await createOrg(owner, 'Org B');
  aManager = await createUser(owner, a, 'MANAGER');
  await product(a.id, 'A-001');
  await product(b.id, 'B-001');
});

describe('row-level security', () => {
  it('shows no tenant rows when no organization is set', async () => {
    await asTenant(null, async () => {
      for (const table of ['organizations', 'products', 'branches', 'tax_rates', 'organization_members', 'audit_logs']) {
        expect((await app.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, table).toBe(0);
      }
    });
  });

  it('shows only the pinned organization', async () => {
    await asTenant(a.id, async () => {
      expect((await app.query('SELECT sku FROM products')).rows).toEqual([{ sku: 'A-001' }]);
      expect((await app.query('SELECT name FROM organizations')).rows).toEqual([{ name: 'Org A' }]);
      expect((await app.query('SELECT count(*)::int AS n FROM organization_members')).rows[0].n).toBe(1);
    });
  });

  it("refuses to write a row into another organization", async () => {
    await asTenant(a.id, async () => {
      await expect(
        app.query(
          `INSERT INTO products (id, organization_id, sku, name, cost_minor, default_markup_bp, min_markup_bp, updated_at)
           VALUES (gen_random_uuid(), $1, 'X-1', 'x', 1, 1, 1, now())`,
          [b.id],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("cannot update or see another organization's rows even by id", async () => {
    await asTenant(a.id, async () => {
      const res = await app.query(`UPDATE products SET name = 'hijacked' WHERE sku = 'B-001'`);
      expect(res.rowCount).toBe(0);
    });
    expect((await owner.query(`SELECT name FROM products WHERE sku = 'B-001'`)).rows[0].name).toBe('Product B-001');
  });

  it('lets a user see their own membership before a tenant is chosen (sign-in), and nobody else', async () => {
    const other = await createUser(owner, b, 'SALES');
    await app.query('BEGIN');
    await app.query(`SELECT set_config('app.user_id', $1, true)`, [aManager.userId]);
    const rows = (await app.query('SELECT user_id FROM organization_members')).rows;
    await app.query('ROLLBACK');
    expect(rows).toEqual([{ user_id: aManager.userId }]);
    expect(rows).not.toContainEqual({ user_id: other.userId });
  });

  it('the application role cannot bypass row-level security', async () => {
    const role = (await owner.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'velora_app'`)).rows[0];
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const unprotected = await owner.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
         AND c.relname NOT IN ('users', 'refresh_tokens', 'password_reset_tokens', '_prisma_migrations')`,
    );
    expect(unprotected.rows).toEqual([]);
  });
});

describe('append-only history and no hard deletes', () => {
  it('denies UPDATE and DELETE on ledgers and the audit log', async () => {
    for (const table of ['audit_logs', 'stock_movements', 'payments', 'sales_returns', 'return_items']) {
      await asTenant(a.id, async () => {
        await expect(app.query(`DELETE FROM ${table}`), table).rejects.toThrow(/permission denied/);
      });
      await asTenant(a.id, async () => {
        await expect(app.query(`UPDATE ${table} SET id = id`), table).rejects.toThrow(/permission denied/);
      });
    }
  });

  it('denies DELETE on business records', async () => {
    for (const table of ['products', 'customers', 'invoices', 'quotations', 'organizations', 'users']) {
      await asTenant(a.id, async () => {
        await expect(app.query(`DELETE FROM ${table}`), table).rejects.toThrow(/permission denied/);
      });
    }
  });
});

describe('constraints', () => {
  const insertProduct = (sku: string, min: number, def: number, cost = 100) =>
    owner.query(
      `INSERT INTO products (id, organization_id, sku, name, cost_minor, default_markup_bp, min_markup_bp, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'p', $3, $4, $5, now())`,
      [a.id, sku, cost, def, min],
    );

  it('keeps SKU unique per organization regardless of case, but allows it in another organization', async () => {
    await expect(insertProduct('a-001', 1500, 3000)).rejects.toThrow(/products_org_sku_lower_key/);
    await expect(product(b.id, 'A-001')).resolves.toBeTruthy();
  });

  it('rejects a minimum markup above the default, and negative cost', async () => {
    await expect(insertProduct('M-1', 4000, 1000)).rejects.toThrow(/products_markup_chk/);
    await expect(insertProduct('M-2', 1500, 3000, -1)).rejects.toThrow(/products_cost_chk/);
  });

  it('never lets stock go negative', async () => {
    const id = (await owner.query(`SELECT id FROM products WHERE sku = 'A-001'`)).rows[0].id;
    await owner.query(
      `INSERT INTO stock_levels (id, organization_id, product_id, branch_id, quantity, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, 2, now())`,
      [a.id, id, a.branchId],
    );
    await expect(owner.query(`UPDATE stock_levels SET quantity = quantity - 3 WHERE product_id = $1`, [id])).rejects.toThrow(
      /stock_levels_quantity_chk/,
    );
  });

  it('requires the movement sign to match its type and a reason for adjustments', async () => {
    const id = (await owner.query(`SELECT id FROM products WHERE sku = 'A-001'`)).rows[0].id;
    const move = (type: string, delta: number, reason: string | null) =>
      owner.query(
        `INSERT INTO stock_movements (id, organization_id, product_id, branch_id, type, quantity_delta, balance_after, unit_cost_minor, reason, created_by_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::"StockMovementType", $5, 5, 100, $6, $7)`,
        [a.id, id, a.branchId, type, delta, reason, aManager.memberId],
      );
    await expect(move('PURCHASE_RECEIPT', -1, null)).rejects.toThrow(/stock_movements_delta_chk/);
    await expect(move('ADJUSTMENT_OUT', 1, 'count correction')).rejects.toThrow(/stock_movements_delta_chk/);
    await expect(move('ADJUSTMENT_OUT', -1, null)).rejects.toThrow(/stock_movements_reason_chk/);
    await expect(move('SALE', -1, null)).rejects.toThrow(/stock_movements_source_chk/);
    await expect(move('ADJUSTMENT_OUT', -1, 'count correction')).resolves.toBeTruthy();
    await expect(move('PURCHASE_RECEIPT', 5, null)).resolves.toBeTruthy();
  });

  it('requires a customer to have a name or a company', async () => {
    const insert = (name: string | null, company: string | null) =>
      owner.query(`INSERT INTO customers (id, organization_id, name, company, updated_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`, [
        a.id,
        name,
        company,
      ]);
    await expect(insert(null, null)).rejects.toThrow(/customers_identity_chk/);
    await expect(insert('  ', '')).rejects.toThrow(/customers_identity_chk/);
    await expect(insert(null, 'Maison Luxe')).resolves.toBeTruthy();
  });

  it('allows one default tax rate and one default branch per organization', async () => {
    await expect(
      owner.query(`INSERT INTO tax_rates (id, organization_id, name, rate_bp, is_default, updated_at) VALUES (gen_random_uuid(), $1, 'Other', 0, true, now())`, [a.id]),
    ).rejects.toThrow(/tax_rates_one_default_key/);
    await expect(
      owner.query(`INSERT INTO branches (id, organization_id, name, code, is_default, updated_at) VALUES (gen_random_uuid(), $1, 'Two', 'TWO', true, now())`, [a.id]),
    ).rejects.toThrow(/branches_one_default_key/);
  });
});
