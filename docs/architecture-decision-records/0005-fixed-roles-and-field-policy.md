# ADR-0005 — Three fixed roles and server-side field confidentiality

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Context
The reference distinguishes Manager and Sales, and intends to hide purchase prices and profit from Sales — but exposes the markup percentage next to the selling price and applies the distinction only in the browser.

## Decision
- Roles `OWNER`, `MANAGER`, `SALES` as an enum on the membership; permissions are a static map in code. No `roles`/`permissions` tables.
- Cost, markup and profit fields are marked manager-only in the API schema and stripped by a role-aware serializer; a contract test proves their absence for Sales on every endpoint.
- Sales staff price by choosing an amount between a floor and a ceiling supplied by the server (decision D1).

## Consequences
- Simple to reason about and test; adding a role is a code change.
- Custom per-tenant roles would require moving the map to data — deferred until requested.
