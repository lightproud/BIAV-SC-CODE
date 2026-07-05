/**
 * Workflow engine (B4c): deterministic multi-subagent orchestration scripts.
 *
 * Runs a workflow script (official Workflow tool semantics, 2.1.198 docs
 * snapshot) inside a `node:vm` context with a restricted API surface:
 *  - injected hooks: agent() / parallel() / pipeline() / phase() / log() /
 *    workflow() / args / budget;
 *  - standard JS built-ins available; NO require / process / fs / network
 *    globals (they are simply absent from the context);
 *  - determinism bans per the official semantics: Date.now(), Math.random(),
 *    arg-less `new Date()` (and bare `Date()` calls) throw — they would break
 *    resume caching.
 *
 * HONESTY NOTE (restricted surface, not a hardened boundary): the vm context
 * restricts the API surface a script can reach, but it is not a security
 * sandbox — exotic reflection over host-thrown Error objects can still reach
 * host intrinsics. Workflow scripts are model-authored and run at the same
 * trust tier as Bash (which has the whole shell), so this is an API-shape
 * guarantee, not a containment guarantee. To keep script-visible data
 * context-native, hook results cross the membrane as JSON strings and are
 * re-parsed inside the context (see the prelude).
 *
 * Official limits implemented verbatim:
 *  - concurrent agent() calls capped at min(16, cpu cores - 2); excess queue;
 *  - total agent() calls across a workflow's lifetime capped at 1000;
 *  - a single parallel()/pipeline() call accepts at most 4096 items
 *    (explicit error, never silent truncation);
 *  - workflow() nesting is one level only.
 *
 * Simplifications (documented in the tool description too):
 *  - budget: this SDK has no per-turn token-target channel ("+500k"
 *    directives) nor a workflow token meter, so budget.total is always null,
 *    budget.spent() returns 0 and budget.remaining() returns Infinity. The
 *    shape matches the official hook so scripts stay portable; the hard-throw
 *    path is implemented but unreachable while total is null.
 *  - agent() opts.effort has no backing capability on this SDK's subagent
 *    spawn contract; it is accepted, ignored, and noted in the progress log.
 *  - agent() opts.schema appends a structured-output instruction to the
 *    prompt and JSON-parses the reply (shallow required-keys check); there is
 *    no forced StructuredOutput tool call nor retry-on-mismatch — an
 *    unparsable reply yields null (same null semantics as a dead agent).
 *
 * Resume: each run journals its agent() calls in invocation order as
 * (input-hash, result) pairs. Resuming replays the longest unchanged prefix
 * from the journal (official semantics: the first edited/new call and
 * everything after it runs live); a call whose inputs match but which never
 * completed (returned null) re-runs live without breaking the prefix.
 * Journals live in memory — resume is same-session only.
 */

import * as os from 'node:os';
import * as vm from 'node:vm';
import { AbortError } from '../errors.js';
import type { SpawnSubagentFn } from './contracts.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WorkflowMeta = {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type WorkflowLimits = {
  /** Concurrent agent() calls per workflow: min(16, cpu cores - 2), floor 1. */
  maxConcurrentAgents: number;
  /** Total agent() calls across a workflow's lifetime (runaway backstop). */
  maxTotalAgents: number;
  /** Max items a single parallel()/pipeline() call accepts. */
  maxCollectionItems: number;
};

export function defaultWorkflowLimits(): WorkflowLimits {
  const cores = os.cpus().length || 4;
  return {
    maxConcurrentAgents: Math.max(1, Math.min(16, cores - 2)),
    maxTotalAgents: 1000,
    maxCollectionItems: 4096,
  };
}

/** One journaled agent() call. `result` is the membrane-encoded JSON channel
 *  string (see module header) or null; `completed` is false for calls that
 *  returned null (dead/unparsable agents re-run on resume). */
export type WorkflowJournalEntry = {
  hash: string;
  completed: boolean;
  result: string | null;
};

