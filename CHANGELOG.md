# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semantic versioning once the first release exists.

## [Unreleased]

### Added — Web app Sprint W4 (2026-11-25)
- **Documents on the web:** list with filters; invoice and quotation pages; record payments, refunds, cancellations and returns (credit notes); view, print and download PDFs; share a summary on WhatsApp. A finished sale now opens its invoice.

### Added — Web app Sprint W3 (2026-11-25)
- **Selling on the web:** sale workspace with product search, price editor, customer picker, live totals from the server, discount and tax, full / part / credit payment by cash or bank transfer, and quotations (save and convert). A sale in progress survives reloads; a sale is never recorded twice, even when the connection drops after it was sent.
- **Customers on the web:** list, detail with figures and documents, add and edit (with a warning when the mobile number is already saved), archive.

### Fixed — W3
- Product search results in the sale workspace were not accessible to screen readers (a button nested inside a list option).

### Added — Web app Sprint W2 (2026-11-25)
- **Inventory on the web:** products list with search, stock filters, sorting and optional columns; product detail; new and edit product with a price preview; receive and adjust stock; archive; stock history filtered by product, type and dates in the business's time zone. Salespeople see prices but never cost, markups or management actions.
- The dashboard's stock figures now open the matching products list.

### Fixed — W2
- Stock entered when a product is created is recorded as **opening stock** (`OPENING`), as business rule S4 says, instead of as a delivery (`PURCHASE_RECEIPT`).

### Added — Web app Sprint W1 (2026-11-25)
- **Web app** (`web/`, Angular 22): sign-in, forgot and reset password (also used to accept invitations), dashboard, app shell for desktop, tablet and phone, light and dark themes. Sessions survive reloads, renew silently, and end in every tab together.
- **Browser sessions** (`/auth/web/login`, `/refresh`, `/logout`): the refresh token is kept in an HttpOnly cookie that page scripts cannot read.
- **Web hosting:** Caddy now serves the web app and the API from one HTTPS address, with a strict Content-Security-Policy.
- **Contract checks:** every backend test response is validated against `openapi.yaml`; the web app's types are generated from it.

### Changed
- Password reset and invitation emails link to `https://<your address>/reset-password` (opens in any browser) instead of `velora://`. `APP_BASE_URL` is now the web app's address; `MOBILE_DEEP_LINK_BASE` is gone.
- `openapi.yaml` corrected where it differed from the API (tax rate id on documents, team member fields, report period, health and forgot-password bodies, nullable margin).

### Added — Web app Sprint W0 (2026-11-25)
- Architecture proposal for a responsive Angular web app on the existing API: framework decision, architecture, state management, API status matrix and missing backend functionality, desktop design audit, screen specifications, design system and component inventory, testing strategy, roadmap with risks and open questions (`docs/web-*.md`). Documentation only; no web code yet.

### Added — Deployment (2026-11-17)
- `deploy/`: production Docker Compose stack (PostgreSQL, API, Caddy with automatic HTTPS), database role setup, secrets generator, nightly backup with optional off-server copy, restore drill, and a step-by-step guide.
- `create-organization` maintenance command: creates a business, its default tax rate and its owner account (there is no public sign-up).
- CI builds the production stack and checks that the API becomes ready.

### Fixed
- Inviting a team member no longer fails when the mail server is unreachable: the account is created, the response says the email was not sent, and the app tells the owner to have the person use "Forgot password".
- Requesting a password reset no longer returns an error when the mail server is down.

### Changed
- The Prisma command-line tool ships in the production image, so the migration job runs from the same image as the API.

### Added — Sprint 6 (2026-11-16)
**Backend**
- `GET /sync/changes`: products and customers changed since a token, for the app's offline copy. A product counts as changed when its row, its stock or the pricing settings change. An overlap window guarantees no change is missed under concurrent writes.
- Maintenance script: `check` verifies every derived figure (stock against the ledger, invoice paid and returned amounts, payment status, one default tax rate, an active owner) and `purge` deletes expired idempotency records and tokens.

**Mobile**
- Works without a connection: products and customers are saved on the device at sign-in and kept current; lists, search, details, the sell picker and the cart use the copy when the server cannot be reached, and a banner says how old it is.
- Quotations, new customers and payments made offline are queued and sent in order when the connection returns, each exactly once. A refusal stays in the queue with its reason until retried or discarded. Invoices are never created offline.
- The app starts without a connection from the profile it last loaded.
- Sync screen, change-password screen.

### Security
- An access token stops working the moment its session is closed — sign-out, password change, role change, removal of access or remote sign-out — instead of up to 15 minutes later.
- The device copy is erased on sign-out and never carried over to another person or role.

