# Velora — Security Guidelines

Baseline: OWASP ASVS Level 2 and the OWASP Mobile Top 10. Each item is a requirement with the sprint in which it is implemented and verified by a test.

## 1. Authentication

| Requirement | Detail | Sprint |
|---|---|---|
| Password storage | Argon2id (memory 64 MiB, 3 iterations, parallelism 1 — tuned to ~250 ms on production hardware), per-password salt | 1 |
| Password policy | ≥ 10 characters, max 200, checked against a common/breached list; no composition rules | 1 |
| Access token | JWT signed with EdDSA (or RS256), 15-minute lifetime, claims: `sub`, `org`, `mid` (member), `role`, `branch`, `fam` (token family), `iat`, `exp`. Keys identified by `kid` for rotation | 1 |
| Refresh token | 256-bit random, opaque, stored only as SHA-256 hash, 30-day sliding lifetime, **single use** | 1 |
| Rotation and reuse detection | Each refresh issues a new token in the same family and marks the old one rotated. A rotated token presented again revokes the entire family and is audit-logged | 1 |
| Revocation | Logout, password change/reset, role change and deactivation revoke the relevant families immediately | 1 |
| Brute force | Login: 5 failures per account per 15 min and 20 per IP per 15 min → `429` with increasing delay; counters stored in PostgreSQL so they hold across instances. Uniform responses and timing for unknown accounts | 1 |
| Password reset | Single-use token, 60-minute expiry, hashed at rest; response never reveals whether the email exists | 1 |
| Session visibility | Users can see and revoke their devices (token families) | 5 |

Not in v1 (recorded as a known gap): multi-factor authentication. Recommended for Owner accounts before public launch.

## 2. Authorization

- **Deny by default.** Every route declares its required permission; a global guard rejects routes without a declaration (enforced by a test that enumerates all routes).
- **Roles** Owner / Manager / Sales map to permissions in one file (`authz/permissions.ts`), mirrored in [`business-rules.md`](business-rules.md) §9.
- **Ownership checks** for the Sales role (own documents only) live in the repository query (`WHERE salesperson_id = :member`), not in controller `if` statements, so list and detail endpoints cannot diverge.
- **Field-level confidentiality:** cost, markup and profit fields are removed by a role-aware serializer driven by the same `x-manager-only` markers as the OpenAPI document. A contract test fetches every endpoint as a Sales user and asserts no such key appears anywhere in the JSON.
- The mobile app hides what the user cannot do, but is never the enforcement point.

## 3. Tenant isolation

- Organization id comes only from the verified token.
- All repositories require the tenant context; PostgreSQL row-level security is the second line (see [`database-design.md`](database-design.md) §3).
- Cross-tenant access returns `404`, never `403`, to avoid confirming existence.
- Object-storage keys are prefixed `org/<organization id>/`; presigned URLs are issued only after a tenant check and expire in 5 minutes (upload) / 15 minutes (download).
- Automated isolation tests are part of the mandatory CI suite.

## 4. Input and output handling

| Risk | Control |
|---|---|
| Injection | Prisma parameterized queries; the few raw SQL statements use tagged templates with bound parameters only. No string-built SQL (lint rule) |
| Mass assignment | DTOs with whitelist validation; unknown properties rejected; server sets `organization_id`, `salesperson_id`, totals and statuses — never the client |
| Tampered totals | Client-submitted totals are not accepted at all; the server computes from product ids, quantities and unit prices, and validates each price against policy |
| Oversized payloads | Body limit 1 MB; list limits ≤ 100; string length limits in every DTO |
| CSV injection in exports | Cells beginning with `= + - @` are prefixed with `'` |
| PDF generation | Built from structured data with a layout library; no HTML rendering of user input |
| Log injection / leakage | Structured logs; passwords, tokens, authorization headers and full request bodies of auth routes are redacted |

## 5. File uploads (product images, logo)

- Direct-to-storage presigned `PUT` with fixed content type and maximum size (5 MB) in the signature.
- Allowed types: JPEG, PNG, WebP. After upload the server reads the object's magic bytes and size before attaching the key to a product; mismatches are deleted and rejected.
- Images are re-encoded server-side to strip metadata (EXIF location) and normalise dimensions.
- Bucket is private; no public listing; objects served through short-lived signed URLs.

