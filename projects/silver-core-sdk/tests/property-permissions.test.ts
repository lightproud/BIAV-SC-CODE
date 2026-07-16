/**
 * Property tests: permission gate partial order (src/permissions/gate.ts).
 *
 * The gate's documented 9-step contract implies invariants that must hold for
 * EVERY combination of rules, mode and input - not just the enumerated cases:
 *  P1 DENY DOMINANCE (metamorphic) - if a config's deny rules alone deny a
 *     call (probed via a bypassPermissions gate with only those deny rules),
 *     then NO addition of allow rules, mode choice, or always-allow
 *     canUseTool handler may flip it to allow. deny > ask > allow, always.
 *  P2 NO SILENT ALLOW - mode 'default', non-read-only call, no matching
 *     allow rule: the call must route to canUseTool (ask), never auto-allow;
 *     with a denying handler the outcome is deny and the handler WAS asked.
 *  P3 READ-ONLY AUTO-ALLOW STAYS QUIET - mode 'default', read-only call, no
 *     deny match: allowed WITHOUT consulting canUseTool.
 *  P4 TOTALITY - arbitrary junk rule strings never crash the gate; every
 *     check settles to a decision.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DefaultPermissionGate } from '../src/permissions/gate.js';

const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'mcp__demo__shout'] as const;
const SPECS = ['git:*', 'rm:*', 'npm:*', '*', 'git status', '/etc/*', 'https://*'] as const;
const SEGMENTS = ['git status', 'git log', 'rm -rf /tmp/x', 'npm ci', 'ls -la', 'echo hi'] as const;
const JOINERS = [' && ', ' ; ', ' || ', ' | '] as const;
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk'] as const;

const ruleArb = fc
  .tuple(fc.constantFrom(...TOOLS), fc.option(fc.constantFrom(...SPECS), { nil: undefined }))
  .map(([tool, spec]) => (spec === undefined ? tool : `${tool}(${spec})`));

const bashInputArb = fc
  .array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 3 })
  .chain((segs) =>
    fc.constantFrom(...JOINERS).map((j) => ({ command: segs.join(j) })),
  );

const callArb = fc.oneof(
  fc.record({ toolName: fc.constant<string>('Bash'), input: bashInputArb }),
  fc
    .tuple(
      fc.constantFrom<string>('Read', 'Write', 'Edit'),
      fc.constantFrom('/tmp/a.txt', '/etc/passwd', 'rel/path.md'),
    )
    .map(([toolName, p]) => ({ toolName, input: { file_path: p } as Record<string, unknown> })),
  fc
    .constantFrom('https://example.com', 'http://10.0.0.1/x')
    .map((url) => ({ toolName: 'WebFetch', input: { url } as Record<string, unknown> })),
);

function checkOpts(readOnly: boolean) {
  return {
    toolUseID: 'tu_prop',
    signal: new AbortController().signal,
    readOnly,
    isFileEdit: false,
  };
}

function makeGate(cfg: {
  mode?: (typeof MODES)[number];
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: ConstructorParameters<typeof DefaultPermissionGate>[0]['canUseTool'];
}) {
  return new DefaultPermissionGate({ debug: () => {}, ...cfg });
}

describe('permission gate properties (fast-check)', () => {
  it('P1: a deny-rule match can never be widened by allow rules, mode, or an allowing canUseTool', async () => {
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.array(ruleArb, { maxLength: 4 }),
        fc.array(ruleArb, { minLength: 1, maxLength: 4 }),
        fc.constantFrom(...MODES),
        fc.boolean(),
        async (call, allow, deny, mode, readOnly) => {
          // Probe: does the deny set alone (bypass mode allows everything else)
          // deny this call?
          const probe = makeGate({ mode: 'bypassPermissions', disallowedTools: deny });
          const probeRes = await probe.check(call.toolName, call.input, checkOpts(readOnly));
          fc.pre(probeRes.decision === 'deny');

          // Full gate: allow rules + arbitrary mode + an always-allow handler.
          const gate = makeGate({
            mode,
            allowedTools: allow,
            disallowedTools: deny,
            canUseTool: async (_t, input) => ({ behavior: 'allow', updatedInput: input }),
          });
          const res = await gate.check(call.toolName, call.input, checkOpts(readOnly));
          expect(res.decision).toBe('deny');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('P2: default mode + non-read-only + no allow rule always consults canUseTool (no silent allow)', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, async (call) => {
        // No deny rules; probe that nothing auto-allows: empty allow set.
        let asked = 0;
        const gate = makeGate({
          mode: 'default',
          canUseTool: async (_t, _input) => {
            asked += 1;
            return { behavior: 'deny', message: 'property probe denies' };
          },
        });
        const res = await gate.check(call.toolName, call.input, checkOpts(false));
        expect(asked).toBe(1);
        expect(res.decision).toBe('deny');
      }),
      { numRuns: 120 },
    );
  });

  it('P3: default mode + read-only + no deny match auto-allows without consulting canUseTool', async () => {
    await fc.assert(
      fc.asyncProperty(callArb, async (call) => {
        let asked = 0;
        const gate = makeGate({
          mode: 'default',
          canUseTool: async (_t, input) => {
            asked += 1;
            return { behavior: 'allow', updatedInput: input };
          },
        });
        const res = await gate.check(call.toolName, call.input, checkOpts(true));
        expect(res.decision).toBe('allow');
        expect(asked).toBe(0);
      }),
      { numRuns: 120 },
    );
  });

  it('P4: totality - junk rule strings never crash the gate and every check settles', async () => {
    const junkRule = fc.oneof(
      ruleArb,
      fc.string({ maxLength: 24 }),
      fc.constantFrom('Bash(', ')', 'Bash()', '(*)', 'Bash((x))', 'Bash(a:b:c)', '  ', '中文工具(規則:*)'),
    );
    await fc.assert(
      fc.asyncProperty(
        callArb,
        fc.array(junkRule, { maxLength: 4 }),
        fc.array(junkRule, { maxLength: 4 }),
        fc.constantFrom(...MODES),
        fc.boolean(),
        async (call, allow, deny, mode, readOnly) => {
          const gate = makeGate({ mode, allowedTools: allow, disallowedTools: deny });
          const res = await gate.check(call.toolName, call.input, checkOpts(readOnly));
          expect(['allow', 'deny']).toContain(res.decision);
        },
      ),
      { numRuns: 300 },
    );
  });
});
