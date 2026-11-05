import { defineConfig } from 'vitest/config';

// Test-only overrides. Everything else (S3 endpoint, credentials, Redis) comes from .env.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://clearshot:clearshot@localhost:5432/clearshot_test',
      QUEUE_PREFIX: 'bull-test',
      S3_BUCKET: 'clearshot-images-test',
      S3_AUTO_CREATE_BUCKET: 'true',
    },
  },
});
