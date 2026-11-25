/** Shared settings for the end-to-end run: its own database and ports, so it never touches development data. */
export const E2E = {
  webPort: 4300,
  apiPort: 3100,
  smtpPort: 2525,
  database: 'velora_e2e',
  ownerUrl: process.env['E2E_OWNER_DATABASE_URL'] ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_e2e',
  appUrl: process.env['E2E_DATABASE_URL'] ?? 'postgresql://velora_app:velora_app_dev@localhost:5432/velora_e2e',
  adminUrl: process.env['E2E_ADMIN_DATABASE_URL'] ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/postgres',
  /** Demo accounts created by backend/prisma/seed.ts. */
  password: 'velora-demo-2026',
  owner: 'owner@velora.example',
  manager: 'manager@velora.example',
  sales: 'ahmed@velora.example',
  /** Owner of a second organization (e2e/prepare-db.mjs), for data-isolation tests. */
  otherOwner: 'owner@other.example',
  otherPassword: 'second-business-2026',
  /** Short, so token expiry can be exercised in a test (the API's minimum). */
  accessTokenSeconds: 60,
} as const;
