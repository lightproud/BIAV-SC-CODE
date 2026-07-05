/**
 * T1 type-surface batch: official drop-in type exports.
 *
 * Covers (1) ToolInputSchemas / ToolOutputSchemas and their member types
 * (src/tool-types.ts, re-exported from the package root), (2) the four
 * official type-name aliases (SDKControlInitializeResponse /
 * SDKFilesPersistedEvent / SDKRateLimitEvent / SDKAPIRetryMessage), (3) the
 * deferred_tool_use dual-track field names, and (4) CanUseTool's required
 * options.requestId.
 *
 * The `satisfies` / annotated-const blocks are COMPILE-TIME assertions: they
 * are enforced whenever this file is type-checked (vitest itself transpiles
 * without checking, so a plain `tsc` pass over tests is the guard; the
 * runtime expectations below keep the file meaningful under `vitest run`).
 */

import { describe, expect, it } from 'vitest';

import { DefaultPermissionGate } from '../src/permissions/gate.js';
import type {
  // T1-1 members (via the package root, proving root reachability).
  AgentInput,
  AgentOutput,
  AskUserQuestionInput,
  AskUserQuestionOutput,
  BashInput,
  BashOutput,
  CanUseTool,
  FileEditInput,
  FileEditOutput,
  FileReadInput,
  FileReadOutput,
  FileWriteInput,
  FileWriteOutput,
  GlobInput,
  GlobOutput,
  GrepInput,
  GrepOutput,
  ListMcpResourcesInput,
  ListMcpResourcesOutput,
  ReadMcpResourceInput,
  ReadMcpResourceOutput,
  SDKAPIRetryMessage,
  SDKApiRetryMessage,
  SDKControlInitializeResponse,
  SDKDeferredToolUse,
  SDKFilesPersistedEvent,
  SDKFilesPersistedMessage,
  SDKInitializationResult,
  SDKRateLimitEvent,
  SDKRateLimitEventMessage,
  TaskCreateInput,
  TaskCreateOutput,
  TaskGetInput,
  TaskGetOutput,
  TaskListInput,
  TaskListOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
  TodoWriteInput,
  TodoWriteOutput,
  ToolInputSchemas,
  ToolOutputSchemas,
  WebFetchInput,
  WebFetchOutput,
  WebSearchInput,
  WebSearchOutput,
  WorkflowInput,
  WorkflowOutput,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// T1-1: tool input types (compile-time samples, official shapes verbatim)
// ---------------------------------------------------------------------------

const agentInput = {
  description: 'Investigate flaky test',
  prompt: 'Find the race in the scheduler.',
  subagent_type: 'general-purpose',
  model: 'sonnet',
  run_in_background: true,
  isolation: 'worktree',
} satisfies AgentInput;

const askInput = {
  questions: [
    {
      question: 'Deploy now?',
      header: 'Deploy',
      options: [{ label: 'yes', description: 'ship it', preview: 'v2' }],
      multiSelect: false,
    },
  ],
} satisfies AskUserQuestionInput;

const bashInput = {
  command: 'ls -la',
  timeout: 5_000,
  description: 'List files',
  run_in_background: false,
  dangerouslyDisableSandbox: false,
} satisfies BashInput;

const editInput = {
  file_path: '/tmp/a.ts',
  old_string: 'a',
  new_string: 'b',
  replace_all: true,
} satisfies FileEditInput;

const readInput = {
  file_path: '/tmp/a.pdf',
  offset: 1,
  limit: 10,
  pages: '1-5',
} satisfies FileReadInput;

const writeInput = { file_path: '/tmp/a.ts', content: 'x' } satisfies FileWriteInput;

const globInput = { pattern: '**/*.ts', path: '/tmp' } satisfies GlobInput;

// T1-5a: GrepInput carries BOTH '-C' and its official alias `context`.
const grepInput = {
  pattern: 'needle',
  path: '/tmp',
  glob: '*.ts',
  type: 'ts',
  output_mode: 'content',
  '-i': true,
  '-n': true,
  '-B': 1,
  '-A': 2,
  '-C': 3,
  context: 3,
  head_limit: 100,
  offset: 0,
  multiline: false,
} satisfies GrepInput;

const listResInput = { server: 'srv' } satisfies ListMcpResourcesInput;
const readResInput = { server: 'srv', uri: 'res://a' } satisfies ReadMcpResourceInput;

const todoInput = {
  todos: [{ content: 'x', status: 'pending', activeForm: 'doing x' }],
} satisfies TodoWriteInput;

const taskCreateInput = {
  subject: 'Fix bug',
  description: 'Fix the login bug',
  activeForm: 'Fixing bug',
  metadata: { pr: 42 },
} satisfies TaskCreateInput;

const taskGetInput = { taskId: '1' } satisfies TaskGetInput;

const taskListInput = {} satisfies TaskListInput;

const taskUpdateInput = {
  taskId: '1',
  status: 'in_progress',
  subject: 'Run tests',
  description: 'Run the suite',
  activeForm: 'Running tests',
  addBlocks: ['2'],
  addBlockedBy: ['3'],
  owner: 'agent-a',
  metadata: { note: null },
} satisfies TaskUpdateInput;

// @ts-expect-error TaskUpdateInput.status is the official literal union (incl. deleted), not free text.
const badTaskUpdateInput: TaskUpdateInput = { taskId: '1', status: 'done' };
void badTaskUpdateInput;

const webFetchInput = { url: 'https://example.com', prompt: 'summarize' } satisfies WebFetchInput;

const webSearchInput = {
  query: 'morimens',
  allowed_domains: ['example.com'],
  blocked_domains: [],
} satisfies WebSearchInput;

// B4c: Workflow input, official shape verbatim (all five fields optional at
// the type level; "at least one of script/name/scriptPath" is runtime-checked).
const workflowInput = {
  script: "export const meta = { name: 'wf', description: 'd' }\nreturn 1",
  args: ['a.ts', 'b.ts'],
  resumeFromRunId: 'wf-run-1',
} satisfies WorkflowInput;

// Every member is assignable into the union.
const inputUnionSamples: ToolInputSchemas[] = [
  agentInput,
  askInput,
  bashInput,
  editInput,
  readInput,
  writeInput,
  globInput,
  grepInput,
  listResInput,
  readResInput,
  taskCreateInput,
  taskGetInput,
  taskListInput,
  taskUpdateInput,
  todoInput,
  webFetchInput,
  webSearchInput,
  workflowInput,
];

// @ts-expect-error GrepInput requires `pattern`.
const badGrepInput: GrepInput = { path: '/tmp' };
void badGrepInput;

// @ts-expect-error AgentInput.model is the official alias union, not free text.
const badAgentInput: AgentInput = { ...agentInput, model: 'gpt-4' };
void badAgentInput;

// ---------------------------------------------------------------------------
// T1-1: tool output types (compile-time samples, official shapes verbatim)
// ---------------------------------------------------------------------------

const agentOutput = {
  status: 'completed',
  agentId: 'agent_1',
  content: [{ type: 'text', text: 'done' }],
  resolvedModel: 'claude-sonnet-4-5',
  totalToolUseCount: 3,
  totalDurationMs: 1200,
  totalTokens: 456,
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  },
  prompt: 'Find the race in the scheduler.',
} satisfies AgentOutput;