export type WorkflowRunOptions = {
  /** The workflow script source (must begin with `export const meta = {...}`). */
  script: string;
  /** Value exposed to the script as the global `args` (JSON round-tripped). */
  args?: unknown;
  /** Subagent spawn callback; absent -> agent() throws when first called. */
  spawnSubagent?: SpawnSubagentFn;
  signal: AbortSignal;
  debug: (msg: string) => void;
  limits?: Partial<WorkflowLimits>;
  /** Prior run's journal (prefix cache) for resumeFromRunId. */
  resumeJournal?: WorkflowJournalEntry[];
  /** Resolve a saved workflow name to script source (workflow(name) hook).
   *  Must throw a descriptive Error for an unknown name. */
  resolveWorkflow?: (name: string) => string;
  /** Read a script file for workflow({scriptPath}). Must throw when unreadable. */
  readScript?: (path: string) => string;
};

export type WorkflowRunResult =
  | {
      ok: true;
      meta: WorkflowMeta;
      /** The script's return value (host-side, JSON-safe by construction). */
      value: unknown;
      progress: string[];
      agentsLive: number;
      agentsCached: number;
      journal: WorkflowJournalEntry[];
    }
  | {
      ok: false;
      /** 'syntax': the top-level script failed meta validation or its syntax
       *  check and NEVER ran. 'runtime': the script started and then failed. */
      stage: 'syntax' | 'runtime';
      error: string;
      stack?: string;
      meta?: WorkflowMeta;
      progress: string[];
      agentsLive: number;
      agentsCached: number;
      journal: WorkflowJournalEntry[];
    };

// ---------------------------------------------------------------------------
// meta block: pure-literal parser (official: "The `meta` object must be a
// PURE LITERAL — no variables, function calls, spreads, or template
// interpolation"). A tiny recursive-descent parser over object/array/string/
// number/boolean/null literals (comments and trailing commas allowed, as in
// the official example) — anything else is a hard parse error, which IS the
// pure-literal validation.
// ---------------------------------------------------------------------------

class MetaParseError extends Error {}

function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i += 1;
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return src.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

class LiteralParser {
  constructor(
    private readonly src: string,
    public i: number,
  ) {}

  private fail(msg: string): never {
    const at = this.src.slice(this.i, this.i + 24).replace(/\n/g, '\\n');
    throw new MetaParseError(`${msg} (at offset ${this.i}: "${at}...")`);
  }

  private trivia(): void {
    this.i = skipTrivia(this.src, this.i);
  }

  private peek(): string | undefined {
    return this.src[this.i];
  }

