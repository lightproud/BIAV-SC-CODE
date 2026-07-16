import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // The suite's mock-HTTP tests stub the GLOBAL fetch, so they pin the
    // pre-v0.45 'fetch' client here (transports constructed without an
    // explicit env read process.env). The default 'node' client (the
    // keep-alive adapter) gets its own dedicated coverage: its unit tests
    // and the emulator e2e's httpClient:'node' runs.
    env: { BPT_HTTP_CLIENT: 'fetch' },
  },
});