### Performance
- Documents list: 1.1 s → 10 ms with 100,000 invoices (reads its page from the index). Measurements in `docs/performance-notes.md`.

### Not included
- Deployment, email delivery, photos, barcode scanning, store builds and device testing remain blocked on hosting (D11) and on a device toolchain — see `TASKS.md`.

### Added — Sprint 5 (2026-11-16)
**Backend**
- Dashboard summary in one request: today's sales against yesterday, stock, money owed and overdue, month-to-date profit and inventory value (managers), products needing attention, recent documents.
- Reports: sales summary, sales by salesperson, invoice status breakdown, inventory valuation, each on the business's calendar days; CSV exports of invoices and stock for managers, with spreadsheet-formula injection neutralised.
- Business profile and settings: owner-only edits, audited; markup policy checked against existing products; currency and time zone lock once documents exist.
- Team: invitation by email with a 7-day set-password link, role changes and removal of access (both sign the member out), never fewer than one active owner — also under concurrent changes.
- Tax rates: add, rename, change the default (always exactly one), stop using; the percentage is immutable.
- Own signed-in devices: list and sign out another device.

**Mobile**
- Home is now a dashboard; its "needs attention" rows open the filtered inventory and documents lists.
- Reports screen with period presets and a custom range, status breakdown, team comparison, stock value and CSV export.
- Business settings, tax rates, team and signed-in devices under More; appearance choice remembered on the device.
- The device type is sent at sign-in so the devices list can name it.

### Changed
- Returns are dated with the application clock, like every other business timestamp.
- A failed load is no longer retried automatically in the background; screens show the failure with "Try again".
- Status pills and document rows no longer overflow at 200% text size.

### Not included
- Outgoing email still needs SMTP configuration; logo upload; offline reports; change-password screen — see `TASKS.md`.

### Added — Sprint 4 (2026-11-16)
**Backend**
- Pricing preview: server-authoritative totals for a cart, with per-line problems (below the lowest price, above the highest, not enough stock, product unavailable). Managers may sell below the lowest price with a reason, which is audited.
- Quotations (numbered `QT-YYYY-NNNNN`, hold prices not stock, expire, can be cancelled or converted) and invoices (`INV-…`) issued in one transaction that takes stock, assigns the number, records an optional first payment and writes the audit entry. Concurrent sales of the last units cannot oversell.
- Later payments, manager-only refunds, cancellation (stock restored, money received recorded as refunded) and returns with credit notes (`CN-…`; optional restock; refund only of what exceeds the balance).
- Combined documents list with status filters and search; invoice and quotation PDFs; `GET /tax-rates`.
- Cost and profit are never sent to the sales role on any sales response.

**Mobile**
- Sell flow: pick in-stock products, choose a price between the lowest and highest allowed (managers also see cost and profit), cart with discount, tax rate and notes, customer picker, and a payment step that states the outcome (paid, partially paid, credit sale with due date) before anything is saved. The cart survives closing the app.
- Documents: list with filters and search; invoice and quotation detail; record payment; cancel; return items; share the PDF or message the customer on WhatsApp. Cancel and return are offered to managers only.
- A sale that fails because stock or prices changed meanwhile saves nothing and returns to the cart, which shows what to fix. Retrying after a lost connection cannot create a second invoice.

### Changed
- Each tab has its own snackbar area, so messages no longer cover a screen's pinned action buttons.
- After a sale the Sell tab returns to the product list while the new document opens under Documents.

### Not included
- Named drafts (D6), offline invoices, date/salesperson filter sheet, in-app print preview — see `TASKS.md`.

### Added — Sprint 3 (2026-11-16)
**Backend**
- Customers API: list with search across name, company, email and phone digits; exact lookup by mobile number in any spelling; create (idempotent, optional client-generated id); detail with totals over issued invoices (invoiced, outstanding, overdue — own invoices only for the sales role); edit; manager-only archive.
- Mobile numbers are validated and stored in international (E.164) form, reading local numbers in the organization's country.

**Mobile**
- Customer directory with search and paging, customer detail with account totals and call / WhatsApp / email actions, new/edit form, and a customer picker that returns an existing or newly created customer (used by the sale flow in Sprint 4).
- Before creating a customer the app checks whether the mobile number is already saved and offers the existing customer instead.

### Changed
- `POST /customers` no longer returns `meta.possibleDuplicates`; duplicates are found beforehand with `GET /customers?mobile=`. Customer sort options are `name` and `-createdAt` (`-lastInvoiceAt` follows with invoices in Sprint 4). Balances are shown on the customer detail, not in the list.
- Label/value rows give the value more room, so long values such as email addresses no longer break mid-word.

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