  parseValue(): unknown {
    this.trivia();
    const c = this.peek();
    if (c === undefined) this.fail('meta literal ended unexpectedly');
    if (c === '{') return this.parseObject();
    if (c === '[') return this.parseArray();
    if (c === '"' || c === "'") return this.parseString();
    if (c === '`') {
      this.fail('meta must be a pure literal: template literals are not allowed');
    }
    if (c === '-' || c === '.' || (c >= '0' && c <= '9')) return this.parseNumber();
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (
        this.src.startsWith(word, this.i) &&
        !IDENT_PART.test(this.src[this.i + word.length] ?? '')
      ) {
        this.i += word.length;
        return value;
      }
    }
    this.fail(
      'meta must be a pure literal: variables, function calls, spreads and interpolation are not allowed',
    );
  }

  private parseObject(): Record<string, unknown> {
    this.i += 1; // {
    const out: Record<string, unknown> = {};
    for (;;) {
      this.trivia();
      if (this.peek() === '}') {
        this.i += 1;
        return out;
      }
      if (this.src.startsWith('...', this.i)) {
        this.fail('meta must be a pure literal: spreads are not allowed');
      }
      let key: string;
      const c = this.peek();
      if (c === '"' || c === "'") key = this.parseString();
      else if (c !== undefined && IDENT_START.test(c)) {
        const start = this.i;
        while (this.i < this.src.length && IDENT_PART.test(this.src[this.i]!)) this.i += 1;
        key = this.src.slice(start, this.i);
      } else this.fail('meta object: expected a property name');
      this.trivia();
      if (this.peek() !== ':') this.fail(`meta object: expected ":" after key "${key}"`);
      this.i += 1;
      out[key] = this.parseValue();
      this.trivia();
      if (this.peek() === ',') {
        this.i += 1;
        continue;
      }
      if (this.peek() === '}') {
        this.i += 1;
        return out;
      }
      this.fail('meta object: expected "," or "}"');
    }
  }

  private parseArray(): unknown[] {
    this.i += 1; // [
    const out: unknown[] = [];
    for (;;) {
      this.trivia();
      if (this.peek() === ']') {
        this.i += 1;
        return out;
      }
      if (this.src.startsWith('...', this.i)) {
        this.fail('meta must be a pure literal: spreads are not allowed');
      }
      out.push(this.parseValue());
      this.trivia();
      if (this.peek() === ',') {
        this.i += 1;
        continue;
      }
      if (this.peek() === ']') {
        this.i += 1;
        return out;
      }
      this.fail('meta array: expected "," or "]"');
    }
  }

  private parseString(): string {
    const quote = this.src[this.i]!;
    this.i += 1;
    let out = '';
    while (this.i < this.src.length) {
      const c = this.src[this.i]!;
      if (c === quote) {
        this.i += 1;
        return out;
      }
      if (c === '\n') this.fail('meta string: unterminated string literal');
      if (c === '\\') {
        const next = this.src[this.i + 1];
        if (next === undefined) this.fail('meta string: dangling escape');
        const simple: Record<string, string> = {
          n: '\n',
          t: '\t',
          r: '\r',
          b: '\b',
          f: '\f',
          v: '\v',
          '0': '\0',
          '\\': '\\',
          "'": "'",
          '"': '"',
          '`': '`',
        };
        if (next in simple) {
          out += simple[next]!;
          this.i += 2;
          continue;
        }
        if (next === 'u') {
          const hex = this.src.slice(this.i + 2, this.i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('meta string: bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 6;
          continue;
        }
        // Unknown escape: keep the escaped character literally.
        out += next;
        this.i += 2;
        continue;
      }
      out += c;
      this.i += 1;
    }
    this.fail('meta string: unterminated string literal');
  }

  private parseNumber(): number {
    const m = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.src.slice(this.i));
    if (m === null || m[0] === '-') this.fail('meta number: malformed number literal');
    this.i += m[0].length;
    return Number(m[0]);
  }
}

export type MetaParseResult =
  | { ok: true; meta: WorkflowMeta; body: string }
  | { ok: false; error: string };

/**
 * Parse and validate the leading `export const meta = {...}` block (comments
 * allowed before it). On success returns the validated meta object plus the
 * script body with the `export` keyword stripped (so the whole script can run
 * inside an async-function wrapper where `export` is illegal).
 */
