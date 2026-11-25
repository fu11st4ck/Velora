# Velora Web — Testing Strategy

**Status:** Implemented (W1–W6); what ran where is in §4. Rule carried over from the whole project: **a test counts only if it was executed**, and reports state what ran, where, and what did not.

## 1. Levels

| Level | Tool | Runs against | What it covers |
|---|---|---|---|
| Unit | Vitest (Angular builder's unit-test runner) | Nothing external | `core/money` (format/parse integer minor units, exponents 0/2/3, large values), dates in the organization time zone, `ApiFailure` mapping, failure → message table, URL ↔ filter mapping, `EntityVersions`, submission state machine, SignalStores (`SessionStore`, `SaleStore` transitions and persistence) |
| Component | Vitest + Angular TestBed (+ Angular Testing Library if it proves simpler), `HttpTestingController` | Fake HTTP backend per test | Design-system components (each state), forms and their validation, `DataTable` (sorting requests, load more, card mode, empty/error), dialogs (focus, confirmation), role-dependent rendering, guards |
| Integration (in-app) | Same as component, at page level | Fake HTTP with realistic responses copied from backend fixtures | Each page: loading → data → mutation → invalidation → refetch; error paths; permissions |
| Contract | `openapi-typescript` type check in CI; **B7**: backend tests validate responses against `openapi.yaml` | Backend test suite | Web types and backend responses cannot drift silently |
| End-to-end | Playwright (Chromium; WebKit and Firefox in the browser matrix job) | **The real API and PostgreSQL**, seeded per test run (no mocks) | The critical scenarios in §2 |
| Accessibility | `@axe-core/playwright` in the e2e run; keyboard-only e2e for the sale workflow | Real app | WCAG 2.2 AA rules: names, contrast, focus order, landmarks |
| Visual | Playwright screenshots of `/dev/ui` and key pages at 1440, 1024, 390 px, light and dark | Real app | Reviewed by a person when they change (not auto-approved) |
| Performance | Angular build budgets; Playwright trace for LCP on the dashboard and products page | Production build | Budgets in `web-frontend-architecture.md` §5 |

Fake HTTP data in component and integration tests is test-only and lives under `src/testing/`; it is never imported by application code.

## 2. End-to-end scenarios (real API)

Each scenario signs in through the UI with seeded accounts (owner, manager, sales) in a database reset before the run. The API is started from the same commit with a short access-token lifetime (60 s) so expiry can be exercised.

| # | Scenario | Checks |
|---|---|---|
| 1 | Successful login | Lands on dashboard; role shown in account menu; reload keeps the session (refresh cookie); access token not in `localStorage`/`sessionStorage`; refresh cookie `HttpOnly` |
| 2 | Invalid login | Wrong password message; 5 failures → lock message with wait time |
| 3 | Session expiration | Access token expires mid-use → transparent refresh; session revoked from another device → next request returns to sign-in with notice; return URL honoured; sale in progress preserved. Two tabs refreshing at once stay signed in |
| 4 | Product creation | Manager creates a product with opening stock; appears in list with list/floor/ceiling prices from the server |
| 5 | Product editing | Edit; concurrent edit in a second session → `VERSION_CONFLICT` message and reload |
| 6 | Inventory adjustment | Remove 2 with reason; history shows the movement; cannot remove more than on hand |
| 7 | Low-stock detection | Adjust below the reorder level → dashboard "low in stock" count and products filter "Low" include it |
| 8 | Successful sale | Search, add, price, customer, full cash payment → invoice `INV-…` Paid; stock reduced; dashboard today's sales updated |
| 9 | Insufficient inventory | Second session sells the last units first → confirming shows "Only n in stock" on the line; nothing created; cart kept |
| 10 | Partial payment | Pay part by bank transfer with reference → Partially paid, due date; record the rest later → Paid |
| 11 | Full payment | Credit sale then payment of the balance; payment above balance refused |
| 12 | Invoice generation | PDF downloads with the invoice number as file name, opens as a PDF; print action calls print |
| 13 | Invoice cancellation | Manager cancels a paid invoice with refund method → Cancelled, stock restored, refund recorded; sales user has no cancel action and the API refuses a forced request |
| 14 | Product return | Manager returns 1 of 2, not restocked → credit note, balance reduced first, refund asked only for the excess |
| 15 | Unauthorized access | Sales user: no cost columns anywhere, Admin group hidden, direct URL to `/settings/team` shows forbidden, API responses contain no cost fields |
| 16 | Organization data isolation | Second organization seeded; its products, customers and documents never appear in lists, search, or by direct URL (404) |
| 17 | Duplicate submission | Network dropped after `POST /invoices` was sent → retry creates exactly one invoice (same idempotency key); double-click on confirm sends one request |
| 18 | Invitation and reset links (after B2) | Owner invites; the emailed https link (captured by the test SMTP sink `web/e2e/mail-sink.mjs`) opens the web reset page; the invitee signs in — **implemented W5** |

## 3. What runs where
- **Every push (CI):** lint, type-check, unit + component + integration tests, production build with budgets, OpenAPI types up to date, e2e scenarios 1–18 on Chromium against the API and PostgreSQL started in the job.
- **Nightly / before release:** e2e on Firefox and WebKit, visual screenshots, axe on all pages, performance trace.
- **This workspace:** Chromium and Playwright are installed and the API and PostgreSQL run locally, so unit, component and Chromium e2e tests can be executed here. Firefox, WebKit, and real iOS Safari cannot — they are CI or manual items, and results will say so.

## 4. Browser support
Last two versions of Chrome, Edge, Firefox and Safari (macOS and iOS), and Samsung Internet on Android. Manual smoke test on a real iPhone and an Android phone before the first release (needs devices; not available in this workspace).

## 4. As run (W6, 2026-11-25)

| Check | Where it ran | Result |
|---|---|---|
| Unit/component (Vitest) | This workspace and CI | 71 passing |
| End-to-end, scenarios 1–18 + extras (Playwright, Chromium, production build, real API and PostgreSQL, test SMTP sink) | This workspace and CI | 62 passing |
| Accessibility: axe (WCAG 2.2 AA) on every page and main dialogs, light + dark, 1440 px + 390 px; keyboard-only sale | This workspace and CI | Passing after fixes (label-in-name, scrollable regions, loading regions, search field) |
| Performance: LCP on throttled CPU/network | This workspace and CI (Chromium) | Within 2.5 s (see web-frontend-architecture.md §5) |
| Firefox, WebKit | Nightly CI only (`browsers.yml`) | **Not run in this workspace** (browsers not installed here) |
| Production stack: images, Caddy on HTTPS, smoke test | CI job `backend-image`; in this workspace the web image + real Caddyfile in front of the API | Web image and Caddy verified here; **API image not built here** (see TASKS.md W6) |
| Screen reader, real phones, print dialog | Manual, before release (`docs/release-checklist.md`) | **Not done** |
