/**
 * Census guard for the structured-output surface.
 *
 * Why a census and not a rule: "every tool must emit `structuredOutput`" would
 * be the wrong rule — several tools genuinely have no fact to report beyond the
 * sentence they already return, and forcing a shape onto them produces
 * typed-not-populated, the failure this whole line of work exists to undo.
 *
 * What actually goes wrong is SILENT growth. Four tools (Write, Edit,
 * TodoWrite, EnterWorktree) each declared an official-shaped output type and
 * never populated it, and nobody noticed for many versions because nothing was
 * counting. `scripts/type-parity.mjs` cannot catch this class either: it
 * compares DECLARED shapes and never asks whether anything emits them.
 *
 * So this pins the roster. A new tool that ships without a structured result
 * fails here and its author writes down why — the reason lands in the ledger
 * instead of in nobody's head.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tools');

/**
 * Tool modules that deliberately emit no `structuredOutput`, each with the
 * reason. Removing a name from here is how a tool graduates; adding one
 * requires stating why the tool has no machine-readable fact worth reporting.
 */
const NO_STRUCTURED_OUTPUT: Record<string, string> = {
  askuserquestion:
    'the answer map is official permission-component UI state; adjudicated unshipped (COMPAT.md)',
  enterplanmode: 'official declares no output type for this tool',
  exitplanmode:
    'official fields are its multi-agent approval chain (awaitingLeaderApproval / requestId)',
  monitor: "MonitorOutput.taskId is official's background-task id space; this Monitor is a subset",
  sendmessage: 'official declares no output type for this tool',
  task: 'the task-ledger quintet returns its rows as text; no official output shape diverges from it',
  workflow:
    "official's WorkflowOutput requires status:'async_launched'; emitting it would assert a launch this engine never made (open item, COMPAT.md)",
  // Not tools — module-level helpers that merely contain a `name:` literal.
  descriptions: 'not a tool module (description constants)',
  shells: 'declares BashOutput/KillShell/TaskOutput/TaskStop, whose facts ride the shell records',
  'workflow-engine': 'not a tool module (the sandboxed runner behind Workflow)',
};

function toolModules(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => readFileSync(join(TOOLS_DIR, f), 'utf8').includes("name: '"))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

function emitsStructuredOutput(mod: string): boolean {
  return readFileSync(join(TOOLS_DIR, `${mod}.ts`), 'utf8').includes('structuredOutput');
}

describe('structured-output census', () => {
  it('every non-emitting tool module is on the ledger with a stated reason', () => {
    const silent = toolModules().filter((m) => !emitsStructuredOutput(m));
    const unexplained = silent.filter((m) => !(m in NO_STRUCTURED_OUTPUT));
    expect(unexplained, `无理由的零产出工具：${unexplained.join(', ')}`).toEqual([]);
  });

  it('the ledger carries no stale entry', () => {
    // A tool that started emitting must LEAVE the ledger, or the ledger drifts
    // into a list of excuses for things that were fixed long ago.
    const stale = Object.keys(NO_STRUCTURED_OUTPUT)
      .filter((m) => toolModules().includes(m))
      .filter((m) => emitsStructuredOutput(m));
    expect(stale, `已产出却仍挂在豁免清单上：${stale.join(', ')}`).toEqual([]);
  });

  it('every reason is a real sentence, not a placeholder', () => {
    for (const [mod, reason] of Object.entries(NO_STRUCTURED_OUTPUT)) {
      expect(reason.length, `${mod} 的理由太短`).toBeGreaterThan(20);
    }
  });

  it('the four tools ruled in on 2026-07-27 do emit', () => {
    for (const mod of ['write', 'edit', 'todo', 'enterworktree']) {
      expect(emitsStructuredOutput(mod), `${mod} 应当产出结构化结果`).toBe(true);
    }
  });
});
