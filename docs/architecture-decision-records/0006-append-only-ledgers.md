# ADR-0006 — Append-only stock and payment ledgers; invoices are immutable

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Context
The reference overwrites product quantities in place and stores one "amount received" on the invoice. There is no history, and overselling silently clamps stock to zero.

## Decision
- Stock changes only by inserting `stock_movements`; `stock_levels.quantity` is a cache updated in the same transaction, guarded by `CHECK (quantity >= 0)` and a conditional update.
- Money changes only by inserting `payments` (payment or refund). Invoice paid/returned amounts and payment status are caches derived from those rows.
- Issued invoices and their lines are never edited; corrections are cancellations and returns (credit notes).
- The application database role has no `UPDATE`/`DELETE` on ledger and audit tables. A nightly job checks caches against ledgers and alerts on differences.

## Consequences
- Complete traceability; safe concurrency.
- "Fixing a typo" on an invoice means cancel and reissue — intentional.
- More rows; acceptable at this scale.
