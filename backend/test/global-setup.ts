import { execSync } from 'node:child_process';

/** Brings the test database schema up to date once per run, as the owner role. */
export default function setup(): void {
  const url =
    process.env.TEST_OWNER_DATABASE_URL ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_test';
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
