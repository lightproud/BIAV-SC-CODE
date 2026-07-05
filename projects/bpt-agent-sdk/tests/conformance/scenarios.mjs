/**
 * L1 stream-grammar scenarios.
 *
 * Each scenario is one deterministic conversation both arms replay against
 * the content-blind emulator. `buildScripts(cwd)` produces the shared
 * model-side script against the arm's own throwaway cwd (each arm gets a
 * fresh one, so fixture paths are computed per run). `expect` is asserted
 * identically on both arms: a check failing on ONE arm is an engine
 * difference, failing on BOTH is a scenario bug.
 */

import { join } from 'node:path';
import { textReply, toolUseReply } from './emulator.mjs';

export const SCENARIOS = [
  {
    id: 'text-single-turn',
    prompt: 'Say OK.',
    fixtureFiles: {},
    buildScripts: () => [{ kind: 'sse', events: textReply('CONFORMANCE TEXT OK') }],
    expect: { resultSubtype: 'success', resultText: 'CONFORMANCE TEXT OK', toolResults: 0 },
  },
  {
    id: 'tool-read-loop',
    prompt: 'Read hello.txt and repeat the magic word.',
    fixtureFiles: { 'hello.txt': 'the magic word is PINEAPPLE\n' },
    buildScripts: (cwd) => [
      { kind: 'sse', events: toolUseReply([{ name: 'Read', input: { file_path: join(cwd, 'hello.txt') } }]) },
      { kind: 'sse', events: textReply('TOOL LOOP DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'TOOL LOOP DONE', toolResults: 1 },
  },
  {
    id: 'two-reads-one-turn',
    prompt: 'Read hello.txt and notes.txt.',
    fixtureFiles: { 'hello.txt': 'alpha content\n', 'notes.txt': 'beta content\n' },
    buildScripts: (cwd) => [
      {
        kind: 'sse',
        events: toolUseReply([
          { name: 'Read', input: { file_path: join(cwd, 'hello.txt') } },
          { name: 'Read', input: { file_path: join(cwd, 'notes.txt') } },
        ]),
      },
      { kind: 'sse', events: textReply('TWO READS DONE') },
    ],
    expect: { resultSubtype: 'success', resultText: 'TWO READS DONE', toolResults: 2 },
  },
];
