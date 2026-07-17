/**
 * Model-aware thinking capability (root-cause fix, 2026-07-05 real-L5 finding).
 *
 * The Messages API `thinking` param has TWO on-forms that are NOT
 * interchangeable across model generations:
 *   - `{type:'adaptive'}` — the ONLY on-form on 4.6-generation-and-later models
 *     (Opus 4.6/4.7/4.8, Sonnet 4.6/5, Fable 5, Mythos 5, and newer). Sending
 *     `budget_tokens` to these models is REJECTED with a 400.
 *   - `{type:'enabled', budget_tokens:N}` — the on-form on pre-4.6 models
 *     (Haiku 4.5, Sonnet 4.5/4, Opus 4.5/4.1/4, and 3.x). Sending `adaptive` to
 *     these models is UNKNOWN and 400s.
 *
 * Because both directions 400 on the wrong tier, the engine must emit whichever
 * form the LIVE model accepts — it cannot pick one form unconditionally. E7-01
 * did exactly that (always `adaptive`), which 400'd every request on the
 * conformance harness's haiku-4.5 arm (run 28753349435: bpt 0/40, turns=0,
 * cost=$0, while the official arm ran fine). The keyless unit suite could not
 * catch it because it stubs the transport and never validates the thinking
 * block against a real endpoint.
 *
 * New models trend adaptive-only, so the boundary is a DENYLIST of the known
 * pre-adaptive families; any unmatched (newer/unknown) model defaults to
 * adaptive. When a new pre-adaptive model ever appears, add it here and the
 * regression test in thinking-model.test.ts locks the mapping.
 */

/** Pre-4.6 model families that reject `{type:'adaptive'}` and take budget_tokens.
 *  The `(?:opus|sonnet|haiku)-4(?!-?\d)` alternative catches the BARE family id
 *  (`claude-opus-4`, `claude-opus-4-v1:0`) without swallowing versioned ids —
 *  a digit after `-4` defers to the explicit minor-version alternatives, so
 *  4.6+ ids still fall through to adaptive. */
const PRE_ADAPTIVE_THINKING =
  /(haiku-4-5|sonnet-4-5|sonnet-4-0|sonnet-4-2|opus-4-5|opus-4-1|opus-4-0|opus-4-2|(?:opus|sonnet|haiku)-4(?!-?\d)|claude-3|claude-2|instant)/i;

/**
 * True when `model` accepts `{type:'adaptive'}` thinking (4.6-generation and
 * later). False for the known pre-adaptive families, which require
 * `{type:'enabled', budget_tokens}` instead.
 *
 * E7 (audit r2): provider spellings are normalized before the match — Vertex
 * ids separate the date with `@` (`claude-opus-4@20250514`) and some surfaces
 * use dots (`claude-4.5-...`); the hyphen-keyed denylist never matched those,
 * so a pre-adaptive model on Vertex fell through to adaptive and 400'd every
 * request (exactly the haiku-storm this module exists to prevent).
 */
export function supportsAdaptiveThinking(model: string): boolean {
  const normalized = model.toLowerCase().replace(/[@.]/g, '-');
  return !PRE_ADAPTIVE_THINKING.test(normalized);
}
