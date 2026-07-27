import { defineConfig } from 'vitest/config';

/**
 * Strip the `#!/usr/bin/env node` line from `.mjs` sources the suite imports.
 *
 * tests/check-mutation-ratchet.test.ts imports the guard script for its pure
 * helpers. On Linux that import resolves through Node's own ESM loader, which
 * strips the shebang; on Windows the 2026-07-26 platform probe had every such
 * import die at the import line with `SyntaxError: Invalid or unexpected
 * token` — the `#` reaching a JS parser verbatim. Twin of the agent SDK's
 * plugin (same reason, same fix).
 *
 * Stripping here rather than deleting the shebang keeps the guard directly
 * executable (`./scripts/check-mutation-ratchet.mjs`). Line count is preserved
 * (the shebang becomes an empty line) so stack traces stay accurate.
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
  },
});
