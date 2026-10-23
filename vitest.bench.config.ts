import { defineConfig } from 'vitest/config';

// Long-running performance and stability checks, kept out of `npm test`.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.test.ts'],
    environment: 'node',
    // The balance bot plays 36 long games per mode.
    testTimeout: 2_400_000,
  },
});
