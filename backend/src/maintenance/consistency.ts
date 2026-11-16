/**
 * Cross-checks every derived figure against the rows it is derived from, across all organizations.
 * The application keeps these in step inside transactions; this job exists to prove it stayed so
 * (business rules S1, Y2, C5) and to raise an alarm if anything — a bug, a manual fix — broke it.
 *
 * Runs with the schema owner's connection (row-level security would hide other tenants). Read-only.
 */
export interface Finding {
  check: string;
  organizationId: string | null;
  entityId: string;
  detail: string;
}

type Query = (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;

const CHECKS: { check: string; sql: string }[] = [
  {
    check: 'stock_matches_ledger',
    sql: `SELECT s.organization_id, s.product_id AS entity_id,
                 'stock level ' || s.quantity || ', ledger total ' || COALESCE(SUM(m.quantity_delta), 0) AS detail
          FROM stock_levels s
          LEFT JOIN stock_movements m ON m.product_id = s.product_id AND m.branch_id = s.branch_id
          GROUP BY s.organization_id, s.product_id, s.branch_id, s.quantity
          HAVING s.quantity <> COALESCE(SUM(m.quantity_delta), 0)`,
  },
  {
    check: 'stock_not_negative',
    sql: `SELECT organization_id, product_id AS entity_id, 'quantity ' || quantity AS detail FROM stock_levels WHERE quantity < 0`,
  },
  {
    check: 'invoice_paid_matches_payments',
    sql: `SELECT i.organization_id, i.id AS entity_id,
                 'paid ' || i.paid_minor || ', payment rows ' || COALESCE(p.net, 0) AS detail
          FROM invoices i
          LEFT JOIN (SELECT invoice_id, SUM(CASE kind WHEN 'PAYMENT' THEN amount_minor ELSE -amount_minor END) AS net
                     FROM payments GROUP BY invoice_id) p ON p.invoice_id = i.id
          WHERE i.paid_minor <> COALESCE(p.net, 0)`,
  },
  {
    check: 'invoice_returned_matches_returns',
    sql: `SELECT i.organization_id, i.id AS entity_id,
                 'returned ' || i.returned_minor || ', credit notes ' || COALESCE(r.total, 0) AS detail
          FROM invoices i
          LEFT JOIN (SELECT invoice_id, SUM(total_minor) AS total FROM sales_returns GROUP BY invoice_id) r ON r.invoice_id = i.id
          WHERE i.returned_minor <> COALESCE(r.total, 0)`,
  },
  {
    check: 'invoice_totals_add_up',
    sql: `SELECT i.organization_id, i.id AS entity_id,
                 'total ' || i.total_minor || ', parts ' || (i.subtotal_minor - i.discount_minor + i.tax_minor) || ', lines ' || COALESCE(l.total, 0) AS detail
          FROM invoices i
          LEFT JOIN (SELECT invoice_id, SUM(line_total_minor) AS total FROM invoice_items GROUP BY invoice_id) l ON l.invoice_id = i.id
          WHERE i.total_minor <> i.subtotal_minor - i.discount_minor + i.tax_minor OR i.subtotal_minor <> COALESCE(l.total, 0)`,
  },
  {
    check: 'invoice_payment_status_matches_balance',
    sql: `SELECT organization_id, id AS entity_id,
                 payment_status || ' with paid ' || paid_minor || ' of ' || (total_minor - returned_minor) AS detail
          FROM invoices
          WHERE status = 'ISSUED' AND payment_status::text <> CASE
                  WHEN total_minor - returned_minor - paid_minor <= 0 THEN 'PAID'
                  WHEN paid_minor > 0 THEN 'PARTIAL' ELSE 'UNPAID' END`,
  },
  {
    check: 'invoice_not_overpaid',
    sql: `SELECT organization_id, id AS entity_id, 'paid ' || paid_minor || ' exceeds ' || (total_minor - returned_minor) AS detail
          FROM invoices WHERE status = 'ISSUED' AND paid_minor > total_minor - returned_minor`,
  },
  {
    check: 'returned_quantity_matches_returns',
    sql: `SELECT i.organization_id, ii.id AS entity_id,
                 'line says ' || ii.returned_quantity || ', return rows ' || COALESCE(r.qty, 0) || ' of ' || ii.quantity AS detail
          FROM invoice_items ii
          JOIN invoices i ON i.id = ii.invoice_id
          LEFT JOIN (SELECT invoice_item_id, SUM(quantity) AS qty FROM return_items GROUP BY invoice_item_id) r ON r.invoice_item_id = ii.id
          WHERE ii.returned_quantity <> COALESCE(r.qty, 0) OR ii.returned_quantity > ii.quantity`,
  },
  {
    check: 'one_default_tax_rate',
    sql: `SELECT o.id AS organization_id, o.id AS entity_id, COUNT(t.id) || ' active default rates' AS detail
          FROM organizations o LEFT JOIN tax_rates t ON t.organization_id = o.id AND t.is_default AND t.is_active
          GROUP BY o.id HAVING COUNT(t.id) <> 1`,
  },
  {
    check: 'has_active_owner',
    sql: `SELECT o.id AS organization_id, o.id AS entity_id, 'no active owner' AS detail
          FROM organizations o
          WHERE NOT EXISTS (SELECT 1 FROM organization_members m JOIN users u ON u.id = m.user_id
                            WHERE m.organization_id = o.id AND m.role = 'OWNER' AND m.is_active AND u.is_active)`,
  },
];

export async function checkConsistency(query: Query): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const { check, sql } of CHECKS) {
    for (const row of (await query(sql)).rows) {
      findings.push({
        check,
        organizationId: (row.organization_id as string | null) ?? null,
        entityId: String(row.entity_id),
        detail: String(row.detail),
      });
    }
  }
  return findings;
}

/**
 * Deletes rows that only exist to expire: idempotency records past their retention, and sign-in
 * and reset tokens that can no longer be used. Returns how many of each were removed.
 */
export async function purgeExpired(
  query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }>,
  now: Date,
): Promise<Record<string, number>> {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const run = async (sql: string, cutoff: Date) => (await query(sql, [cutoff])).rowCount ?? 0;
  return {
    idempotencyKeys: await run('DELETE FROM idempotency_keys WHERE expires_at < $1', now),
    // Kept a month past expiry, so a late replay of a stolen token is still recognised and logged.
    refreshTokens: await run('DELETE FROM refresh_tokens WHERE expires_at < $1', monthAgo),
    passwordResetTokens: await run('DELETE FROM password_reset_tokens WHERE expires_at < $1', monthAgo),
  };
}
