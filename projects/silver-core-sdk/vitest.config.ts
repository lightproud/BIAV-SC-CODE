import { defineConfig } from 'vitest/config';

/**
 * Strip the `#!/usr/bin/env node` line from `.mjs` sources the suite imports.
 *
 * Four test files import a guard script from `scripts/` for its pure helpers
 * (check-version-bump, check-mutation-ratchet, check-eval-regression,
 * update-evals-manifest). On Linux those imports resolve to Node's own ESM
 * loader, which strips the shebang; on Windows the 2026-07-26 platform probe
 * had all four die at the import line with `SyntaxError: Invalid or unexpected
 * token` — the `#` reaching a JS parser verbatim.
 *
 * The correlation is exact and was the diagnosis: every imported `scripts/*.mjs`
 * WITH a shebang failed, and the only two WITHOUT one (eval-harnesses.mjs,
 * eval-scoring.mjs) passed.
 *
 * Stripping here rather than deleting the shebangs keeps the guards directly
 * executable (`./scripts/check-version-bump.mjs`) — the test harness is what
 * needed fixing, not the scripts. Line count is preserved (the shebang becomes
 * an empty line) so stack traces still point at the right source line.
 */
const stripMjsShebang = {
  name: 'silver-core-strip-mjs-shebang',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.mjs') || !code.startsWith('#!')) return null;
    return { code: code.replace(/^#![^\n]*/, ''), map: null };
  },
};

export default defineConfig({
  plugins: [stripMjsShebang],
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
