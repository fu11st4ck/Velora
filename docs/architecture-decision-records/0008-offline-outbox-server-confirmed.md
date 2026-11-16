# ADR-0008 — Offline via local cache and outbox; stock and money confirmed by the server

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Context
Shops may have unreliable connectivity. Offline writes to shared stock and money can create inconsistent records.

## Decision
- Cache products, customers and viewed documents locally; refresh by a delta feed.
- Drafts are local. Customers, quotations and payments on existing invoices can be queued with client-generated IDs and idempotency keys.
- Invoices offline are disabled by default; when an organization enables them they are provisional (no number) until the server accepts them. The server never partially fulfils or goes negative; it rejects, and the app surfaces the item for a human decision.
- No automatic conflict resolution for anything involving stock or money.

## Consequences
- Predictable and auditable, at the cost of some operations requiring connectivity.
- Full offline-first with CRDT-style merging was rejected: stock of unique items is not mergeable.
