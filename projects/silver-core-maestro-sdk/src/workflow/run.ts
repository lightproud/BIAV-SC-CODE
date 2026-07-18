/**
 * WorkflowRun — dispatch orchestration over the task ledger (campaign 4,
 * SCS-REQ orchestrator-sdk §3 "declarative graph executor" + §6.3 fan-out /
 * converge example).
 *
 * Division of labor: this class only READS session states and DISPATCHES
 * ready nodes — node sessions are executed by the host's LedgerDriver, never
 * here. Deterministic session ids make dispatch idempotent, and idempotent
 * dispatch IS the resume story: a fresh WorkflowRun over the same store
 * continues exactly where the last one stopped. All time goes through the
 * injected clock (no bare globals in src).
 */

import type { Clock } from '../clock.js';
import { systemClock } from '../clock.js';
import type { TaskLedger } from '../ledger/ledger.js';
import { DuplicateSessionError } from '../ledger/ledger.js';
import type { SessionState } from '../ledger/types.js';
import type { WorkflowGraph, WorkflowNode, WorkflowStatus } from './graph.js';
import { graphStatus, readyNodes, validateGraph } from './graph.js';

/** Deterministic per-node session id — the idempotency/resume key. */
export function workflowSessionId(graphId: string, runId: string, nodeId: string): string {
  return `wf:${graphId}:${runId}:${nodeId}`;
}

/** Convergence context delivered to every node session (§6.3 合入). */
export interface WorkflowNodeContext {
  graphId: string;
  runId: string;
  nodeId: string;
  /** depId -> summary of the dep's last ok query row, or null if it had none. */
  deps: Record<string, string | null>;
}

/** Envelope dispatched as the node session's payload. */
export interface WorkflowNodePayload {
  /** The node's own declared payload, untouched. */
  node: unknown;
  workflow: WorkflowNodeContext;
}

export interface WorkflowRunOptions {
  ledger: TaskLedger;
  graph: WorkflowGraph;
  /** Distinguishes runs of the same graph over the same store (non-empty). */
  runId: string;
  clock?: Clock;
  /** run() tick cadence (default 300 ms). */
  pollIntervalMs?: number;
}

export interface WorkflowRunResult {
  status: 'done' | 'failed';
  /**
   * Per-node session state at settle time (undefined = never dispatched).
   * Null-prototype object: keys are node ids, which may collide with
   * Object.prototype member names (audit D4).
   */
  states: Record<string, SessionState | undefined>;
}

export class WorkflowRun {
  readonly #ledger: TaskLedger;
  readonly #graph: WorkflowGraph;
  readonly #runId: string;
  readonly #clock: Clock;
  readonly #pollIntervalMs: number;

