# ADR-0001 — Server-authoritative backend

**Status:** Proposed · **Date:** 2026-11-15

## Context
The reference application has no backend. All data is in one browser's `localStorage`, roles are a dropdown, and three dashboard figures are literals. It cannot support two devices, real access control, or trustworthy stock.

## Decision
Build a backend that owns every business rule, number, stock level and balance. Mobile clients are untrusted: they send intent (products, quantities, unit prices, payment), the server validates and computes. The reference is treated as a statement of product intent and visual identity, not as a system to integrate with or port.

## Consequences
- Backend, database, authentication and API are new work — the largest part of the project.
- Behaviour absent from the reference (returns, later payments, numbering, concurrency) must be designed and approved (roadmap decisions D1–D10).
- A pure on-device app (closest to the reference) was rejected: it cannot give multi-user consistency, cost confidentiality or auditability.
