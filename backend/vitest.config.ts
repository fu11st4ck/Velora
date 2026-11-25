import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one PostgreSQL database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://velora_app:velora_app_dev@localhost:5432/velora_test',
      TEST_OWNER_DATABASE_URL:
        process.env.TEST_OWNER_DATABASE_URL ?? 'postgresql://velora_owner:velora_owner_dev@localhost:5432/velora_test',
      APP_BASE_URL: 'http://localhost:4200',
      RATE_LIMIT_PER_MINUTE: '100000',
      AUTH_RATE_LIMIT_PER_15_MIN: '100000',
    },
  },
  // Nest relies on decorator metadata, which esbuild does not emit.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
