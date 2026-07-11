/**
 * Standing red-line guard: no reproduced prompt may reference a tool the SDK
 * does NOT ship. Reproducing a prompt that names an unshipped tool would
 * describe a capability that doesn't exist — the exact red line the v0.6 work
 * has been holding by hand. This test makes it mechanical: a denylist of
 * official-but-unshipped tool identifiers must never appear (as whole words) in
 * ANY reproduced prompt constant. A future contributor who pastes such a prompt
 * turns the build red.
 */

import { describe, expect, it } from 'vitest';

import { TOOL_DESCRIPTION_TEXT, BASH_SANDBOX_FRAGMENTS } from '../src/tools/descriptions.js';
import {
  MAIN_LOOP_INTRO,
  MAIN_LOOP_BODY,
  MEMORY_COMPACTION_FLUSH_PROMPT,
  MEMORY_PROTOCOL_FRAGMENT,
  MEMORY_SESSION_END_PROMPT,
} from '../src/engine/prompt-fragments.js';
import {
  AWAY_SUMMARY_SYSTEM,
  BACKGROUND_STATE_SYSTEM,
  COMMAND_PREFIX_SYSTEM,
  MEMORY_FILES_SYSTEM,
  SESSION_NAME_SYSTEM,
  SESSION_TITLE_SYSTEM,
  TITLE_AND_BRANCH_SYSTEM,
} from '../src/generators/prompts.js';
import { VERIFY_VERDICT_SYSTEM } from '../src/verifier/prompts.js';
import { CONTEXT_TIP_SELECTOR_SYSTEM, TIP_RECEPTION_SYSTEM } from '../src/tips/prompts.js';
import { HOOK_CONDITION_SYSTEM, HOOK_STOP_CONDITION_SYSTEM } from '../src/hooks/condition.js';
import {
  COORDINATOR_MODE_PROMPT,
  COORDINATOR_WORKER_INSTRUCTIONS,
  GENERAL_PURPOSE_PROMPT,
  WORKER_FORK_FRAMING,
} from '../src/subagents/agents.js';

/**
 * Official Claude Code tool identifiers this SDK deliberately does NOT ship.
 * PascalCase, whole-word, case-sensitive — these never appear as English prose,
 * so a match means a prompt is describing an unshipped capability. (Extend when
 * a new official tool is confirmed absent from this SDK.)
 */
const UNSHIPPED_TOOL_TOKENS = [
  'NotebookEdit',
  'NotebookRead',
  'MultiEdit',
  // 'ExitPlanMode' removed 2026-07-05 (B4b): the tool now ships (src/tools/exitplanmode.ts).
  'ExitWorktree',
  // 'TaskStop' removed 2026-07-08: the tool now ships (src/tools/shells.ts);
  // TaskOutput ships alongside it. Both are the official names for the
  // background-task read/stop surface.
  'SlashCommand',
  'WebFetchTool',
  'PowerShell',
];

/** Every reproduced prompt constant, labeled for a readable failure. */
const REPRODUCED: Array<[label: string, text: string]> = [
  ...Object.entries(TOOL_DESCRIPTION_TEXT).map(
    ([tool, text]) => [`tool-description:${tool}`, text] as [string, string],
  ),
  ...BASH_SANDBOX_FRAGMENTS.map((f) => [`sandbox-fragment:${f.id}`, f.text] as [string, string]),
  ['main-loop:intro', MAIN_LOOP_INTRO.text],
  ...MAIN_LOOP_BODY.map((f) => [`main-loop:${f.id}`, f.text] as [string, string]),
  // Memory mode-B protocol prompt (docs-verbatim; the `memory` tool it names
  // ships in src/tools/memory/ and the fragment is only injected when it does).
  ['memory:protocol', MEMORY_PROTOCOL_FRAGMENT.text],
  ['memory:compaction-flush', MEMORY_COMPACTION_FLUSH_PROMPT],
  ['memory:session-end', MEMORY_SESSION_END_PROMPT],
  ['generator:command-prefix', COMMAND_PREFIX_SYSTEM],
  ['generator:background-state', BACKGROUND_STATE_SYSTEM],
  ['generator:session-title', SESSION_TITLE_SYSTEM],
  ['generator:title-and-branch', TITLE_AND_BRANCH_SYSTEM],
  ['generator:session-name', SESSION_NAME_SYSTEM],
  ['generator:away-summary', AWAY_SUMMARY_SYSTEM],
  ['generator:memory-files', MEMORY_FILES_SYSTEM],
  ['verifier:verdict', VERIFY_VERDICT_SYSTEM],
  ['tips:selector', CONTEXT_TIP_SELECTOR_SYSTEM],
  ['tips:reception', TIP_RECEPTION_SYSTEM],
  ['hooks:condition', HOOK_CONDITION_SYSTEM],
  ['hooks:stop-condition', HOOK_STOP_CONDITION_SYSTEM],
  ['subagent:general-purpose', GENERAL_PURPOSE_PROMPT],
  ['subagent:worker-fork', WORKER_FORK_FRAMING],
  // O-B2: legal only because the SendMessage tool body ships in the same
  // batch — every tool these reference (Agent/SendMessage/TaskStop) exists.
  ['subagent:coordinator-mode', COORDINATOR_MODE_PROMPT],
  ['subagent:coordinator-worker', COORDINATOR_WORKER_INSTRUCTIONS],
];

describe('red-line: reproduced prompts never name an unshipped tool', () => {
  for (const token of UNSHIPPED_TOOL_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`);
    it(`no reproduced prompt references the unshipped tool "${token}"`, () => {
      const offenders = REPRODUCED.filter(([, text]) => re.test(text)).map(([label]) => label);
      expect(offenders, `"${token}" found in: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('covers every reproduced-prompt surface (guard is wired to real constants)', () => {
    // A cheap wiring check so the guard cannot silently cover nothing.
    expect(REPRODUCED.length).toBeGreaterThanOrEqual(20);
    for (const [label, text] of REPRODUCED) {
      expect(typeof text === 'string' && text.length > 0, label).toBe(true);
    }
  });
});
