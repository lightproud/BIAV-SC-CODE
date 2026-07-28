/**
 * Workflow built-in tool (B4c): deterministic multi-subagent orchestration.
 *
 * Official input schema (0.3.201 docs snapshot / 2.1.198 prompt archive) is
 * implemented in full: `script` (inline, main path), `scriptPath` (takes
 * precedence over script and name), `name` (resolved from `.claude/workflows/`
 * under the session cwd — this SDK ships no built-in named workflows), `args`
 * (exposed to the script as the global `args`), and `resumeFromRunId`
 * (in-memory prefix cache, same session only). The official live wire schema
 * additionally carries the display params `title` and `description`
 * (conformance wire reference, tests/conformance/wire-reference.json); both
 * are implemented as run labels (they override meta.name / meta.description
 * in the result header) so the params surface byte-matches the reference.
 *
 * ASYNC since v0.92.0 (keeper ruling 2026-07-27, "1 改"). Official launches the
 * workflow in the background and returns `{status: "async_launched", taskId}`
 * immediately; this tool did the opposite — it ran the whole workflow inside
 * the tool call and returned the finished result. The two could not be
 * reconciled at the type level, and faking it was worse than the gap: emitting
 * `status: 'async_launched'` from a synchronous run hands the caller a claim
 * ticket for goods it is already holding, and it will go looking for a task
 * that finished before the ticket was printed. So the BEHAVIOUR moved.
 *
 * The run is registered in the SAME background-task id space TaskOutput and
 * TaskStop already serve (`ShellManager.registerTask`), rather than getting a
 * registry and a pair of tools of its own — a model holding a task id should
 * not have to know which kind of background thing produced it.
 *
 * Three things this deliberately does NOT claim:
 *  - No `<task-notification>` push. Official's harness delivers one; this
 *    engine has no such channel for tool-launched work (the subagent runtime's
 *    drain is agent-only). The ack says "read it with TaskOutput", which is
 *    what actually happens, instead of promising a delivery that never comes.
 *  - No `transcriptDir`. There is none; the field stays absent.
 *  - Syntax errors stay SYNCHRONOUS (`checkWorkflowSyntax` pre-flight), the way
 *    official documents them. A typo must not ack as launched and surface a
 *    turn later.
 *
 * Requires a query-lifetime signal (`ctx.lifeSignal`) and a shell manager. With
 * either missing — bare tool use outside query() — the tool runs the workflow
 * synchronously and says so, rather than detaching work onto a per-turn signal
 * that would kill it at the turn boundary.
 *
 * Run journals are kept per session, keyed on the shared `readFilePaths` Set
 * exactly like the Task tools' store (src/tools/task.ts precedent), so a
 * resumed invocation in the same query finds its prior run's journal. Bare
 * tool use outside query() falls back to keying on the ToolContext itself.
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';
import {
  checkWorkflowSyntax,
  runWorkflow,
  type WorkflowJournalEntry,
  type WorkflowLimits,
  type WorkflowRunResult,
} from './workflow-engine.js';
import type { WorkflowOutput } from '../types/tools.js';
import { WORKFLOW_DESCRIPTION } from './descriptions.js';
import { sliceSurrogateSafe } from '../internal/text.js';

// ---------------------------------------------------------------------------
// Per-session run registry (resume journals). WeakMap so a finished query's
// journals are collectable; key selection mirrors src/tools/task.ts.
// ---------------------------------------------------------------------------

/** Input-resolution failures (bad name/scriptPath); module-private sentinel
 *  per the error-discipline whitelist (tests/error-discipline.test.ts). */
class WorkflowInputError extends Error {}

type RunStore = {
  nextRunId: number;
  journals: Map<string, WorkflowJournalEntry[]>;
};

const RUN_STORES = new WeakMap<object, RunStore>();

function storeFor(ctx: ToolContext): RunStore {
  const key = ctx.readFilePaths ?? ctx;
  let store = RUN_STORES.get(key);
  if (store === undefined) {
    store = { nextRunId: 1, journals: new Map() };
    RUN_STORES.set(key, store);
  }
  return store;
}

