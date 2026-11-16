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
- [ ] Drift local database — moves with the product cache to Sprint 6 (see below)
- [ ] Freezed / json_serializable — still deferred; models remain hand-written and small
- [ ] Localisation via ARB files — strings are English literals in widgets for now; extract before Sprint 4
- [x] Pagination helper and role-aware product view — built with S2-01
- [ ] Appearance setting (System/Light/Dark) — app follows the system theme today
- [x] Remove `NotBuiltYetScreen` from Sell and Documents (S4) — every tab is now real

## Sprint 2 — Products and inventory
- [x] S2-01 Products API: list with search, stock filters, sorting, keyset paging and counts; create with opening stock; detail; edit under optimistic locking; archive; cost fields omitted for the sales role
- [x] S2-03 Stock receipts with weighted-average cost, adjustments with mandatory reason, stock movement ledger
- [x] S2-04 Inventory screens C1–C6: list, product detail, new/edit product, receive stock, adjust stock, stock history
- [x] Barcode as a product field (typed entry and search)

### Moved out of Sprint 2
- [ ] S2-02 Product photos — needs object storage, which this workspace cannot run (no Docker/MinIO), and the camera/gallery picker needs a device. Products show the monogram tile; `imageUrl` is always null. Scheduled with deployment storage in Sprint 6
- [ ] S2-05 Camera barcode scanning — needs a device to build and verify; scheduled with the first device-capable environment
- [ ] S2-06 Product cache and delta sync (`GET /sync/changes`, Drift) — moved to Sprint 6 with the rest of offline support, so the cache and the sync engine are designed together

## Sprint 3 — Customers
- [x] S3-01 Customers API: list with search (name, company, email, phone digits), exact lookup by mobile, create with optional client id, detail with invoiced / outstanding / overdue totals, edit, manager-only archive
- [x] S3-02 Customer screens E1–E3 (directory, detail, new/edit) and the reusable customer picker (D4) for the sale flow
- [ ] S3-03 Customer cache and offline create — moved to Sprint 6 with the rest of offline support
- [ ] Customer's document list on the detail screen — listed under Sprint 4 "Not in Sprint 4"

## Sprint 4 — Sales and documents
- [x] S4-01 Pricing engine (price bounds, integer totals, tax on the discounted total) and `POST /pricing/preview`
- [x] S4-02 Document numbering; quotations API (create, detail, cancel, expiry)
- [x] S4-03 Invoice issue in one transaction: stock, number, optional first payment, audit, idempotency; concurrency tests
- [x] S4-04 Payments and refunds · S4-05 Cancellation and returns (credit notes) · S4-06 Combined documents list and PDFs
- [x] `GET /tax-rates` (read side, for choosing a rate on a sale; managing rates is S5-04)
- [x] S4-07 Sell flow screens D1–D5: product picker, price sheet, cart (kept across restarts), customer picker, payment
- [x] S4-08 Documents screens F1–F6: list with filters and search, invoice and quotation detail, record payment, cancel, return items, share PDF / WhatsApp
- [x] Live contract test: the app's API client runs the whole sale against the real backend

### Not in Sprint 4
- [ ] **D7 tax rule still needs the accountant's confirmation** — implemented as accepted (one tax-exclusive rate on the discounted total)
- [ ] D6 Drafts screen — the app keeps one cart in progress on the device; several named drafts were not built. Decide in Sprint 6 whether they are still wanted
- [ ] Offline invoices (`offline` field on `POST /invoices`) — Sprint 6 with the outbox
- [ ] Documents list: date range and salesperson filters exist in the API but have no filter sheet in the app; only `-issuedAt` sorting is implemented
- [ ] Sell product list shows the first 50 matches and asks the user to search for more (no infinite scroll)
- [ ] Printing goes through the system share sheet (share PDF → Print); no in-app print preview
- [ ] Customer's document list on the customer detail screen (API supports `customerId`)
- [ ] Sale and document screens have not been run on a physical device (no Android SDK / macOS here) — widget tests, rendered goldens and live API tests only

## Sprint 5 — Dashboard, reports, settings ← next
- [ ] S5-01 Dashboard · S5-02 Reports API and CSV · S5-03 Reports screen
- [ ] S5-04 Settings, tax rates, team · S5-05 Sessions and appearance

## Sprint 6 — Production readiness
- [ ] S6-01 Outbox and sync · S6-02 Security review · S6-03 Performance
- [ ] S6-04 Monitoring and consistency job · S6-05 Deployment and backups (blocked: D11)
- [ ] S6-06 Store preparation · S6-07 Device end-to-end and accessibility pass

## Open blockers
- CI has never run: the workflow triggers on pull requests and on pushes to `main`, and neither has happened yet.
- Android SDK download host is not reachable from the current workspace; iOS builds need macOS (CI).