export function parseWorkflowMeta(script: string): MetaParseResult {
  try {
    let i = skipTrivia(script, 0);
    const exportIdx = i;
    const expectWord = (word: string, what: string): void => {
      if (!script.startsWith(word, i) || IDENT_PART.test(script[i + word.length] ?? '')) {
        throw new MetaParseError(what);
      }
      i += word.length;
    };
    const mustBegin =
      'every workflow script must begin with `export const meta = { name, description }` as a pure literal';
    expectWord('export', mustBegin);
    i = skipTrivia(script, i);
    expectWord('const', mustBegin);
    i = skipTrivia(script, i);
    expectWord('meta', mustBegin);
    i = skipTrivia(script, i);
    if (script[i] !== '=') throw new MetaParseError(mustBegin);
    i += 1;
    const parser = new LiteralParser(script, i);
    const raw = parser.parseValue();
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new MetaParseError('meta must be an object literal');
    }
    const meta = raw as Record<string, unknown>;
    if (typeof meta['name'] !== 'string' || meta['name'].length === 0) {
      throw new MetaParseError('meta.name is required (non-empty string)');
    }
    if (typeof meta['description'] !== 'string' || meta['description'].length === 0) {
      throw new MetaParseError('meta.description is required (non-empty string)');
    }
    if (meta['whenToUse'] !== undefined && typeof meta['whenToUse'] !== 'string') {
      throw new MetaParseError('meta.whenToUse must be a string when present');
    }
    if (meta['phases'] !== undefined) {
      const phases = meta['phases'];
      const okPhases =
        Array.isArray(phases) &&
        phases.every(
          (p) =>
            p !== null &&
            typeof p === 'object' &&
            !Array.isArray(p) &&
            typeof (p as Record<string, unknown>)['title'] === 'string',
        );
      if (!okPhases) {
        throw new MetaParseError(
          'meta.phases must be an array of objects each with a string `title`',
        );
      }
    }
    // Strip the `export` keyword so the script runs inside a function wrapper.
    const body =
      script.slice(0, exportIdx) + script.slice(exportIdx + 'export'.length);
    return { ok: true, meta: meta as WorkflowMeta, body };
  } catch (err) {
    if (err instanceof MetaParseError) return { ok: false, error: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// vm prelude: determinism bans + membrane rebinding (see module header).
// `__host_*` temp globals are consumed and deleted so scripts never see the
// raw host functions; the wrappers created here are context-native.
// ---------------------------------------------------------------------------

const PRELUDE = `'use strict';
(function () {
  const hostAgent = __host_agent;
  const hostParallel = __host_parallel;
  const hostPipeline = __host_pipeline;
  const hostPhase = __host_phase;
  const hostLog = __host_log;
  const hostWorkflow = __host_workflow;
  const hostArgsJson = __host_args_json;
  delete globalThis.__host_agent;
  delete globalThis.__host_parallel;
  delete globalThis.__host_pipeline;
  delete globalThis.__host_phase;
  delete globalThis.__host_log;
  delete globalThis.__host_workflow;
  delete globalThis.__host_args_json;

  const decode = (channel) =>
    channel === null || channel === undefined ? null : JSON.parse(channel).v;

  globalThis.agent = async (prompt, opts) => decode(await hostAgent(prompt, opts));
  globalThis.parallel = async (thunks) => Array.from(await hostParallel(thunks));
  globalThis.pipeline = async (items, ...stages) =>
    Array.from(await hostPipeline(items, stages));
  globalThis.phase = (title) => { hostPhase(title); };
  globalThis.log = (message) => { hostLog(message); };
  globalThis.workflow = async (ref, childArgs) => {
    const channel = await hostWorkflow(ref, childArgs);
    return channel === undefined ? undefined : JSON.parse(channel).v;
  };
  // Simplified budget surface: no token-target channel in this SDK (see the
  // engine module header) — total is always null, spent() 0, remaining() Inf.
  globalThis.budget = Object.freeze({
    total: null,
    spent: () => 0,
    remaining: () => Infinity,
  });
  globalThis.args =
    typeof hostArgsJson === 'string' ? JSON.parse(hostArgsJson) : undefined;

  // Determinism bans (official): these would break resume caching. The
  // context-local sentinel class keeps the error-discipline guard's "no bare
  // new Error" rule holding even inside this embedded prelude source.
  class WorkflowDeterminismError extends Error {}
  const banned = (what, hint) => () => {
    throw new WorkflowDeterminismError(
      what + ' is unavailable in workflow scripts (it would break resume); ' + hint,
    );
  };
  Math.random = banned('Math.random()', 'vary agent prompts/labels by index instead.');
  Date.now = banned('Date.now()', 'pass timestamps in via args.');
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, argList, newTarget) {
      if (argList.length === 0) {
        throw new WorkflowDeterminismError(
          'new Date() without arguments is unavailable in workflow scripts (it would break resume); pass timestamps in via args.',
        );
      }
      return Reflect.construct(target, argList, newTarget);
    },
    apply: banned('Date()', 'pass timestamps in via args.'),
  });
})();
`;

// ---------------------------------------------------------------------------
// Concurrency primitive
// ---------------------------------------------------------------------------

class Semaphore {
  private inUse = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = (): void => {
        this.inUse += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.inUse -= 1;
          const next = this.queue.shift();
          if (next !== undefined) next();
        });
      };
      if (this.inUse < this.max) grant();
      else this.queue.push(grant);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class WorkflowSyntaxError extends Error {}

/** Script-facing operational failures (caps, missing runtime, resolution). */
class WorkflowScriptError extends Error {}

/** Script-facing call-shape errors (wrong argument types to the hooks). */
class WorkflowTypeError extends TypeError {}

function isAbort(err: unknown): boolean {
  return err instanceof AbortError || (err instanceof Error && err.name === 'AbortError');
}

/** Deterministic stringify (sorted object keys) for agent-call hashing. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Strip a markdown code fence around a JSON reply, if present. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const m = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return m !== undefined && m !== null ? m[1]! : trimmed;
}

/** Framing appended to every workflow agent prompt (the tool description's
 *  "subagents are told their final text IS the return value" claim). */
const RETURN_FRAMING =
  '\n\nYou are one agent inside an orchestrated workflow. Your final message IS ' +
  "the workflow script's return value for this agent() call — it is consumed by " +
  'code, not read by a human. Return raw data only: no preamble, no markdown commentary.';

function schemaInstruction(schema: unknown): string {
  return (
    '\n\nStructured output REQUIRED: reply with ONLY a single JSON value that ' +
    'conforms to this JSON Schema (no prose, no markdown fences):\n' +
    JSON.stringify(schema)
  );
}

/** Parse a structured (schema) agent reply. Returns undefined when the reply
 *  is not valid JSON or misses a top-level required key. */
function parseStructured(text: string, schema: Record<string, unknown>): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return undefined;
  }
  // Shallow required-keys check (simplification; see module header).
  const required = schema['required'];
  if (Array.isArray(required) && required.length > 0) {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    for (const key of required) {
      if (typeof key === 'string' && !(key in (parsed as Record<string, unknown>))) {
        return undefined;
      }
    }
  }
  return parsed;
}

