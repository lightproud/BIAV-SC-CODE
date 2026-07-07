/**
 * i18n-zh structural guard for the small generator + context-tip prompts (Phase
 * 2 batch C, keeper ruling B 2026-07-08): the session-title / title+branch /
 * session-name / away-summary / memory-files generators and the two context-tip
 * prompts are translated to Chinese in-place. These drive PARSED output and
 * few-shot demonstrations, so the guard asserts the instructional prose is
 * Chinese + emoji-free while the output-contract tokens (JSON keys, enum values,
 * placeholders, `claude/` branch prefix) survive verbatim. The two big
 * classifiers (command-prefix, background-state) are a later batch and stay
 * English — they are intentionally NOT covered here.
 */

import { describe, expect, it } from 'vitest';

import {
  SESSION_TITLE_SYSTEM,
  TITLE_AND_BRANCH_SYSTEM,
  SESSION_NAME_SYSTEM,
  AWAY_SUMMARY_SYSTEM,
  MEMORY_FILES_SYSTEM,
  MEMORY_FILES_OUTPUT_CONTRACT,
} from '../src/generators/prompts.js';
import {
  CONTEXT_TIP_SELECTOR_SYSTEM,
  CONTEXT_TIP_SELECTOR_OUTPUT_CONTRACT,
  TIP_RECEPTION_SYSTEM,
  TIP_RECEPTION_OUTPUT_CONTRACT,
} from '../src/tips/prompts.js';

const CJK = /[一-鿿]/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

// [displayName, prompt, output-contract tokens that MUST survive translation]
const TRANSLATED: Array<[string, string, string[]]> = [
  ['SESSION_TITLE_SYSTEM', SESSION_TITLE_SYSTEM, ['<session>', '"title"', 'JSON']],
  ['TITLE_AND_BRANCH_SYSTEM', TITLE_AND_BRANCH_SYSTEM, ['"title"', '"branch"', 'claude/', '{description}', '<description>']],
  ['SESSION_NAME_SYSTEM', SESSION_NAME_SYSTEM, ['kebab-case', '"name"', 'JSON']],
  ['AWAY_SUMMARY_SYSTEM', AWAY_SUMMARY_SYSTEM, ['markdown']],
  ['MEMORY_FILES_SYSTEM', MEMORY_FILES_SYSTEM, ['[user]', '[project]', 'Claude Code']],
  ['MEMORY_FILES_OUTPUT_CONTRACT', MEMORY_FILES_OUTPUT_CONTRACT, ['JSON', '[]']],
  [
    'CONTEXT_TIP_SELECTOR_SYSTEM',
    CONTEXT_TIP_SELECTOR_SYSTEM,
    ['session_metadata', 'eligible_ids', 'ineligible_ids', 'feature_id', 'numStartups', 'MCP', '{situations}'],
  ],
  ['CONTEXT_TIP_SELECTOR_OUTPUT_CONTRACT', CONTEXT_TIP_SELECTOR_OUTPUT_CONTRACT, ['has_tip', 'feature_id', 'action', 'JSON']],
  [
    'TIP_RECEPTION_SYSTEM',
    TIP_RECEPTION_SYSTEM,
    ['acted_on', 'reception', 'positive', 'neutral', 'negative', 'unknown'],
  ],
  ['TIP_RECEPTION_OUTPUT_CONTRACT', TIP_RECEPTION_OUTPUT_CONTRACT, ['acted_on', 'reception', 'JSON']],
];

describe('generator + tip prompts i18n-zh (Phase 2 batch C)', () => {
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
});
