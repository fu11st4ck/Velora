#!/usr/bin/env bash
# Nightly backup: a compressed dump of the database in ./backups, old ones pruned, and — when
# BACKUP_RCLONE_REMOTE is set in .env — a copy off this server. Then the consistency check.
# Exit code is non-zero if the backup, the copy or the check failed, so cron mail / monitoring notices.
set -euo pipefail
cd "$(dirname "$0")"
# Reads one setting from .env without executing the file (values may contain spaces or symbols).
setting() { sed -n "s/^$1=//p" .env | tail -n 1; }
remote="$(setting BACKUP_RCLONE_REMOTE)"
keep_days="$(setting BACKUP_KEEP_DAYS)"

mkdir -p backups
file="backups/velora-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Custom format: compressed, and restorable table by table with pg_restore.
docker compose exec -T postgres pg_dump -U postgres -d velora --format=custom > "$file.partial"
# A dump that is suspiciously small means something went wrong; do not let it replace good backups.
if [ "$(wc -c < "$file.partial")" -lt 10000 ]; then
  echo "backup failed: dump is too small" >&2
  rm -f "$file.partial"
  exit 1
fi
mv "$file.partial" "$file"
echo "backup written: $file ($(du -h "$file" | cut -f1))"

find backups -name 'velora-*.dump' -mtime "+${keep_days:-14}" -delete

status=0
if [ -n "$remote" ]; then
  rclone copy "$file" "$remote" || { echo "off-server copy failed" >&2; status=1; }
else
  echo "warning: BACKUP_RCLONE_REMOTE is not set — this backup exists only on this server" >&2
fi

docker compose exec -T api node dist/maintenance/cli.js purge
docker compose exec -T api node dist/maintenance/cli.js check || { echo "consistency check found problems (see above)" >&2; status=1; }
exit "$status"
