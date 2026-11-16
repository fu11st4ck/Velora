# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semantic versioning once the first release exists.

## [Unreleased]

### Added — Sprint 2 (2026-11-16)
**Backend**
- Products API: list with search (name, SKU, barcode), stock-status filters, five sort orders, keyset pagination and per-status counts; create with opening stock; detail with stock per branch; edit with optimistic locking; archive.
- Inventory API: stock receipts that re-average cost, adjustments with a mandatory reason, and the stock movement ledger with type filters.
- Cost, markup and supplier fields are omitted for the sales role by a single product/movement view.
- SKUs are unique per organization regardless of case; a generated SKU has the form `SKU-` plus six digits.

**Mobile**
- Inventory list (search, filter chips with counts, sort, paging, pull to refresh), product detail, new/edit product, receive stock, adjust stock and stock history screens.
- Live previews in forms (list and lowest price, purchase total, new stock level, new average cost) computed with integer arithmetic that mirrors the server.
- Idempotency keys on every stock-changing request: reused on a network retry, renewed after the input changes.

### Fixed
- A request with a JSON content type and no body (the app's "archive product") was rejected by the API. The API now treats an empty body as no body, and the app no longer sends a content type on bodiless requests. Found by running the app's API client against the live backend.
- Two simultaneous product creations with the same SKU could be answered with the wrong error code (`BARCODE_TAKEN` or a generic conflict) instead of `SKU_TAKEN`; SKU and barcode checks are now serialized per organization.
- Forms validated only the fields currently scrolled into view; all fields are now always built and validated.
- At large system text sizes on small phones, inventory rows, navigation labels and the "New product" button overlapped or wrapped badly.
- Repeated backend builds could produce no output (`dist/` deleted, incremental build skipped); the build no longer uses incremental state.

### Not included
- Product photos, camera barcode scanning, and the offline product cache moved out of this sprint — see `TASKS.md`.

### Added — Sprint 1 (2026-11-16)
**Backend** (`backend/`)
- NestJS/Fastify API under `/api/v1` with validated environment configuration, a single error envelope, `{ data, meta }` success envelope, request ids, security headers, rate limits and health probes.
- PostgreSQL migrations: the 21-table schema plus SQL constraints, case-insensitive and partial unique indexes, trigram search indexes, row-level security on every tenant table and append-only privileges for ledgers and the audit log.
- Authentication: sign-in with account lockout, 15-minute access tokens (EdDSA), single-use rotating refresh tokens with reuse detection, sign-out, password reset and change, `GET /auth/me`.
- Authorization: three roles with a permission map; routes are denied unless they declare an access rule.
- Money arithmetic on integer minor units (rounding, pricing, totals, allocation, weighted-average cost).
- Idempotency service that commits the key, the change and the stored response in one transaction.
- Demo seed from the reference data (guarded by `SEED_DEMO`, refused in production).
- Dockerfile, Docker Compose file and CI workflow.

**Mobile** (`mobile/`)
- Flutter app with dev/staging/prod entry points, Riverpod, go_router (five tabs with separate stacks; navigation rail on tablets), Dio client with single-flight token refresh, Keychain/Keystore token storage.
- Velora design system: light and dark themes, tokens, bundled Inter and Playfair Display fonts, shared components.
- Screens: start-up/session restore, sign in, forgot password, reset password, Home (signed-in context), More (profile, sign out).

**Verified by execution**
- Backend: 70 tests (unit, HTTP integration against PostgreSQL 16, direct-SQL tests of row-level security, privileges and constraints, concurrency tests for refresh and idempotency); ESLint, `tsc` and build clean.
- Mobile: 98 tests (unit, widget, full app-flow with a fake transport, accessibility guidelines, contrast, golden screenshots); `flutter analyze` clean.
- The Flutter API client was run against the live backend with seeded data (4 contract tests).

**Not verified** — no Android or iOS build or device run (toolchains unavailable in the workspace); Docker image and CI workflow have not been executed.

### Changed
- `audit_logs.organization_id` is nullable (pre-tenant authentication events); `users` gained lockout columns; `refresh_tokens` records the membership it acts as.
- Idempotency: failures store nothing (the change and the key roll back together); see `docs/api-error-handling.md` §6.

### Added — Sprint 0 (2026-11-15)
- Audit of the reference web application: source review and scripted walkthrough on desktop, tablet and phone, with screenshots and the reproducible audit script.
- Product discovery, user-flow map and feature matrix.
- Design audit, mobile design system and mobile screen specifications.
- Business rules: pricing, totals, tax, stock, numbering, payments, cancellations, returns, reporting definitions, authorization.
- System architecture and nine architecture decision records.
- PostgreSQL schema (Prisma, 21 tables), database design and ER diagram.
- REST API specification (50 operations), error-handling catalogue and OpenAPI 3.1 contract.
- Offline synchronization strategy, security guidelines and testing strategy.
- Implementation roadmap with backlog, dependencies, risks, decisions needed and unresolved questions.

### Notes
- No application code yet. Behaviour that differs from the reference is listed in `docs/feature-matrix.md` and `docs/business-rules.md`.
