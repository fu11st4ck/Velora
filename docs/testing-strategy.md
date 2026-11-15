# Velora — Testing Strategy

Principle: the rules that move money and stock are tested at the lowest level that can prove them, against a real PostgreSQL — never mocked persistence for transactional behaviour. A test result is only reported after the test was actually executed; every sprint report includes the commands run and their output.

## 1. Test pyramid

| Level | Backend | Flutter |
|---|---|---|
| Unit | Pure domain functions: money rounding/allocation, price bounds, totals, status derivation, weighted-average cost, numbering format, permission map (Vitest) | Money type and formatting, mirrored cart calculations, validators, DTO ↔ entity mapping, error mapping, outbox state machine (`flutter_test`) |
| Component / widget | Services with a real database per test file (transaction rollback or template database) | Screens with overridden Riverpod providers: loading / empty / error / offline states, form validation, role-dependent UI; golden tests for design-system components and key screens (light/dark, 100%/200% text) |
| Integration | HTTP-level tests with Supertest against the Nest app + PostgreSQL: full request pipeline, auth, validation, serialization | Repository tests against a fake HTTP server and an in-memory Drift database; router tests (redirects, deep links, per-tab back stacks) |
| End-to-end | Scenario tests chaining endpoints (the critical scenarios below) | `integration_test` on an emulator/simulator against a seeded local API: login → add product → sell → pay → share |
| Contract | Generated OpenAPI is diffed against `backend/openapi/openapi.yaml`; responses validated against schemas in integration tests | DTOs are validated against recorded API fixtures produced by the backend tests |

## 2. Critical business scenarios

Each is an automated backend scenario test (`test/scenarios/*.spec.ts`), and the user-facing ones are also covered by a Flutter integration or widget test. Property-based tests (fast-check) back the arithmetic.

| # | Scenario | Assertions |
|---|---|---|
| 1 | **Successful sale** | Invoice issued with next number; stock reduced per line; one `SALE` movement per line with correct `balance_after`; totals per rules T1–T5; audit entry; response excludes cost for Sales |
| 2 | **Insufficient inventory** | `409 INSUFFICIENT_STOCK` with per-line availability; no invoice, movement, payment, number consumption or audit row (full rollback); includes the reference's defect — same product on two lines exceeding stock together |
| 3 | **Partial payment** | `PARTIAL`; balance = total − paid; due date set; later payment of the remainder → `PAID` |
| 4 | **Full payment** | `PAID`; balance 0; no due date; further payment → `422 INVOICE_ALREADY_PAID` |
| 5 | **Credit sale** | `UNPAID`; due date = issue date + credit days in the organization timezone; becomes overdue when the clock passes the due date (clock injected) |
| 6 | **Invoice cancellation** | Manager only; refund row equals paid amount; status `CANCELLED`; excluded from reports and outstanding; number retained; second cancel → `409` |
| 7 | **Product return** | Credit note numbered; credit = allocated net + tax; partial then final return leaves zero rounding residue; over-return → `422`; refund required exactly when credit > balance |
| 8 | **Stock restoration** | Cancellation and restocked returns add stock with `SALE_CANCELLATION` / `CUSTOMER_RETURN` movements; `restock=false` adds none; ledger sum equals `stock_levels.quantity` |
| 9 | **Duplicate payment submission** | Same `Idempotency-Key` twice (sequential and concurrent) → one payment, identical responses, `Idempotent-Replayed` header; same key with different body → `409` |
| 10 | **Concurrent stock updates** | N parallel invoices for the last unit → exactly one succeeds; stock never negative; also parallel adjustment vs. sale; no deadlock across multi-line invoices with overlapping products in different orders |
| 11 | **Invalid discounts** | Negative, greater than subtotal, non-integer → rejected; boundary values 0 and = subtotal accepted (total = 0 with zero tax) |
| 12 | **Tax calculations** | Table-driven cases incl. the reference's own example (subtotal 2,989.00, discount 150.00, 5% → tax 141.95, total 2,980.95); half-up boundaries; 0% rate; allocation sums exactly; property test: `total = subtotal − discount + tax` and Σ allocations = document figures for random carts |
| 13 | **Expired authentication** | Expired access token → `401 TOKEN_EXPIRED`; refresh rotates; reused refresh token revokes the family; Flutter interceptor refreshes once for parallel requests and replays them |
| 14 | **Unauthorized access** | Route × role matrix; Sales cannot read another salesperson's document (`404`), cannot receive/adjust/cancel/return (`403`), never receives cost fields; other-tenant IDs → `404` on every route |
| 15 | **Offline sale synchronization** | Outbox replays in order with stable keys; server rejection becomes Needs attention without altering local data; kill during send does not duplicate; provisional invoice accepted/rejected paths; setting off → blocked |