## 6. Transport and platform

- HTTPS only (TLS 1.2+), HSTS at the edge. The app refuses cleartext (`android:usesCleartextTraffic="false"`, iOS ATS on) in staging and production flavours.
- CORS disabled for the API by default (mobile clients do not need it); an allow-list is added only if a web client is introduced.
- Standard security headers via `@fastify/helmet`.
- Rate limiting per user and per IP on all routes; stricter on auth and on PDF/CSV generation.
- Certificate pinning is **not** enabled in v1 (operational risk of lock-out on certificate rotation outweighs the benefit at this stage); revisit before handling payment-card data.

## 7. Mobile application

| Requirement | Detail |
|---|---|
| Token storage | `flutter_secure_storage` — iOS Keychain (`first_unlock_this_device`), Android Keystore-backed encrypted storage. Never in preferences, logs or the local database |
| Local database | App-private directory; excluded from backups (`android:allowBackup="false"`, iOS backup-exclusion attribute). Contains business data the user is entitled to, and never cost data for Sales users. SQLCipher encryption is evaluated in Sprint 6 if owners require protection against rooted/jailbroken devices |
| No secrets in the binary | The app holds only the API base URL and public identifiers per flavour. No API keys, signing secrets or credentials |
| Screens with cost/profit | Marked secure on Android (`FLAG_SECURE`) for Manager-only profit views — configurable |
| Session expiry | Refresh failure → sign-in screen; in-memory state cleared; drafts and outbox retained for the same user |
| Deep links | Only the password-reset and document routes are linkable; parameters validated; no action is performed from a link without authentication |
| Release builds | Obfuscation with split debug info; no debug logging; Sentry scrubbing of personal data |
| Dependencies | Lockfiles committed; `dart pub outdated` / `npm audit` in CI; automated dependency update PRs |

## 8. Audit trail

Written inside the same database transaction as the change, so an action cannot succeed without its record:

- Authentication events: login success/failure, refresh-token reuse, password reset and change, session revocation.
- Every stock-changing action: product create, receipt, adjustment (with reason).
- Every financial action: invoice issue, payment, refund, cancellation (with reason), return, below-minimum price override (with reason).
- Configuration: settings, tax rates, product pricing policy (before/after), member role/status.

Entries hold actor, organization, action, entity, before/after JSON (no secrets), IP, user agent, request id, timestamp. The application database role cannot update or delete them. Retention: 7 years by default (configurable per legal requirement — unresolved question U5).

## 9. Secrets and configuration

- All secrets come from environment variables injected by the deployment platform's secret store; validated at start-up (the process exits on a missing or weak value).
- `.env` files are for local development only, git-ignored; `.env.example` contains placeholders, never real values.
- Separate credentials and signing keys per environment. JWT signing keys are rotatable (`kid`), database credentials are least-privilege (application role: no DDL, no `BYPASSRLS`, no update/delete on append-only tables).
- CI uses repository secrets; secret scanning and push protection enabled on the repository.

## 10. Data protection

- Personal data held: staff name/email/phone; customer name, company, phone, email, address, tax number. Nothing more is collected.
- Encrypted at rest by the managed database and object storage; in transit by TLS.
- Backups are encrypted and access-controlled like production.
- Customer archive hides the customer from lists; documents keep their legal snapshot. A documented erasure procedure (anonymising the customer record while retaining financial documents) is prepared before launch in jurisdictions that require it.

## 11. Security verification

| Check | When |
|---|---|
| Authorization matrix tests (every route × role) | CI, every commit |
| Tenant isolation tests + RLS test | CI, every commit |
| Sales-role confidentiality contract test | CI, every commit |
| Refresh rotation / reuse / revocation tests | CI |
| Idempotency and concurrency tests on financial routes | CI |
| Dependency audit, secret scan, static analysis (`eslint-plugin-security`, `dart analyze`) | CI |
| Manual review against this document + OWASP MASVS checklist | Sprint 6 |
| External penetration test | Before public launch (recommended) |
