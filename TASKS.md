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
- [x] Owner review: all recommended defaults (D1–D11) accepted on 2026-11-15

## Sprint 1 — Foundation
- [x] S1-01 Repository layout (`backend/`, `mobile/`), lint, type-check, CI workflow *(workflow written; not yet executed — nothing has been pushed to GitHub)*
- [x] S1-02 Docker Compose dev stack and API Dockerfile *(written; not run here — no Docker daemon. Local PostgreSQL via `backend/scripts/db-setup.sh` is what was used)*
- [x] S1-03 NestJS/Fastify skeleton: validated config, request ids, error envelope, response envelope, health, security headers, rate limits
- [x] S1-04 Migrations: schema + SQL constraints, row-level security, append-only privileges; demo seed
- [x] S1-05 Tenant-scoped transactions, money module, idempotency service, audit service
- [x] S1-06 Authentication (sign-in with lockout, refresh rotation with reuse detection, sign-out, password reset/change, `/auth/me`) and deny-by-default authorization
- [x] S1-07 Flutter project: entry points per flavour, Riverpod, go_router shell with five tabs, Dio client with token refresh, secure token storage
- [x] S1-08 Design system: light/dark themes, tokens, bundled fonts, shared components, contrast test, golden screenshots
- [x] S1-09 Sign-in, forgot/reset password, session restore, sign-out

### Carried over from Sprint 1
- [ ] Android and iOS builds and on-device runs — **blocked here** (no Android SDK, no macOS); CI jobs `mobile-android` and `mobile-ios` are defined and will run on the first push
- [ ] Native build flavours (Android `productFlavors`, iOS schemes) and the `velora://` deep-link registration — need the native toolchains to verify; Dart entry points and `--dart-define` config are in place
- [ ] Drift local database — moved to S2-06, where the product cache is its first real use
- [ ] Freezed / json_serializable — deferred until model count justifies code generation (Sprint 2); current models are hand-written
- [ ] Localisation via ARB files — strings are English literals in widgets for now; extract before Sprint 4
- [ ] Pagination helper and role-aware field serializer — built with their first consumer (S2-01)
- [ ] Appearance setting (System/Light/Dark) — app follows the system theme today
- [ ] Remove `NotBuiltYetScreen` from Inventory (S2), Sell and Documents (S4)

## Sprint 2 — Products and inventory ← next
- [ ] S2-01 Products API · S2-02 Image upload · S2-03 Receipts, adjustments, ledger
- [ ] S2-04 Inventory screens · S2-05 Barcode scanning · S2-06 Product cache and delta sync

## Sprint 3 — Customers
- [ ] S3-01 Customers API · S3-02 Customer screens and picker · S3-03 Cache and offline create

## Sprint 4 — Sales and documents (D7 tax rule needs accountant confirmation)
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
- **Nothing has been pushed.** GitHub refuses pushes from this session to `fu11st4ck/Velora` (the Claude GitHub App has no write access). All work is committed locally on `claude/velora-flutter-mobile-nmc3b4`.
- Android SDK download host is not reachable from the current workspace; iOS builds need macOS (CI).
