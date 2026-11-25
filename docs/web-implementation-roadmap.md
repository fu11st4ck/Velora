# Velora Web — Implementation Roadmap

**Status:** W0 approved 2026-11-25 with the default answers to Q1–Q9. **W1–W6 delivered 2026-11-25** (see `TASKS.md`). Remaining before the first release are manual checks (`docs/release-checklist.md`) and the first CI run.

The brief's nine sprints are re-ordered by what actually exists: the backend already implements every agreed v1 capability, so most web sprints are frontend-only. Two sprints from the brief are dropped because the product has no such modules (suppliers and purchases — D6; expenses / P&L — no ledger); they return only if those decisions change. Backend prerequisites come first because nothing behind sign-in can be built safely without them.

## Sprint plan

| Sprint | Goal | Contents | Depends on |
|---|---|---|---|
| **W0** | Discovery and architecture (this) | Framework decision, architecture, state, API matrix, design audit, screen specs, component inventory, testing strategy, backlog | — |
| **W1** ✅ | Foundation and sign-in | **Backend:** B1 browser sessions (cookie), B2 https email links, B3 same-origin hosting in `deploy/` + CSP, B7 response contract tests. **Web:** project setup (Angular 22, strict, zoneless, Vitest, Playwright, ESLint), tokens + Material theme (light/dark), fonts/icons, app shell (sidebar/rail/drawer, top bar, account menu, appearance), API client + interceptors + `ApiFailure` + message table, OpenAPI types, `SessionStore`, multi-tab refresh (Web Locks), guards, W-A1–A3, W-S3, `/dev/ui` with first components (button, form field, status pill, states, toast, confirm dialog) | Approval of W0 |
| **W2** ✅ | Dashboard and inventory | W-B1, W-C1–C6; `DataTable` (server sort, load more, card mode, columns), `FilterBar`, `KpiTile`, `MoneyInput`, `EntityVersions`; e2e 4–7, 15–16 | W1 |
| **W3** ✅ | Customers and the sale | W-E1–E3, W-D1–D4 (`SaleStore`, live preview, price editor, customer picker, payment, duplicate protection), quotation save/convert; e2e 8–11, 17 | W2 |
| **W4** ✅ | Documents | W-F1–F8 (lists, detail, payments, refund, cancel, return, PDF view/print/download, WhatsApp link); e2e 12–14 | W3 |
| **W5** ✅ | Reports, settings, account | W-G1 (+ CSV), W-H1–H5, global search W-S2; e2e 3, 18 | W2 |
| **W6** ✅ | Production readiness | Accessibility audit (axe + keyboard + screen reader pass), performance budgets and traces, browser matrix (Firefox, WebKit in CI), security review (CSP, cookies, headers, dependency audit), deployment of the web build through Caddy, documentation, release checklist | W1–W5 |

Rough size, for one developer working with this assistant: W1 ≈ 1.5 weeks (half backend), W2–W5 ≈ 1 week each, W6 ≈ 1 week.

## Backlog (W1–W6)

