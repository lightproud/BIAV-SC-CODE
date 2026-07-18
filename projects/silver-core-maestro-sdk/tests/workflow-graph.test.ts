/**
 * Behavioral pin for the workflow graph pure core (mutation-testing target):
 * every validateGraph rejection branch, readiness under every blocking state,
 * and the graphStatus matrix including fail-fast precedence.
 */
import { describe, it, expect } from 'vitest';
import type { SessionState } from '../src/ledger/types.js';
import type { WorkflowGraph } from '../src/workflow/graph.js';
import { GraphError, graphStatus, readyNodes, validateGraph } from '../src/workflow/graph.js';

const node = (id: string, deps?: string[]) => ({
  id,
  intent: `intent:${id}`,
  ...(deps !== undefined ? { deps } : {}),
});

const diamond: WorkflowGraph = {
  id: 'dg',
  nodes: [node('a'), node('b', ['a']), node('c', ['a']), node('d', ['b', 'c'])],
};

describe('validateGraph', () => {
  it('accepts a valid diamond (shared dep is not a false cycle)', () => {
    expect(() => validateGraph(diamond)).not.toThrow();
  });

  it('rejects an empty graph id', () => {
    expect(() => validateGraph({ id: '', nodes: [node('a')] })).toThrow(GraphError);
    expect(() => validateGraph({ id: '', nodes: [node('a')] })).toThrow(/graph id/);
  });

  it('rejects a missing (non-string) graph id', () => {
    const graph = { id: undefined, nodes: [node('a')] } as unknown as WorkflowGraph;
    expect(() => validateGraph(graph)).toThrow(/graph id/);
  });

  it('rejects zero nodes', () => {
    expect(() => validateGraph({ id: 'g', nodes: [] })).toThrow(/at least one node/);
  });

  it('rejects duplicate node ids', () => {
    expect(() => validateGraph({ id: 'g', nodes: [node('a'), node('a')] })).toThrow(
      /duplicate node id 'a'/,
    );
  });

  it('rejects a dep referencing an unknown node', () => {
    expect(() => validateGraph({ id: 'g', nodes: [node('a', ['ghost'])] })).toThrow(
      /node 'a' depends on unknown node 'ghost'/,
    );
  });

  it('rejects a self-dependency', () => {
    expect(() => validateGraph({ id: 'g', nodes: [node('a', ['a'])] })).toThrow(
      /node 'a' depends on itself/,
    );
  });

  it('rejects a 3-node cycle and names the cycle path', () => {
    const graph: WorkflowGraph = {
      id: 'g',
      nodes: [node('a', ['c']), node('b', ['a']), node('c', ['b'])],
    };
    let caught: unknown;
    try {
      validateGraph(graph);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraphError);
    const err = caught as GraphError;
    expect(err.detail).toMatch(/dependency cycle: a -> c -> b -> a/);
    expect(err.message).toContain(err.detail);
    expect(err.name).toBe('GraphError');
  });

  it('rejects a 2-node cycle reached through an acyclic prefix', () => {
    const graph: WorkflowGraph = {
      id: 'g',
      nodes: [node('root'), node('x', ['root', 'y']), node('y', ['x'])],
    };
    expect(() => validateGraph(graph)).toThrow(/dependency cycle: (x -> y -> x|y -> x -> y)/);
  });
});

