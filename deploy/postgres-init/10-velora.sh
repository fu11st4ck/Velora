#!/usr/bin/env bash
# Runs once, when the database volume is first created.
# Two roles: velora_owner owns the schema (migrations, maintenance); velora_app is what the API
# connects as — it cannot change the schema or bypass row-level security.
set -euo pipefail
: "${VELORA_OWNER_PASSWORD:?}" "${VELORA_APP_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username postgres \
     -v owner_password="$VELORA_OWNER_PASSWORD" -v app_password="$VELORA_APP_PASSWORD" <<'SQL'
CREATE ROLE velora_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE velora_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE velora OWNER velora_owner;
\c velora
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
REVOKE ALL ON DATABASE velora FROM PUBLIC;
GRANT CONNECT ON DATABASE velora TO velora_app;
SQL
