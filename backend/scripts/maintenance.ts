/**
 * Scheduled maintenance, run with the schema owner's connection:
 *   npm run maintenance -- check     verifies derived figures; exits 1 and lists what is wrong
 *   npm run maintenance -- purge     deletes expired idempotency records and tokens
 * Intended for a daily scheduler; `check` failing is an alert, never something to auto-repair.
 */
import { Client } from 'pg';
import { checkConsistency, purgeExpired } from '../src/maintenance/consistency';

async function main(): Promise<number> {
  const command = process.argv[2];
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL is not set.');
    return 2;
  }
  if (command !== 'check' && command !== 'purge') {
    console.error('Usage: maintenance <check|purge>');
    return 2;
  }
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    if (command === 'purge') {
      console.log(JSON.stringify({ purged: await purgeExpired((sql, values) => db.query(sql, values), new Date()) }));
      return 0;
    }
    const findings = await checkConsistency((sql) => db.query(sql));
    console.log(JSON.stringify({ consistent: findings.length === 0, findings }, null, 2));
    return findings.length === 0 ? 0 : 1;
  } finally {
    await db.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(2);
  },
);
