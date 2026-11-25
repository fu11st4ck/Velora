# The web app, built and served by Caddy together with the reverse proxy for the API.
# Not built in the development workspace (no Docker daemon there); verified by the CI job "stack".
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm 11: npm 10's resolver crashes on this dependency set (see web/README.md).
RUN npx -y npm@11.6.2 ci
COPY . .
RUN npx ng build --configuration production

FROM caddy:2
COPY --from=build /app/dist/velora-web/browser /srv
# The Caddyfile is mounted from deploy/ (see deploy/docker-compose.yml).
