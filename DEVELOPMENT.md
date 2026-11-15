# Development Guide

> Sprint 0 state: there is no runnable application yet. The commands under "Available today" work now; the rest describes the workflow that Sprint 1 sets up and will be updated as it lands.

## Available today

```bash
# Validate the database schema
cd backend && DATABASE_URL="postgresql://u:p@localhost:5432/velora" npx prisma@6 validate --schema prisma/schema.prisma

# Lint the API contract
npx @redocly/cli@1 lint backend/openapi/openapi.yaml

# Re-run the reference-application audit (Node 22 + Playwright with Chromium)
node docs/reference-screenshots/audit-script.js <output-directory>
```

Both validations were run on 2026-11-15: the Prisma schema is valid; the OpenAPI document is valid (style warnings only).

## Prerequisites (from Sprint 1)

| Tool | Version | Notes |
|---|---|---|
| Flutter | stable 3.x (pinned in `mobile/.fvmrc`) | Android SDK for Android builds; Xcode on macOS for iOS |
| Node.js | 22 LTS | |
| PostgreSQL | 16 | via Docker Compose or local install |
| Docker + Compose | recent | optional when PostgreSQL is installed locally |

## Planned workflow (Sprint 1)

```bash
# Backend
cd backend
cp .env.example .env
docker compose up -d            # postgres, minio, mailpit
npm ci
npx prisma migrate dev
SEED_DEMO=true npx prisma db seed
npm run start:dev               # http://localhost:3000/api/v1, Swagger UI at /docs
npm test                        # unit + integration + scenarios (needs PostgreSQL)

# Mobile
cd mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run --flavor dev -t lib/main_dev.dart
flutter analyze && flutter test
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

## Workspace limitations noted during Sprint 0

- The cloud workspace used for Sprint 0 has Node 22, PostgreSQL 16 and Chromium/Playwright, but **no Flutter SDK, no Android SDK/emulator, no Docker daemon and no macOS**. See risk R2/R3 in `docs/implementation-roadmap.md`.
