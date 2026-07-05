/**
 * Official tool input/output type surface (drop-in compat).
 *
 * Verbatim reproductions of the "Tool Input Types" / "Tool Output Types"
 * chapters of the public @anthropic-ai/claude-agent-sdk TypeScript reference
 * (0.3.201 docs snapshot): member names, field names, optionality and literal
 * unions follow the official text exactly.
 *
 * SCOPE: only the members whose tool this SDK actually ships are defined
 * (Agent, AskUserQuestion, Bash, Edit, Read, Write, Glob, Grep,
 * ListMcpResourcesTool, ReadMcpResourceTool, TaskCreate, TaskGet, TaskList,
 * TaskUpdate, TodoWrite, WebFetch, WebSearch). TodoWrite ships as the legacy
 * task surface behind CLAUDE_CODE_ENABLE_TASKS=0 (official 0.3.142 semantics;
 * see src/tools/index.ts), so both its types and the Task quartet's are kept.
 * Official members for tools this SDK does not ship (Monitor, NotebookEdit,
 * Workflow, TaskStop, TaskOutput, EnterWorktree, ExitPlanMode, the
 * Subscribe/Unsubscribe pairs, McpInput) are intentionally NOT fabricated, so
 * the two unions below are shipped-subset views of the official 27-input /
 * 22-output unions. The legacy BashOutput/KillShell shell tools have no
 * official 0.3.201 type members (the official docs type their successors
 * TaskOutput/TaskStop instead) and the ToolSearch builtin is absent from the
 * official union entirely.
 *
 * These are CONSUMER-FACING wire types: they describe the official schema a
 * drop-in host programs against, independent of the internal BuiltinTool
 * runtime plumbing in src/tools/.
 */

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

/** Input for the Agent tool (tool name `Agent`; `Task` accepted as alias). */
export type AgentInput = {
  description: string;
  prompt: string;
  subagent_type: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'fable';
  resume?: string;
  run_in_background?: boolean;
  max_turns?: number;
  name?: string;
  mode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
  isolation?: 'worktree';
};

/** Input for the AskUserQuestion tool. */
export type AskUserQuestionInput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect: boolean;
  }>;
};

/** Input for the Bash tool. */
export type BashInput = {
  command: string;
  timeout?: number;
  description?: string;
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;
};

/** Input for the Edit tool (official member name: FileEditInput). */
export type FileEditInput = {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

/** Input for the Read tool (official member name: FileReadInput). */
export type FileReadInput = {
  file_path: string;
  offset?: number;
  limit?: number;
  pages?: string;
};

/** Input for the Write tool (official member name: FileWriteInput). */
export type FileWriteInput = {
  file_path: string;
  content: string;
};

/** Input for the Glob tool. */
export type GlobInput = {
  pattern: string;
  path?: string;
};

/** Input for the Grep tool. `context` is the official alias for `-C`. */
export type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  '-i'?: boolean;
  '-n'?: boolean;
  '-B'?: number;
  '-A'?: number;
  '-C'?: number;
  context?: number;
  head_limit?: number;
  offset?: number;
  multiline?: boolean;
};

/** Input for the ListMcpResourcesTool tool. */
export type ListMcpResourcesInput = {
  server?: string;
};

/** Input for the ReadMcpResourceTool tool. */
export type ReadMcpResourceInput = {
  server: string;
  uri: string;
};

/** Input for the TaskCreate tool. */
export type TaskCreateInput = {
  subject: string;
  description: string;
  activeForm?: string;
  metadata?: Record<string, unknown>;
};

/** Input for the TaskGet tool. */
export type TaskGetInput = {
  taskId: string;
};

/** Input for the TaskList tool (official member: an empty object). */
export type TaskListInput = {};

/** Input for the TaskUpdate tool. */
export type TaskUpdateInput = {
  taskId: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'deleted';
  subject?: string;
  description?: string;
  activeForm?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
};

/** Input for the TodoWrite tool. */
export type TodoWriteInput = {
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
};

/** Input for the WebFetch tool. */
export type WebFetchInput = {
  url: string;
  prompt: string;
};

/** Input for the WebSearch tool. */
export type WebSearchInput = {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
};

/**
 * Union of the tool input types this SDK ships (official export name;
 * shipped-subset of the official 27-member union - see module header).
 */
export type ToolInputSchemas =
  | AgentInput
  | AskUserQuestionInput
  | BashInput
  | FileEditInput
  | FileReadInput
  | FileWriteInput
  | GlobInput
  | GrepInput
  | ListMcpResourcesInput
  | ReadMcpResourceInput
  | TaskCreateInput
  | TaskGetInput
  | TaskListInput
  | TaskUpdateInput
  | TodoWriteInput
  | WebFetchInput
  | WebSearchInput;

// ---------------------------------------------------------------------------
// Tool output types
// ---------------------------------------------------------------------------

