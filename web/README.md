# Velora — Web app

Angular 22 web app for Velora, on the same API as the mobile app. Architecture and decisions: [`docs/web-frontend-architecture.md`](../docs/web-frontend-architecture.md), [`docs/web-state-management.md`](../docs/web-state-management.md), [`docs/web-api-integration.md`](../docs/web-api-integration.md). Roadmap and status: [`docs/web-implementation-roadmap.md`](../docs/web-implementation-roadmap.md), [`TASKS.md`](../TASKS.md).

## Run it

```bash
# 1. The API (from backend/, with PostgreSQL running and the demo data seeded — see DEVELOPMENT.md)
cd backend && npm run build && node dist/main.js        # http://localhost:3000, APP_BASE_URL=http://localhost:4200

# 2. The web app
cd web
npx -y npm@11.6.2 install                                # npm 11: npm 10's resolver crashes on this dependency set
npm start                                                # http://localhost:4200 — /api is proxied to :3000
```

Sign in with a demo account (`owner@`, `manager@` or `ahmed@velora.example`, password from `SEED_PASSWORD`). The design-system page is at `/dev/ui` in development builds.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Development server with the API proxy (`proxy.conf.json`) |
| `npm test` | Unit and component tests (Vitest, through the Angular builder) |
| `npm run lint` | ESLint with Angular template and accessibility rules |
| `npm run e2e` | End-to-end tests (Playwright, Chromium) against the **production build** with the production security headers, the real API and a freshly seeded `velora_e2e` database. Starts everything itself; PostgreSQL must be running |
| `npx ng build` | Production build into `dist/velora-web/browser` |
| `npm run api:types` | Regenerates `src/app/core/api/schema.d.ts` from `backend/openapi/openapi.yaml` |
| `npm run api:check` | Fails if the committed types are out of date (CI) |

## Conventions
- Standalone components, `OnPush`, zoneless; signals for state, `httpResource` for reading server data, NgRx SignalStore for shared state.
- Money is integer minor units; format and parse only with `core/money`.
- Never write a token to any browser storage; the refresh token is an HttpOnly cookie the code never sees.
- Features may import from `core/` and `shared/`, never from each other.
- A sidebar entry is added only when its page exists (`layout/navigation.ts`).
