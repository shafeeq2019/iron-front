import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@iron/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) } },
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts', 'client/test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
