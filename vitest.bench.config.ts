import { defineConfig } from 'vitest/config';

// Long-running performance and stability checks, kept out of `npm test`.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
