/**
 * L3 tool-behavior differential scenarios.
 *
 * Each dual-arm case scripts one tool_use per turn (inputs rewritten against
 * each arm's own mkdtemp cwd via buildScripts(cwd, ctx)); BOTH engines
 * execute the real tool; the runner extracts each arm's tool_result blocks
 * from its PUBLIC SDKMessage stream and compares them after L3 normalization
 * (normalize-l3.mjs). Side effects (file bytes in the scenario cwd) are
 * asserted HARD - never KD-excusable - except where a declared behavioral
 * divergence makes them legitimately differ per arm (encoded IN the case as
 * perArm expectations, not silently normalized).
 *
 * Step shape (steps[i] pairs with the i-th tool_result of the run):
 *   tool           - name, for reporting
 *   isError        - boolean asserted on BOTH arms, or { ours, official }
 *                    (undefined side = not asserted)
 *   locks          - regexes that must match the NORMALIZED text on both arms
 *   oursLocks / officialLocks - per-arm semantic locks
 *   notLocks       - regexes that must NOT match on either arm
 *   kd             - KD-L3 ids this step may consume (unlisted diff stays
 *                    DIVERGENT)
 *   crossCompare   - false for behavioral splits where the texts are expected
 *                    to disagree by design (per-arm locks carry the assertion;
 *                    behavioralKd records the split as a reported known diff)
 *   flags          - normalization opt-ins (maskTiming/maskTimestamps/sortLines)
 *
 * Permissions: allowedTools (NOT permissionMode bypassPermissions - the
 * official claude-code refuses bypass when running as root without
 * IS_SANDBOX=1, a real CI risk) so both arms auto-approve non-readonly tools.
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { textReply } from './emulator.mjs';

const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'BashOutput',
  'KillShell',
  'Glob',
  'Grep',
];

/**
 * Scripted assistant turn issuing tool_use blocks with UNIQUE ids per turn
 * (toolu_l3_t<turn>_<n>). The M1 toolUseReply helper reuses toolu_conf_N
 * every turn, which is fine for single-tool-turn L1 chains but ambiguous for
 * multi-turn L3 chains where tool_use_id is the correlation key.
 */
function toolTurn(turnNo, calls) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg_l3_t${turnNo}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-conformance-1',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    },
  ];
  calls.forEach((call, i) => {
    events.push(
      {
        type: 'content_block_start',
        index: i,
        content_block: {
          type: 'tool_use',
          id: `toolu_l3_t${turnNo}_${i + 1}`,
          name: call.name,
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: i,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) },
      },
      { type: 'content_block_stop', index: i },
    );
  });
  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: 'message_stop' },
  );
  return { kind: 'sse', events };
}

/** Text of a tool_result block (mirror of arm.mjs extraction, kept tiny). */
function trText(block) {
  const c = block?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b?.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
  }
  return '';
}

/**
 * Harvest a background shell id from the PUBLIC tool_result of a given
 * scripted tool_use - stream-derived, inside the content-blind boundary.
 * Tolerant of both id formats: ours 'bash_N' and whatever token the official
 * arm advertises next to an id marker.
 */