// ---------------------------------------------------------------------------
// Script resolution
// ---------------------------------------------------------------------------

/** Resolve a saved workflow name under `{cwd}/.claude/workflows/`. Tries the
 *  exact name, then `.js` / `.mjs`. Throws a descriptive Error when absent. */
function resolveNamedWorkflow(name: string, cwd: string): { path: string; source: string } {
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new WorkflowInputError(`invalid workflow name "${name}": names cannot contain path separators.`);
  }
  const dir = join(cwd, '.claude', 'workflows');
  for (const candidate of [name, `${name}.js`, `${name}.mjs`]) {
    const p = join(dir, candidate);
    try {
      if (statSync(p).isFile()) return { path: p, source: readFileSync(p, 'utf8') };
    } catch {
      // try the next candidate
    }
  }
  throw new WorkflowInputError(
    `unknown workflow "${name}": no matching file under ${dir} ` +
      '(this SDK ships no built-in named workflows).',
  );
}

function readScriptFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    throw new WorkflowInputError(
      `could not read workflow script at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Persist an inline script so it can be edited and re-invoked via scriptPath
 *  (official iteration loop). Best-effort: returns undefined on fs failure. */
function persistScript(source: string): string | undefined {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'bpt-workflow-'));
    const p = join(dir, 'workflow.mjs');
    writeFileSync(p, source, 'utf8');
    return p;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Result rendering
// ---------------------------------------------------------------------------

/** Cap on the serialized return value embedded in the tool result. */
const MAX_RESULT_CHARS = 100_000;

function serializeValue(value: unknown): string {
  if (value === undefined) return '(script returned no value)';
  let json: string;
  try {
    json = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    json = String(value);
  }
  if (json.length > MAX_RESULT_CHARS) {
    // Surrogate-safe cut (audit r4 R7s-3): a bare .slice() landing inside an
    // astral codepoint puts a lone surrogate into the tool result, which the
    // wire then serializes as U+FFFD.
    return `${sliceSurrogateSafe(json, MAX_RESULT_CHARS)}\n[...] result truncated at ${MAX_RESULT_CHARS} characters`;
  }
  return json;
}

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

/** Build the Workflow tool. `overrides.limits` is a test seam for the
 *  concurrency / lifetime / collection caps (defaults are the official
 *  numbers: min(16, cores-2) concurrent, 1000 lifetime, 4096 per call). */
export function createWorkflowTool(overrides?: {
  limits?: Partial<WorkflowLimits>;
}): BuiltinTool {
  return {
    name: 'Workflow',
    description: WORKFLOW_DESCRIPTION,
    // Spawns subagents that can themselves mutate state; same permission
    // posture as the Agent tool (never auto-approved as read-only).
    readOnly: false,
    isFileEdit: false,
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description:
            'Inline workflow script. Must begin with `export const meta = { name, description }` ' +
            'as a pure literal, followed by the script body using agent(), parallel(), ' +
            'pipeline(), and phase().',
        },
        name: {
          type: 'string',
          description:
            'Name of a workflow saved in .claude/workflows/ (resolved against the working ' +
            'directory). This SDK ships no built-in named workflows.',
        },
        scriptPath: {
          type: 'string',
          description:
            'Path to a workflow script file on disk. Takes precedence over script and name. ' +
            'Every invocation persists its script and returns the path in the result, so you ' +
            'can edit that file and re-invoke with the same scriptPath to iterate.',
        },
        args: {
          description:
            'Input value exposed to the script as the global `args`, for parameterized ' +
            'workflows. Pass arrays and objects as actual JSON values, not as a JSON-encoded ' +
            'string.',
        },
        title: {
          type: 'string',
          description:
            'Short display title for this run; labels the run header of the tool result. ' +
            'Defaults to meta.name.',
        },
        description: {
          type: 'string',
          description:
            'One-line description of what this workflow run does; shown as the summary line ' +
            'of the tool result. Defaults to meta.description.',
        },
        resumeFromRunId: {
          type: 'string',
          description:
            'Run ID of a prior Workflow invocation to resume. Completed agent() calls with ' +
            'unchanged inputs return cached results; only changed or new calls run live. ' +
            'Same session only.',
        },
      },
      required: [],
    },
    async execute(
      input: Record<string, unknown>,
      ctx: ToolContext,
    ): Promise<ToolResultPayload> {
      if (ctx.signal.aborted) throw new AbortError();

      for (const field of [
        'script',
        'name',
        'scriptPath',
        'resumeFromRunId',
        'title',
        'description',
      ] as const) {
        const raw = input[field];
        if (raw !== undefined && (typeof raw !== 'string' || raw.length === 0)) {
          return errorResult(`Workflow failed: "${field}" must be a non-empty string when provided.`);
        }
      }
      const script = input['script'] as string | undefined;
      const name = input['name'] as string | undefined;
      const scriptPath = input['scriptPath'] as string | undefined;
      const resumeFromRunId = input['resumeFromRunId'] as string | undefined;
      // Display fields (official wire params): label the run in the result;
      // meta.name / meta.description are the fallbacks.
      const title = input['title'] as string | undefined;
      const description = input['description'] as string | undefined;

      // Resolve the script source. Official precedence: scriptPath > script > name;
      // at least one of the three is required.
      let source: string;
      let persistedPath: string | undefined;
      try {
        if (scriptPath !== undefined) {
          source = readScriptFile(scriptPath);
          persistedPath = scriptPath;
        } else if (script !== undefined) {
          source = script;
          persistedPath = persistScript(script);
        } else if (name !== undefined) {
          const resolved = resolveNamedWorkflow(name, ctx.cwd);
          source = resolved.source;
          persistedPath = resolved.path;
        } else {
          return errorResult(
            'Workflow failed: at least one of "script", "name", or "scriptPath" is required.',
          );
        }
      } catch (err) {
        return errorResult(
          `Workflow failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const store = storeFor(ctx);
      let resumeJournal: WorkflowJournalEntry[] | undefined;
      if (resumeFromRunId !== undefined) {
        resumeJournal = store.journals.get(resumeFromRunId);
        if (resumeJournal === undefined) {
          return errorResult(
            `Workflow failed: unknown run ID "${resumeFromRunId}" — resume works within the ` +
              'same session only (run journals are kept in memory).',
          );
        }
      }

      const runOptions = {
        script: source,
        args: input['args'],
        spawnSubagent: ctx.spawnSubagent,
        debug: ctx.debug,
        ...(overrides?.limits !== undefined ? { limits: overrides.limits } : {}),
        ...(resumeJournal !== undefined ? { resumeJournal } : {}),
        resolveWorkflow: (n: string) => resolveNamedWorkflow(n, ctx.cwd).source,
        readScript: readScriptFile,
      };

      // Pre-flight. Official documents Workflow as returning immediately AND
      // as throwing on a syntax error; both hold only if the verdict is
      // reached before the run detaches. A typo'd script must not ack as
      // launched and then surface its error a turn later.
      const syntax = checkWorkflowSyntax(source);
      if (!syntax.ok) {
        return errorResult(
          `Workflow failed its syntax check and did not start.\nerror: ${syntax.error}`,
        );
      }
      const metaName = title ?? syntax.meta.name ?? '(unknown)';
      const summary = description ?? syntax.meta.description;

      const runId = `wf-run-${store.nextRunId}`;
      store.nextRunId += 1;

      /** Shared renderer so the async transcript and the sync fallback agree. */
      const renderResult = (result: WorkflowRunResult): string => {
        const lines: string[] = [
          result.ok ? `Workflow completed: ${metaName}` : `Workflow failed: ${metaName}`,
        ];
        if (summary !== undefined) lines.push(`summary: ${summary}`);
        lines.push(`runId: ${runId} (pass as resumeFromRunId to resume; same session only)`);
        if (persistedPath !== undefined) {
          lines.push(
            `scriptPath: ${persistedPath} (edit and re-invoke with {scriptPath} to iterate)`,
          );
        }
        lines.push(`agents: ${result.agentsLive} run live, ${result.agentsCached} from cache`);
        if (result.progress.length > 0) lines.push('--- progress ---', ...result.progress);
        if (result.ok) {
          lines.push('--- result ---', serializeValue(result.value));
        } else {
          lines.push('--- error ---', result.error);
          if (result.stack !== undefined) lines.push(result.stack);
        }
        return lines.join('\n');
      };

      const shells = ctx.shells;
      const lifeSignal = ctx.lifeSignal;

      // SYNCHRONOUS FALLBACK. Reached only outside query() (bare tool use, unit
      // tests): with no query-lifetime signal there is nothing safe to detach
      // onto — driving background work off the per-TURN signal would ack the
      // launch and then kill the run at the turn boundary, silently. Running
      // it here and saying so is the honest degradation.
      if (shells === undefined || lifeSignal === undefined) {
        const result = await runWorkflow({ ...runOptions, signal: ctx.signal });
        if (!result.ok && result.stage === 'syntax') {
          return errorResult(
            `Workflow failed its syntax check and did not start.\nerror: ${result.error}`,
          );
        }
        store.journals.set(runId, result.journal);
        const body = renderResult(result);
        ctx.debug(`Workflow: run ${runId} ("${metaName}") finished inline (no background host)`);
        return {
          content:
            'Ran inline: this context has no background-task host, so the workflow ' +
            `did NOT launch asynchronously.\n${body}`,
          ...(result.ok ? {} : { isError: true }),
        };
      }

      // ASYNC PATH. The run is driven by the QUERY-lifetime signal plus its own
      // stop controller, never by the turn signal.
      const stopper = new AbortController();
      const handle = shells.registerTask({
        label: `Workflow: ${metaName}`,
        onStop: () => stopper.abort(),
      });
      const runSignal = AbortSignal.any([lifeSignal, stopper.signal]);

      handle.write(`Workflow launched: ${metaName} (taskId: ${handle.id}, runId: ${runId})`);
      void (async () => {
        try {
          const result = await runWorkflow({ ...runOptions, signal: runSignal });
          store.journals.set(runId, result.journal);
          handle.write(renderResult(result));
          handle.finish(result.ok ? 0 : 1);
          ctx.debug(
            `Workflow: run ${runId} ("${metaName}") ${result.ok ? 'completed' : 'failed'} ` +
              `in background task ${handle.id}`,
          );
        } catch (err) {
          // An abort here is a TaskStop or query teardown; `finish` keeps the
          // 'killed' verdict a stop already recorded rather than overwriting
          // it with 'failed'.
          const message = err instanceof Error ? err.message : String(err);
          handle.writeErr(`Workflow aborted: ${message}`);
          handle.finish(1);
          ctx.debug(`Workflow: background task ${handle.id} aborted: ${message}`);
        }
      })();

      const ack = [
        `Launched workflow "${metaName}" in the background.`,
        `taskId: ${handle.id} — read its progress and result with TaskOutput, stop it with TaskStop.`,
        `runId: ${runId} (pass as resumeFromRunId to resume; same session only)`,
      ];
      if (summary !== undefined) ack.splice(1, 0, `summary: ${summary}`);
      if (persistedPath !== undefined) {
        ack.push(`scriptPath: ${persistedPath} (edit and re-invoke with {scriptPath} to iterate)`);
      }
      return {
        content: ack.join('\n'),
        // Now honestly official-shaped: the launch really did happen, and the
        // id really is one TaskOutput/TaskStop accept. `transcriptDir` stays
        // absent — this engine has none.
        structuredOutput: {
          status: 'async_launched',
          taskId: handle.id,
          runId,
          ...(summary !== undefined ? { summary } : {}),
          ...(persistedPath !== undefined ? { scriptPath: persistedPath } : {}),
        } satisfies WorkflowOutput,
      };
    },
  };
}

/** The default Workflow tool (official caps). */
export const workflowTool: BuiltinTool = createWorkflowTool();
