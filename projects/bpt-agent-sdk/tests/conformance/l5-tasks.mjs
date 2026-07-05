/**
 * L5 five-dimension task library (conformance suite M4, blueprint §三).
 *
 * 18 tasks across the five Desktop-calibrated dimensions - chat 3 /
 * retrieval 4 / document 4 / code 5 / long-conversation 2 - with 5 Chinese
 * variants spread across ALL five dimensions (chat-02, retrieval-03,
 * document-03, code-04, longconv-02). Consumed by run-l5.mjs, which runs
 * every task through BOTH engines against the real API and applies gate B
 * (aggregate pass-rate non-inferiority, tolerance 5 percentage points).
 *
 * House pattern (tests/integration/ab-benchmark.mjs, reused NOT imported -
 * that file belongs to the benchmark line): fixture(dir) seeds a mkdtemp
 * cwd, prompt drives the model, and the pass decision is MACHINE-DECIDABLE
 * with no LLM judging:
 *   check(text, result, dir) - decides from the final result text and/or
 *     fs state inside the sandbox (dir is still alive when it runs);
 *   verify(dir)              - code tasks only: dynamic-import the produced
 *     module (cache-busted) and execute a multi-case suite where a solution
 *     hard-coded to the prompt's example fails (ab-benchmark hard-task
 *     #10/#11 discipline, extended here to five code sub-dimensions:
 *     bug-fix / general-solution / self-verify / zh multi-file rename
 *     verified by execution / tool-mix).
 *
 * Anti-false-positive disciplines baked into the data:
 *   - Answer values are collision-free against every numeral appearing in
 *     their own prompt (e.g. chat-01's 145 shares no substring with
 *     09/15/11/40), so substring/regex checks cannot pass on prompt echo;
 *     digit-boundary regexes ((?<!\d)N(?!\d)) close the remaining edge.
 *   - Document tasks carry untouched-sentinel assertions (a second
 *     'pending' row, a preserved zh sentence) so a blanket rewrite/sed pass
 *     that would ace a naive contains-check fails - general-solution
 *     resistance on the document axis.
 *   - Long-conversation tasks use 3-turn streaming input (AsyncIterable
 *     prompt, built by the runner from `turns`), and the pass condition
 *     requires a turn-1 value to materialize in an fs artifact at turn 3 -
 *     context retention decided from the filesystem, not from wording.
 *
 * Deliberately absent (blueprint §三 rulings): refusal-boundary tasks
 * (拒绝类不进门禁 - proprietary-prompt shadow, observation only) and
 * image-generation tasks (生图射程外 - Desktop routes it host/MCP-side,
 * no official-engine behavior to compare against).
 *
 * repeatOverride: budget lever, honored by run-l5.mjs ONLY under --econ.
 * The 11 low-variance tasks (chat/retrieval/document) carry
 * repeatOverride: 3 so a round whose cache diagnosis shows per-run-write or
 * no-cache pricing (design scenarios b/c) can be downgraded without
 * touching the 7 discriminators (code-01..05, longconv-01..02), which keep
 * the full repeat=5.
 *
 * estTurns is the nominal per-repeat assistant-turn load used by the
 * blueprint budget estimate (~42 turns/engine/repeat total).
 *
 * strays: task-owned file basenames the model may misplace at the tmpdir
 * ROOT instead of the sandbox cwd. First real round (run 28736460533,
 * dissected in Public-Info-Pool/Resource/repo-engineering/
 * bpt-sdk-l5-failure-dissection-20260705.md, S2): the official arm's Write
 * requires absolute paths and Haiku guessed /tmp/<name>; the repeat-1
 * leftover then steered repeats 2-3 into verifying at the wrong location
 * (the read-before-write gate plus a pre-existing correct file removed the
 * ENOENT self-rescue signal repeat 1 recovered on). run-l5.mjs sweeps these
 * exact basenames at the tmpdir root before and after every run - restoring
 * per-run independence without touching any pass semantics. Listed for
 * every task that names a concrete artifact file (created or edited).
 *
 * kd: L5 known-difference tags (table: L5_KNOWN_DIFFERENCES below) carried
 * into the report's per-task summaries so a reader of per-task pass counts
 * sees the standing explanation next to the number instead of rediscovering
 * it from traces.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Seed one fixture file, creating parent directories. */