describe('readyNodes', () => {
  type States = Record<string, SessionState | undefined>;

  it('with no states, only roots are ready', () => {
    expect(readyNodes(diamond, {})).toEqual(['a']);
  });

  it('already-dispatched nodes are never ready, whatever their state', () => {
    const states: SessionState[] = ['pending', 'running', 'retrying', 'failed', 'done'];
    for (const state of states) {
      expect(readyNodes({ id: 'g', nodes: [node('a')] }, { a: state })).toEqual([]);
    }
  });

  it('a node becomes ready only when every dep is done', () => {
    expect(readyNodes(diamond, { a: 'done' })).toEqual(['b', 'c']);
    expect(readyNodes(diamond, { a: 'done', b: 'done', c: 'running' })).toEqual([]);
    expect(readyNodes(diamond, { a: 'done', b: 'done', c: 'done' })).toEqual(['d']);
  });

  it.each<SessionState>(['pending', 'running', 'retrying', 'failed'])(
    'dep state %s blocks readiness (fail-fast by construction for failed)',
    (state) => {
      const graph: WorkflowGraph = { id: 'g', nodes: [node('a'), node('b', ['a'])] };
      expect(readyNodes(graph, { a: state })).toEqual([]);
    },
  );

  it('an undispatched dep blocks readiness', () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('a'), node('b', ['a'])] };
    expect(readyNodes(graph, {})).toEqual(['a']);
  });

  it('multiple ready nodes preserve declaration order, not lexical order', () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('z'), node('m'), node('a')] };
    expect(readyNodes(graph, {})).toEqual(['z', 'm', 'a']);
    const withGate: WorkflowGraph = {
      id: 'g',
      nodes: [node('gate'), node('z', ['gate']), node('a', ['gate'])],
    };
    expect(readyNodes(withGate, { gate: 'done' })).toEqual(['z', 'a']);
  });

  it('mixed readiness: satisfied and unsatisfied nodes filter independently', () => {
    const states: States = { a: 'done', b: 'retrying' };
    expect(readyNodes(diamond, states)).toEqual(['c']);
  });
});

describe('graphStatus', () => {
  it('all done -> done', () => {
    expect(graphStatus(diamond, { a: 'done', b: 'done', c: 'done', d: 'done' })).toBe('done');
  });

  it('any failed -> failed, taking precedence over every other node being done', () => {
    expect(graphStatus(diamond, { a: 'done', b: 'failed', c: 'done', d: 'done' })).toBe('failed');
    expect(graphStatus(diamond, { a: 'failed' })).toBe('failed');
    expect(graphStatus(diamond, { a: 'done', b: 'running', c: 'failed' })).toBe('failed');
  });

  it.each<SessionState>(['pending', 'running', 'retrying'])(
    'a %s node keeps the run running',
    (state) => {
      expect(graphStatus(diamond, { a: 'done', b: 'done', c: 'done', d: state })).toBe('running');
    },
  );

  it('an undispatched node keeps the run running', () => {
    expect(graphStatus(diamond, { a: 'done', b: 'done', c: 'done' })).toBe('running');
    expect(graphStatus(diamond, {})).toBe('running');
  });
});

describe("id hygiene (review hardening 2026-07-18): ':' banned in graph/node ids", () => {
  it('rejects a colon in the graph id', () => {
    expect(() =>
      validateGraph({ id: 'etl:a', nodes: [{ id: 'n', intent: 'x' }] }),
    ).toThrow(/graph id must not contain ':'/);
  });
  it('rejects a colon in a node id', () => {
    expect(() =>
      validateGraph({ id: 'etl', nodes: [{ id: 'n:1', intent: 'x' }] }),
    ).toThrow(/node id must not contain ':'/);
  });
});

describe('audit D2: node id validation is GraphError, empty id rejected', () => {
  it('rejects a missing (non-string) node id with GraphError, not a raw TypeError', () => {
    const graph = { id: 'g', nodes: [{ id: undefined, intent: 'x' }] } as unknown as WorkflowGraph;
    expect(() => validateGraph(graph)).toThrow(GraphError);
    expect(() => validateGraph(graph)).toThrow(/node id must be a non-empty string/);
  });

  it('rejects a numeric node id with GraphError, not a raw TypeError', () => {
    const graph = { id: 'g', nodes: [{ id: 42, intent: 'x' }] } as unknown as WorkflowGraph;
    expect(() => validateGraph(graph)).toThrow(GraphError);
  });

  it('rejects an empty node id', () => {
    expect(() => validateGraph({ id: 'g', nodes: [{ id: '', intent: 'x' }] })).toThrow(GraphError);
    expect(() => validateGraph({ id: 'g', nodes: [{ id: '', intent: 'x' }] })).toThrow(
      /node id must be a non-empty string/,
    );
  });
});

