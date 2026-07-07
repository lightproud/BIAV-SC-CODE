/**
 * i18n-zh structural guard for the auxiliary generator prompts (Phase 2 batch B,
 * keeper ruling B 2026-07-08): the hook-condition evaluators, the adversarial
 * verifier prompt, and the subagent framing prompts are translated to Chinese
 * in-place. These drive PARSED structured output, so the guard asserts two
 * things: the instructional prose is actually Chinese and emoji-free, AND the
 * output-contract tokens a parser matches on (JSON keys, verdict enums, tool
 * names) survive translation verbatim. VERIFY_KEEP_RULE is intentionally NOT
 * here — it is a doc/anchor constant, never sent to the model, still English.
 */

import { describe, expect, it } from 'vitest';

import { HOOK_CONDITION_SYSTEM, HOOK_STOP_CONDITION_SYSTEM } from '../src/hooks/condition.js';
import {
  THREE_STATE_VERDICT_DEFINITIONS,
  RECALL_BIAS_GUIDANCE,
  VERIFY_VERDICT_SYSTEM,
} from '../src/verifier/prompts.js';
import { GENERAL_PURPOSE_PROMPT, WORKER_FORK_FRAMING } from '../src/subagents/agents.js';

const CJK = /[一-鿿]/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

// [displayName, prompt, output-contract tokens that MUST survive translation]
const TRANSLATED: Array<[string, string, string[]]> = [
  ['HOOK_CONDITION_SYSTEM', HOOK_CONDITION_SYSTEM, ['"ok"', '"reason"', 'true', 'false', 'JSON']],
  [
    'HOOK_STOP_CONDITION_SYSTEM',
    HOOK_STOP_CONDITION_SYSTEM,
    ['"ok"', '"reason"', '"impossible"', 'true', 'false', 'JSON'],
  ],
  ['THREE_STATE_VERDICT_DEFINITIONS', THREE_STATE_VERDICT_DEFINITIONS, ['CONFIRMED', 'PLAUSIBLE', 'REFUTED']],
  ['RECALL_BIAS_GUIDANCE', RECALL_BIAS_GUIDANCE, ['PLAUSIBLE', 'REFUTED', 'nil/undefined', 'diff']],
  [
    'VERIFY_VERDICT_SYSTEM',
    VERIFY_VERDICT_SYSTEM,
    ['CONFIRMED', 'PLAUSIBLE', 'REFUTED', '"verdict"', '"quote"', '"rationale"', '"confirms"', 'JSON'],
  ],
  ['GENERAL_PURPOSE_PROMPT', GENERAL_PURPOSE_PROMPT, ['Read', '*.md', 'README']],
  ['WORKER_FORK_FRAMING', WORKER_FORK_FRAMING, ['Agent', 'worker fork']],
];

describe('auxiliary generator prompts i18n-zh (Phase 2 batch B)', () => {
  it.each(TRANSLATED)(
    '%s is non-empty Chinese, emoji-free, and keeps its output-contract tokens',
    (name, prompt, tokens) => {
      expect(prompt.length, name).toBeGreaterThan(0);
      expect(CJK.test(prompt), `${name} must be Chinese`).toBe(true);
      expect(EMOJI.test(prompt), `${name} must carry no emoji`).toBe(false);
      for (const t of tokens) {
        expect(prompt.includes(t), `${name} must preserve output-contract token "${t}"`).toBe(true);
      }
    },
  );

  it('the assembled verifier system prompt embeds its three verdict states and JSON keys', () => {
    // Belt-and-suspenders: the parser (parseVerdict) matches on these, so a
    // dropped enum/JSON key would silently break the review flow.
    for (const tok of ['CONFIRMED', 'PLAUSIBLE', 'REFUTED', '"verdict"']) {
      expect(VERIFY_VERDICT_SYSTEM).toContain(tok);
    }
  });
});