const agentAsyncOutput = {
  status: 'async_launched',
  agentId: 'agent_2',
  description: 'bg task',
  prompt: 'p',
  outputFile: '/tmp/out.txt',
  canReadOutputFile: true,
} satisfies AgentOutput;

const askOutput = {
  questions: askInput.questions,
  answers: { Deploy: 'yes' },
  response: undefined,
} satisfies AskUserQuestionOutput;

const bashOutput = {
  stdout: 'ok',
  stderr: '',
  interrupted: false,
  backgroundTaskId: 'bash_1',
  returnCodeInterpretation: 'success',
} satisfies BashOutput;

const editOutput = {
  filePath: '/tmp/a.ts',
  oldString: 'a',
  newString: 'b',
  originalFile: 'a',
  structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }],
  userModified: false,
  replaceAll: false,
  gitDiff: {
    filename: 'a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@',
  },
} satisfies FileEditOutput;

const readTextOutput = {
  type: 'text',
  file: { filePath: '/tmp/a.ts', content: 'x', numLines: 1, startLine: 1, totalLines: 1 },
} satisfies FileReadOutput;

const readImageOutput = {
  type: 'image',
  file: {
    base64: 'AAAA',
    type: 'image/png',
    originalSize: 4,
    dimensions: { originalWidth: 2, originalHeight: 2 },
  },
} satisfies FileReadOutput;