describe('audit D5: statically invalid node fields rejected up front', () => {
  it('rejects an empty node intent', () => {
    expect(() => validateGraph({ id: 'g', nodes: [{ id: 'a', intent: '' }] })).toThrow(GraphError);
    expect(() => validateGraph({ id: 'g', nodes: [{ id: 'a', intent: '' }] })).toThrow(
      /node 'a' intent must be a non-empty string/,
    );
  });

  it('rejects a missing (non-string) node intent', () => {
    const graph = { id: 'g', nodes: [{ id: 'a', intent: undefined }] } as unknown as WorkflowGraph;
    expect(() => validateGraph(graph)).toThrow(GraphError);
  });

  it('rejects a non-integer maxAttempts', () => {
    expect(() =>
      validateGraph({ id: 'g', nodes: [{ id: 'a', intent: 'x', maxAttempts: 1.5 }] }),
    ).toThrow(/node 'a' maxAttempts must be an integer >= 1/);
  });

  it('rejects maxAttempts < 1 and NaN', () => {
    for (const bad of [0, -1, NaN]) {
      expect(() =>
        validateGraph({ id: 'g', nodes: [{ id: 'a', intent: 'x', maxAttempts: bad }] }),
      ).toThrow(GraphError);
    }
  });

  it('accepts maxAttempts: 1 and an undeclared maxAttempts', () => {
    expect(() =>
      validateGraph({ id: 'g', nodes: [{ id: 'a', intent: 'x', maxAttempts: 1 }] }),
    ).not.toThrow();
    expect(() => validateGraph({ id: 'g', nodes: [{ id: 'a', intent: 'x' }] })).not.toThrow();
  });
});

describe('audit D1: prototype-chain hygiene in keyed state lookups', () => {
  it("a node named 'toString' with no states is ready (no Object.prototype read)", () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('toString')] };
    expect(readyNodes(graph, {})).toEqual(['toString']);
  });

  it("nodes named 'constructor' and 'hasOwnProperty' are ready from empty states", () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('constructor'), node('hasOwnProperty')] };
    expect(readyNodes(graph, {})).toEqual(['constructor', 'hasOwnProperty']);
  });

  it("a dep named 'valueOf' that was never dispatched blocks its dependent (not fake-done)", () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('valueOf'), node('b', ['valueOf'])] };
    expect(readyNodes(graph, {})).toEqual(['valueOf']);
  });

  it("graphStatus treats an undispatched 'toString' node as running, and done when own-keyed done", () => {
    const graph: WorkflowGraph = { id: 'g', nodes: [node('toString')] };
    expect(graphStatus(graph, {})).toBe('running');
    const done = Object.create(null) as Record<string, SessionState | undefined>;
    done['toString'] = 'done';
    expect(graphStatus(graph, done)).toBe('done');
    expect(readyNodes(graph, done)).toEqual([]);
  });
});

describe('mutation kill round (2026-07-18): cycle path is EXACTLY the cycle', () => {
  it('strips the acyclic prefix and starts the report at the cycle entry', () => {
    const graph = {
      id: 'g',
      nodes: [
        { id: 'p', intent: 'x', deps: ['a'] },
        { id: 'a', intent: 'x', deps: ['b'] },
        { id: 'b', intent: 'x', deps: ['a'] },
      ],
    };
    try {
      validateGraph(graph);
      expect.unreachable('must throw');
    } catch (e) {
      // Exact cycle segment: a -> b -> a. The acyclic prefix p must NOT
      // appear, and no foreign text may leak into the path.
      expect((e as Error).message).toContain('a -> b -> a');
      expect((e as Error).message).not.toContain('p ->');
      expect((e as Error).message).not.toContain('Stryker');
    }
  });
});