| ID | Item | Sprint |
|---|---|---|
| WB-01 | B1: `/auth/web/login`, `/web/refresh`, `/web/logout`; HttpOnly `__Secure-` cookie, Origin + `X-Velora-Client` checks, tests | W1 |
| WB-02 | B2: email links to `${APP_BASE_URL}/reset-password?token=`; update mobile docs (App Links / Universal Links later) | W1 |
| WB-03 | B3: Caddy serves `web/dist` at `/`, proxies `/api/*`; CSP and security headers for the web app | W1 |
| WB-04 | B7: validate backend test responses against `openapi.yaml`; fix the spec where it differs | W1 |
| WF-01 | Angular 22 project in `web/`: strict TS and templates, zoneless, ESLint, Vitest, Playwright, budgets, CI job | W1 |
| WF-02 | Tokens, Material 3 theme, typography, icons, light/dark, `PreferencesStore` | W1 |
| WF-03 | App shell, navigation config with permissions, breadcrumbs, account menu, skip link, shortcuts | W1 |
| WF-04 | API layer: generated types, `api.ts`, envelope/page, interceptors, `ApiFailure`, message table (shared codes with mobile) | W1 |
| WF-05 | `SessionStore`, sign-in/out, session restore, Web Locks refresh, BroadcastChannel sign-out, guards | W1 |
| WF-06 | Auth screens W-A1–A3; not found / forbidden / expired | W1 |
| WF-07 | Base components + `/dev/ui` | W1 |
| WF-08 | `DataTable`, `FilterBar`, URL-synced filter stores, `EntityVersions`, money pipe/input | W2 ✅ |
| WF-09 | Dashboard | W1 ✅ (links W2) |
| WF-10 | Products table, detail, form (page — see screen spec), receive, adjust, stock history | W2 ✅ |
| WF-11 | Customers table, detail with documents, form, picker | W3 ✅ |
| WF-12 | Sale workspace, `SaleStore` + persistence, preview, price editor, payment and review, quotations | W3 ✅ |
| WF-13 | Documents table, invoice/quotation detail, payment, refund, cancel, return, PDF actions | W4 ✅ |
| WF-14 | Reports with ranges and CSV export | W5 ✅ |
| WF-15 | Business settings, tax rates, team, change password, devices | W5 ✅ |
| WF-16 | Global search | W5 ✅ |
| WF-17 | A11y, performance, browser matrix, security review, deployment, docs | W6 ✅ (manual items in the release checklist) |
| — | Optional backend improvements B4 (customer balances), B5 (document sorting), B6 (audit log), B8 (payment register) | When approved |

## Definition of Done (each screen)
UI to spec at 1440, 1024 and 390 px, light and dark · state, API and validation working against the real backend · authorization respected (UI and verified API refusal) · loading, empty, error states · unit/component tests and the relevant e2e scenario **executed** and passing · docs updated (`TASKS.md`, `CHANGELOG.md`, deviations noted in the screen spec) · no dead buttons, no fake data, no duplicated business rules.

## Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| Refresh-token rotation + several tabs signs users out | High (daily annoyance) | Web Locks single-flight refresh; e2e scenario with two tabs |
| OpenAPI response schemas drift from real responses | Medium (wrong types compile) | B7 contract validation in backend tests; CI check that generated types are current |
| `httpResource`-based invalidation misses a dependency → stale figure on screen | Medium | Invalidation table in one file; integration tests per mutation assert refetch; fallback to TanStack Query for server state if needed |
| Money parsing/formatting differences between web and mobile | High (financial) | Port the mobile algorithm with the same test cases; server totals always displayed |
| Same-origin hosting assumption fails (separate domains wanted) | Medium | Then cookies need `SameSite=None` + CSRF token and CORS allow-list — more work, documented alternative |
| Angular 22.3 is one week old | Low | Start on 22.2.x; `ng update` within the major |
| E2E flakiness against a real API | Medium | Seeded DB per run, unique data per test, no sleeps (Playwright auto-waits), traces on failure only |
| Large lists on slow devices | Low at 10 users | Server pagination; virtual scrolling only if measured need |

## Open questions (need your answer)

| # | Question | Default if not answered |
|---|---|---|
| Q1 | Approve **Angular 22** (vs React)? | Angular |
| Q2 | Approve the backend changes **B1–B3** (web session cookie, https email links, web served by Caddy at the same domain as the API)? | Yes; needed for W1 |
| Q3 | Same domain for app and API (`https://app.yourshop.com` for both, API under `/api`)? | Yes |
| Q4 | Web session length: same 30-day refresh as mobile, or shorter for shared shop computers (e.g. sign out after 12 h of inactivity)? | 30 days, plus "Sign out" clearly in the account menu |
| Q5 | Suppliers, purchases, expenses/P&L, categories, product images, branches, custom permissions, notifications — still out of v1 (D5, D6, D9)? | Out; documented as not available |
| Q6 | Optional backend items B4 (customer balances column), B5 (document sorting), B6 (activity log), B8 (payment register) — any wanted? | Not built |
| Q7 | Arabic / right-to-left interface needed? | English only; strings marked for translation |
| Q8 | Is the web app used on shared counter computers by several staff? (affects session length and the "Sale in progress" behaviour) | Personal sign-in per person; no quick user switching |
| Q9 | Web is online-only (offline remains a phone feature) — acceptable? | Yes |
