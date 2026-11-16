# ADR-0002 — Modular monolith on NestJS/Fastify, PostgreSQL and Prisma; no Redis in v1

**Status:** Accepted (2026-11-15) · **Date:** 2026-11-15

## Context
Sales, stock and payments must change together in one transaction. The team and load are small. The brief prefers Node.js/NestJS, PostgreSQL and Prisma, and asks that Redis and microservices be justified rather than assumed.

## Decision
- One deployable NestJS application (Fastify adapter) with domain modules that communicate through service interfaces.
- PostgreSQL 16 as the only datastore. Prisma for schema, migrations and ordinary queries; raw SQL, confined to repositories and migrations, for conditional stock updates, `SELECT … FOR UPDATE`, `CHECK` constraints, partial/functional indexes and row-level security.
- REST with an OpenAPI 3.1 contract under `/api/v1`.
- No Redis: idempotency records, login throttling and sequences live in PostgreSQL. No message queue: nothing is asynchronous yet except email, sent after commit with a simple retry.

## Consequences
- Simple operations: one container and one database.
- Two query styles (Prisma and SQL) must be kept disciplined.
- Revisit Redis when there are more than about two API instances needing shared rate limits, or when background jobs (scheduled reports, push notifications) are added. Revisit service extraction only if a module needs independent scaling.

## Alternatives considered
Microservices (distributed transactions for the core flow — rejected). Drizzle/Kysely (closer to SQL; Prisma chosen for migrations and team familiarity). GraphQL (no need; REST is simpler for idempotent offline replay).
