#!/usr/bin/env bash
# Creates the database roles and the dev/test databases on a local PostgreSQL (development only).
# Runs psql as the postgres superuser: via sudo when available, otherwise via su (when root).
set -euo pipefail
SQL="$(cd "$(dirname "$0")" && pwd)/db-setup.sql"
if command -v sudo >/dev/null 2>&1; then sudo -u postgres psql -v ON_ERROR_STOP=1 -q -f - < "$SQL"
else su postgres -c "psql -v ON_ERROR_STOP=1 -q -f -" < "$SQL"; fi
echo "databases ready: velora_dev, velora_test"
