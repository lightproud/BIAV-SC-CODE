/**
 * System wire-field derivation (audit 2026-07-10 P2-2, scoped landing).
 *
 * The system prompt reaches the wire through a FOUR-FIELD protocol on
 * EngineConfig (`systemPrompt` / `systemPromptSuffix` / `systemPromptBaseLen` /
 * `systemBlocks`) whose assembly lives in engine/config-builder.ts and whose
 * interpretation used to live inline in the loop — two sites coupled by a
 * fragile invariant (systemPromptBaseLen is a CHAR OFFSET into the stable
 * prompt; anything appended to the stable prompt must land AFTER `base` or
 * every derived block shifts). This module is the single interpretation
 * point: the loop calls deriveSystemField() and nothing else slices the
 * prompt. tests/system-field.test.ts pins the assembly<->derivation pairing
 * (build a config through buildEngineConfig, derive, assert block joins
 * reproduce the exact prompt), so a drift on either side turns red.
 *
 * Byte discipline: the outputs are IDENTICAL to the historical inline logic —
 * this is a relocation with a contract test, not a behavior change.
 */

import type { TextBlockParam } from '../types.js';
import type { EngineConfig } from '../internal/contracts.js';

export type DerivedSystemField = {
  /** The request `system` value (string, or split blocks when caching). */
  system: string | TextBlockParam[];
  /** The matching applyCacheControl systemBoundary for this shape. */
  boundary: 'first' | 'last' | 'dual' | 'preserve';
  /** True when caller-authored segment blocks were forwarded verbatim (the
   *  loop must then NOT add a message breakpoint — 4-cap budget). */
  callerBlocks: boolean;
};

/**
 * Derive the wire `system` field + cache boundary from the config's
 * system-prompt fields. Shapes:
 *  - Caller segments (config.systemBlocks): forwarded VERBATIM; the caller
 *    owns the blocks + their cache_control ('preserve').
 *  - Caching on + volatile suffix: [stable, cwd] split ('first'), upgraded to
 *    the three-block [base, project, cwd] dual split ('dual') when the stable
 *    prompt carries a valid base/tail boundary — the strict
 *    0 < baseLen < length guard degrades cleanly on a stale offset.
 *  - Otherwise: flat single string ('last'; suffix joined with '\n').
 *
 * audit r4 Z8-1: the volatile (cwd/env) block in the split/dual array carries a
 * leading '\n' so the wire bytes match the flat path exactly. The API
 * concatenates system text blocks with NO inter-block separator (which is why
 * base+tail reconstructs the stable prompt byte-for-byte), so without the '\n'
 * the split path produced `stable`+`suffix` (no gap) while the flat path
 * produced `stable\nsuffix` — toggling promptCaching silently changed the
 * system bytes the model saw. The '\n' lives inside the volatile block, so the
 * cached stable prefix (base/tail) is untouched.
 */
export function deriveSystemField(
  config: Pick<
    EngineConfig,
    'promptCaching' | 'systemPrompt' | 'systemPromptSuffix' | 'systemPromptBaseLen' | 'systemBlocks'
  >,
): DerivedSystemField {
  const cachingOn = config.promptCaching === true;
  const callerBlocks = config.systemBlocks;
  const hasSuffix =
    config.systemPromptSuffix !== undefined && config.systemPromptSuffix.length > 0;
  const splitSystem = cachingOn && hasSuffix && callerBlocks === undefined;
  const baseLen = config.systemPromptBaseLen;
  const hasProjectTail =
    baseLen !== undefined && baseLen > 0 && baseLen < config.systemPrompt.length;
  const dualSplit = splitSystem && hasProjectTail;
  const system: string | TextBlockParam[] =
    callerBlocks !== undefined
      ? callerBlocks
      : dualSplit
        ? [
            { type: 'text', text: config.systemPrompt.slice(0, baseLen) },
            { type: 'text', text: config.systemPrompt.slice(baseLen) },
            // audit r4 Z8-1: leading '\n' mirrors the flat-path join below.
            { type: 'text', text: `\n${config.systemPromptSuffix as string}` },
          ]
        : splitSystem
          ? [
              { type: 'text', text: config.systemPrompt },
              // audit r4 Z8-1: leading '\n' mirrors the flat-path join below.
              { type: 'text', text: `\n${config.systemPromptSuffix as string}` },
            ]
          : hasSuffix
            ? `${config.systemPrompt}\n${config.systemPromptSuffix}`
            : config.systemPrompt;
  const boundary =
    callerBlocks !== undefined
      ? ('preserve' as const)
      : dualSplit
        ? ('dual' as const)
        : splitSystem
          ? ('first' as const)
          : ('last' as const);
  return { system, boundary, callerBlocks: callerBlocks !== undefined };
}
