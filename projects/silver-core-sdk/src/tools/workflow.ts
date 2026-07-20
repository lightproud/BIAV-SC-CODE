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
 * HONEST ADAPTATION (documented in the tool description): the official tool
 * launches the workflow in the background and returns
 * `{status: "async_launched", taskId, ...}` immediately, with the result
 * arriving later as a task notification. This SDK has no background-task
 * delivery channel for tools (same gap as Monitor's push delivery), so the
 * workflow runs SYNCHRONOUSLY inside the tool call and the tool result
 * carries the consolidated outcome directly: the script's return value
 * (JSON-serialized), the progress transcript (phase()/log()/per-agent lines),
 * the runId for resume, and the persisted script path. The official
 * WorkflowOutput wire type is kept verbatim in src/tool-types.ts (wire type
 * over runtime subset — the MonitorInput.ws precedent).
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
  runWorkflow,
  type WorkflowJournalEntry,
  type WorkflowLimits,
} from './workflow-engine.js';
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

      const result = await runWorkflow({
        script: source,
        args: input['args'],
        spawnSubagent: ctx.spawnSubagent,
        signal: ctx.signal,
        debug: ctx.debug,
        ...(overrides?.limits !== undefined ? { limits: overrides.limits } : {}),
        ...(resumeJournal !== undefined ? { resumeJournal } : {}),
        resolveWorkflow: (n) => resolveNamedWorkflow(n, ctx.cwd).source,
        readScript: readScriptFile,
      });

      // Syntax stage: the script never ran — nothing to resume, no runId.
      if (!result.ok && result.stage === 'syntax') {
        return errorResult(
          `Workflow failed its syntax check and did not start.\nerror: ${result.error}`,
        );
      }

      // The run started (even if it then failed): mint a runId and store the
      // journal so a fixed script can resume over the completed prefix.
      const runId = `wf-run-${store.nextRunId}`;
      store.nextRunId += 1;
      store.journals.set(runId, result.journal);

      const lines: string[] = [];
      const metaName = title ?? result.meta?.name ?? '(unknown)';
      lines.push(
        result.ok ? `Workflow completed: ${metaName}` : `Workflow failed: ${metaName}`,
      );
      const summary = description ?? result.meta?.description;
      if (summary !== undefined) {
        lines.push(`summary: ${summary}`);
      }
      lines.push(`runId: ${runId} (pass as resumeFromRunId to resume; same session only)`);
      if (persistedPath !== undefined) {
        lines.push(`scriptPath: ${persistedPath} (edit and re-invoke with {scriptPath} to iterate)`);
      }
      lines.push(`agents: ${result.agentsLive} run live, ${result.agentsCached} from cache`);
      if (result.progress.length > 0) {
        lines.push('--- progress ---', ...result.progress);
      }
      if (result.ok) {
        lines.push('--- result ---', serializeValue(result.value));
        ctx.debug(
          `Workflow: run ${runId} ("${metaName}") completed — ` +
            `${result.agentsLive} live, ${result.agentsCached} cached`,
        );
        return { content: lines.join('\n') };
      }
      lines.push('--- error ---', result.error);
      if (result.stack !== undefined) lines.push(result.stack);
      ctx.debug(`Workflow: run ${runId} ("${metaName}") failed: ${result.error}`);
      return { content: lines.join('\n'), isError: true };
    },
  };
}

/** The default Workflow tool (official caps). */
export const workflowTool: BuiltinTool = createWorkflowTool();
