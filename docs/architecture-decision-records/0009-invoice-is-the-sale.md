# ADR-0009 — An invoice is the sale; quotations are separate; a payment belongs to one invoice

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Context
The brief lists sales, sale items, invoices, invoice items, payments and payment allocations as candidates. In the reference, completing a sale *is* generating the invoice; quotations are saved carts; "Credit" and "Partial" are presented as payment methods.

## Decision
- No `sales` table or `/sales` resource: `invoices` + `invoice_items` represent the sale.
- `quotations` are a separate entity with their own numbering and lifecycle; converting one creates an invoice linked to it.
- `payments` rows attach to exactly one invoice; payment status (`UNPAID`, `PARTIAL`, `PAID`) and overdue are derived. Methods are only real methods (cash, bank transfer).
- Returns are credit notes linked to the invoice.

## Consequences
- Fewer tables and endpoints, matching how users think about the product.
- Customer-level payments spanning several invoices, deposits and store credit are not supported; adding them later means introducing an allocation table — a known, additive change.
