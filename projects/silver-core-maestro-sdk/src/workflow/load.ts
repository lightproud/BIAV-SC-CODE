/**
 * Declarative workflow-graph loading (keeper todo 2026-07-18 item 4; SCS-REQ
 * orchestrator-sdk §3 "the graph definition is data, lives in the capability
 * hot layer, flow changes deploy nothing").
 *
 * Hot-layer gate semantics: a definition FILE is host-editable content, so a
 * malformed one must DEGRADE TO SKIP — these functions never throw. Every
 * failure comes back as `{ ok: false, error }` for the host to log and move
 * past; only an `ok: true` result carries a graph, and that graph has already
 * passed `validateGraph` (a returned graph is always runnable).
 *
 * Two formats:
 *  - `json`: the file IS the WorkflowGraph object;
 *  - `md`:   a markdown capability file carrying the graph in its FIRST
 *            ```json fenced block (prose/frontmatter around it is free-form).
 */

import { readFile } from 'node:fs/promises';
import { GraphError, validateGraph, type WorkflowGraph } from './graph.js';

export type WorkflowGraphSourceFormat = 'json' | 'md';

export type WorkflowGraphLoadResult =
  | { ok: true; graph: WorkflowGraph; format: WorkflowGraphSourceFormat }
  | { ok: false; error: string };

/**
 * Extract the FIRST top-level ```json / ```workflow fence body. A line
 * scanner, not a regex (audit r2): a regex match also fired on fences quoted
 * INSIDE another fence (e.g. a ```md block documenting a graph) or indented
 * example blocks, silently loading the wrong definition. Fences only count
 * when opened at top level with <= 3 leading spaces; any other fence opens an
 * opaque region skipped until its closing line.
 */
function extractTopLevelFence(source: string): string | null {
  const lines = source.split('\n');
  let inOtherFence = false;
  let capturing = false;
  const body: string[] = [];
  for (const line of lines) {
    const m = /^ {0,3}```(.*)$/.exec(line);
    if (m !== null) {
      // The capture group always participates in a match (possibly empty),
      // so no ?? fallback exists here — it would be dead code.
      const info = (m[1] as string).trim();
      if (capturing) return body.join('\n');
      if (inOtherFence) {
        if (info === '') inOtherFence = false;
        continue;
      }
      if (info === 'json' || info === 'workflow') capturing = true;
      else inOtherFence = true;
      continue;
    }
    if (capturing) body.push(line);
  }
  return null;
}

function fail(error: string): WorkflowGraphLoadResult {
  return { ok: false, error };
}

/**
 * Parse a graph definition from source text. `format` defaults by sniffing:
 * a source whose first non-whitespace character is `{` is json, else md.
 * Never throws.
 */
export function parseWorkflowGraphSource(
  source: string,
  format?: WorkflowGraphSourceFormat,
): WorkflowGraphLoadResult {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return fail('empty graph definition source');
  }
  const fmt: WorkflowGraphSourceFormat =
    format ?? (source.trimStart().startsWith('{') ? 'json' : 'md');
  let jsonText: string;
  if (fmt === 'json') {
    jsonText = source;
  } else {
    const fenceBody = extractTopLevelFence(source);
    if (fenceBody === null) {
      return fail('md graph definition has no top-level ```json fenced block');
    }
    jsonText = fenceBody;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return fail(`graph definition is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('graph definition must be a JSON object');
  }
  const graph = parsed as WorkflowGraph;
  try {
    validateGraph(graph);
  } catch (err) {
    if (err instanceof GraphError) return fail(err.message);
    return fail(`graph validation failed: ${(err as Error).message}`);
  }
  return { ok: true, graph, format: fmt };
}

/**
 * Load a graph definition file (`.json` or `.md`; other extensions are
 * format-sniffed). A missing/unreadable file degrades to `{ ok: false }`
 * exactly like a malformed one — the hot-layer skip gate. Never throws.
 */
export async function loadWorkflowGraphFile(
  filePath: string,
): Promise<WorkflowGraphLoadResult> {
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (err) {
    return fail(`cannot read graph definition file '${filePath}': ${(err as Error).message}`);
  }
  const format = filePath.endsWith('.json')
    ? ('json' as const)
    : filePath.endsWith('.md')
      ? ('md' as const)
      : undefined;
  return parseWorkflowGraphSource(source, format);
}
