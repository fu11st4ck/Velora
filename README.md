# Velora — Sales & Inventory

Native Android and iOS application (Flutter) with a NestJS/PostgreSQL backend for jewellery sales and inventory: stock, customer pricing, quotations, invoices, payments and reports.

> **Status (2026-11-15): Sprint 0 — discovery and architecture — is complete and awaiting approval. No application code exists yet.** This repository currently contains the design documents, the database schema and the API contract.

The product is derived from the reference web demo at <https://velora-sales-inventory.sujankarki15357.chatgpt.site/>. That demo is a browser-only prototype with no server; see [`docs/product-discovery.md`](docs/product-discovery.md).

## Start here

| If you want to… | Read |
|---|---|
| Know what the reference does and where it falls short | [`docs/product-discovery.md`](docs/product-discovery.md), [`docs/feature-matrix.md`](docs/feature-matrix.md) |
| See the flows | [`docs/user-flow-map.md`](docs/user-flow-map.md) |
| Review the decisions awaiting approval, the backlog and the risks | [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md) |
| Check a calculation or rule | [`docs/business-rules.md`](docs/business-rules.md) |
| Understand the design direction | [`docs/design-audit.md`](docs/design-audit.md), [`docs/design-system.md`](docs/design-system.md), [`docs/mobile-screen-specifications.md`](docs/mobile-screen-specifications.md) |
| Understand the system | [`docs/system-architecture.md`](docs/system-architecture.md), [`docs/architecture-decision-records/`](docs/architecture-decision-records/) |
| Work on data | [`docs/database-design.md`](docs/database-design.md), [`docs/entity-relationship-diagram.md`](docs/entity-relationship-diagram.md), [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) |
| Work on the API | [`docs/api-specification.md`](docs/api-specification.md), [`docs/api-error-handling.md`](docs/api-error-handling.md), [`backend/openapi/openapi.yaml`](backend/openapi/openapi.yaml) |
| Offline, security, testing | [`docs/offline-sync-strategy.md`](docs/offline-sync-strategy.md), [`docs/security-guidelines.md`](docs/security-guidelines.md), [`docs/testing-strategy.md`](docs/testing-strategy.md) |

## Repository layout

```
backend/
  prisma/schema.prisma     PostgreSQL schema (validated)
  openapi/openapi.yaml     API contract (linted)
docs/                      Product, design, architecture, API, strategy documents
  reference-screenshots/   Evidence from the audit of the reference app + the audit script
  architecture-decision-records/
mobile/                    Flutter app — created in Sprint 1
DEVELOPMENT.md  ENVIRONMENT.md  CHANGELOG.md  TASKS.md
```

## Stack (proposed)

Flutter · Riverpod · go_router · Dio · Drift — NestJS (Fastify) · Prisma · PostgreSQL 16 — REST `/api/v1` with OpenAPI 3.1. Rationale and trade-offs: [`docs/system-architecture.md`](docs/system-architecture.md).
