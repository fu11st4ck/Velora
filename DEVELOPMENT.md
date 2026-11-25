# Development Guide

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 | |
| PostgreSQL | 16 with `citext` and `pg_trgm` | local install, or `docker compose up -d postgres` |
| Flutter | stable 3.50 (Dart 3.14) | Material comes from the `material_ui` package in this Flutter version — import `package:material_ui/material_ui.dart`, not `package:flutter/material.dart` |
| Android SDK / Xcode | current | for device builds |

## Backend

```bash
cd backend
cp .env.example .env                 # local values only
bash scripts/db-setup.sh             # creates roles velora_owner / velora_app and databases velora_dev / velora_test
npm ci
npx prisma generate
DATABASE_URL=postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_dev npx prisma migrate deploy
SEED_DEMO=true SEED_PASSWORD='<choose one, 10+ chars>' \
  DATABASE_MIGRATION_URL=postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_dev npm run db:seed
npm run start:dev                    # http://localhost:3000/api/v1

npm run lint && npm run typecheck && npm test && npm run build
```

- Two database roles on purpose: migrations and the seed run as the **owner**; the API connects as **`velora_app`**, which is subject to row-level security and cannot update or delete ledgers. Never point `DATABASE_URL` at the owner role.
- Tests use the `velora_test` database and apply migrations automatically. Override with `TEST_DATABASE_URL` / `TEST_OWNER_DATABASE_URL`.
- Demo accounts after seeding: `owner@velora.example`, `manager@velora.example`, `ahmed@velora.example` (sales), all with the `SEED_PASSWORD` you chose.
- New migration: edit `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>` as the owner, then add anything Prisma cannot express (checks, policies, grants) to the generated SQL and cover it in `test/database.spec.ts`. **Every new tenant table needs a row-level security policy** — a test fails otherwise.

## Mobile

```bash
cd mobile
flutter pub get
flutter analyze && flutter test
flutter run -t lib/main_dev.dart                                   # Android emulator → http://10.0.2.2:3000/api/v1
flutter run -t lib/main_dev.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1   # iOS simulator

# Golden screenshots (review the images before committing)
flutter test --update-goldens test/golden

# The app's API client against a running, seeded backend
VELORA_LIVE_API=http://localhost:3000/api/v1 VELORA_LIVE_PASSWORD='<seed password>' flutter test test/live
```

Staging and production builds require `--dart-define=API_BASE_URL=https://…` and refuse to start without it.

## Web

See [`web/README.md`](web/README.md). In short: run the API (`APP_BASE_URL=http://localhost:4200`, the default in `.env.example`), then `cd web && npx -y npm@11.6.2 install && npm start`, and open http://localhost:4200. `npm test` runs unit and component tests; `npm run e2e` builds the production app and runs the end-to-end tests against the real API and a fresh `velora_e2e` database (PostgreSQL must be running).

## Maintenance jobs

```bash
cd backend
DATABASE_MIGRATION_URL=postgresql://velora_owner:…@localhost:5432/velora_dev npm run maintenance -- check   # exit 1 lists what is inconsistent
DATABASE_MIGRATION_URL=… npm run maintenance -- purge                                                      # deletes expired idempotency records and tokens
```

Both use the owner connection (row-level security would hide other organizations). `check` only reads.

## Other checks

```bash
npx @redocly/cli@1 lint backend/openapi/openapi.yaml                # API contract
node docs/reference-screenshots/audit-script.js <output-directory>  # re-run the reference audit (Playwright)
```

## Conventions

- **Branches:** short-lived feature branches; `main` is always releasable.
- **Commits:** imperative subject, body explains why. One logical change per commit.
- **Money:** integer minor units only (`*_minor`, `*Minor`). A lint rule forbids `double` in money paths on both sides.
- **Business rules** change in `docs/business-rules.md` first, then in code and tests in the same pull request.
- **API changes** update `backend/openapi/openapi.yaml` and `docs/api-specification.md` in the same pull request; CI diffs the generated contract.
- **Database changes** are forward-only Prisma migrations; SQL constraints live in the migration and are covered by constraint tests.
- **Architecture decisions** get an ADR.
- **Definition of done:** see `docs/mobile-screen-specifications.md` (acceptance checklist) and `docs/testing-strategy.md`.

## Workspace limitations

Sprints 0–1 were built in a cloud workspace with Node 22, PostgreSQL 16, the Flutter SDK and Chromium, but **no Android SDK or emulator, no macOS/Xcode and no Docker daemon**. Everything listed as verified in `CHANGELOG.md` was actually run there; device builds, the Docker image and the CI workflow were not. See risks R2/R3 in `docs/implementation-roadmap.md`.