type AgentOpts = {
  label?: string;
  phase?: string;
  schema?: Record<string, unknown>;
  model?: string;
  effort?: string;
  isolation?: 'worktree';
  agentType?: string;
};

function validateAgentOpts(raw: unknown): AgentOpts {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WorkflowTypeError('agent() options must be an object.');
  }
  const o = raw as Record<string, unknown>;
  for (const field of ['label', 'phase', 'model', 'effort', 'agentType'] as const) {
    if (o[field] !== undefined && typeof o[field] !== 'string') {
      throw new WorkflowTypeError(`agent() opts.${field} must be a string.`);
    }
  }
  if (o['isolation'] !== undefined && o['isolation'] !== 'worktree') {
    throw new WorkflowTypeError('agent() opts.isolation must be "worktree" when provided.');
  }
  if (
    o['schema'] !== undefined &&
    (o['schema'] === null || typeof o['schema'] !== 'object' || Array.isArray(o['schema']))
  ) {
    throw new WorkflowTypeError('agent() opts.schema must be a JSON Schema object.');
  }
  return o as AgentOpts;
}

/** Max lines kept in the progress transcript (overflow noted once). */
const MAX_PROGRESS_LINES = 400;

/** vm timeout for the SYNCHRONOUS portion of script evaluation (up to the
 *  first await). Post-await sync segments are not preemptible — a limitation
 *  of vm; abort coverage comes from the signal checks in agent(). */
