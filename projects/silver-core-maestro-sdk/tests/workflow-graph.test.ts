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