  constructor(opts: WorkflowRunOptions) {
    validateGraph(opts.graph);
    if (typeof opts.runId !== 'string' || opts.runId.length === 0) {
      throw new TypeError('WorkflowRun: runId must be a non-empty string');
    }
    // ':' is the session-id segment separator (wf:{graph}:{run}:{node}); a
    // colon inside any segment lets distinct runs collide on the same session
    // id and silently adopt each other's records (review finding 2026-07-18).
    if (opts.runId.includes(':')) {
      throw new TypeError(`WorkflowRun: runId must not contain ':' (got '${opts.runId}')`);
    }
    const pollIntervalMs = opts.pollIntervalMs ?? 300;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new RangeError('WorkflowRun: pollIntervalMs must be a finite number >= 0');
    }
    this.#ledger = opts.ledger;
    this.#graph = opts.graph;
    this.#runId = opts.runId;
    this.#clock = opts.clock ?? systemClock;
    this.#pollIntervalMs = pollIntervalMs;
  }

  /** The ledger session id this run uses for a node. */
  sessionId(nodeId: string): string {
    return workflowSessionId(this.#graph.id, this.#runId, nodeId);
  }

  async #readStates(): Promise<Record<string, SessionState | undefined>> {
    // Null prototype: node ids are host data, and states['__proto__'] = ...
    // on a plain object would silently set the prototype instead of recording
    // the state, leaving the node forever undispatchable (audit D4).
    const states: Record<string, SessionState | undefined> = Object.create(null) as Record<
      string,
      SessionState | undefined
    >;
    for (const node of this.#graph.nodes) {
      const session = await this.#ledger.getSession(this.sessionId(node.id));
      states[node.id] = session?.state;
    }
    return states;
  }

  /** Summary of each dep's last ok query row (null when it carried none). */
  async #depSummaries(deps: readonly string[]): Promise<Record<string, string | null>> {
    // Null prototype for the same reason as #readStates: a dep id like
    // '__proto__' must land as an own key of the convergence map.
    const out: Record<string, string | null> = Object.create(null) as Record<
      string,
      string | null
    >;
    for (const depId of deps) {
      const rows = await this.#ledger.listQueries(this.sessionId(depId));
      let summary: string | null = null;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row !== undefined && row.outcome === 'ok') {
          summary = row.summary ?? null;
          break;
        }
      }
      out[depId] = summary;
    }
    return out;
  }

  async #dispatchNode(node: WorkflowNode): Promise<void> {
    const payload: WorkflowNodePayload = {
      node: node.payload,
      workflow: {
        graphId: this.#graph.id,
        runId: this.#runId,
        nodeId: node.id,
        deps: await this.#depSummaries(node.deps ?? []),
      },
    };
    try {
      await this.#ledger.dispatch({
        id: this.sessionId(node.id),
        intent: node.intent,
        payload,
        ...(node.maxAttempts !== undefined ? { maxAttempts: node.maxAttempts } : {}),
      });
    } catch (error) {
      // Duplicate id = a previous run already dispatched this node; keeping
      // its record (not re-running) is the whole resume contract. TYPED match
      // only — a message match would misread coincidental store errors.
      if (!(error instanceof DuplicateSessionError)) {
        throw error;
      }
    }
  }

  /**
   * One orchestration step: read node states, dispatch every ready node,
   * report aggregate status. Freshly dispatched nodes count as running (their
   * pre-dispatch state was undefined), never as done.
   */
  async tick(): Promise<WorkflowStatus> {
    const states = await this.#readStates();
    for (const nodeId of readyNodes(this.#graph, states)) {
      const node = this.#graph.nodes.find((n) => n.id === nodeId);
      if (node !== undefined) await this.#dispatchNode(node);
    }
    return graphStatus(this.#graph, states);
  }

  /**
   * Tick-loop on the injected clock until the run settles. Throws on
   * drainTimeoutMs exceeded (unset = wait indefinitely); the host's driver
   * must be running for the loop to make progress.
   */
  async run(opts: { drainTimeoutMs?: number } = {}): Promise<WorkflowRunResult> {
    // A NaN drainTimeoutMs makes the deadline comparison always false and
    // silently disables the timeout; Infinity and <= 0 are equally
    // meaningless as a drain budget (audit D3).
    if (
      opts.drainTimeoutMs !== undefined &&
      (!Number.isFinite(opts.drainTimeoutMs) || opts.drainTimeoutMs <= 0)
    ) {
      throw new RangeError(
        `WorkflowRun: drainTimeoutMs must be a finite number > 0, got ${opts.drainTimeoutMs}`,
      );
    }
    const deadline =
      opts.drainTimeoutMs !== undefined ? this.#clock.now() + opts.drainTimeoutMs : null;
    for (;;) {
      const status = await this.tick();
      if (status !== 'running') {
        return { status, states: await this.#readStates() };
      }
      if (deadline !== null && this.#clock.now() >= deadline) {
        throw new Error(
          `WorkflowRun: drain timeout after ${opts.drainTimeoutMs} ms ` +
            `(graph '${this.#graph.id}', run '${this.#runId}' still running)`,
        );
      }
      await new Promise<void>((resolve) => {
        this.#clock.setTimeout(resolve, this.#pollIntervalMs);
      });
    }
  }
}