function harvestShellId(messages, toolUseId) {
  for (const m of messages) {
    if (m?.type !== 'user') continue;
    const content = Array.isArray(m.message?.content) ? m.message.content : [];
    for (const b of content) {
      if (b?.type !== 'tool_result' || b.tool_use_id !== toolUseId) continue;
      const text = trText(b);
      for (const re of [
        /with id:?\s*"?([A-Za-z0-9_.-]+)"?/i,
        /shell[_ ]?id[":\s]+"?([A-Za-z0-9_.-]+)"?/i,
        /\b(bash_[A-Za-z0-9]+)\b/,
      ]) {
        const hit = re.exec(text);
        if (hit) return hit[1];
      }
    }
  }
  return undefined;
}

export const L3_SCENARIOS = [
  // --- Read ----------------------------------------------------------------
  {
    id: 'L3-READ-01',
    tool: 'Read',
    prompt: 'Read notes.txt.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'notes.txt': 'first line\n\tsecond line with a tab\nthird line   \n',
    },
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'notes.txt') } }]),
      { kind: 'sse', events: textReply('L3 READ-01 DONE') },
    ],
    steps: [
      {
        tool: 'Read',
        isError: false,
        locks: [/first line/, /second line with a tab/, /third line/],
        kd: ['KD-L3-01', 'KD-L3-02', 'KD-L3-18'],
      },
    ],
  },
  {
    id: 'L3-READ-02',
    tool: 'Read',
    prompt: 'Read ghost.txt.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'ghost.txt') } }]),
      { kind: 'sse', events: textReply('L3 READ-02 DONE') },
    ],
    steps: [
      {
        tool: 'Read',
        isError: true,
        // Observed live: the official wording ('File does not exist. Note:
        // your current working directory is <cwd>.') does not name the file,
        // so the filename lock is ours-only.
        locks: [/does not exist|no such file|not found/i],
        oursLocks: [/ghost\.txt/],
        kd: ['KD-L3-03'],
      },
    ],
  },
  {
    id: 'L3-READ-03',
    tool: 'Read',
    prompt: 'Read the outside file.',
    options: { allowedTools: ALLOWED_TOOLS },
    needsOutsideDir: true,
    outsideFixtureFiles: { 'outside.txt': 'outside-content-token\n' },
    fixtureFiles: {},
    buildScripts: (_cwd, ctx) => [
      toolTurn(1, [
        { name: 'Read', input: { file_path: join(ctx.outsideDir, 'outside.txt') } },
      ]),
      { kind: 'sse', events: textReply('L3 READ-03 DONE') },
    ],
    steps: [
      {
        tool: 'Read',
        crossCompare: false,
        behavioralKd: 'KD-L3-04',
        isError: { ours: true, official: false },
        oursLocks: [/outside the allowed directories/],
        officialLocks: [/outside-content-token/],
      },
    ],
  },
  // --- Write ---------------------------------------------------------------
  {
    id: 'L3-WRITE-01',
    tool: 'Write',
    prompt: 'Create out/new.txt.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    captureFiles: ['out/new.txt'],
    buildScripts: (cwd) => [
      toolTurn(1, [
        {
          name: 'Write',
          input: { file_path: join(cwd, 'out', 'new.txt'), content: 'hello conformance\n' },
        },
      ]),
      { kind: 'sse', events: textReply('L3 WRITE-01 DONE') },
    ],
    expectFiles: { 'out/new.txt': 'hello conformance\n' },
    steps: [
      {
        tool: 'Write',
        isError: false,
        locks: [/new\.txt/],
        kd: ['KD-L3-05'],
      },
    ],
  },
  {
    id: 'L3-WRITE-02',
    tool: 'Write',
    prompt: 'Overwrite exists.txt without reading it first.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { 'exists.txt': 'old\n' },
    captureFiles: ['exists.txt'],
    buildScripts: (cwd) => [
      toolTurn(1, [
        { name: 'Write', input: { file_path: join(cwd, 'exists.txt'), content: 'new\n' } },
      ]),
      { kind: 'sse', events: textReply('L3 WRITE-02 DONE') },
    ],
    // The ONE case where side effects legitimately differ per arm: the
    // official read-before-write gate blocks the overwrite (KD-L3-06).
    expectFilesPerArm: {
      ours: { 'exists.txt': 'new\n' },
      official: { 'exists.txt': 'old\n' },
    },
    steps: [
      {
        tool: 'Write',
        crossCompare: false,
        behavioralKd: 'KD-L3-06',
        isError: { ours: false, official: true },
        oursLocks: [/^Overwrote existing file /],
        officialLocks: [/read/i],
      },
    ],
  },
  {
    id: 'L3-WRITE-03',
    tool: 'Write',
    prompt: 'Read exists.txt then overwrite it.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { 'exists.txt': 'old\n' },
    captureFiles: ['exists.txt'],
    maxTurns: 6,
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'exists.txt') } }]),
      toolTurn(2, [
        { name: 'Write', input: { file_path: join(cwd, 'exists.txt'), content: 'new\n' } },
      ]),
      { kind: 'sse', events: textReply('L3 WRITE-03 DONE') },
    ],
    expectFiles: { 'exists.txt': 'new\n' },
    steps: [
      {
        tool: 'Read',
        isError: false,
        locks: [/old/],
        kd: ['KD-L3-01', 'KD-L3-02', 'KD-L3-18'],
      },
      {
        tool: 'Write',
        isError: false,
        locks: [/exists\.txt/],
        kd: ['KD-L3-05'],
      },
    ],
  },
  // --- Edit ----------------------------------------------------------------
  {
    id: 'L3-EDIT-01',
    tool: 'Edit',
    prompt: 'Replace ALPHA with BETA in code.txt.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'code.txt': 'line one\nline two\nfeature ALPHA here\nline four\nline five\n',
    },
    captureFiles: ['code.txt'],
    maxTurns: 6,
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'code.txt') } }]),
      toolTurn(2, [
        {
          name: 'Edit',
          input: { file_path: join(cwd, 'code.txt'), old_string: 'ALPHA', new_string: 'BETA' },
        },
      ]),
      { kind: 'sse', events: textReply('L3 EDIT-01 DONE') },
    ],
    expectFiles: {
      'code.txt': 'line one\nline two\nfeature BETA here\nline four\nline five\n',
    },
    steps: [
      {
        tool: 'Read',
        isError: false,
        locks: [/feature ALPHA here/],
        kd: ['KD-L3-01', 'KD-L3-02', 'KD-L3-18'],
      },
      {
        tool: 'Edit',
        isError: false,
        locks: [/code\.txt/],
        oursLocks: [/^Replaced 1 occurrence /, /BETA/],
        kd: ['KD-L3-01', 'KD-L3-07'],
      },
    ],
  },
  {
    id: 'L3-EDIT-02',
    tool: 'Edit',
    prompt: 'Replace DUP without replace_all (must fail on uniqueness).',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { 'dup.txt': 'DUP alpha\nmiddle\nDUP beta\n' },
    captureFiles: ['dup.txt'],
    maxTurns: 6,
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'dup.txt') } }]),
      toolTurn(2, [
        {
          name: 'Edit',
          input: { file_path: join(cwd, 'dup.txt'), old_string: 'DUP', new_string: 'X' },
        },
      ]),
      { kind: 'sse', events: textReply('L3 EDIT-02 DONE') },
    ],
    // Failed edit must leave the file untouched on BOTH arms - hard assert.
    expectFiles: { 'dup.txt': 'DUP alpha\nmiddle\nDUP beta\n' },
    steps: [
      {
        tool: 'Read',
        isError: false,
        locks: [/DUP alpha/],
        kd: ['KD-L3-01', 'KD-L3-02', 'KD-L3-18'],
      },
      {
        tool: 'Edit',
        isError: true,
        locks: [/2/, /uniqu|match|occurrenc/i],
        kd: ['KD-L3-08'],
      },
    ],
  },
  {
    id: 'L3-EDIT-03',
    tool: 'Edit',
    prompt: 'Replace every DUP with X via replace_all.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { 'dup.txt': 'DUP alpha\nmiddle\nDUP beta\n' },
    captureFiles: ['dup.txt'],
    maxTurns: 6,
    buildScripts: (cwd) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(cwd, 'dup.txt') } }]),
      toolTurn(2, [
        {
          name: 'Edit',
          input: {
            file_path: join(cwd, 'dup.txt'),
            old_string: 'DUP',
            new_string: 'X',
            replace_all: true,
          },
        },
      ]),
      { kind: 'sse', events: textReply('L3 EDIT-03 DONE') },
    ],
    expectFiles: { 'dup.txt': 'X alpha\nmiddle\nX beta\n' },
    steps: [
      {
        tool: 'Read',
        isError: false,
        locks: [/DUP alpha/],
        kd: ['KD-L3-01', 'KD-L3-02', 'KD-L3-18'],
      },
      {
        tool: 'Edit',
        isError: false,
        locks: [/dup\.txt/],
        oursLocks: [/^Replaced 2 occurrences /],
        kd: ['KD-L3-01', 'KD-L3-07'],
      },
    ],
  },
  // --- Bash ----------------------------------------------------------------
  {
    id: 'L3-BASH-01',
    tool: 'Bash',
    prompt: 'Print a marker line.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    buildScripts: () => [
      toolTurn(1, [{ name: 'Bash', input: { command: "printf 'conf-stdout-line\\n'" } }]),
      { kind: 'sse', events: textReply('L3 BASH-01 DONE') },
    ],
    steps: [
      {
        tool: 'Bash',
        isError: false,
        locks: [/conf-stdout-line/],
        // Calibration case: no KD candidates on purpose - any official-arm
        // wrapper noise must surface as DIVERGENT and be triaged honestly.
        kd: [],
      },
    ],
  },
  {
    id: 'L3-BASH-02',
    tool: 'Bash',
    prompt: 'Fail with exit code 3.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    buildScripts: () => [
      toolTurn(1, [{ name: 'Bash', input: { command: "printf 'oops\\n' >&2; exit 3" } }]),
      { kind: 'sse', events: textReply('L3 BASH-02 DONE') },
    ],
    steps: [
      {
        tool: 'Bash',
        isError: true,
        locks: [/oops/],
        oursLocks: [/^Command failed with exit code 3/],
        kd: ['KD-L3-09', 'KD-L3-10'],
      },
    ],
  },
  {
    id: 'L3-BASH-03',
    tool: 'Bash',
    prompt: 'cd into sub, then pwd.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { sub: { dir: true } },
    maxTurns: 6,
    buildScripts: () => [
      toolTurn(1, [{ name: 'Bash', input: { command: 'cd sub' } }]),
      toolTurn(2, [{ name: 'Bash', input: { command: 'pwd' } }]),
      { kind: 'sse', events: textReply('L3 BASH-03 DONE') },
    ],
    steps: [
      {
        tool: 'Bash',
        isError: false,
        kd: ['KD-L3-11'],
      },
      {
        // COMPAT's Bash PARTIAL persistence claim, machine-checked: the cwd
        // set by the previous call must survive into this one on BOTH arms.
        tool: 'Bash',
        isError: false,
        locks: [/<CWD>\/sub/],
        kd: [],
      },
    ],
  },
  // --- Background family -----------------------------------------------------
  {
    id: 'L3-BG-01',
    tool: 'BashOutput',
    prompt: 'Run a background job, poll it, kill it, poll again.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    maxTurns: 12,
    buildScripts: (_cwd, ctx) => [
      toolTurn(1, [
        {
          name: 'Bash',
          input: { command: 'echo bg-marker; sleep 60', run_in_background: true },
        },
      ]),
      // Settle barrier: also guarantees the dynamic entry below never depends
      // on the message emitted by the immediately preceding turn (stdout
      // delivery may race the next HTTP request).
      toolTurn(2, [{ name: 'Bash', input: { command: 'sleep 1' } }]),
      (messages) => {
        if (ctx.state.shellId === undefined) {
          ctx.state.shellId = harvestShellId(messages, 'toolu_l3_t1_1');
        }
        return toolTurn(3, [
          { name: 'BashOutput', input: { bash_id: ctx.state.shellId ?? 'HARVEST-FAILED' } },
        ]);
      },
      () =>
        toolTurn(4, [
          { name: 'KillShell', input: { shell_id: ctx.state.shellId ?? 'HARVEST-FAILED' } },
        ]),
      toolTurn(5, [{ name: 'Bash', input: { command: 'sleep 1' } }]),
      () =>
        toolTurn(6, [
          { name: 'BashOutput', input: { bash_id: ctx.state.shellId ?? 'HARVEST-FAILED' } },
        ]),
      { kind: 'sse', events: textReply('L3 BG-01 DONE') },
    ],
    steps: [
      {
        tool: 'Bash (background launch)',
        isError: false,
        oursLocks: [/^Command running in background with id: /],
        kd: ['KD-L3-12', 'KD-L3-13'],
      },
      { tool: 'Bash (settle)', isError: false, kd: ['KD-L3-11'] },
      // Steps 3/4/6 are a declared behavioral split (KD-L3-19, observed live
      // 2026-07-05): official 2.1.201 backgrounds the command as a TASK whose
      // interim output is read via Read on a task file, and its own
      // BashOutput/KillShell answer '<tool_use_error>No task found with
      // ID: <id></tool_use_error>' for the id its Bash just advertised. Ours
      // implements the SDK-documented poll/kill/poll lifecycle. Both sides
      // are asserted per arm - neither is fuzzed away.
      {
        tool: 'BashOutput (running)',
        crossCompare: false,
        behavioralKd: 'KD-L3-19',
        isError: { ours: false, official: true },
        oursLocks: [/status: running/, /bg-marker/],
        officialLocks: [/No task found with ID/i],
        flags: { maskTimestamps: true, maskTiming: true },
      },
      {
        tool: 'KillShell',
        crossCompare: false,
        behavioralKd: 'KD-L3-19',
        isError: { ours: false, official: true },
        oursLocks: [/^Killed background shell /],
        officialLocks: [/No task found with ID/i],
      },
      { tool: 'Bash (settle)', isError: false, kd: ['KD-L3-11'] },
      {
        tool: 'BashOutput (after kill)',
        crossCompare: false,
        behavioralKd: 'KD-L3-19',
        isError: { ours: false, official: true },
        notLocks: [/bg-marker/],
        oursLocks: [/status: killed/, /no new output/],
        officialLocks: [/No task found with ID/i],
        flags: { maskTimestamps: true, maskTiming: true },
      },
    ],
  },
  {
    id: 'L3-BG-02',
    tool: 'KillShell',
    prompt: 'Poll and kill a shell id that never existed.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    maxTurns: 6,
    buildScripts: () => [
      toolTurn(1, [{ name: 'BashOutput', input: { bash_id: 'bash_999' } }]),
      toolTurn(2, [{ name: 'KillShell', input: { shell_id: 'bash_999' } }]),
      { kind: 'sse', events: textReply('L3 BG-02 DONE') },
    ],
    steps: [
      {
        tool: 'BashOutput (unknown id)',
        isError: true,
        locks: [/bash_999/],
        kd: ['KD-L3-14'],
      },
      {
        tool: 'KillShell (unknown id)',
        isError: true,
        locks: [/bash_999/],
        kd: ['KD-L3-14'],
      },
    ],
  },
  // --- Glob ------------------------------------------------------------------
  {
    id: 'L3-GLOB-01',
    tool: 'Glob',
    prompt: 'List every txt file, newest first.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'a.txt': { content: 'a\n', mtime: '2026-01-01T00:00:01Z' },
      'b.txt': { content: 'b\n', mtime: '2026-01-01T00:00:02Z' },
      'sub/c.txt': { content: 'c\n', mtime: '2026-01-01T00:00:03Z' },
    },
    buildScripts: () => [
      toolTurn(1, [{ name: 'Glob', input: { pattern: '**/*.txt' } }]),
      { kind: 'sse', events: textReply('L3 GLOB-01 DONE') },
    ],
    steps: [
      {
        tool: 'Glob',
        isError: false,
        // Newest-first via utimes pins: c, b, a - locked on OUR arm (COMPAT
        // claims mtime sort). Observed live: official 2.1.201 emitted the
        // ASCENDING order a,b,c with relative paths, so ordering is a
        // registered divergence (KD-L3-20, path-set equality) and the
        // newest-first lock is ours-only.
        oursLocks: [/sub\/c\.txt[\s\S]*b\.txt[\s\S]*a\.txt/],
        kd: ['KD-L3-16', 'KD-L3-20'],
      },
    ],
  },
  {
    id: 'L3-GLOB-02',
    tool: 'Glob',
    prompt: 'Glob a pattern with no matches.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: { 'a.txt': 'a\n' },
    buildScripts: () => [
      toolTurn(1, [{ name: 'Glob', input: { pattern: '*.zzz' } }]),
      { kind: 'sse', events: textReply('L3 GLOB-02 DONE') },
    ],
    steps: [
      {
        tool: 'Glob (empty)',
        isError: false,
        locks: [/no files/i],
        kd: ['KD-L3-15'],
      },
    ],
  },
  {
    id: 'L3-GLOB-03',
    tool: 'Glob',
    prompt: 'Glob inside a directory that does not exist.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    buildScripts: () => [
      toolTurn(1, [{ name: 'Glob', input: { pattern: '*.txt', path: 'missing-dir' } }]),
      { kind: 'sse', events: textReply('L3 GLOB-03 DONE') },
    ],
    steps: [
      {
        // Pre-run this was flagged as the most likely genuine-DIVERGENT case
        // (official non-error empty result). Observed live 2026-07-05: the
        // official arm ERRORS too - error-channel agreement holds and only
        // the wording differs (KD-L3-17, note updated to what was observed).
        tool: 'Glob (missing root)',
        isError: true,
        oursLocks: [/^Glob: directory does not exist: <CWD>\/missing-dir/],
        officialLocks: [/directory does not exist/i],
        kd: ['KD-L3-17'],
      },
    ],
  },
  // --- Grep ------------------------------------------------------------------
  {
    id: 'L3-GREP-01',
    tool: 'Grep',
    prompt: 'Find the needle with one context line.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'hay.txt': 'decoy one\ndecoy two\nhas needle-42 here\ndecoy four\n',
    },
    buildScripts: (cwd) => [
      toolTurn(1, [
        {
          name: 'Grep',
          input: {
            pattern: 'needle-\\d+',
            path: join(cwd, 'hay.txt'),
            output_mode: 'content',
            '-C': 1,
          },
        },
      ]),
      { kind: 'sse', events: textReply('L3 GREP-01 DONE') },
    ],
    steps: [
      {
        tool: 'Grep (content)',
        isError: false,
        // Both arms follow rg separators (':' match / '-' context) with the
        // same line numbers; official prints them BARE for a single-file
        // search while ours keeps the absolute path prefix (KD-L3-21).
        locks: [/needle-42/, /3:has needle-42 here/],
        oursLocks: [/hay\.txt:3:has needle-42 here/],
        kd: ['KD-L3-16', 'KD-L3-21'],
      },
    ],
  },
  {
    id: 'L3-GREP-02',
    tool: 'Grep',
    prompt: 'Search for a pattern that matches nothing.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'hay.txt': 'decoy one\ndecoy two\nhas needle-42 here\ndecoy four\n',
    },
    buildScripts: () => [
      toolTurn(1, [{ name: 'Grep', input: { pattern: 'zebra-absent' } }]),
      { kind: 'sse', events: textReply('L3 GREP-02 DONE') },
    ],
    steps: [
      {
        // Observed live: official answers the (default) files_with_matches
        // mode's empty result with 'No files found'; ours says 'No matches
        // found' - the sentinel lock accepts both, the delta is KD-L3-15.
        tool: 'Grep (no match)',
        isError: false,
        locks: [/no (matches|files) found/i],
        kd: ['KD-L3-15'],
      },
    ],
  },
  {
    id: 'L3-GREP-03',
    tool: 'Grep',
    prompt: 'Which files contain the target token?',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {
      'match.md': 'has target-token inside\n',
      'other.md': 'nothing here\n',
    },
    buildScripts: () => [
      toolTurn(1, [{ name: 'Grep', input: { pattern: 'target-token' } }]),
      { kind: 'sse', events: textReply('L3 GREP-03 DONE') },
    ],
    steps: [
      {
        tool: 'Grep (files_with_matches)',
        isError: false,
        locks: [/match\.md/],
        notLocks: [/other\.md/],
        kd: ['KD-L3-15', 'KD-L3-16'],
      },
    ],
  },
];

