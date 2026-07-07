/**
 * Faithful tool-description reproductions: fidelity markers + the red line that
 * no description may reference a tool/capability this SDK does not ship.
 */

import { describe, expect, it } from 'vitest';
import * as D from '../src/tools/descriptions.js';
import { createBuiltinTools } from '../src/tools/index.js';

const ALL = [
  D.BASH_DESCRIPTION,
  D.READ_DESCRIPTION,
  D.EDIT_DESCRIPTION,
  D.WRITE_DESCRIPTION,
  D.GREP_DESCRIPTION,
  D.GLOB_DESCRIPTION,
  D.TODOWRITE_DESCRIPTION,
  D.TASKCREATE_DESCRIPTION,
  D.TASKGET_DESCRIPTION,
  D.TASKUPDATE_DESCRIPTION,
  D.TASKLIST_DESCRIPTION,
  D.WEBFETCH_DESCRIPTION,
  D.WEBSEARCH_DESCRIPTION,
  D.ASKUSERQUESTION_DESCRIPTION,
  D.EXITPLANMODE_DESCRIPTION,
  D.ENTERWORKTREE_DESCRIPTION,
  D.MONITOR_DESCRIPTION,
  D.WORKFLOW_DESCRIPTION,
];

describe('faithful tool descriptions', () => {
  it('reproduce official signature phrasing', () => {
    expect(D.BASH_DESCRIPTION).toContain('Executes a given bash command');
    // dedicated-tools-over-bash redirects reference only shipped tools
    expect(D.BASH_DESCRIPTION).toMatch(/BashOutput/);
    expect(D.BASH_DESCRIPTION).toMatch(/KillShell/);
    // (The English-size heuristic on TODOWRITE_DESCRIPTION was retired in the
    //  i18n-zh campaign — TodoWrite is now Chinese, ~compact, and its adequacy
    //  is asserted structurally in tool-descriptions-i18n-zh.test.ts.)
    // old_string is a preserved wire token, so it survives Edit's translation.
    expect(D.EDIT_DESCRIPTION).toContain('old_string');
  });

  it('are substantially richer than a terse stub (fidelity implies size)', () => {
    // Bash is the largest official description; ours reproduces it faithfully.
    expect(D.BASH_DESCRIPTION.length).toBeGreaterThan(4000);
  });

  it('RED LINE: never reference a tool or capability this SDK does not ship', () => {
    const forbidden = [
      'NotebookEdit',
      'MultiEdit',
      // 'ExitPlanMode' removed 2026-07-05 (B4b): the tool now ships.
      'ExitWorktree',
      'TaskStop',
      'PowerShell',
      'SlashCommand',
      'computer use',
      'sandbox',
    ];
    for (const desc of ALL) {
      for (const bad of forbidden) {
        expect(desc).not.toContain(bad);
      }
      // 'Workflow' check removed 2026-07-05 (B4c): the Workflow tool now ships
      // (src/tools/workflow.ts) so descriptions may legitimately reference it.
      // "Task tool" / "Agent tool" must not appear (subagents aren't a shipped tool)
      expect(desc).not.toMatch(/\bTask tool\b/);
      expect(desc).not.toMatch(/\bAgent tool\b/);
    }
  });

  it('Workflow description states the honest synchronous adaptation and the shipped caps', () => {
    // The official tool is async (task-notification delivery); ours runs the
    // workflow synchronously inside the tool call — the description must say
    // so and must not promise the unshipped async machinery. Prose is now
    // Chinese (i18n-zh batch 4): the honest-adaptation intent is asserted
    // against the translated wording; code/number tokens stay verbatim.
    expect(D.WORKFLOW_DESCRIPTION).toContain('在工具调用内**同步**运行');
    expect(D.WORKFLOW_DESCRIPTION).not.toContain('task-notification');
    expect(D.WORKFLOW_DESCRIPTION).not.toContain('/workflows to watch');
    // budget is honestly described as the null stub (no token-target channel).
    expect(D.WORKFLOW_DESCRIPTION).toContain('`budget.total` **永远为 null**');
    // Official caps are reproduced (the engine implements them); numbers verbatim.
    expect(D.WORKFLOW_DESCRIPTION).toContain('min(16, cpu 核数 - 2)');
    expect(D.WORKFLOW_DESCRIPTION).toContain('上限为 1000');
    expect(D.WORKFLOW_DESCRIPTION).toContain('4096 个条目');
  });

  it('are actually wired onto the built-in tools', () => {
    const tools = createBuiltinTools({ env: {} });
    // Bash is byte-identical to the base description everywhere except win32,
    // where the gated platform note is appended (see createBashTool).
    const expectedBash =
      process.platform === 'win32'
        ? D.BASH_DESCRIPTION + '\n\n' + D.BASH_WIN32_NOTE
        : D.BASH_DESCRIPTION;
    expect(tools.get('Bash')?.description).toBe(expectedBash);
    expect(tools.get('Grep')?.description).toBe(D.GREP_DESCRIPTION);
    // Task quartet is the default task surface (TodoWrite off by default) ...
    expect(tools.get('TaskCreate')?.description).toBe(D.TASKCREATE_DESCRIPTION);
    expect(tools.get('TaskList')?.description).toBe(D.TASKLIST_DESCRIPTION);
    expect(tools.has('TodoWrite')).toBe(false);
    // ... TodoWrite stays wired behind the official revert gate.
    const legacy = createBuiltinTools({ env: { CLAUDE_CODE_ENABLE_TASKS: '0' } });
    expect(legacy.get('TodoWrite')?.description).toBe(D.TODOWRITE_DESCRIPTION);
    // B4b batch: the three new tools ship by default with their descriptions.
    expect(tools.get('Monitor')?.description).toBe(D.MONITOR_DESCRIPTION);
    expect(tools.get('ExitPlanMode')?.description).toBe(D.EXITPLANMODE_DESCRIPTION);
    expect(tools.get('EnterWorktree')?.description).toBe(D.ENTERWORKTREE_DESCRIPTION);
    // B4c batch: Workflow ships by default with its description.
    expect(tools.get('Workflow')?.description).toBe(D.WORKFLOW_DESCRIPTION);
  });
});
