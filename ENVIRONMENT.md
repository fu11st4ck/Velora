# Environment Configuration

All configuration is supplied through environment variables, validated at start-up (the API exits if a required value is missing or malformed). No secret is committed; `.env` files are local-only and git-ignored. Values shown are examples or defaults, never real credentials.

Status: specification for Sprint 1 — the variables are not yet read by any code.

## Backend API

| Variable | Required | Example / default | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `development` \| `test` \| `production` | Runtime mode |
| `PORT` | no | `3000` | HTTP port |
| `APP_BASE_URL` | yes | `http://localhost:3000` | Used in emailed links |
| `DATABASE_URL` | yes | `postgresql://velora_app:…@localhost:5432/velora` | Application role (no DDL, no RLS bypass) |
| `DATABASE_MIGRATION_URL` | yes (deploy) | `postgresql://velora_owner:…@…/velora` | Owner role, used only by the migration job and the maintenance jobs (`npm run maintenance`) |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | yes | PEM | Access-token signing key pair |
| `JWT_KEY_ID` | yes | `2026-11` | `kid` for key rotation |
| `ACCESS_TOKEN_TTL_SECONDS` | no | `900` | |
| `REFRESH_TOKEN_TTL_DAYS` | no | `30` | |
| `PASSWORD_RESET_TTL_MINUTES` | no | `60` | |
| `STORAGE_ENDPOINT` | yes | `http://localhost:9000` | S3-compatible endpoint |
| `STORAGE_REGION` | yes | `us-east-1` | |
| `STORAGE_BUCKET` | yes | `velora-dev` | Private bucket |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | yes | — | |
| `MAIL_SMTP_URL` | yes | `smtp://localhost:1025` | Mailpit locally |
| `MAIL_FROM` | yes | `Velora <no-reply@example.com>` | |
| `MOBILE_DEEP_LINK_BASE` | yes | `velora://` | Reset-password and invite links |
| `RATE_LIMIT_PER_MINUTE` | no | `120` | Per user |
| `LOG_LEVEL` | no | `info` | |
| `SENTRY_DSN` | no | — | Error monitoring; disabled when empty |
| `SEED_DEMO` | no | `false` | Seeds the demo organization; refused when `NODE_ENV=production` |

## Mobile application

Compile-time configuration per flavour (`--dart-define-from-file=config/<flavour>.json`). These are not secrets.

| Key | dev | staging | prod |
|---|---|---|---|
| `API_BASE_URL` | `http://10.0.2.2:3000/api/v1` (Android emulator) / `http://localhost:3000/api/v1` (iOS simulator) | staging URL | production URL |
| `FLAVOR` | `dev` | `staging` | `prod` |
| `SENTRY_DSN` | empty | set | set |
| `ALLOW_CLEARTEXT` | `true` | `false` | `false` |

## Business settings are not environment variables

Currency, timezone, tax rates, markup limits, credit days, low-stock threshold, document prefixes and offline-sales permission are **per-organization data** (`organizations`, `tax_rates`, `document_sequences`), editable in the app by the Owner. They are never configured through the environment.

## Environments

| Environment | Purpose | Data |
|---|---|---|
| `dev` | Local development (Docker Compose or local PostgreSQL) | Demo seed |
| `test` | Automated tests | Created per test run |
| `staging` | Pre-release verification | Synthetic |
| `production` | Live | Real; backups with point-in-time recovery |
