import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['/tmp/claude-0/-home-user-BIAV-SC-CODE/93f8283e-4d62-5e63-a9ec-a1c6ef71b7b1/scratchpad/probe/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    env: { BPT_HTTP_CLIENT: 'fetch' },
  },
});
