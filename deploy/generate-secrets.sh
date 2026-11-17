#!/usr/bin/env bash
# Prints fresh values for deploy/.env: three database passwords and the token-signing key pair.
# Nothing is written anywhere; copy the lines into .env.   Needs: openssl
set -euo pipefail
password() { openssl rand -hex 24; }
one_line() { awk 'BEGIN { ORS = "\\n" } { print }'; }

key="$(openssl genpkey -algorithm ed25519)"
echo "POSTGRES_SUPERUSER_PASSWORD=$(password)"
echo "VELORA_OWNER_PASSWORD=$(password)"
echo "VELORA_APP_PASSWORD=$(password)"
echo "JWT_PRIVATE_KEY=$(printf '%s\n' "$key" | one_line)"
echo "JWT_PUBLIC_KEY=$(printf '%s\n' "$key" | openssl pkey -pubout | one_line)"