/**
 * Single-arm locks: BPT policy surface with no official-arm observable
 * counterpart under the content-blind boundary (or where pinning the official
 * side would only manufacture churn-prone KDs). Exact house wording/behavior
 * is pinned on OUR arm only; the official side of these behaviors is covered
 * by the dual-arm semantic invariants above.
 */
export const L3_SINGLE_ARM = [
  {
    id: 'L3-SA-READ-CONTAIN',
    tool: 'Read',
    reason:
      'containment reason STRING is BPT policy surface (fsutil.resolveWithin); the official arm has no equivalent knob (its --add-dir feeds a different permission model). The behavioral split itself is dual-arm L3-READ-03.',
    prompt: 'Read the outside file without a whitelist.',
    needsOutsideDir: true,
    outsideFixtureFiles: { 'f.txt': 'secret outside content\n' },
    fixtureFiles: {},
    buildScripts: (_cwd, ctx) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(ctx.outsideDir, 'f.txt') } }]),
      { kind: 'sse', events: textReply('L3 SA CONTAIN DONE') },
    ],
    steps: [
      {
        tool: 'Read',
        isError: true,
        exact:
          'Read failed: Path "<OUTSIDE>/f.txt" is outside the allowed directories ("<CWD>").',
      },
    ],
  },
  {
    id: 'L3-SA-READ-ADDDIR',
    tool: 'Read',
    reason:
      'additionalDirectories whitelist flip - same policy surface as above; locks that the SAME path succeeds once whitelisted.',
    prompt: 'Read the outside file with the directory whitelisted.',
    needsOutsideDir: true,
    outsideFixtureFiles: { 'f.txt': 'secret outside content\n' },
    fixtureFiles: {},
    buildOptions: (_cwd, ctx) => ({ additionalDirectories: [ctx.outsideDir] }),
    buildScripts: (_cwd, ctx) => [
      toolTurn(1, [{ name: 'Read', input: { file_path: join(ctx.outsideDir, 'f.txt') } }]),
      { kind: 'sse', events: textReply('L3 SA ADDDIR DONE') },
    ],
    steps: [
      {
        tool: 'Read',
        isError: false,
        exact: '1|secret outside content',
      },
    ],
  },
  {
    id: 'L3-SA-WRITE-REWIND',
    tool: 'Write',
    reason:
      'pre-image checkpointing is only observable through OUR Query.rewindFiles(); the official checkpoint surface sits behind CLI internals that are off-limits under content-blind. Locks the COMPAT "file checkpointing + rewindFiles" claim.',
    prompt: 'Overwrite one file, create another, then rewind.',
    options: { allowedTools: ALLOWED_TOOLS, enableFileCheckpointing: true },
    fixtureFiles: { 'exists.txt': 'old\n' },
    maxTurns: 6,
    buildScripts: (cwd) => [
      toolTurn(1, [
        { name: 'Write', input: { file_path: join(cwd, 'exists.txt'), content: 'new\n' } },
      ]),
      toolTurn(2, [
        {
          name: 'Write',
          input: { file_path: join(cwd, 'out', 'created.txt'), content: 'temp\n' },
        },
      ]),
      { kind: 'sse', events: textReply('L3 SA REWIND DONE') },
    ],
    afterQuery: async (q, { cwd, messages }) => {
      const firstUser = messages.find(
        (m) => m?.type === 'user' && typeof m.uuid === 'string',
      );
      if (firstUser === undefined) return { failure: 'no user message uuid in stream' };
      await q.rewindFiles(firstUser.uuid);
      const read = (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return null;
        }
      };
      return {
        exists: read(join(cwd, 'exists.txt')),
        created: read(join(cwd, 'out', 'created.txt')),
      };
    },
    checkAfterQuery: (res) => {
      const failures = [];
      if (res?.failure) failures.push(res.failure);
      if (res?.exists !== 'old\n') {
        failures.push(`rewind did not restore exists.txt (got ${JSON.stringify(res?.exists)})`);
      }
      if (res?.created !== null) {
        failures.push(
          `rewind did not delete the created file (got ${JSON.stringify(res?.created)})`,
        );
      }
      return failures;
    },
    steps: [
      { tool: 'Write (overwrite)', isError: false, locks: [/^Overwrote existing file /] },
      { tool: 'Write (create)', isError: false, locks: [/^Created new file /] },
    ],
  },
  {
    id: 'L3-SA-BASH-HOUSE',
    tool: 'Bash',
    reason:
      'the "(no output)" placeholder and the timeout phrasing are house wording whose official counterparts are volatile across CLI minors; pinning them dual-arm would manufacture churn-prone KDs for zero conformance signal.',
    prompt: 'Run a silent command, then a command that times out.',
    options: { allowedTools: ALLOWED_TOOLS },
    fixtureFiles: {},
    maxTurns: 6,
    buildScripts: () => [
      toolTurn(1, [{ name: 'Bash', input: { command: 'true' } }]),
      toolTurn(2, [{ name: 'Bash', input: { command: 'sleep 2', timeout: 500 } }]),
      { kind: 'sse', events: textReply('L3 SA BASH DONE') },
    ],
    steps: [
      { tool: 'Bash (silent success)', isError: false, exact: '(no output)' },
      {
        tool: 'Bash (timeout)',
        isError: true,
        locks: [/^Command timed out after 500ms/],
      },
    ],
  },
];

