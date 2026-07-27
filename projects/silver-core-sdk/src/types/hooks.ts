/**
 * Silver Core SDK 公开类型面 — 钩子事件与输入输出。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'UserPromptSubmit'
  | 'MessageDisplay'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Notification'
  // NEW-IN-DOCS (live docs, above pins agent-sdk 0.3.199): six additional hook
  // events. All are typed-not-fired here — this SDK has no natural runtime hook
  // point for any of them (no Setup phase / agent-teams / Task four-piece /
  // settings engine / worktree lifecycle), so they are declared for drop-in
  // type compatibility only and never emitted. See each input type below.
  | 'Setup'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'ConfigChange'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  // BPT-EXTENSION (SCS-REQ-REPOS-01 §3 R2): structured budget event stream on
  // top of maxBudgetUsd. Root loop only; informational (aggregate hook outputs
  // carry no decision semantics for these events). Hosts subscribe instead of
  // polling result metrics.
  | 'budget:threshold'
  | 'budget:exhausted';

export type BaseHookInput = {
  session_id: string;
  cwd: string;
  hook_event_name: HookEvent;
  transcript_path?: string;
  agent_id?: string;
  agent_type?: string;
  /**
   * NEW-IN-DOCS: UUID of the user prompt currently being processed (matches the
   * OpenTelemetry `prompt.id`). Official requires Claude Code v2.1.196+; absent
   * until the first user input. typed-not-populated in this engine.
   */
  prompt_id?: string;
  /** NEW-IN-DOCS: active permission mode at hook time. typed-not-populated. */
  permission_mode?: string;
  /** NEW-IN-DOCS: reasoning-effort level at hook time. typed-not-populated. */
  effort?: { level: string };
};

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
  tool_use_id?: string;
  duration_ms?: number;
};

export type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure';
  tool_name: string;
  tool_input: unknown;
  error: string;
  tool_use_id?: string;
  duration_ms?: number;
};

/** One tool invocation in a PostToolBatch, official `tool_calls[]` element shape. */
export type PostToolBatchToolCall = {
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type PostToolBatchHookInput = BaseHookInput & {
  hook_event_name: 'PostToolBatch';
  /**
   * Official field (P2 parity): the full tool_use blocks that ran in the batch,
   * each carrying `tool_name`/`tool_input`/`tool_use_id`.
   */
  tool_calls: PostToolBatchToolCall[];
  /**
   * @deprecated Superseded by the official `tool_calls` field. Kept on a dual
   * track so existing consumers keep compiling; carries the same tool names as
   * `tool_calls.map(c => c.tool_name)`.
   */
  tool_names: string[];
};

export type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
};

export type MessageDisplayHookInput = BaseHookInput & {
  hook_event_name: 'MessageDisplay';
  /**
   * NEW-IN-DOCS: official incremental-render protocol. NOTE this engine is NOT
   * a true incremental delta stream — it fires MessageDisplay ONCE per COMPLETED
   * assistant message (same honest-subset stance as the Monitor tool). Therefore
   * `final` is always true, `delta` carries the whole message segment, and
   * `index` is monotonic across emits. Hosts that expect mid-message deltas will
   * simply receive one final delta per message.
   */
  turn_id: string;
  message_id: string;
  index: number;
  final: boolean;
  delta: string;
  /**
   * @deprecated Superseded by the official `delta` field (NEW-IN-DOCS). Kept on
   * a dual track so existing consumers keep compiling; carries the same whole
   * message text as `delta`.
   */
  message_text: string;
};

/** NEW-IN-DOCS: summary of a live background task, attached to Stop /
 *  SubagentStop inputs. typed-not-populated in this engine. */
export type BackgroundTaskSummary = {
  id: string;
  type: string;
  status: string;
  description: string;
  command?: string;
  agent_type?: string;
  server?: string;
  tool?: string;
  name?: string;
};

/** NEW-IN-DOCS: summary of a session cron, attached to Stop / SubagentStop
 *  inputs. typed-not-populated in this engine. */
export type SessionCronSummary = {
  id: string;
  schedule: string;
  recurring: boolean;
  prompt: string;
};

export type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop';
  stop_hook_active: boolean;
  /** NEW-IN-DOCS. Populated on root-loop natural stops with the final
   *  assistant text (L2-10: keeps Stop consumers — e.g. the goal evaluator —
   *  sighted even when incognito omits transcript_path). */
  last_assistant_message?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  background_tasks?: BackgroundTaskSummary[];
  /** NEW-IN-DOCS. typed-not-populated. */
  session_crons?: SessionCronSummary[];
};

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
};

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
  agent_transcript_path?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  last_assistant_message?: string;
  /** NEW-IN-DOCS. typed-not-populated. */
  background_tasks?: BackgroundTaskSummary[];
  /** NEW-IN-DOCS. typed-not-populated. */
  session_crons?: SessionCronSummary[];
};

export type PreCompactHookInput = BaseHookInput & {
  hook_event_name: 'PreCompact';
  trigger: 'manual' | 'auto';
  custom_instructions: string | null;
};

export type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: 'PermissionRequest';
  tool_name: string;
  tool_input: unknown;
  tool_use_id?: string;
};

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
};

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd';
  reason: string;
};

export type NotificationHookInput = BaseHookInput & {
  hook_event_name: 'Notification';
  message: string;
  title?: string;
  notification_type?: string;
};

// NEW-IN-DOCS hook input types (all typed-not-fired; see HookEvent note). Field
// shapes track the live docs verbatim for drop-in compatibility.

