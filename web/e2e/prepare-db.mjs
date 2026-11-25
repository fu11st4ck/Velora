// Creates (once) and resets the end-to-end database, applies migrations and seeds the demo
// organization. Runs before the API starts (see playwright.config.ts).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend');
const { Client } = createRequire(join(backend, 'package.json'))('pg');
const ownerUrl = process.env.E2E_OWNER_DATABASE_URL ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_e2e';
const adminUrl = process.env.E2E_ADMIN_DATABASE_URL ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/postgres';

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'velora_e2e'");
if (exists.rowCount === 0) await admin.query('CREATE DATABASE velora_e2e');
await admin.end();

const db = new Client({ connectionString: ownerUrl });
await db.connect();
await db.query('CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;');
await db.end();

const env = { ...process.env, DATABASE_URL: ownerUrl, DATABASE_MIGRATION_URL: ownerUrl };
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: backend, env, stdio: ['ignore', 'ignore', 'inherit'] });

const reset = new Client({ connectionString: ownerUrl });
await reset.connect();
await reset.query('TRUNCATE organizations, users CASCADE');
await reset.end();
execFileSync('npx', ['tsx', 'prisma/seed.ts'], {
  cwd: backend,
  env: { ...env, NODE_ENV: 'development', SEED_DEMO: 'true', SEED_PASSWORD: 'velora-demo-2026' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
