#!/usr/bin/env bash
# Runs on the server, started over SSH by the GitLab CI job `deploy` after a merge into main.
# The job first copies this directory's files here (never .env or backups/).
#
#   printf '%s' "$REGISTRY_PASSWORD" | ./ci-deploy.sh API_IMAGE WEB_IMAGE REGISTRY REGISTRY_USER
#
# Points .env at the new images, pulls them, backs up the database, then starts the new release
# (migrations first, as always) and checks the data. Any failure stops the deploy with a non-zero exit.
set -euo pipefail
cd "$(dirname "$0")"
api_image="$1" web_image="$2" registry="$3" registry_user="$4"

if [ ! -f .env ]; then
  echo "No .env in $PWD. Create it once, by hand, as in README.md §2 (cp .env.example .env," >&2
  echo "./generate-secrets.sh, set DOMAIN and the mail settings), then run the deploy job again." >&2
  exit 1
fi

# Sets KEY=VALUE in .env, replacing an existing line or adding one. Values here contain no '#'.
set_env() {
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}

# The job token piped in on stdin is valid only while the job runs; nothing is stored on the server
# after the logout below.
docker login -u "$registry_user" --password-stdin "$registry"
trap 'docker logout "$registry" >/dev/null 2>&1 || true' EXIT

set_env COMPOSE_FILE docker-compose.yml:docker-compose.registry.yml
set_env VELORA_API_IMAGE "$api_image"
set_env VELORA_WEB_IMAGE "$web_image"
docker compose pull migrate api caddy

if [ -n "$(docker compose ps -q postgres)" ]; then
  ./backup.sh
else
  echo "First start: no database to back up yet."
fi

docker compose up -d --wait --wait-timeout 300 --remove-orphans
docker compose exec -T api node dist/maintenance/cli.js check
docker image prune -f >/dev/null
echo "Deployed $api_image and $web_image."