const writeOutput = {
  type: 'create',
  filePath: '/tmp/a.ts',
  content: 'x',
  structuredPatch: [],
  originalFile: null,
} satisfies FileWriteOutput;

const globOutput = {
  durationMs: 4,
  numFiles: 1,
  filenames: ['/tmp/a.ts'],
  truncated: false,
} satisfies GlobOutput;

const grepOutput = {
  mode: 'content',
  numFiles: 1,
  filenames: ['/tmp/a.ts'],
  content: '/tmp/a.ts:1:needle',
  numLines: 1,
  numMatches: 1,
  appliedLimit: 250,
  appliedOffset: 0,
} satisfies GrepOutput;

const listResOutput = [
  { uri: 'res://a', name: 'a', mimeType: 'text/plain', server: 'srv' },
] satisfies ListMcpResourcesOutput;

const readResOutput = {
  contents: [{ uri: 'res://a', mimeType: 'text/plain', text: 'x' }],
} satisfies ReadMcpResourceOutput;

const todoOutput = {
  oldTodos: [],
  newTodos: [{ content: 'x', status: 'in_progress', activeForm: 'doing x' }],
} satisfies TodoWriteOutput;

const taskCreateOutput = {
  task: { id: '1', subject: 'Fix bug' },
} satisfies TaskCreateOutput;

const taskGetOutput = {
  task: {
    id: '1',
    subject: 'Fix bug',
    description: 'Fix the login bug',
    status: 'pending',
    blocks: ['2'],
    blockedBy: [],
  },
} satisfies TaskGetOutput;

// Official semantics: an unknown ID yields task: null, not an error.
const taskGetNullOutput = { task: null } satisfies TaskGetOutput;

const taskListOutput = {
  tasks: [
    { id: '1', subject: 'Fix bug', status: 'in_progress', owner: 'agent-a', blockedBy: [] },
    { id: '2', subject: 'Run tests', status: 'pending', blockedBy: ['1'] },
  ],
} satisfies TaskListOutput;

const taskUpdateOutput = {
  success: true,
  taskId: '1',
  updatedFields: ['status'],
  statusChange: { from: 'pending', to: 'in_progress' },
} satisfies TaskUpdateOutput;

const webFetchOutput = {
  bytes: 10,
  code: 200,
  codeText: 'OK',
  result: 'summary',
  durationMs: 30,
  url: 'https://example.com',
} satisfies WebFetchOutput;

const webSearchOutput = {
  query: 'morimens',
  results: [
    { tool_use_id: 'toolu_1', content: [{ title: 't', url: 'https://example.com' }] },
    'Links: []',
  ],
  durationSeconds: 1.2,
} satisfies WebSearchOutput;

// B4c: Workflow output, official async-launch member VERBATIM (wire type over
// runtime subset — the shipped tool runs synchronously; see src/tool-types.ts).
const workflowOutput = {
  status: 'async_launched',
  taskId: 'task_1',
  runId: 'wf-run-1',
  summary: 'Find flaky tests and propose fixes',
  scriptPath: '/tmp/workflow.mjs',
} satisfies WorkflowOutput;

// @ts-expect-error WorkflowOutput.status is the official literal, not free text.
const badWorkflowOutput: WorkflowOutput = { status: 'completed', taskId: 'task_1' };
void badWorkflowOutput;

const outputUnionSamples: ToolOutputSchemas[] = [
  agentOutput,
  agentAsyncOutput,
  askOutput,
  bashOutput,
  editOutput,
  readTextOutput,
  readImageOutput,
  writeOutput,
  globOutput,
  grepOutput,
  listResOutput,
  readResOutput,
  taskCreateOutput,
  taskGetOutput,
  taskGetNullOutput,
  taskListOutput,
  taskUpdateOutput,
  todoOutput,
  webFetchOutput,
  webSearchOutput,
  workflowOutput,
];

// ---------------------------------------------------------------------------
// T1-3: official type-name aliases (mutual assignability = same type)
// ---------------------------------------------------------------------------