export type SetupHookInput = BaseHookInput & {
  hook_event_name: 'Setup';
  trigger: 'init' | 'maintenance';
};

export type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: 'TeammateIdle';
  teammate_name: string;
  /** @deprecated since v2.1.178. Carries the session-derived team name. */
  team_name: string;
};

export type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCompleted';
  task_id: string;
  task_subject: string;
  task_description?: string;
  teammate_name?: string;
  /** @deprecated since v2.1.178. Carries the session-derived team name. */
  team_name?: string;
};

export type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: 'ConfigChange';
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills';
  file_path?: string;
};

export type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeCreate';
  name: string;
};

export type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeRemove';
  worktree_path: string;
};

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PostToolBatchHookInput
  | UserPromptSubmitHookInput
  | MessageDisplayHookInput
  | StopHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PermissionRequestHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | NotificationHookInput
  | SetupHookInput
  | TeammateIdleHookInput
  | TaskCompletedHookInput
  | ConfigChangeHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput
  | BudgetThresholdHookInput
  | BudgetExhaustedHookInput;

/**
 * R2 closeout report: handed to the host on `budget:exhausted` as a
 * structured object (SCS-REQ-REPOS-01 §3 R2) — cumulative cost, turn count,
 * and a bounded last-state summary, so an unattended loop's runner can log
 * the shutdown without replaying the stream.
 */
export type BudgetCloseoutReport = {
  /** Estimated cumulative cost of the run (static price table). */
  cumulative_cost_usd: number;
  /** The cap that was hit. */
  max_budget_usd: number;
  /** Engine turns completed when the cap fired. */
  num_turns: number;
  /** Text of the last assistant turn, bounded to 500 chars. */
  last_assistant_summary: string;
};

/** `budget:threshold` — fired ONCE when cumulative cost crosses
 *  `maxBudgetUsd * budgetThresholdRatio` (default 0.8). */
export type BudgetThresholdHookInput = BaseHookInput & {
  hook_event_name: 'budget:threshold';
  cumulative_cost_usd: number;
  max_budget_usd: number;
  threshold_ratio: number;
};

/** `budget:exhausted` — fired ONCE when the engine stops on the budget cap
 *  (after the in-flight turn completes; no further billable call is made). */
export type BudgetExhaustedHookInput = BaseHookInput & {
  hook_event_name: 'budget:exhausted';
  /** The engine's budget-stop reason string (matches the terminal result). */
  reason: string;
  report: BudgetCloseoutReport;
};

export type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';

export type HookJSONOutput = {
  /** When false, the agent stops after this hook. */
  continue?: boolean;
  /**
   * Official field: hide this output's systemMessage from the conversation
   * surface. Honored by the hook aggregator since v0.7 (T2-7 close-out);
   * permission decisions and continue:false still apply regardless.
   */
  suppressOutput?: boolean;
  stopReason?: string;
  /** Legacy-style decision field; 'block' behaves like a deny. */
  decision?: 'approve' | 'block';
  /** Message surfaced to the user (not the model). */
  systemMessage?: string;
  reason?: string;
  /** Fire-and-forget mode: agent proceeds without waiting. */
  async?: boolean;
  asyncTimeout?: number;
  hookSpecificOutput?: {
    hookEventName: HookEvent;
    /** PreToolUse: permission decision for the pending tool call. */
    permissionDecision?: HookPermissionDecision;
    permissionDecisionReason?: string;
    /** PreToolUse: replaces the tool input (requires allow/ask decision). */
    updatedInput?: Record<string, unknown>;
    /** PostToolUse / UserPromptSubmit / SessionStart: extra context for the model. */
    additionalContext?: string;
    /** PostToolUse: replace the tool output before the model sees it. */
    updatedToolOutput?: unknown;
  };
};

export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookJSONOutput | void>;

export type HookCallbackMatcher = {
  /**
   * Pattern matched against the event's filter field (tool name for tool
   * hooks). Exact-string set (letters, digits, _, -, spaces, ',', '|') is
   * compared literally with '|'/',' alternatives; anything else is an
   * unanchored regular expression. Omitted/'*'/'' matches everything.
   */
  matcher?: string;
  /**
   * v0.6: optional natural-language CONDITION gating this matcher. When set,
   * the runner evaluates it with a bounded single-shot model call (the
   * reproduced hook-condition evaluator; the stop variant for Stop /
   * SubagentStop events) BEFORE firing this matcher's callbacks, and SKIPS
   * them when the condition is not met. FAILS CLOSED: a garbled or errored
   * evaluation counts as not met. Omitted -> the existing fully-deterministic
   * path, zero model calls.
   */
  condition?: string;
  /**
   * BPT-EXTENSION (audit 2026-07-14 M-1): per-matcher failure policy for THIS
   * matcher's callbacks, overriding Options.hookFailureMode when set. The
   * global default stays 'open' (official drop-in parity), which means a
   * crashed or timed-out callback is treated as "no opinion" — a security
   * PreToolUse hook that WOULD have denied silently stops denying. Marking
   * the security-critical matcher 'closed' turns its callback failures into a
   * deny (fail safe) without changing behavior for every other hook; 'open'
   * likewise wins over a global 'closed' for a best-effort matcher. Omitted
   * -> the global setting applies.
   */
  failureMode?: 'open' | 'closed';
  hooks: HookCallback[];
  /** Timeout in seconds for each callback (default 60). */
  timeout?: number;
};
