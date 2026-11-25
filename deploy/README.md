# Deploying Velora with Docker

One server runs everything: PostgreSQL, the API, and Caddy, which provides HTTPS and serves the web app. The web app is at `https://<your domain>/` and the API under `https://<your domain>/api/v1` — one address for both. Sized for a small team; 2 vCPU and 2–4 GB of memory are plenty.

> **What has and has not been tested.** The steps the containers perform — creating the database roles, running migrations, creating the first organization, the API in production mode, backup, restore and the consistency check — were rehearsed against a local PostgreSQL. **The Docker image build, the Compose stack and Caddy were not run**: the workspace this was written in has no Docker daemon. `docker compose config` validates the file. Expect to fix small things on the first `docker compose up`; the last section lists where to look.

## 1. Before you start

- A Linux server (Ubuntu 24.04 or Debian 12) with a public IP address.
- A domain name, for example `app.yourshop.com`, with a DNS **A record pointing at the server**. The web app and the API share it. Caddy needs it to get the HTTPS certificate.
- Ports **80 and 443** open in the provider's firewall. Nothing else needs to be reachable (SSH aside).
- An SMTP account for sending email (Resend, Postmark, Brevo, or your mail provider). The API refuses to start without one, because invitations and password resets depend on it.

## 2. Install

```bash
# On the server
curl -fsSL https://get.docker.com | sh
git clone https://github.com/fu11st4ck/Velora.git && cd Velora/deploy

cp .env.example .env
./generate-secrets.sh        # prints passwords and signing keys — paste them into .env
nano .env                    # set DOMAIN, MAIL_SMTP_URL, MAIL_FROM
chmod 600 .env

docker compose up -d --build
docker compose ps            # postgres and api should become "healthy"; migrate should have exited 0
```

Check it from your own computer: `https://app.yourshop.com/api/v1/health/ready` should answer `{"data":{"status":"ok"}}`, and `https://app.yourshop.com/` should show the sign-in page.

## 3. Create your business and the owner account

There is no public sign-up. This command creates the business, its default tax rate and the owner, once:

```bash
docker compose exec \
  -e ORG_NAME="Your Shop Name" \
  -e ORG_CURRENCY=AED -e ORG_TIMEZONE=Asia/Dubai -e ORG_COUNTRY=AE \
  -e ORG_TAX_NAME="VAT 5%" -e ORG_TAX_RATE_BP=500 \
  -e OWNER_NAME="Your Name" -e OWNER_EMAIL=you@example.com \
  -e OWNER_PASSWORD='at-least-10-characters' \
  api node dist/maintenance/cli.js create-organization
```

- `ORG_TAX_RATE_BP` is in hundredths of a percent: `500` is 5%.
- Currency and time zone can be changed in the app only until the first quotation or invoice, so choose them now.
- Change the password in the app afterwards (More → Change password); the one typed here stays in the shell history.
- Everyone else is invited from the app (More → Team) and receives an email with a link to choose a password.

## 4. Open the app

The web app is at `https://<your domain>` — sign in with the owner account. Then check the deployment from any computer with the repository (read-only, creates nothing):

```bash
cd web && SMOKE_URL=https://app.yourshop.com SMOKE_EMAIL=you@yourshop.com SMOKE_PASSWORD='…' npm run smoke
```

The mobile app is built with the server address:

```bash
flutter build apk --release -t lib/main_prod.dart --dart-define=API_BASE_URL=https://app.yourshop.com/api/v1
```

Production builds refuse an address that is not `https`. Note that **no Android or iOS build has been produced or tested yet**, and the links in invitation and reset emails (`https://<your domain>/reset-password?…`) open the web page, which works on phones too; opening them directly in the phone app needs Android App Links / iOS Universal Links in the native projects.

## 5. Backups

```bash
./backup.sh                  # dump to ./backups, prune old ones, purge expired records, consistency check
```

Run it nightly with cron (`crontab -e`):

```
15 2 * * * /home/USER/Velora/deploy/backup.sh >> /home/USER/Velora/deploy/backups/backup.log 2>&1
```

**Copy backups off the server**, or a lost server loses them too. Install [rclone](https://rclone.org), run `rclone config` once to add a remote (Cloudflare R2, Backblaze B2, S3…), and set `BACKUP_RCLONE_REMOTE=remote:bucket` in `.env`. The script warns on every run while this is unset.

Test a restore before you rely on it, and again every few months:

```bash
./restore.sh backups/velora-….dump            # restores into a scratch database and checks it; production untouched
./restore.sh backups/velora-….dump --replace  # the real thing: replaces production (asks first)
```

Also turn on your provider's server snapshots. They are a second line, not a substitute: a snapshot taken mid-write is less reliable than a database dump.

## 6. Updating

```bash
cd Velora && git pull && cd deploy
./backup.sh
docker compose up -d --build --wait   # rebuilds, runs new migrations, restarts the API and the web app
```

Then run the smoke test above. Browsers pick up a new release of the web app on their next page load: the app page is never cached, its files are named by content and cached for a year. The full list is in `docs/release-checklist.md`.

Migrations only add to the schema, so going back means checking out the previous commit and running the same command.

## 7. Day-to-day

| Task | Command |
|---|---|
| Status | `docker compose ps` |
| API logs | `docker compose logs -f --tail 100 api` |
| Is the data consistent? | `docker compose exec api node dist/maintenance/cli.js check` |
| Database shell | `docker compose exec postgres psql -U postgres velora` |
| Restart | `docker compose restart api` |

Things worth knowing:
- **One server is one point of failure.** While it is down, invoices cannot be created; the app still shows saved products and customers and queues quotations.
- `docker compose down` keeps the data; `docker compose down -v` **deletes the database**. Never use `-v`.
- Keep the system updated (`apt upgrade`), allow SSH by key only, and keep `.env` readable by you alone.
- If the signing keys in `.env` are replaced, everyone is signed out.
- Errors show a reference ("Ref req_…") in the app; search the API logs for it.

## 8. If the first start fails

| Symptom | Likely cause |
|---|---|
| `api` exits with "Invalid environment configuration" | A value in `.env` is missing — the message names it |
| `migrate` fails with an authentication error | The database volume was created with different passwords. Passwords are applied only when the volume is first created: fix `.env`, or (only on a brand-new install with no data) `docker compose down -v` and start again |
| Caddy logs certificate errors | DNS does not point at this server yet, or ports 80/443 are closed |
| Image build fails | Not verified in advance (see the note at the top) — send the error output. The web image needs about 2 GB of memory to build |
| Invitations do not arrive | Check `docker compose logs api` for "could not be sent"; verify `MAIL_SMTP_URL` and that `MAIL_FROM` is an address your mail provider allows |