function seed(dir, rel, content) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** Sandbox file contents, or null when missing - checks never throw on absence. */
function read(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), 'utf8');
  } catch {
    return null;
  }
}

/** Digit-boundary matcher: N as a standalone number, not inside 145/042/... */
function num(n) {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`);
}

/**
 * Cache-busted dynamic import for verify() suites. Date.now() alone (the
 * ab-benchmark house buster) can collide when two verifies of the SAME path
 * land in the same millisecond - the random component removes that flake
 * class without changing the discipline.
 */
function importFresh(dir, rel) {
  return import(
    `file://${path.join(dir, rel)}?t=${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  );
}

/**
 * L5 known differences - task-level, REPORT-ONLY (gate B stays aggregate).
 * Source: first real round run 28736460533 dissection (2026-07-05),
 * Public-Info-Pool/Resource/repo-engineering/bpt-sdk-l5-failure-dissection-20260705.md.
 * Every entry is grounded in L6 official-arm public-stream traces - the
 * legal observation surface (净室观测边界 r2); request bodies were never read.
 */
export const L5_KNOWN_DIFFERENCES = {
  'KD-L5-01': {
    arm: 'official',
    title: 'tmpdir-root path anchoring on new-file writes',
    note:
      'Official Write requires absolute paths; Haiku guesses /tmp/<name> instead of ' +
      'the sandbox cwd. Recoverable via the ENOENT self-rescue signal on a clean ' +
      'tmpdir (code-03 r1); the strays sweep keeps the signal available every run.',
  },
  'KD-L5-02': {
    arm: 'official',
    title: 'injection-suspicion refusal variance on benign multi-turn remember-X (zh)',
    note:
      'The official system prompt\'s injection wariness + Haiku sometimes judges ' +
      '"记住：甲的值是 12。只需确认" as a prompt-injection attempt and refuses from ' +
      'turn 1 (longconv-02 r1/r2 of run 28736460533). Model-level posture, not an ' +
      'engine defect on either side; per-task numbers for longconv-02 are noisy.',
  },
  'KD-L5-03': {
    arm: 'bpt',
    title: 'thinking asymmetry: official CLI defaults extended thinking ON, our engine OFF',
    note:
      '54/54 official traces carry thinking_tokens events; our claude_code preset ' +
      'sends no thinking block. Costs us pre-answer computation on chat-03 (reverse ' +
      'alphabetical) and diligence probability on code-01 (even-length median). ' +
      'Alignment candidates: engine Fix-1 (preset default-on thinking) and/or ' +
      'harness Fix-2 (explicit equal maxThinkingTokens on both arms).',
  },
  'KD-L5-04': {
    arm: 'both',
    title: 'per-result cumulative semantics diverge between engines on streamed multi-turn input',
    note:
      'Both engines emit one result per streamed user turn, but the official arm ' +
      'reports num_turns and usage PER RESULT with total_cost_usd/duration_api_ms ' +
      'session-cumulative (verified from run 28736460533 longconv traces: ' +
      'num_turns 1,1,2; costs strictly increasing with exact per-run deltas), while ' +
      'our SDK rewrites EVERY field session-cumulative on every result except ' +
      'duration_api_ms which stays per-run (query.ts finding #33 rewriteResult). ' +
      'run-l5 aggregates per-arm accordingly. Engine alignment candidate: match ' +
      'the official per-result semantics on the drop-in surface.',
  },
};

