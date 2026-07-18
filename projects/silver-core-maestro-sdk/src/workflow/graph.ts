/**
 * Workflow graph — pure core (campaign 4, SCS-REQ orchestrator-sdk §3
 * "declarative graph executor; the graph definition is data").
 *
 * This file is the mutation-testing target: validation, readiness and status
 * are pure functions over plain data — no I/O, no clock, no store. Fail-fast
 * is structural: readiness requires every dependency to be 'done', so nothing
 * downstream of a failure can ever become ready.
 */

import type { SessionState } from '../ledger/types.js';

/** One node of a workflow graph. The whole graph is data (JSON-shaped). */
export interface WorkflowNode {
  id: string;
  /** Business intent for the node's ledger session (host vocabulary). */
  intent: string;
  /** Opaque host payload, wrapped (not replaced) by the dispatch envelope. */
  payload?: unknown;
  /** Ids of nodes that must be 'done' before this node may dispatch. */
  deps?: string[];
  /** Per-node retry ceiling forwarded to the ledger session. */
  maxAttempts?: number;
}

export interface WorkflowGraph {
  id: string;
  nodes: WorkflowNode[];
}

/** Aggregate run state derived from per-node session states. */
export type WorkflowStatus = 'running' | 'done' | 'failed';

/** Graph-definition rejection; `detail` carries the machine-stable reason. */
export class GraphError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`invalid workflow graph: ${detail}`);
    this.name = 'GraphError';
    this.detail = detail;
  }
}

/**
 * Throws GraphError unless the graph is well-formed: non-empty graph id, at
 * least one node, unique node ids, every dep referencing a declared node, no
 * self-dependency, no dependency cycle (one cycle path is named on failure).
 */
export function validateGraph(graph: WorkflowGraph): void {
  if (typeof graph.id !== 'string' || graph.id.length === 0) {
    throw new GraphError('graph id must be a non-empty string');
  }
  // ':' is the session-id segment separator (wf:{graph}:{run}:{node}); a colon
  // inside the graph id or a node id collides distinct runs onto one session
  // id (review finding 2026-07-18).
  if (graph.id.includes(':')) {
    throw new GraphError(`graph id must not contain ':' (got '${graph.id}')`);
  }
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new GraphError(`graph '${graph.id}' must declare at least one node`);
  }
  const byId = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) {
      throw new GraphError(`duplicate node id '${node.id}'`);
    }
    if (node.id.includes(':')) {
      throw new GraphError(`node id must not contain ':' (got '${node.id}')`);
    }
    byId.set(node.id, node);
  }
  for (const node of graph.nodes) {
    for (const dep of node.deps ?? []) {
      if (dep === node.id) {
        throw new GraphError(`node '${node.id}' depends on itself`);
      }
      if (!byId.has(dep)) {
        throw new GraphError(`node '${node.id}' depends on unknown node '${dep}'`);
      }
    }
  }
  // Cycle detection: DFS along dep edges with an explicit path so the error
  // can name one concrete cycle (a -> b -> c -> a), not just "cycle exists".
  const finished = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  const dfs = (id: string): string[] | null => {
    if (finished.has(id)) return null;
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
    visiting.add(id);
    path.push(id);
    for (const dep of byId.get(id)?.deps ?? []) {
      const cycle = dfs(dep);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(id);
    finished.add(id);
    return null;
  };
  for (const node of graph.nodes) {
    const cycle = dfs(node.id);
    if (cycle !== null) {
      throw new GraphError(`dependency cycle: ${cycle.join(' -> ')}`);
    }
  }
}

/**
 * Node ids ready to dispatch: not yet dispatched (states[id] === undefined)
 * with every dependency 'done'. Order follows graph declaration order —
 * deterministic fan-out without any scheduler policy in the SDK.
 */
export function readyNodes(
  graph: WorkflowGraph,
  states: Record<string, SessionState | undefined>,
): string[] {
  return graph.nodes
    .filter(
      (node) =>
        states[node.id] === undefined &&
        (node.deps ?? []).every((dep) => states[dep] === 'done'),
    )
    .map((node) => node.id);
}

/**
 * Aggregate status. Any 'failed' node fails the run immediately (fail-fast
 * precedence — checked before completeness); all nodes 'done' completes it;
 * anything else (undispatched / pending / running / retrying) keeps it
 * running.
 */
export function graphStatus(
  graph: WorkflowGraph,
  states: Record<string, SessionState | undefined>,
): WorkflowStatus {
  let allDone = true;
  for (const node of graph.nodes) {
    const state = states[node.id];
    if (state === 'failed') return 'failed';
    if (state !== 'done') allDone = false;
  }
  return allDone ? 'done' : 'running';
}