const initAsOfficial: SDKControlInitializeResponse = {} as SDKInitializationResult;
const initAsHouse: SDKInitializationResult = {} as SDKControlInitializeResponse;
const filesAsOfficial: SDKFilesPersistedEvent = {} as SDKFilesPersistedMessage;
const filesAsHouse: SDKFilesPersistedMessage = {} as SDKFilesPersistedEvent;
const rateAsOfficial: SDKRateLimitEvent = {} as SDKRateLimitEventMessage;
const rateAsHouse: SDKRateLimitEventMessage = {} as SDKRateLimitEvent;
const retryAsOfficial: SDKAPIRetryMessage = {} as SDKApiRetryMessage;
const retryAsHouse: SDKApiRetryMessage = {} as SDKAPIRetryMessage;
void [initAsOfficial, initAsHouse, filesAsOfficial, filesAsHouse];
void [rateAsOfficial, rateAsHouse, retryAsOfficial, retryAsHouse];

// ---------------------------------------------------------------------------
// T1-4: deferred_tool_use dual-track fields
// ---------------------------------------------------------------------------

// Both spellings coexist on the type; official names are optional during the
// dual-track transition, legacy names still required.
const deferredDual = {
  id: 'toolu_defer_1',
  name: 'Bash',
  input: { command: 'ls' },
  tool_use_id: 'toolu_defer_1',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
} satisfies SDKDeferredToolUse;

// @ts-expect-error legacy tool_use_id is still required (dual-track).
const deferredOfficialOnly: SDKDeferredToolUse = {
  id: 'toolu_defer_2',
  name: 'Bash',
  input: {},
};
void deferredOfficialOnly;

// ---------------------------------------------------------------------------
// T1-5b: CanUseTool options.requestId is required
// ---------------------------------------------------------------------------

type CanUseToolOptions = Parameters<CanUseTool>[2];

// requestId narrows to string, not string | undefined.
const requestIdIsString: string = ({} as CanUseToolOptions).requestId;
void requestIdIsString;

// @ts-expect-error options without requestId no longer satisfy the surface.
const optionsMissingRequestId: CanUseToolOptions = {
  signal: new AbortController().signal,
  toolUseID: 'toolu_x',
};
void optionsMissingRequestId;

// ---------------------------------------------------------------------------
// Runtime expectations
// ---------------------------------------------------------------------------

describe('tool type surface (T1-1)', () => {
  it('sample inputs cover all 18 shipped-tool input members (B4c adds Workflow)', () => {
    expect(inputUnionSamples).toHaveLength(18);
    expect(grepInput['-C']).toBe(grepInput.context);
  });

  it('sample outputs cover all 18 shipped-tool output members (B4c adds Workflow)', () => {
    // 21 samples over 18 member types (Agent + Read contribute two arms each;
    // TaskGet contributes a found and a null sample).
    expect(outputUnionSamples).toHaveLength(21);
    const statuses = outputUnionSamples
      .filter((o): o is AgentOutput => typeof o === 'object' && !Array.isArray(o) && 'status' in o)
      .map((o) => o.status);
    // Agent's two arms plus Workflow's official async-launch member.
    expect(statuses).toEqual(['completed', 'async_launched', 'async_launched']);
  });
});

describe('deferred_tool_use dual-track fields (T1-4)', () => {
  it('carries identical values under official and legacy names', () => {
    expect(deferredDual.id).toBe(deferredDual.tool_use_id);
    expect(deferredDual.name).toBe(deferredDual.tool_name);
    expect(deferredDual.input).toEqual(deferredDual.tool_input);
  });
});

describe('CanUseTool options.requestId (T1-5b)', () => {
  it('the gate passes a non-empty requestId string on every consultation', async () => {
    let seenRequestId: unknown;
    const canUse: CanUseTool = async (_toolName, _input, options) => {
      seenRequestId = options.requestId;
      return { behavior: 'allow' };
    };
    const gate = new DefaultPermissionGate({ debug: () => {}, mode: 'default', canUseTool: canUse });
    await gate.check(
      'Bash',
      { command: 'make' },
      {
        toolUseID: 'toolu_t1_5b',
        signal: new AbortController().signal,
        readOnly: false,
        isFileEdit: false,
      },
    );
    expect(typeof seenRequestId).toBe('string');
    expect((seenRequestId as string).length).toBeGreaterThan(0);
  });
});
