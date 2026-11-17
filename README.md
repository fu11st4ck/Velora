# Velora — Sales & Inventory

Native Android and iOS application (Flutter) with a NestJS/PostgreSQL backend for jewellery sales and inventory: stock, customer pricing, quotations, invoices, payments and reports.

> **Status (2026-11-16): Sprints 0–5 delivered, Sprint 6 partly** — the backend and the Flutter app cover sign-in, inventory, customers, the sale flow, documents, dashboard, reports, settings and offline use (saved products and customers, queued quotations, customers and payments). **Deployment:** a Docker Compose setup is in [`deploy/`](deploy/README.md) (rehearsed locally, not yet run on a server). **Not done:** product photos, barcode scanning and store builds. The app has never been run on a physical device. See [`TASKS.md`](TASKS.md) and [`CHANGELOG.md`](CHANGELOG.md).

The product is derived from the reference web demo at <https://velora-sales-inventory.sujankarki15357.chatgpt.site/>. That demo is a browser-only prototype with no server; see [`docs/product-discovery.md`](docs/product-discovery.md).

## Start here

| If you want to… | Read |
|---|---|
| Know what the reference does and where it falls short | [`docs/product-discovery.md`](docs/product-discovery.md), [`docs/feature-matrix.md`](docs/feature-matrix.md) |
| See the flows | [`docs/user-flow-map.md`](docs/user-flow-map.md) |
| Review the decisions awaiting approval, the backlog and the risks | [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md) |
| See the feature list per platform (API, Android, iOS, Web) and effort estimates | [`docs/feature-list-and-estimation.md`](docs/feature-list-and-estimation.md) |
| Check a calculation or rule | [`docs/business-rules.md`](docs/business-rules.md) |
| Understand the design direction | [`docs/design-audit.md`](docs/design-audit.md), [`docs/design-system.md`](docs/design-system.md), [`docs/mobile-screen-specifications.md`](docs/mobile-screen-specifications.md) |
| Understand the system | [`docs/system-architecture.md`](docs/system-architecture.md), [`docs/architecture-decision-records/`](docs/architecture-decision-records/) |
| Work on data | [`docs/database-design.md`](docs/database-design.md), [`docs/entity-relationship-diagram.md`](docs/entity-relationship-diagram.md), [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) |
| Work on the API | [`docs/api-specification.md`](docs/api-specification.md), [`docs/api-error-handling.md`](docs/api-error-handling.md), [`backend/openapi/openapi.yaml`](backend/openapi/openapi.yaml) |
| Offline, security, testing | [`docs/offline-sync-strategy.md`](docs/offline-sync-strategy.md), [`docs/security-guidelines.md`](docs/security-guidelines.md), [`docs/testing-strategy.md`](docs/testing-strategy.md) |

## Repository layout

```
backend/                   NestJS API
  src/                     common, prisma, authz, auth, catalog, inventory, customers, idempotency, audit, mail, health
  prisma/                  schema, migrations (incl. constraints + row-level security), seed
  openapi/openapi.yaml     API contract
  test/                    unit, HTTP integration and direct-SQL tests
mobile/                    Flutter app
  lib/app/                 config, router, theme
  lib/core/                api client, auth/session, money, shared widgets
  lib/features/            auth, shell, home, products (inventory), customers, more
  test/                    unit, widget, app-flow, golden and live contract tests
docs/                      Product, design, architecture, API, strategy documents
  reference-screenshots/   Evidence from the audit of the reference app + the audit script
  architecture-decision-records/
DEVELOPMENT.md  ENVIRONMENT.md  CHANGELOG.md  TASKS.md
```

## Stack

Flutter · Riverpod · go_router · Dio · Drift — NestJS (Fastify) · Prisma · PostgreSQL 16 — REST `/api/v1` with OpenAPI 3.1. Rationale and trade-offs: [`docs/system-architecture.md`](docs/system-architecture.md).
