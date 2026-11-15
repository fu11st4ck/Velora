# Tasks

Legend: `[x]` done · `[ ]` open · `[~]` in progress · **(blocked: …)**. Detailed backlog with dependencies: [`docs/implementation-roadmap.md`](docs/implementation-roadmap.md).

## Sprint 0 — Discovery and architecture
- [x] Inspect workspace, tooling and repository (empty repository; no Flutter SDK, Android SDK or Docker daemon)
- [x] Gain access to and audit the complete reference application (source + Playwright, 3 viewports, both roles)
- [x] `docs/product-discovery.md`, `docs/user-flow-map.md`, `docs/feature-matrix.md`
- [x] `docs/design-audit.md`, `docs/design-system.md`, `docs/mobile-screen-specifications.md`
- [x] `docs/business-rules.md`
- [x] `docs/system-architecture.md` + ADRs 0001–0009
- [x] `backend/prisma/schema.prisma` (validated), `docs/database-design.md`, `docs/entity-relationship-diagram.md`
- [x] `docs/api-specification.md`, `docs/api-error-handling.md`, `backend/openapi/openapi.yaml` (linted)
- [x] `docs/offline-sync-strategy.md`, `docs/security-guidelines.md`, `docs/testing-strategy.md`
- [x] `docs/implementation-roadmap.md`, `README.md`, `DEVELOPMENT.md`, `ENVIRONMENT.md`, `CHANGELOG.md`
- [ ] **Owner review and approval of architecture and decisions D1–D11** ← current gate

## Sprint 1 — Foundation (blocked: Sprint 0 approval)
- [ ] S1-01 Repository layout, tooling, CI
- [ ] S1-02 Docker Compose dev stack
- [ ] S1-03 NestJS/Fastify skeleton (config, logging, errors, envelope, health)
- [ ] S1-04 Migration #1 with SQL constraints and RLS; demo seed
- [ ] S1-05 Tenant context, transactions, money, pagination, idempotency, audit
- [ ] S1-06 Authentication and authorization + tests
- [ ] S1-07 Flutter project, flavours, router shell, API client, storage
- [ ] S1-08 Design system implementation + goldens + contrast test
- [ ] S1-09 Login / reset screens and session handling

## Sprint 2 — Products and inventory (blocked: D2)
- [ ] S2-01 Products API · S2-02 Image upload · S2-03 Receipts, adjustments, ledger
- [ ] S2-04 Inventory screens · S2-05 Barcode scanning · S2-06 Product cache and delta sync

## Sprint 3 — Customers
- [ ] S3-01 Customers API · S3-02 Customer screens and picker · S3-03 Cache and offline create

## Sprint 4 — Sales and documents (blocked: D1, D3, D4, D7)
- [ ] S4-01 Pricing engine · S4-02 Numbering and quotations · S4-03 Invoice issue transaction
- [ ] S4-04 Payments and refunds · S4-05 Cancellation and returns · S4-06 Documents list and PDF
- [ ] S4-07 Sell flow screens · S4-08 Documents screens

## Sprint 5 — Dashboard, reports, settings
- [ ] S5-01 Dashboard · S5-02 Reports API and CSV · S5-03 Reports screen
- [ ] S5-04 Settings, tax rates, team · S5-05 Sessions and appearance

## Sprint 6 — Production readiness
- [ ] S6-01 Outbox and sync · S6-02 Security review · S6-03 Performance
- [ ] S6-04 Monitoring and consistency job · S6-05 Deployment and backups (blocked: D11)
- [ ] S6-06 Store preparation · S6-07 Device end-to-end and accessibility pass

## Open blockers
- Android SDK download host is not reachable from the current workspace; iOS builds need macOS (CI).
