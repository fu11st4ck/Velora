#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#   ./restore.sh backups/velora-….dump            into a scratch database "velora_restore" (a drill:
#                                                 production is not touched), then checks it
#   ./restore.sh backups/velora-….dump --replace  REPLACES the production database with the backup
set -euo pipefail
cd "$(dirname "$0")"
file="${1:?usage: restore.sh <backup file> [--replace]}"
mode="${2:-drill}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
# Reads one setting from .env without executing the file (values may contain spaces or symbols).
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }
psql() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

if [ "$mode" = "--replace" ]; then
  read -r -p "This replaces ALL current data with $file. Type the word replace to continue: " answer
  [ "$answer" = "replace" ] || { echo "cancelled"; exit 1; }
  target=velora
  docker compose stop api
else
  target=velora_restore
fi

psql -d postgres -c "DROP DATABASE IF EXISTS $target WITH (FORCE)" -c "CREATE DATABASE $target OWNER velora_owner"
docker compose exec -T postgres pg_restore -U postgres -d "$target" --no-owner --role=velora_owner --exit-on-error < "$file"
# Privileges of the application role are restored from the dump; make sure it can connect.
psql -d postgres -c "REVOKE ALL ON DATABASE $target FROM PUBLIC" -c "GRANT CONNECT ON DATABASE $target TO velora_app"

echo "restored into database: $target"
psql -d "$target" -At -c "SELECT 'organizations: ' || count(*) FROM organizations" \
                      -c "SELECT 'invoices: ' || count(*) FROM invoices" \
                      -c "SELECT 'payments: ' || count(*) FROM payments"

if [ "$mode" = "--replace" ]; then
  docker compose start api
  docker compose exec -T api node dist/maintenance/cli.js check
else
  docker compose exec -T -e DATABASE_MIGRATION_URL="postgresql://velora_owner:$(setting VELORA_OWNER_PASSWORD)@postgres:5432/velora_restore" \
    api node dist/maintenance/cli.js check
  echo "drill finished. Remove the scratch copy with:"
  echo "  docker compose exec -T postgres psql -U postgres -c 'DROP DATABASE velora_restore'"
fi