/** Output of the Agent tool. Discriminated on `status`. */
export type AgentOutput =
  | {
      status: 'completed';
      agentId: string;
      content: Array<{ type: 'text'; text: string }>;
      resolvedModel?: string;
      totalToolUseCount: number;
      totalDurationMs: number;
      totalTokens: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number | null;
        cache_read_input_tokens: number | null;
        server_tool_use: {
          web_search_requests: number;
          web_fetch_requests: number;
        } | null;
        service_tier: ('standard' | 'priority' | 'batch') | null;
        cache_creation: {
          ephemeral_1h_input_tokens: number;
          ephemeral_5m_input_tokens: number;
        } | null;
      };
      prompt: string;
    }
  | {
      status: 'async_launched';
      agentId: string;
      description: string;
      resolvedModel?: string;
      prompt: string;
      outputFile: string;
      canReadOutputFile?: boolean;
    }
  | {
      status: 'sub_agent_entered';
      description: string;
      message: string;
    };

/** Output of the AskUserQuestion tool. */
export type AskUserQuestionOutput = {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect: boolean;
  }>;
  answers: Record<string, string>;
  response?: string;
};

/** Output of the Bash tool. */
export type BashOutput = {
  stdout: string;
  stderr: string;
  rawOutputPath?: string;
  interrupted: boolean;
  isImage?: boolean;
  backgroundTaskId?: string;
  backgroundedByUser?: boolean;
  dangerouslyDisableSandbox?: boolean;
  returnCodeInterpretation?: string;
  structuredContent?: unknown[];
  persistedOutputPath?: string;
  persistedOutputSize?: number;
};

/** Output of the Edit tool (official member name: FileEditOutput). */
export type FileEditOutput = {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  userModified: boolean;
  replaceAll: boolean;
  gitDiff?: {
    filename: string;
    status: 'modified' | 'added';
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
};

/** Output of the Read tool. Discriminated on `type`. */
export type FileReadOutput =
  | {
      type: 'text';
      file: {
        filePath: string;
        content: string;
        numLines: number;
        startLine: number;
        totalLines: number;
      };
    }
  | {
      type: 'image';
      file: {
        base64: string;
        type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        originalSize: number;
        dimensions?: {
          originalWidth?: number;
          originalHeight?: number;
          displayWidth?: number;
          displayHeight?: number;
        };
      };
    }
  | {
      type: 'notebook';
      file: {
        filePath: string;
        cells: unknown[];
      };
    }
  | {
      type: 'pdf';
      file: {
        filePath: string;
        base64: string;
        originalSize: number;
      };
    }
  | {
      type: 'parts';
      file: {
        filePath: string;
        originalSize: number;
        count: number;
        outputDir: string;
      };
    };

/** Output of the Write tool (official member name: FileWriteOutput). */
export type FileWriteOutput = {
  type: 'create' | 'update';
  filePath: string;
  content: string;
  structuredPatch: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }>;
  originalFile: string | null;
  gitDiff?: {
    filename: string;
    status: 'modified' | 'added';
    additions: number;
    deletions: number;
    changes: number;
    patch: string;
  };
};

/** Output of the Glob tool. */
export type GlobOutput = {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
};

/** Output of the Grep tool. Shape varies by `mode`. */
export type GrepOutput = {
  mode?: 'content' | 'files_with_matches' | 'count';
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
  appliedLimit?: number;
  appliedOffset?: number;
};

/** Output of the ListMcpResourcesTool tool. */
export type ListMcpResourcesOutput = Array<{
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}>;

/** Output of the ReadMcpResourceTool tool. */
export type ReadMcpResourceOutput = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
  }>;
};

/** Output of the TaskCreate tool. */
export type TaskCreateOutput = {
  task: {
    id: string;
    subject: string;
  };
};

/** Output of the TaskGet tool. `task` is null when the ID is not found. */
export type TaskGetOutput = {
  task: {
    id: string;
    subject: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed';
    blocks: string[];
    blockedBy: string[];
  } | null;
};

/** Output of the TaskList tool. */
export type TaskListOutput = {
  tasks: Array<{
    id: string;
    subject: string;
    status: 'pending' | 'in_progress' | 'completed';
    owner?: string;
    blockedBy: string[];
  }>;
};

/** Output of the TaskUpdate tool. */
export type TaskUpdateOutput = {
  success: boolean;
  taskId: string;
  updatedFields: string[];
  error?: string;
  statusChange?: {
    from: string;
    to: string;
  };
};

/** Output of the TodoWrite tool. */
export type TodoWriteOutput = {
  oldTodos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
  newTodos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
};

/** Output of the WebFetch tool. */
export type WebFetchOutput = {
  bytes: number;
  code: number;
  codeText: string;
  result: string;
  durationMs: number;
  url: string;
};

/** Output of the WebSearch tool. */
export type WebSearchOutput = {
  query: string;
  results: Array<
    | {
        tool_use_id: string;
        content: Array<{ title: string; url: string }>;
      }
    | string
  >;
  durationSeconds: number;
};

/**
 * Union of the tool output types this SDK ships (official export name;
 * shipped-subset of the official 22-member union - see module header).
 */
export type ToolOutputSchemas =
  | AgentOutput
  | AskUserQuestionOutput
  | BashOutput
  | FileEditOutput
  | FileReadOutput
  | FileWriteOutput
  | GlobOutput
  | GrepOutput
  | ListMcpResourcesOutput
  | ReadMcpResourceOutput
  | TaskCreateOutput
  | TaskGetOutput
  | TaskListOutput
  | TaskUpdateOutput
  | TodoWriteOutput
  | WebFetchOutput
  | WebSearchOutput;
