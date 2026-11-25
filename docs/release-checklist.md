# Release Checklist

For each release of Velora (API + web app on one server, `deploy/`). Items marked **manual** cannot be automated and were not done in the development workspace; they need a person and real devices.

## 1. Before releasing
- [ ] CI green on the release commit (`.github/workflows/ci.yml`): backend tests (incl. response contract checks), web lint/types/unit/build with budgets, web end-to-end on Chromium, and the **stack** job (`backend-image`) — production images built, stack started behind Caddy, business created with `create-organization`, post-deploy smoke test passed.
- [ ] Last nightly **Browsers** run green (`.github/workflows/browsers.yml`: Firefox and WebKit). Trigger it manually if the last run is older than the release commit.
- [ ] `npm audit --omit=dev` clean in `backend/` and `web/` (dev-only advisories are reviewed, not blocking).
- [ ] CHANGELOG.md has the release's entry; TASKS.md known gaps reviewed.
- [ ] **Manual — screen reader pass** of the critical flows (sign in, make a sale, record a payment, return items): NVDA + Firefox or JAWS + Chrome on Windows, VoiceOver + Safari on macOS/iOS. Automated axe checks pass on every page (web/e2e/a11y.spec.ts) but cannot judge reading order or announcements.
- [ ] **Manual — real phones**: iPhone (Safari) and an Android phone (Chrome): sign in, sale with the cart steps, invoice PDF open/share, WhatsApp link.
- [ ] **Manual — printing**: invoice PDF → Print opens the print dialog in Chrome, Edge, Firefox and Safari (headless tests confirm the PDF is loaded for printing, not the dialog itself).

## 2. Releasing (deploy/README.md §6)
```bash
cd Velora && git pull && cd deploy
./backup.sh                          # before every update
docker compose up -d --build --wait  # new images, migrations, restart
```

## 3. Right after releasing
- [ ] Post-deploy smoke test from any computer with the repository (read-only; creates nothing):
  ```bash
  cd web && SMOKE_URL=https://app.yourshop.com SMOKE_EMAIL=<an account> SMOKE_PASSWORD=<its password> npm run smoke
  ```
  It checks HTTPS, the security headers, caching (app page `no-cache`, hashed files `immutable`), the API through Caddy, sign-in with an `HttpOnly; Secure; SameSite=Strict` cookie, no token in browser storage, no Content-Security-Policy violations, navigation and sign-out.
- [ ] `docker compose exec api node dist/maintenance/cli.js check` reports `consistent: true`.
- [ ] Open the app once in a normal browser window: a new release is picked up on the next page load (the app page is never cached).

## 4. If something is wrong
Roll back to the previous commit and run the same `docker compose up -d --build --wait`. Migrations only add to the schema, so the previous API keeps working against it; a migration that is not additive needs its own written plan (docs/deployment-runbook.md §2). Restore from backup only for data problems (deploy/README.md §5, tested with `restore.sh`).
