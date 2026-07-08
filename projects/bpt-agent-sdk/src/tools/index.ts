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
 *
 * Background-task name alignment (2026-07-08): TaskOutput / TaskStop are the
 * official 0.3.201 names for reading and stopping a background task. This SDK's
 * background tasks ARE background shells, so both delegate to the same
 * ShellManager as the legacy BashOutput / KillShell tools; all four ship during
 * the transition (the reproduced Bash / Monitor descriptions still steer the
 * model to BashOutput / KillShell). See src/tools/shells.ts.
 */

import type { BuiltinTool } from '../internal/contracts.js';
import { createReadTool, readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool, createBashTool } from './bash.js';
import type { JSONSchema, ReadLimits, SandboxContext } from '../types.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { webFetchTool } from './webfetch.js';
import { webSearchTool } from './websearch.js';
import { askUserQuestionTool } from './askuserquestion.js';
import { todoWriteTool } from './todo.js';
import { taskTools } from './task.js';
import { listMcpResourcesTool, readMcpResourceTool } from './resources.js';
import { bashOutputTool, killShellTool, taskOutputTool, taskStopTool } from './shells.js';
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
    taskOutputTool,
    taskStopTool,
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

/**
 * Lightweight, read-only view of a built-in tool's definition: just the
 * wire-facing metadata (name + description + input JSON Schema), with no
 * `execute` and no `readOnly`/`isFileEdit` policy flags. Field-identical to the
 * SDK MCP tool metadata (`{ name, description, inputJsonSchema }`) so a host can
 * feed built-in and MCP tools through ONE token-estimation / context-composition
 * path.
 */
export type BuiltinToolMetadata = {
  name: string;
  description: string;
  /** The tool's advertised input JSON Schema — the same object sent as the
   *  Messages API `tools[].input_schema` for this tool. */
  inputJsonSchema: JSONSchema;
};

/**
 * Enumerate the default built-in tools' definition metadata: a ZERO-SIDE-EFFECT,
 * read-only projection of createBuiltinTools(). It constructs the same tool set
 * and maps each entry to `{ name, description, inputJsonSchema }` — no `execute`
 * is ever called, no MCP server connects, no filesystem or network is touched
 * (construction is pure object assembly). Public, stable seam for a host that
 * needs the built-in tools' resident definition cost (their name+description+
 * schema, always present in the request `tools`) — e.g. a context-composition
 * breakdown that today can only estimate this block as a residual.
 *
 * `cfg` mirrors createBuiltinTools so the enumerated set matches what a given
 * host would actually run:
 *  - `env` selects the task surface (`CLAUDE_CODE_ENABLE_TASKS=0` -> TodoWrite
 *    instead of the Task quartet), changing which tools appear;
 *  - `sandbox` swaps Bash's description + schema for the sandbox-aware form;
 *  - `readLimits` is accepted for signature parity (it changes Read's runtime
 *    limits, not its advertised name/description/schema).
 * Absent `env` falls back to process.env (same default as createBuiltinTools).
 *
 * The `inputJsonSchema` field name (not `inputSchema`) matches the SDK MCP tool
 * metadata shape so both tool kinds estimate through the same host code path.
 */
export function enumerateBuiltinToolMetadata(cfg?: {
  sandbox?: SandboxContext;
  env?: Record<string, string | undefined>;
  readLimits?: ReadLimits;
}): BuiltinToolMetadata[] {
  return [...createBuiltinTools(cfg).values()].map((t) => ({
    name: t.name,
    description: t.description,
    inputJsonSchema: t.inputSchema,
  }));
}
