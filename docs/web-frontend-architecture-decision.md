# Velora Web — Framework Decision

**Status:** Proposed (Sprint W0, 2026-11-25) — awaiting approval.
**Decision:** **Angular 22** with standalone components, zoneless change detection, Signals, Angular `httpResource` for reading server data, and **NgRx SignalStore** for shared client state. Angular Material 3 and the CDK, themed with Velora's design tokens. No React.

Versions verified on the npm registry on 2026-11-25. Angular 22.3.0 was released on 18 Nov; the project starts on the latest 22.x that is at least two weeks old (22.2.x today) and moves to 22.3 after its first patch releases.

## 1. What the web app has to fit into

Facts from inspecting the repository — they weigh more than general preferences:

| Fact | Consequence for the web app |
|---|---|
| Backend is **NestJS 11 + Fastify**, TypeScript, decorators, dependency injection, class-validator DTOs | Angular's structure (DI, services, decorators, typed forms) reads the same way; one TypeScript mental model across backend and web |
| The REST API is complete for the agreed v1 scope (51 operations, all tested; see `web-api-integration.md`) and has an **OpenAPI 3 file whose paths match the implemented routes** | Request and response types can be generated from it; no API needs inventing |
| Business rules (pricing bounds, tax, totals, stock, payment status) are **server-authoritative**, with `POST /pricing/preview` returning totals and per-line problems | The web app needs very little client logic — mostly forms, tables and orchestration of requests. This favours a framework with strong built-in forms, DI and HTTP over a minimal view library |
| The mobile app (Flutter + Riverpod) already defines the screens, flows, wording, error mapping and role rules | The web app mirrors those behaviours; the framework does not change them |
| Small team, one business, ~10 users | Fewer moving parts beats maximum flexibility. A framework that brings router, forms, HTTP, i18n and testing in one release train reduces dependency upkeep |
| No existing web code, no React or Angular code anywhere in the repository | No migration cost either way |

## 2. Comparison

Scores are relative for *this* project (5 = clearly better fit).

| Criterion | Angular 22 | React 19 + Vite | Notes |
|---|---|---|---|
| 1. Team and project compatibility | **5** | 3 | NestJS backend uses the same DI/decorator/DTO style; mobile uses a provider-based DI (Riverpod) that maps cleanly to Angular services. React would add a third architectural idiom |
| 2. Application complexity (forms, tables, role-gated routes, dialogs) | **5** | 4 | Reactive Forms with typed controls, route guards and resolvers are built in. React needs React Hook Form + Zod + a router + a data layer, chosen and kept compatible by us |
| 3. Long-term maintainability | **5** | 3 | One release train with automated migrations (`ng update`) versus five independently versioned libraries |
| 4. State management | 4 | **5** | RTK Query is the most mature server-cache library. Angular 22 now has stable `resource`/`httpResource`, and SignalStore covers client state; enough for this app's data volume, slightly less out-of-the-box caching (see `web-state-management.md`) |
| 5. Performance | 4 | 4 | Both are far above what 10 users need. Angular zoneless + OnPush + deferrable views; React with memoisation. Bundle sizes comparable once routes are lazy |
| 6. Testing | 4 | 4 | Angular 22's builder runs Vitest natively; React uses Vitest + Testing Library. Playwright for both |
| 7. Developer experience | 4 | 4 | Angular CLI generators and strict templates versus Vite speed and JSX flexibility |
| 8. Ecosystem | 4 | **5** | React's is larger. Everything this app needs exists for Angular: Material/CDK (table, dialog, overlay, datepicker, virtual scroll, a11y), Playwright, OpenAPI typings |
| 9. Reusability | 4 | 4 | Standalone components and directives versus components and hooks; equivalent |
| 10. Scalability (more modules, more people) | **5** | 4 | Enforced conventions, DI scopes and lazy route providers make features independent by default |
| **Total** | **44** | **40** | |

### Where React would win, and why it does not decide this
- **Server caching:** RTK Query gives shared caches, tag invalidation and request de-duplication out of the box. In this app, financial data must be fresh after every mutation, lists are server-paginated, and there are 10 users; a small invalidation helper on top of `httpResource` (one version signal per entity) covers the need without a second state system. If that turns out insufficient, TanStack Query for Angular exists (stable package name since September 2026) and can be adopted for server state only — documented as the fallback in `web-state-management.md`.
- **Hiring pool:** larger for React. Not a factor at this team size; revisit if the team grows.

## 3. Decision details

| Area | Choice | Rejected alternatives |
|---|---|---|
| Framework | Angular 22, standalone components only (no NgModules) | React 19; Angular with NgModules |
| Change detection | Zoneless (`provideZonelessChangeDetection`, public API since 20.2), `OnPush` everywhere | Zone.js |
| Reading server data | `httpResource` / `rxResource` (stable public API in 22.0), keyed by signals, with per-entity invalidation | TanStack Query (fallback only), NgRx Effects |
| Shared client state | NgRx SignalStore (`@ngrx/signals` 22): session, preferences, sale in progress, list filters | NgRx Store (global, event-driven) — not justified at this size; plain services with signals for cross-feature state (insufficiently structured for the cart) |
| Local UI state | Component `signal()` / `computed()` | — |
| Async streams | RxJS only where it is the right tool (HttpClient, debounced search, `rxMethod`) | RxJS everywhere |
| Forms | Typed Reactive Forms | Template forms; Signal Forms (still evolving; revisit in a later release) |
| UI components | Angular Material 3 + CDK, themed with Velora tokens (CSS custom properties) | Fully custom kit (cost), PrimeNG, Tailwind (a second styling system next to Material's tokens) |
| Charts | Small custom SVG/CSS components (labelled bars, stacked status bar) — the reports have no time series today | ECharts/Chart.js (adopt only when a trend chart is needed) |
| API types | Generated from `backend/openapi/openapi.yaml` with `openapi-typescript` (types only, no runtime) | Hand-written DTOs; generated client code |
| Tests | Vitest through the Angular builder; Playwright end-to-end against the real API | Karma/Jasmine; Cypress |
| Location in repo | `web/` next to `backend/` and `mobile/` | `apps/web` with Nx — the repository is not a workspace monorepo and does not need one |

## 4. Consequences

- **Backend work is needed before the web app can sign anyone in safely**: browser sessions with an HttpOnly refresh cookie, and email links that open in a browser (B1, B2 in `web-api-integration.md`). This is the first item of Sprint W1.
- The web app is **online-only**. Offline working stays a mobile feature (`offline-sync-strategy.md`); a shop's desktop is assumed to be connected.
- Business rules stay in the backend. The web app validates input for usability using values the server provided (price bounds, available stock) and always shows the server's totals.
- Mobile and web are independent applications on the same API. Shared things are the contract (OpenAPI), the design tokens (values, not code) and the wording.