export const L5_TASKS = [
  // --- chat: pure dialogue, zero tools --------------------------------------
  {
    id: 'chat-01',
    dimension: 'chat',
    zh: false,
    repeatOverride: 3,
    estTurns: 1,
    prompt:
      'Without using any tools: a train departs at 09:15 and arrives at 11:40 ' +
      'the same morning. How many minutes does the journey take? Reply with ' +
      'just the number.',
    // 145 is collision-free vs the prompt numerals 09/15/11/40; num_turns is
    // reported by the runner but deliberately NOT gated (a model that wastes
    // a turn is an efficiency signal, not a correctness failure).
    check: (text) => num(145).test(text),
  },
  {
    id: 'chat-02',
    dimension: 'chat',
    zh: true,
    repeatOverride: 3,
    estTurns: 1,
    prompt:
      '不使用任何工具：小满有 45 颗糖，分给 6 个朋友、每人 7 颗，自己还剩几颗？' +
      '只回复一个阿拉伯数字，不要任何其他文字。',
    // Answer 3 is collision-free vs the prompt numerals; the exclusion guard
    // catches echo-the-prompt non-answers (45/6/7 verbatim, or the
    // intermediate 42) that a bare contains('3') would miss entirely.
    check: (text) => num(3).test(text) && !/(?<!\d)(45|42|6|7)(?!\d)/.test(text),
  },
  {
    id: 'chat-03',
    dimension: 'chat',
    zh: false,
    repeatOverride: 3,
    estTurns: 1,
    kd: ['KD-L5-03'],
    prompt:
      'Without using any tools: list the three classical states of matter ' +
      '(solid, liquid, gas) in REVERSE alphabetical order, comma-separated, ' +
      'all lowercase, no spaces. Reply with only that list.',
    // Exact-order instruction following, decidable by substring after
    // whitespace normalization (reverse alphabetical = solid,liquid,gas).
    check: (text) => text.toLowerCase().replace(/\s/g, '').includes('solid,liquid,gas'),
  },

  // --- retrieval: cross-file find and aggregate ------------------------------
  {
    id: 'retrieval-01',
    dimension: 'retrieval',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    fixture(dir) {
      // Only api-v2.md contains the word "deprecated"; the decoys stay clean
      // so a lucky guess has at best 1-in-4 odds and the check keys on the
      // unique correct name.
      seed(
        dir,
        'docs/api-v1.md',
        '# API v1\n\nThe v1 endpoints are stable and fully supported.\n' +
          'Use /v1/query for standard lookups.\n',
      );
      seed(
        dir,
        'docs/api-v2.md',
        '# API v2\n\nDEPRECATED: the /v2/batch endpoint is deprecated and ' +
          'will be removed in the next major release.\nMigrate to /v3/batch.\n',
      );
      seed(
        dir,
        'docs/api-v3.md',
        '# API v3\n\nThe v3 endpoints are the current recommended surface.\n' +
          '/v3/batch supersedes the older batch API.\n',
      );
      seed(
        dir,
        'docs/readme.md',
        '# Docs index\n\nEndpoint reference lives in the api-v*.md files.\n',
      );
    },
    prompt:
      'Exactly one file under docs/ marks an API as deprecated. Find it and ' +
      'reply with just that file\'s name.',
    check: (text) => text.includes('api-v2.md'),
  },
  {
    id: 'retrieval-02',
    dimension: 'retrieval',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    fixture(dir) {
      // Per-file ERROR counts 2/3/1 - none equal to the total 6 and the
      // prompt carries no numerals, so a partial read or a single-file
      // answer cannot collide with the correct aggregate.
      seed(
        dir,
        'logs/a.log',
        '2026-07-01 10:00:01 INFO service started\n' +
          '2026-07-01 10:00:05 ERROR failed to open cache\n' +
          '2026-07-01 10:00:09 INFO retry scheduled\n' +
          '2026-07-01 10:00:12 ERROR cache still unavailable\n' +
          '2026-07-01 10:00:20 INFO cache rebuilt\n',
      );
      seed(
        dir,
        'logs/b.log',
        '2026-07-02 09:10:00 WARN slow response from upstream\n' +
          '2026-07-02 09:10:04 ERROR upstream timeout\n' +
          '2026-07-02 09:11:31 ERROR upstream timeout\n' +
          '2026-07-02 09:12:02 WARN retry budget low\n' +
          '2026-07-02 09:12:44 ERROR giving up on upstream\n',
      );
      seed(
        dir,
        'logs/c.log',
        '2026-07-03 14:00:00 INFO nightly job begins\n' +
          '2026-07-03 14:00:03 INFO scanning archives\n' +
          '2026-07-03 14:02:41 ERROR checksum mismatch in shard 9\n' +
          '2026-07-03 14:03:00 INFO shard requeued\n' +
          '2026-07-03 14:09:58 INFO nightly job ends\n',
      );
    },
    prompt:
      'The logs/ directory has several log files. Count the total number of ' +
      'lines containing the word ERROR across ALL of them and reply with ' +
      'just the total.',
    check: (text) => num(6).test(text),
  },
  {
    id: 'retrieval-03',
    dimension: 'retrieval',
    zh: true,
    repeatOverride: 3,
    estTurns: 2,
    fixture(dir) {
      // 姓名与年龄分离在不同行、分散在三份档案，必须读完并比较（阿澄 17 /
      // 洛尔 23 / 白芷 19）才能答对；单文件抽读给不出最大值。
      seed(
        dir,
        'profiles/chars-a.md',
        '# 角色档案 甲\n\n姓名：阿澄\n年龄：17\n阵营：晨曦修道院\n',
      );
      seed(
        dir,
        'profiles/chars-b.md',
        '# 角色档案 乙\n\n姓名：洛尔\n年龄：23\n阵营：深渊观测站\n',
      );
      seed(
        dir,
        'profiles/chars-c.md',
        '# 角色档案 丙\n\n姓名：白芷\n年龄：19\n阵营：旧城书馆\n',
      );
    },
    prompt: 'profiles/ 目录下有三份角色档案。找出年龄最大的角色，只回复该角色的名字。',
    check: (text) => text.includes('洛尔'),
  },
  {
    id: 'retrieval-04',
    dimension: 'retrieval',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    fixture(dir) {
      // 30 candidates make read-them-all expensive and guessing infeasible -
      // the task rewards grep-shaped search while the answer stays a single
      // objective string (the file that carries the planted marker).
      for (let i = 1; i <= 30; i++) {
        const nn = String(i).padStart(2, '0');
        const extra = i === 17 ? 'marker: ZEPHYR-42\n' : '';
        seed(
          dir,
          `data/f${nn}.txt`,
          `record ${nn} alpha\nrecord ${nn} beta\nrecord ${nn} gamma\n${extra}`,
        );
      }
    },
    prompt:
      'Exactly one file under data/ contains the marker ZEPHYR-42. Find ' +
      'which one and reply with just the file name.',
    check: (text) => text.includes('f17'),
  },

  // --- document: long-text read / targeted rewrite ---------------------------
  {
    id: 'document-01',
    dimension: 'document',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    strays: ['toc.md'],
    fixture(dir) {
      const body = (label, n) =>
        Array.from(
          { length: n },
          (_, i) => `${label} note ${i + 1}: keep this step documented for operators.`,
        ).join('\n');
      seed(
        dir,
        'guide.md',
        '# Project guide\n\n## Setup\n\n' +
          body('Install', 10) +
          '\n\n## Usage\n\n' +
          body('Run', 11) +
          '\n\n## Troubleshooting\n\n' +
          body('Debug', 9) +
          '\n',
      );
    },
    prompt:
      'Read guide.md and create toc.md containing the three section titles ' +
      '(the ## headings, without the ## prefix) in the order they appear, ' +
      'one per line.',
    // Order-sensitive and content-objective: all three titles present, in
    // document order, and the ## prefix genuinely stripped.
    check: (text, result, dir) => {
      const s = read(dir, 'toc.md');
      if (s === null) return false;
      const iSetup = s.indexOf('Setup');
      const iUsage = s.indexOf('Usage');
      const iTrouble = s.indexOf('Troubleshooting');
      return (
        iSetup !== -1 &&
        iUsage !== -1 &&
        iTrouble !== -1 &&
        iSetup < iUsage &&
        iUsage < iTrouble &&
        !s.includes('##')
      );
    },
  },
  {
    id: 'document-02',
    dimension: 'document',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    strays: ['tasks.md'],
    fixture(dir) {
      seed(
        dir,
        'tasks.md',
        '| task | status |\n' +
          '| --- | --- |\n' +
          '| build | done |\n' +
          '| deploy | pending |\n' +
          '| review | pending |\n' +
          '| docs | done |\n',
      );
    },
    prompt:
      'In tasks.md, the \'deploy\' task is now finished. Update ONLY the ' +
      'deploy row\'s status from pending to done, leaving every other row ' +
      'unchanged.',
    // The surviving "review | pending" row is the anti-shortcut sentinel: a
    // blanket replace-all pending->done rewrite fails this check.
    check: (text, result, dir) => {
      const s = read(dir, 'tasks.md');
      if (s === null) return false;
      return (
        /deploy\s*\|\s*done/.test(s) &&
        !/deploy\s*\|\s*pending/.test(s) &&
        /review\s*\|\s*pending/.test(s)
      );
    },
  },
  {
    id: 'document-03',
    dimension: 'document',
    zh: true,
    repeatOverride: 3,
    estTurns: 2,
    strays: ['announcement_zh.md'],
    fixture(dir) {
      seed(
        dir,
        'announcement_zh.md',
        '# 系统维护公告\n' +
          '\n' +
          '各位调查员：\n' +
          '\n' +
          '平台将于 2026年6月30日 凌晨两点开始例行维护，预计持续四小时。\n' +
          '维护期间无法登录，请提前安排好探索进度。\n' +
          '\n' +
          '维护完成后所有存档数据不会丢失，请放心。\n' +
          '\n' +
          '本次维护将优化档案检索速度，并修复若干界面显示异常。\n' +
          '如维护时间有变，将另行公告。\n' +
          '\n' +
          '感谢各位的理解与支持。\n' +
          '\n' +
          '—— 数据库管理组\n',
      );
    },
    prompt:
      '公告 announcement_zh.md 里的维护日期需要顺延：把「2026年6月30日」改为' +
      '「2026年7月15日」，其余内容一个字都不要动。改完后读出文件确认。',
    // 第三个断言是未触碰哨兵句：整段重写 / 漏抄任一行都会丢掉它而失败。
    check: (text, result, dir) => {
      const s = read(dir, 'announcement_zh.md');
      if (s === null) return false;
      return (
        s.includes('2026年7月15日') &&
        !s.includes('2026年6月30日') &&
        s.includes('维护完成后所有存档数据不会丢失')
      );
    },
  },
  {
    id: 'document-04',
    dimension: 'document',
    zh: false,
    repeatOverride: 3,
    estTurns: 2,
    strays: ['RELEASES.md'],
    fixture(dir) {
      // Interleaved versions (a: 1.0.0 + 1.2.0, b: 1.1.0) force a real
      // ordering merge - plain concatenation in either order fails.
      seed(
        dir,
        'CHANGELOG-a.md',
        '## v1.0.0\n\n- initial public release\n- basic card database\n\n' +
          '## v1.2.0\n\n- added lore cross-links\n- faster archive search\n',
      );
      seed(dir, 'CHANGELOG-b.md', '## v1.1.0\n\n- fixed login redirect\n');
    },
    prompt:
      'Merge the two changelog files into a single RELEASES.md that lists ' +
      'all version headings (## v...) in ascending version order, keeping ' +
      'each version\'s bullet lines under its heading.',
    check: (text, result, dir) => {
      const s = read(dir, 'RELEASES.md');
      if (s === null) return false;
      const i0 = s.indexOf('## v1.0.0');
      const i1 = s.indexOf('## v1.1.0');
      const i2 = s.indexOf('## v1.2.0');
      return (
        i0 !== -1 &&
        i1 !== -1 &&
        i2 !== -1 &&
        i0 < i1 &&
        i1 < i2 &&
        // A bullet that lives only in CHANGELOG-b.md - proves both sources
        // were actually merged, not one copied over the other.
        s.includes('fixed login redirect')
      );
    },
  },

  // --- code: bug-fix / general-solution / self-verify / zh rename / tool-mix -
  {
    id: 'code-01',
    dimension: 'code',
    zh: false,
    estTurns: 3,
    strays: ['stats.mjs'],
    kd: ['KD-L5-03'],
    options: { maxTurns: 12 },
    fixture(dir) {
      // BUG: indexes the middle of the UNSORTED input - median([3,1,2])
      // returns 1. A fix must sort (and handle even lengths) to survive
      // verify's off-example cases.
      seed(
        dir,
        'stats.mjs',
        'export function median(xs) {\n' +
          '  // middle element of the list\n' +
          '  return xs[Math.floor(xs.length / 2)];\n' +
          '}\n',
      );
    },
    prompt:
      'There is a bug in stats.mjs: median([3,1,2]) should return 2 but ' +
      'does not. Find and fix the bug so median works for any array of ' +
      'numbers.',
    async verify(dir) {
      // The [9,1] and even-length cases fail any fix hard-coded to the
      // prompt example; a throw counts as fail (runner catches).
      const m = await importFresh(dir, 'stats.mjs');
      return (
        m.median([3, 1, 2]) === 2 &&
        m.median([1, 2, 3, 4]) === 2.5 &&
        m.median([7]) === 7 &&
        m.median([9, 1]) === 5
      );
    },
  },
  {
    id: 'code-02',
    dimension: 'code',
    zh: false,
    estTurns: 3,
    strays: ['slug.mjs'],
    options: { maxTurns: 12 },
    prompt:
      'Create slug.mjs exporting slugify(s): lowercase the string, replace ' +
      'every run of non-alphanumeric characters with a single hyphen, and ' +
      'strip leading/trailing hyphens. For example slugify(\'Hello World\') ' +
      'is \'hello-world\'.',
    async verify(dir) {
      // Only the first case appears in the prompt; a hard-coded return
      // fails the other three (house #11 anti-hardcode pattern).
      const m = await importFresh(dir, 'slug.mjs');
      return (
        m.slugify('Hello World') === 'hello-world' &&
        m.slugify('A  B!!C') === 'a-b-c' &&
        m.slugify('  Trim Me  ') === 'trim-me' &&
        m.slugify('already-good') === 'already-good'
      );
    },
  },
  {
    id: 'code-03',
    dimension: 'code',
    zh: false,
    estTurns: 4,
    strays: ['fizz.mjs'],
    kd: ['KD-L5-01'],
    options: { maxTurns: 12 },
    prompt:
      'Create fizz.mjs exporting classify(n): return \'FizzBuzz\' if n is ' +
      'divisible by 15, \'Fizz\' if by 3, \'Buzz\' if by 5, otherwise ' +
      'String(n). Before finishing, RUN it with node yourself to verify at ' +
      'least the inputs 15, 9, 10 and 7, and fix anything wrong.',
    async verify(dir) {
      // 30 and 1 are NOT in the prompt - the self-verify discipline must
      // generalize; string-vs-number return is the classic silent failure
      // an execution check catches and a text check never would.
      const m = await importFresh(dir, 'fizz.mjs');
      return (
        m.classify(15) === 'FizzBuzz' &&
        m.classify(9) === 'Fizz' &&
        m.classify(10) === 'Buzz' &&
        m.classify(7) === '7' &&
        m.classify(30) === 'FizzBuzz' &&
        m.classify(1) === '1'
      );
    },
  },
  {
    id: 'code-04',
    dimension: 'code',
    zh: true,
    estTurns: 3,
    strays: ['a.mjs', 'b.mjs'],
    options: { maxTurns: 12 },
    fixture(dir) {
      seed(dir, 'b.mjs', 'export function getData() {\n  return 42;\n}\n');
      seed(
        dir,
        'a.mjs',
        "import { getData } from './b.mjs';\n\n" +
          'export function run() {\n  return getData() * 2;\n}\n',
      );
    },
    prompt:
      '这个小项目里 b.mjs 导出的函数 getData 要改名为 fetchData：改 b.mjs 的' +
      '导出名，并同步更新 a.mjs 里的 import 和调用，保证改完后 a.mjs 还能正常运行。',
    async verify(dir) {
      // 执行级验证（m.run() === 84）抓「改了名但跑不起来」；文本断言抓
      // 「只改一头」或「留旧别名蒙混」——两类静态检查单独都不充分。
      const m = await importFresh(dir, 'a.mjs');
      if (m.run() !== 84) return false;
      const a = read(dir, 'a.mjs') ?? '';
      const b = read(dir, 'b.mjs') ?? '';
      return b.includes('fetchData') && !b.includes('getData') && !a.includes('getData');
    },
  },
  {
    id: 'code-05',
    dimension: 'code',
    zh: false,
    estTurns: 2,
    strays: ['result.txt'],
    options: { maxTurns: 12 },
    prompt:
      'Using Bash, compute the sum of the integers from 1 to 100 (do not ' +
      'just recall it - actually run a command that computes it), then ' +
      'write the result into result.txt as a bare number.',
    // Tool-mix sub-dimension (Bash compute + file write). The check is
    // fs-only: a compute-in-head-then-claim run still passes only if the
    // file actually lands with 5050.
    check: (text, result, dir) => {
      const s = read(dir, 'result.txt');
      return s !== null && num(5050).test(s.trim());
    },
  },

  // --- long-conversation: 3-turn streaming input ------------------------------
  {
    id: 'longconv-01',
    dimension: 'long-conversation',
    zh: false,
    estTurns: 4,
    strays: ['note.txt'],
    options: { maxTurns: 10 },
    // The runner wraps `turns` in an async generator; each turn is released
    // only after the previous turn's completion (result / end_turn) shows up
    // on the public stream - the house streaming-input pattern.
    turns: [
      'Remember this code word: CRIMSON-7. Just acknowledge it, do nothing else.',
      'Create note.txt containing exactly the word placeholder.',
      'Now replace the content of note.txt with the code word from my first message.',
    ],
    // Passes only if the turn-1 value survives to turn 3 (context
    // retention, decided from fs); the required absence of the turn-2
    // "placeholder" proves the file was genuinely cycled, not written once.
    check: (text, result, dir) => {
      const s = read(dir, 'note.txt');
      return s !== null && s.includes('CRIMSON-7') && !s.includes('placeholder');
    },
  },
  {
    id: 'longconv-02',
    dimension: 'long-conversation',
    zh: true,
    estTurns: 4,
    strays: ['sum.txt'],
    kd: ['KD-L5-01', 'KD-L5-02'],
    options: { maxTurns: 10 },
    turns: [
      '记住：甲的值是 12。只需确认，不要做别的。',
      '再记住：乙的值是 30。只需确认。',
      '把甲和乙的和写入 sum.txt（只写数字），并在回复里说出这个和。',
    ],
    // 42 与 12/30 无子串冲突；两个加数分别来自第 1、2 轮，只有跨轮保留上下文
    // 才能在第 3 轮求和——文件与回复双断言。
    check: (text, result, dir) => {
      const s = read(dir, 'sum.txt');
      return s !== null && num(42).test(s) && num(42).test(text);
    },
  },
];

/** Dimension totals - used by the runner's plan printout and sanity checks. */
export const L5_DIMENSIONS = ['chat', 'retrieval', 'document', 'code', 'long-conversation'];
