/**
 * Tool-parity backstop (audit 2026-07-15): pins the shipped default-builtin
 * set so adding or removing a tool reds this test until docs/TOOL-PARITY.md is
 * updated. This is the mechanism that would have caught the MultiEdit /
 * EnterPlanMode / ReadMcpResourceDirTool gaps. Agent and ToolSearch are shipped
 * conditionally/deferred (not via createBuiltinTools) and are asserted
 * separately.
 */

import { describe, expect, it } from 'vitest';

import { createBuiltinTools } from '../src/tools/index.js';
import { createAgentTool } from '../src/subagents/agent-tool.js';
import { TOOL_SEARCH_NAME } from '../src/tools/toolsearch.js';

/** Default env (no CLAUDE_CODE_ENABLE_TASKS override) → the Task-tool family, not TodoWrite. */
const EXPECTED_DEFAULT = [
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'KillShell',
  'ListMcpResourcesTool',
  'Monitor',
  'MultiEdit',
  'Read',
  'ReadMcpResourceDirTool',
  'ReadMcpResourceTool',
  'SendMessage',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'WebFetch',
  'WebSearch',
  'Workflow',
  'Write',
].sort();

describe('tool-parity backstop', () => {
  it('the default built-in set exactly matches the ledger (update docs/TOOL-PARITY.md on change)', () => {
    const names = [...createBuiltinTools({ env: {} }).keys()].sort();
    expect(names).toEqual(EXPECTED_DEFAULT);
  });

  it('legacy TodoWrite swaps in for the Task-tool family under CLAUDE_CODE_ENABLE_TASKS=0', () => {
    const names = new Set(createBuiltinTools({ env: { CLAUDE_CODE_ENABLE_TASKS: '0' } }).keys());
    expect(names.has('TodoWrite')).toBe(true);
    for (const t of ['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList']) {
      expect(names.has(t), t).toBe(false);
    }
  });

  it('Agent and ToolSearch ship conditionally/deferred (outside createBuiltinTools)', () => {
    const defaults = new Set(createBuiltinTools({ env: {} }).keys());
    expect(defaults.has('Agent')).toBe(false);
    expect(defaults.has(TOOL_SEARCH_NAME)).toBe(false);
    // But they are real, shipped tools registered elsewhere.
    expect(createAgentTool([]).name).toBe('Agent');
    expect(TOOL_SEARCH_NAME).toBe('ToolSearch');
  });
});
