# Velora — Deployment Runbook (draft)

> **Status: written, never executed.** No hosting has been chosen (decision D11), so nothing here has been run against real infrastructure. Treat every step as a plan to verify on staging first.

## 1. What has to exist

| Piece | Requirement |
|---|---|
| PostgreSQL 16 | Extensions `citext`, `pg_trgm`. Two roles: an owner (migrations, maintenance) and `velora_app` (the API; no DDL, row-level security applies). Create both with `backend/scripts/db-setup.sql` before the first migration — the migration grants privileges to `velora_app` only if the role exists. |
| API container | Built from `backend/Dockerfile` (CI job `backend-image`). Stateless; run at least two instances behind a TLS-terminating load balancer. |
| Secrets | `DATABASE_URL` (app role), `DATABASE_MIGRATION_URL` (owner), the JWT signing key, `MAIL_SMTP_URL`. See `ENVIRONMENT.md`. Never in the image or the repository. |
| SMTP | Required. Without it invitations and password resets are silently not delivered (the server only logs that a mail was due). |
| Scheduler | Daily, in the API image with the owner URL: `node dist/maintenance/cli.js check` (alert on exit code 1) and `node dist/maintenance/cli.js purge`. |
| Object storage | Not needed yet; required when product photos and the logo are built. |

## 2. Release steps

1. Build and push the image for the commit.
2. Run migrations as a one-off job with the owner URL: `npx prisma migrate deploy`. Migrations are forward-only; the API of the previous version must keep working against the new schema (add first, remove in a later release).
3. Roll the API instances. Readiness is `GET /api/v1/health/ready` (checks the database); liveness is `/health/live`.
4. Smoke test: sign in, `GET /dashboard/summary`, create and cancel a test invoice in a test organization.
5. Run `maintenance -- check`.

Rollback: redeploy the previous image. Because migrations are additive, no schema rollback is needed; a migration that cannot be additive needs its own written plan.

## 3. Backups

- Managed point-in-time recovery with at least 7 days of retention, plus a daily logical dump kept 30 days in another region.
- **Restore drill before go-live and quarterly:** restore last night's backup into a scratch database, run `maintenance -- check` against it, and compare invoice and payment counts with production. A backup that has not been restored is not a backup.
- The append-only tables (`stock_movements`, `payments`, `sales_returns`, `audit_logs`) cannot be updated or deleted by the application role, so a compromised API cannot rewrite history; only a backup protects against loss of the database itself.

## 4. Monitoring to set up

| Signal | Alert when |
|---|---|
| `/health/ready` | failing for 2 minutes |
| 5xx rate | above 1% for 5 minutes |
| Request latency p95 | above 1 s for 10 minutes (reference numbers: `performance-notes.md`) |
| `maintenance -- check` | exit code 1 — investigate before anything else; never auto-repair |
| Audit events `auth.refresh_reuse_detected` | any (a stolen or replayed refresh token) |
| Database | connections above 80% of the limit; storage above 80% |

Errors are logged as structured JSON with a `requestId` that the app shows to the user ("Ref …"); an error-tracking service still has to be chosen and wired in.

## 5. Mobile releases

Not started: no Android or iOS build has been produced. Needed before a store build: signing keys, application ids and flavours in the native projects, `velora://` deep-link registration for password links, app icons and splash, privacy declarations (the app stores business data and session tokens on the device; no analytics or advertising SDKs), and a pass on real devices.