Additional scenarios: quotation → invoice conversion (single conversion under concurrency); price below floor for Sales vs. Manager override with reason; weighted-average cost after receipts and returns; gapless numbering under parallel issues and across a year boundary in the organization timezone; product archive rules; SKU uniqueness (case-insensitive).

## 3. Backend specifics

- **Database:** PostgreSQL 16 in CI (service container) and locally. Migrations are applied to a template database once; each test file clones it. No SQLite or mocks for persistence.
- **Transaction tests:** failures are injected after each write step of invoice issue (via a test hook) to prove all-or-nothing behaviour.
- **Constraint tests:** direct SQL attempts to violate each `CHECK`, unique and RLS rule must fail.
- **Consistency checker:** the nightly job's queries run at the end of the scenario suite and must report zero differences.
- **Authorization tests:** generated from the route registry so a new route without a test fails the build.
- **Performance smoke:** issue 1,000 invoices and list documents/products at 50k rows; p95 budgets (list < 200 ms, issue < 300 ms on CI hardware) to catch missing indexes.

## 4. Flutter specifics

- **State management tests:** controllers tested with `ProviderContainer` and fake repositories — success, failure, refresh, pagination, optimistic cart updates.
- **Form validation tests:** each form's rules (product policy ordering, money field limits, customer name-or-company, payment amount cap).
- **Navigation tests:** auth redirect, role-guarded routes, tab stack preservation, deep link to a document, Back behaviour from the sale flow.
- **Golden tests:** components and the screens in [`mobile-screen-specifications.md`](mobile-screen-specifications.md) at 360×640, 390×844, 834×1194; light/dark; 100%/200% text. Goldens are reviewed against the specification.
- **Accessibility tests:** `meetsGuideline` for tap-target size, label presence and text contrast on every screen test.
- **Integration tests:** Android emulator and iOS simulator in CI (macOS runner for iOS). Device coverage in this cloud workspace is limited — see roadmap risk R2.

## 5. Tooling and gates

| Gate (CI, blocking) | Tool |
|---|---|
| Lint / format | ESLint + Prettier; `dart format`, `flutter analyze` (strict lints) |
| Types | `tsc --noEmit` strict; Dart sound null safety |
| Tests | Vitest; `flutter test`; scenario suite |
| Coverage | ≥ 90% lines on backend domain and service code for sales, payments, inventory, pricing; ≥ 80% on Flutter `domain/` and controllers. Coverage is a floor, not the goal — the scenario list is |
| Contract | OpenAPI diff |
| Security | Authorization matrix, tenant isolation, confidentiality tests; dependency audit |
| Migrations | `prisma migrate deploy` on an empty database and on the previous release's schema |

## 6. Test data

- Factories build organizations, members, products and documents with explicit values; no shared mutable fixtures.
- The demo seed (reference data) is used only for manual testing and end-to-end tests.
- Time is injected (`Clock`) everywhere dates matter; tests cover the organization timezone at day and year boundaries.

## 7. Manual verification per sprint

- Walkthrough of each delivered screen against its specification on one Android and one iOS configuration, with screenshots attached to the sprint report.
- Exploratory session on the sale flow with network throttling and airplane mode.
- Sales-role and Manager-role passes.