const SYNC_EVAL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export async function runWorkflow(opts: WorkflowRunOptions): Promise<WorkflowRunResult> {
  const limits: WorkflowLimits = { ...defaultWorkflowLimits(), ...opts.limits };
  const progress: string[] = [];
  const journal: WorkflowJournalEntry[] = [];
  const semaphore = new Semaphore(limits.maxConcurrentAgents);

  let seq = 0; // agent() invocation counter (lifetime cap + journal index)
  let agentsLive = 0;
  let agentsCached = 0;
  let cacheActive = opts.resumeJournal !== undefined;
  let topMeta: WorkflowMeta | undefined;
  let started = false;

  const pushProgress = (line: string): void => {
    if (progress.length < MAX_PROGRESS_LINES) progress.push(line);
    else if (progress.length === MAX_PROGRESS_LINES) progress.push('[...] progress truncated');
    opts.debug(`Workflow: ${line}`);
  };

  let currentPhase: string | undefined;

  // ---- agent() ------------------------------------------------------------
  // Returns the membrane channel: a JSON string `{"v": ...}` or null.
  const hostAgent = async (promptRaw: unknown, optsRaw: unknown): Promise<string | null> => {
    if (opts.signal.aborted) throw new AbortError();
    if (typeof promptRaw !== 'string' || promptRaw.length === 0) {
      throw new WorkflowTypeError('agent() requires a non-empty prompt string.');
    }
    const agentOpts = validateAgentOpts(optsRaw);
    const index = seq;
    seq += 1;
    if (index >= limits.maxTotalAgents) {
      throw new WorkflowScriptError(
        `Workflow agent limit reached: at most ${limits.maxTotalAgents} agent() calls ` +
          'are allowed across a workflow\'s lifetime (runaway-loop backstop).',
      );
    }
    const label =
      agentOpts.label ?? (promptRaw.length > 48 ? `${promptRaw.slice(0, 45)}...` : promptRaw);
    const phaseTag = agentOpts.phase ?? currentPhase;
    const display = phaseTag !== undefined ? `${label} [${phaseTag}]` : label;

    const hash = stableStringify({
      prompt: promptRaw,
      schema: agentOpts.schema,
      model: agentOpts.model,
      effort: agentOpts.effort,
      isolation: agentOpts.isolation,
      agentType: agentOpts.agentType,
    });
    const entry: WorkflowJournalEntry = { hash, completed: false, result: null };
    journal[index] = entry;

    // Resume prefix cache: unchanged + completed -> cached result; unchanged
    // but never completed -> re-run live without breaking the prefix; changed
    // or new -> everything after runs live.
    if (cacheActive) {
      const prior = opts.resumeJournal![index];
      if (prior !== undefined && prior.hash === hash) {
        if (prior.completed) {
          agentsCached += 1;
          entry.completed = true;
          entry.result = prior.result;
          pushProgress(`[agent#${index}] ${display}: cached (resume)`);
          return prior.result;
        }
        // fall through: matching inputs, uncompleted -> live, prefix intact
      } else {
        cacheActive = false;
      }
    }

    const spawn = opts.spawnSubagent;
    if (spawn === undefined) {
      throw new WorkflowScriptError('agent() failed: subagent runtime not available in this context.');
    }
    if (agentOpts.effort !== undefined) {
      pushProgress(
        `[agent#${index}] note: opts.effort ("${agentOpts.effort}") is not supported by this SDK; ignored`,
      );
    }
    let prompt = promptRaw + RETURN_FRAMING;
    if (agentOpts.schema !== undefined) prompt += schemaInstruction(agentOpts.schema);

    const release = await semaphore.acquire();
    try {
      if (opts.signal.aborted) throw new AbortError();
      agentsLive += 1;
      pushProgress(`[agent#${index}] ${display}: running`);
      const res = await spawn({
        subagentType: agentOpts.agentType ?? 'general-purpose',
        prompt,
        description: agentOpts.label,
        runInBackground: false,
        model: agentOpts.model,
        isolation: agentOpts.isolation,
        toolUseId: '',
        signal: opts.signal,
      });
      if (res.isError) {
        pushProgress(`[agent#${index}] ${display}: failed (${res.content.slice(0, 120)})`);
        return null;
      }
      let value: unknown = res.content;
      if (agentOpts.schema !== undefined) {
        value = parseStructured(res.content, agentOpts.schema);
        if (value === undefined) {
          pushProgress(
            `[agent#${index}] ${display}: reply did not match the requested schema; returning null`,
          );
          return null;
        }
      }
      const channel = JSON.stringify({ v: value });
      entry.completed = true;
      entry.result = channel;
      pushProgress(`[agent#${index}] ${display}: done`);
      return channel;
    } catch (err) {
      if (isAbort(err)) throw err;
      pushProgress(`[agent#${index}] ${display}: failed (${errorMessage(err)})`);
      return null;
    } finally {
      release();
    }
  };

  // ---- parallel() -----------------------------------------------------------
  const hostParallel = async (thunksRaw: unknown): Promise<unknown[]> => {
    if (!Array.isArray(thunksRaw)) {
      throw new WorkflowTypeError('parallel() expects an array of functions (thunks).');
    }
    if (thunksRaw.length > limits.maxCollectionItems) {
      throw new WorkflowScriptError(
        `parallel() accepts at most ${limits.maxCollectionItems} items; got ${thunksRaw.length}.`,
      );
    }
    thunksRaw.forEach((t, i) => {
      if (typeof t !== 'function') {
        throw new WorkflowTypeError(`parallel() item ${i} is not a function.`);
      }
    });
    // Barrier: awaits ALL thunks. A thunk that throws resolves to null in the
    // result array — the call itself never rejects (abort excepted).
    return Promise.all(
      thunksRaw.map((thunk, i) =>
        Promise.resolve()
          .then(() => (thunk as () => unknown)())
          .catch((err: unknown) => {
            if (isAbort(err)) throw err;
            pushProgress(`[parallel] item ${i} failed -> null (${errorMessage(err)})`);
            return null;
          }),
      ),
    );
  };

  // ---- pipeline() -----------------------------------------------------------
  const hostPipeline = async (itemsRaw: unknown, stagesRaw: unknown): Promise<unknown[]> => {
    if (!Array.isArray(itemsRaw)) throw new WorkflowTypeError('pipeline() expects an items array.');
    if (itemsRaw.length > limits.maxCollectionItems) {
      throw new WorkflowScriptError(
        `pipeline() accepts at most ${limits.maxCollectionItems} items; got ${itemsRaw.length}.`,
      );
    }
    const stages = Array.isArray(stagesRaw) ? stagesRaw : [];
    if (stages.length === 0) throw new WorkflowTypeError('pipeline() requires at least one stage.');
    stages.forEach((s, i) => {
      if (typeof s !== 'function') throw new WorkflowTypeError(`pipeline() stage ${i} is not a function.`);
    });
    // NO barrier between stages: each item runs through all stages on its own
    // chain. A stage that throws drops that item to null and skips the rest.
    return Promise.all(
      itemsRaw.map(async (item, index) => {
        let prev: unknown = item;
        for (let s = 0; s < stages.length; s += 1) {
          try {
            prev = await (stages[s] as (p: unknown, o: unknown, i: number) => unknown)(
              prev,
              item,
              index,
            );
          } catch (err) {
            if (isAbort(err)) throw err;
            pushProgress(
              `[pipeline] item ${index} dropped at stage ${s} -> null (${errorMessage(err)})`,
            );
            return null;
          }
        }
        return prev;
      }),
    );
  };

  // ---- phase() / log() ------------------------------------------------------
  const hostPhase = (titleRaw: unknown): void => {
    if (typeof titleRaw !== 'string' || titleRaw.length === 0) {
      throw new WorkflowTypeError('phase() requires a non-empty title string.');
    }
    currentPhase = titleRaw;
    pushProgress(`=== phase: ${titleRaw} ===`);
  };
  const hostLog = (message: unknown): void => {
    pushProgress(`[log] ${typeof message === 'string' ? message : String(message)}`);
  };

  // ---- script execution (shared by the top script and workflow() children) --
  const executeScript = async (
    source: string,
    scriptArgs: unknown,
    depth: number,
  ): Promise<{ meta: WorkflowMeta; value: unknown }> => {
    const parsed = parseWorkflowMeta(source);
    if (!parsed.ok) throw new WorkflowSyntaxError(parsed.error);
    let compiled: vm.Script;
    try {
      compiled = new vm.Script(`(async () => { 'use strict';\n${parsed.body}\n})()`, {
        filename: depth === 0 ? 'workflow.mjs' : `child-workflow.mjs`,
      });
    } catch (err) {
      throw new WorkflowSyntaxError(`script failed its syntax check: ${errorMessage(err)}`);
    }
    if (depth === 0) {
      topMeta = parsed.meta;
      started = true;
    }

    const hostWorkflow = async (refRaw: unknown, childArgs?: unknown): Promise<string | undefined> => {
      if (depth >= 1) {
        throw new WorkflowScriptError(
          'workflow() nesting is limited to one level: a child workflow cannot call workflow().',
        );
      }
      let childSource: string;
      let childLabel: string;
      if (typeof refRaw === 'string' && refRaw.length > 0) {
        if (opts.resolveWorkflow === undefined) {
          throw new WorkflowScriptError('workflow(name) is unavailable: no workflow registry in this context.');
        }
        childSource = opts.resolveWorkflow(refRaw); // throws on unknown name
        childLabel = refRaw;
      } else if (
        refRaw !== null &&
        typeof refRaw === 'object' &&
        typeof (refRaw as Record<string, unknown>)['scriptPath'] === 'string'
      ) {
        const p = (refRaw as Record<string, string>)['scriptPath']!;
        if (opts.readScript === undefined) {
          throw new WorkflowScriptError('workflow({scriptPath}) is unavailable: no script reader in this context.');
        }
        childSource = opts.readScript(p); // throws when unreadable
        childLabel = p;
      } else {
        throw new WorkflowTypeError('workflow() expects a workflow name string or {scriptPath: string}.');
      }
      pushProgress(`[workflow] running child "${childLabel}"`);
      // Child shares this run's concurrency cap, agent counter, journal,
      // abort signal and budget; child syntax errors throw into the parent
      // script (catchable), per the official contract.
      const child = await executeScript(childSource, childArgs, depth + 1);
      pushProgress(`[workflow] child "${child.meta.name}" completed`);
      if (child.value === undefined) return undefined;
      try {
        return JSON.stringify({ v: child.value });
      } catch (err) {
        throw new WorkflowScriptError(`workflow() child returned a non-JSON-serializable value: ${errorMessage(err)}`);
      }
    };

    let argsJson: string | undefined;
    if (scriptArgs !== undefined) {
      try {
        argsJson = JSON.stringify(scriptArgs);
      } catch (err) {
        throw new WorkflowSyntaxError(`workflow args are not JSON-serializable: ${errorMessage(err)}`);
      }
    }

    const context = vm.createContext(
      {
        __host_agent: hostAgent,
        __host_parallel: hostParallel,
        __host_pipeline: hostPipeline,
        __host_phase: hostPhase,
        __host_log: hostLog,
        __host_workflow: hostWorkflow,
        __host_args_json: argsJson,
      },
      { name: 'bpt-workflow' },
    );
    new vm.Script(PRELUDE, { filename: 'workflow-prelude.js' }).runInContext(context);
    const value: unknown = await compiled.runInContext(context, {
      timeout: SYNC_EVAL_TIMEOUT_MS,
    });
    return { meta: parsed.meta, value };
  };

  try {
    const { meta, value } = await executeScript(opts.script, opts.args, 0);
    return { ok: true, meta, value, progress, agentsLive, agentsCached, journal };
  } catch (err) {
    if (isAbort(err)) throw err;
    const base = {
      progress,
      agentsLive,
      agentsCached,
      journal,
      ...(topMeta !== undefined ? { meta: topMeta } : {}),
    };
    if (!started) {
      return { ok: false, stage: 'syntax', error: errorMessage(err), ...base };
    }
    const stack = err instanceof Error && err.stack !== undefined ? err.stack : undefined;
    return {
      ok: false,
      stage: 'runtime',
      error: errorMessage(err),
      ...(stack !== undefined ? { stack } : {}),
      ...base,
    };
  }
}