/**
 * Deliberate skips (from the L3 mapping), registered so the matrix reports
 * WHY a COMPAT row has no dual-arm green light rather than silently lacking
 * one.
 */
export const L3_SKIPPED = [
  { option: 'WebFetch', reason: 'network egress breaks keyless-CI determinism; ours streams through an SSRF guard while official routes differently - no deterministic shared observable without a web emulator (out of L3 scope per blueprint).' },
  { option: 'WebSearch', reason: 'host-callback on our arm vs server-backed on official; the two arms do not share an execution model.' },
  { option: 'AskUserQuestion', reason: 'host-callback/interactive by definition; the official headless arm has no scriptable answerer inside the content-blind boundary.' },
  { option: 'TodoWrite', reason: 'pure model-state bookkeeping, no filesystem side effect; result text is UX wording and official emits todo state via system-message channels - low signal, high KD churn.' },
  { option: 'Task (Agent tool)', reason: 'model-coupled subagent spawn produces unpredictable nested request counts per arm; belongs to a dedicated L3.5 subagent differential.' },
  { option: 'NotebookEdit / MultiEdit', reason: 'UNSUPPORTED by design in COMPAT (no notebook surface; MultiEdit retired upstream); the suite tests claimed surface only.' },
  { option: 'Read (image/PDF block variants)', reason: 'base64 content blocks megabytes-large in stream artifacts and official rendering policy differs by CLI minor; deferred to a follow-up batch with block-hash comparison.' },
  { option: 'Read (>50MB cap)', reason: 'ours-specific OOM guard already unit-locked; a 50MB fixture per CI run buys no official-arm signal (official caps are different and undocumented).' },
  { option: 'Bash (functions/aliases non-persistence)', reason: 'documented PARTIAL vs the official long-lived shell - a guaranteed behavioral KD already declared in COMPAT; deferred so batch 1 measures claimed-equivalent behavior.' },
  { option: 'Grep (JS backreference pattern)', reason: 'strong KD candidate (pure-JS RegExp accepts what Rust-regex rejects, per COMPAT Grep PARTIAL) but deferred to batch 2 after the format baseline is established.' },
  { option: 'Glob (100-result truncation note)', reason: 'needs 101 fixture files for a wording-only assertion with an unknown official threshold; cost/signal ratio too poor for batch 1.' },
];
