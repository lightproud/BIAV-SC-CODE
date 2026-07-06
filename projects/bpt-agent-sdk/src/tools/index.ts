/**
 * Built-in tool registry, keyed by public tool names.
 *
 * Task tracking (official 0.3.142 semantics): the TaskCreate / TaskGet /
 * TaskUpdate / TaskList quartet is the DEFAULT task surface and TodoWrite is
 * disabled by default. The official revert gate is the environment variable
 * `CLAUDE_CODE_ENABLE_TASKS=0` ("set CLAUDE_CODE_ENABLE_TASKS=0 to revert to
 * TodoWrite" — TS reference, 0.3.201 docs snapshot); when set, TodoWrite is
 * registered and the Task tools are not. The two surfaces are mutually
 * exclusive, mirroring the official toolset.
 *
 * B4b batch: Monitor / ExitPlanMode / EnterWorktree are registered by default
 * (all three are in the official built-in toolset and input/output unions).
 * Monitor is an honest command-source subset over the shell registry (see
 * monitor.ts); ExitPlanMode flips the plan permission mode via the optional
 * ToolContext.permissionGate bridge (see exitplanmode.ts); EnterWorktree
 * creates/enters git worktrees via src/internal/worktree.ts.
 *
 * B4c batch: Workflow is registered by default (in the official built-in
 * toolset and input/output unions as of Agent SDK 0.3.149). It runs workflow
 * scripts synchronously over the subagent runtime (agent() needs
 * ctx.spawnSubagent, wired inside query(); a zero-agent script still runs
 * bare). See src/tools/workflow.ts + src/internal/workflow-engine.ts.
 */

import type { BuiltinTool } from '../internal/contracts.js';
import { createReadTool, readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool, createBashTool } from './bash.js';
import type { ReadLimits, SandboxContext } from '../types.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { webFetchTool } from './webfetch.js';
import { webSearchTool } from './websearch.js';
import { askUserQuestionTool } from './askuserquestion.js';
import { todoWriteTool } from './todo.js';
import { taskTools } from './task.js';
import { listMcpResourcesTool, readMcpResourceTool } from './resources.js';
import { bashOutputTool, killShellTool } from './shells.js';
import { monitorTool } from './monitor.js';
import { exitPlanModeTool } from './exitplanmode.js';
import { enterWorktreeTool } from './enterworktree.js';
import { workflowTool } from './workflow.js';

/** Fresh Map per call so callers can filter without affecting others.
 *  When a sandbox is active (G-SANDBOX) the Bash tool is built with its
 *  sandbox-aware description + schema; absent, it is the byte-identical
 *  unsandboxed `bashTool`.
 *  `env` selects the task surface (CLAUDE_CODE_ENABLE_TASKS=0 reverts to
 *  TodoWrite); absent it falls back to process.env, so hosts that do not
 *  thread options.env still get the official env-var gate. */
export function createBuiltinTools(cfg?: {
  sandbox?: SandboxContext;
  env?: Record<string, string | undefined>;
  /** Read output limits (spec §E). Undefined -> the default-limits readTool. */
  readLimits?: ReadLimits;
}): Map<string, BuiltinTool> {
  const env = cfg?.env ?? process.env;
  const legacyTodo = env['CLAUDE_CODE_ENABLE_TASKS'] === '0';
  const tools: BuiltinTool[] = [
    cfg?.readLimits !== undefined ? createReadTool(cfg.readLimits) : readTool,
    writeTool,
    editTool,
    cfg?.sandbox !== undefined ? createBashTool(cfg.sandbox) : bashTool,
    bashOutputTool,
    killShellTool,
    monitorTool,
    globTool,
    grepTool,
    webFetchTool,
    webSearchTool,
    askUserQuestionTool,
    ...(legacyTodo ? [todoWriteTool] : taskTools),
    listMcpResourcesTool,
    readMcpResourceTool,
    exitPlanModeTool,
    enterWorktreeTool,
    workflowTool,
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
