# ADR-0004 — Shared-schema multi-tenancy with row-level security

**Status:** Proposed · **Date:** 2026-11-15

## Context
The brief requires organization-level isolation. The reference has a single hardcoded company.

## Decision
One database and schema; every business table has `organization_id`. Isolation is enforced twice: repositories always scope by the request's tenant context, and PostgreSQL row-level security policies compare `organization_id` with a transaction-local setting. The application role cannot bypass RLS. Cross-tenant access answers `404`.

Branches exist in the schema (stock is per product per branch) because adding that dimension later would mean rewriting the stock ledger; the v1 UI is single-branch.

## Consequences
- Cheap to operate; one migration path.
- Every transaction must set the tenant setting first — handled by a single transaction helper and tested.
- Schema-per-tenant or database-per-tenant were rejected as operationally heavy for the expected number and size of tenants.
