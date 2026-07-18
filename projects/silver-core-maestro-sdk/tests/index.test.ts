import { describe, it, expect } from 'vitest';
import { MAESTRO_SDK_VERSION } from '../src/index.js';

describe('silver-core-maestro-sdk phase-0 shell', () => {
  it('exports its own version constant, mirroring package.json', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(MAESTRO_SDK_VERSION).toBe(pkg.default.version);
  });
});
