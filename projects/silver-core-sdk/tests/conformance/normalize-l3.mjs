/**
 * L3 tool_result content normalization + comparison.
 *
 * The L3 differential compares the TEXT of tool_result blocks after both
 * engines executed the same real tool against their own throwaway cwd. Raw
 * texts differ for boring reasons (each arm has its own mkdtemp path, its own
 * shell ids); normalization removes ONLY that per-run noise:
 *
 *   N1 cwd masking      - raw cwd AND realpath(cwd) -> <CWD> (the official
 *                         CLI canonicalizes /tmp symlinks); the outside dir
 *                         of containment cases -> <OUTSIDE>.
 *   N2 whitespace       - CRLF -> LF, strip trailing whitespace per line,
 *                         drop trailing blank lines. The per-line trailing-
 *                         whitespace strip is opt-OUT (flags.preserveTrailingSpace)
 *                         so a case probing trailing-whitespace FIDELITY can
 *                         observe a real per-arm divergence (audit r4 V7-3).
 *   N3 timing mask      - "after <N>ms/s/m" -> "after <T>", ONLY in cases
 *                         flagged maskTiming (never bare numbers - exit codes
 *                         and line numbers must survive). maskTimestamps
 *                         similarly masks ISO datetimes per-case.
 *   N4 shell-id mask    - each arm's own harvested background-shell id ->
 *                         <SHELL_ID>.
 *   N5 gutter canon     - cat -n gutters "   N<TAB>" (ours, formatCatN) and
 *                         "   N<U+2192>" (official, spaces+number+arrow) both
 *                         -> "N|", PRESERVING the line number. The gutter
 *                         delta itself is recorded as KD-L3-01, never hidden.
 *   N6 system-reminder  - a trailing official-only <system-reminder> appendix
 *                         is stripped and recorded as KD-L3-02.
 *   N7 line sort        - per-case order-insensitive mode for list outputs
 *                         (belt + braces on top of the utimes pins).
 *
 * Verdict model per tool_result pair: exact normalized equality -> match
 * (with any N5/N6 asymmetry reported as a known diff, not silently absorbed);
 * otherwise the diff must be claimed by a case-listed KNOWN_TOOL_DIVERGENCES
 * entry whose applies() predicate matches BOTH sides -> known; anything
 * unlisted stays divergent. Same reported-never-hidden contract as the L1
 * KNOWN_DIVERGENCES table.
 */

/** Escape a literal string for use inside a RegExp. */
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize one tool_result text. env carries the per-arm run facts
 * ({ cwd, realCwd, outsideDir, realOutsideDir, shellId }); flags are the
 * per-case opt-ins ({ maskTiming, maskTimestamps, sortLines,
 * preserveTrailingSpace }).
 * Returns { text, applied } where applied is the set of KD-relevant rewrite
 * tags that actually fired ('gutter-tab' | 'gutter-arrow' | 'system-reminder'
 * | 'shell-id') so the comparator can report them.
 */
export function normalizeToolResult(rawText, env = {}, flags = {}) {
  let text = String(rawText ?? '').replace(/\r\n/g, '\n');
  const applied = new Set();

  // N6: trailing system-reminder appendix (official Read decoration).
  const stripped = text.replace(
    /\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*$/,
    '',
  );
  if (stripped !== text) {
    applied.add('system-reminder');
    text = stripped;
  }

  // N1: path masking, longest literal first so "<realCwd>/sub" cannot be
  // half-eaten by a shorter prefix.
  const pairs = [];
  const addPair = (p, token) => {
    if (typeof p === 'string' && p.length > 0) pairs.push([p, token]);
  };
  addPair(env.realOutsideDir, '<OUTSIDE>');
  addPair(env.outsideDir, '<OUTSIDE>');
  addPair(env.realCwd, '<CWD>');
  addPair(env.cwd, '<CWD>');
  pairs.sort((a, b) => b[0].length - a[0].length);
  for (const [p, token] of pairs) {
    text = text.split(p).join(token);
  }

  // N4: this arm's own background shell id.
  if (typeof env.shellId === 'string' && env.shellId.length > 0) {
    if (text.includes(env.shellId)) applied.add('shell-id');
    text = text.replace(new RegExp(reEscape(env.shellId), 'g'), '<SHELL_ID>');
  }

  // N5: cat -n gutter canonicalization, keeping the line NUMBER.
  text = text.replace(/^\s*(\d+)([\t→])/gm, (_m, n, sep) => {
    applied.add(sep === '\t' ? 'gutter-tab' : 'gutter-arrow');
    return `${n}|`;
  });

  // N3: timing masks, opt-in per case only.
  if (flags.maskTiming === true) {
    text = text.replace(/after \d+(ms|s|m)\b/g, 'after <T>');
  }
  if (flags.maskTimestamps === true) {
    text = text.replace(
      /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g,
      '<TS>',
    );
  }

  // N2: per-line rstrip + trailing blank lines. The per-line trailing-
  // whitespace strip is opt-OUT (flags.preserveTrailingSpace) so a case probing
  // trailing-whitespace FIDELITY (e.g. L3-READ-01's 'third line   ') can observe
  // a real per-arm divergence instead of having it normalized away on BOTH arms
  // (audit r4 V7-3). CRLF->LF (top) and trailing-blank-line drop still apply.
  const n2Lines = text.split('\n');
  text = (flags.preserveTrailingSpace === true ? n2Lines : n2Lines.map((l) => l.replace(/[ \t]+$/, '')))
    .join('\n')
    .replace(/\n+$/, '');

  // N7: opt-in order-insensitive mode.
  if (flags.sortLines === true) {
    text = text.split('\n').sort().join('\n');
  }

  return { text, applied };
}

/**
 * Known tool-behavior divergences between the official arm and this SDK.
 * Every entry was observed live (run-l3 first pass, 2026-07-05) or is a
 * behavioral split already declared in docs/COMPAT.md. Entries with an
 * applies(officialNorm, oursNorm) predicate claim a textual diff; entries
 * without one are recorded structurally (normalization tags or per-arm
 * behavioral expectations encoded IN the case). A case must LIST a KD id as
 * a candidate for it to be consumable - and every consumption is reported.
 */
export const KNOWN_TOOL_DIVERGENCES = [
  {
    id: 'KD-L3-01',
    tool: 'Read/Edit',
    note: 'GUARD, not hit live (2026-07-05 run): anticipated from source reading that official emits spaces+number+U+2192 arrow gutters, but official 2.1.201 tool_result content uses number+TAB just like ours (the arrow is UI-side rendering). N5 canonicalizes both forms and this entry reports if the arrow form ever appears on one arm only.',
  },
  {
    id: 'KD-L3-02',
    tool: 'Read',
    note: 'GUARD, not hit live (2026-07-05 run, these fixtures): official is known to append a trailing <system-reminder> appendix to some Read results; none was observed on 2.1.201 here. N6 strips and this entry reports it if it appears on the official arm only.',
  },
  {
    id: 'KD-L3-03',
    tool: 'Read',
    note: 'file-not-found error wording: ours \'Read failed: file does not exist: "<abs>".\' vs the official tool_use_error phrasing. Both flag is_error.',
    applies: (o, u) =>
      /(does not exist|no such file|not found)/i.test(o) &&
      /^Read failed: file does not exist:/m.test(u),
  },
  // KD-L3-04 RETIRED (2026-07-05, keeper ruling on BPT #2): the BPT-only path
  // fence was removed (resolveWithin -> resolveAbs), so Read reaches an
  // outside-cwd file on BOTH arms - L3-READ-03 is now a plain CONTENT_MATCH,
  // no per-arm split. Id kept out of circulation.
  {
    id: 'KD-L3-05',
    tool: 'Write',
    note: 'success wording: ours \'Created new file "<abs>" (N bytes written).\' / \'Overwrote existing file ...\' vs official \'File created successfully at: <abs>\' style. Side-effect bytes are asserted hard-equal separately.',
    applies: (o, u) =>
      /^(Created new file|Overwrote existing file) "/m.test(u) &&
      /(file|written|updated|created|success)/i.test(o),
  },
  // KD-L3-06 RETIRED (2026-07-05, E4): ours now enforces the same
  // read-before-write gate with the verbatim official error text, so
  // L3-WRITE-02 converged to shared expectations. Id kept out of circulation.
  {
    id: 'KD-L3-07',
    tool: 'Edit',
    note: 'success wording + snippet window: ours \'Replaced N occurrence(s) of old_string in "<abs>".\' with a 2-context-line cat -n snippet vs the official updated-file phrasing/snippet. The actual byte change is asserted hard-equal separately.',
    applies: (o, u) =>
      /^Replaced \d+ occurrence/m.test(u) &&
      /(updated|replaced|edit)/i.test(o),
  },
  {
    id: 'KD-L3-08',
    tool: 'Edit',
    note: 'non-unique old_string error wording: ours \'Edit failed: found N occurrences ... must be unique ...\' vs official \'Found N matches ...\' style. Both flag is_error and carry the count.',
    applies: (o, u) =>
      /^Edit failed: found \d+ occurrences/m.test(u) &&
      /\d+/.test(o) &&
      /(match|occurrenc|uniqu)/i.test(o),
  },
  {
    id: 'KD-L3-09',
    tool: 'Bash',
    note: 'failure prefix: ours prepends \'Command failed with exit code N\'; the official arm surfaces the streams with its own (or no) exit-code phrasing.',
    applies: (_o, u) => /^Command failed with exit code \d+/m.test(u),
  },
  {
    id: 'KD-L3-10',
    tool: 'Bash',
    note: 'ours-only \'[stderr]\' section marker between stdout and stderr; the official arm formats streams differently.',
    applies: (o, u) => u.includes('[stderr]') && !o.includes('[stderr]'),
  },
  {
    id: 'KD-L3-11',
    tool: 'Bash',
    note: 'empty-success placeholder: ours returns \'(no output)\' for a silent zero-exit command; official 2.1.201 returns \'(Bash completed with no output)\' (observed live 2026-07-05).',
    applies: (o, u) => u === '(no output)' && o !== '(no output)',
  },
  {
    id: 'KD-L3-12',
    tool: 'Bash/BashOutput/KillShell',
    note: 'background family envelope: ours uses \'Command running in background with id: <id>\' / \'status: running|killed (...)\' / \'(no new output)\' / \'Killed background shell <id>.\'; official 2.1.201 acks with \'Command running in background with ID: <id> Output is being written to: <task file> ... use Read on that file path\' (observed live 2026-07-05). Ids masked by N4; lifecycle semantics locked per step.',
    applies: (o, u) =>
      (/<SHELL_ID>|status: (running|killed|completed|failed)|no new output|Killed background shell/.test(u) ||
        /^Command running in background/m.test(u)) &&
      /<SHELL_ID>|running|killed|kill|exit|status|output|shell|task/i.test(o),
  },
  {
    id: 'KD-L3-13',
    tool: 'Bash',
    note: 'shell-id token format: ours \'bash_N\'; recorded when the official arm\'s harvested id does not match that shape (observed live: official 2.1.201 advertises a non-bash_N task id). Values masked by N4 either way.',
  },
  {
    id: 'KD-L3-14',
    tool: 'BashOutput/KillShell',
    note: 'unknown-shell-id error wording: ours \'<Tool>: no background shell with id "<id>".\' vs official 2.1.201 \'<tool_use_error>No task found with ID: <id></tool_use_error>\' (observed live 2026-07-05). Both flag is_error and reference the id.',
    applies: (o, u) =>
      /no background shell with id "bash_999"/.test(u) && /bash_999/.test(o),
  },
  {
    id: 'KD-L3-15',
    tool: 'Glob/Grep',
    note: 'empty-result sentinel / truncation-note wording: ours \'No files found\' / \'No matches found\' vs official variants (observed live: official Grep answers a no-match files_with_matches search with \'No files found\').',
    applies: (o, u) =>
      /^No (files|matches) found$/.test(u) && /no (files|matches)/i.test(o),
  },
  {
    id: 'KD-L3-16',
    tool: 'Glob/Grep',
    note: 'path/list emission style: ours absolute paths (masked to <CWD>/...), official may emit cwd-relative paths and/or a \'Found N files\' header line. Same file set required - only prefix/header dressing differs.',
    applies: (o, u) => {
      const strip = (t) =>
        t
          .split('\n')
          .filter((l) => !/^Found \d+ (file|files|match|matches)/i.test(l))
          .map((l) => l.replace(/^<CWD>\//, '').trim())
          .filter((l) => l.length > 0);
      const a = strip(o);
      const b = strip(u);
      return a.length === b.length && a.every((l, i) => l === b[i]);
    },
  },
  {
    id: 'KD-L3-17',
    tool: 'Glob',
    note: 'nonexistent search root: BOTH arms flag is_error (error-channel agreement, observed live 2026-07-05 - the pre-run risk of an official non-error empty result did NOT materialize); wording differs: ours \'Glob: directory does not exist: <abs>\', official \'<tool_use_error>Directory does not exist: <relative>. Note: your current working directory is <cwd>.</tool_use_error>\'.',
    applies: (o, u) =>
      /^Glob: directory does not exist:/.test(u) &&
      /directory does not exist/i.test(o),
  },
  {
    id: 'KD-L3-18',
    tool: 'Read',
    note: 'phantom trailing line: for a file ending in a newline, official 2.1.201 numbers one extra empty line past the last real line (\'N|\' with no text); ours drops the phantom line (toDisplayLines). Line numbers/text otherwise identical (observed live 2026-07-05).',
    applies: (o, u) => {
      const t = o.replace(/\n\d+\|$/, '');
      return t !== o && t === u;
    },
  },
  {
    id: 'KD-L3-19',
    tool: 'Bash/BashOutput/KillShell',
    note: 'background execution model split (behavioral, observed live 2026-07-05): official 2.1.201 runs run_in_background as a TASK whose interim output is read via Read on a task file, and its own BashOutput/KillShell do not resolve the advertised id (\'<tool_use_error>No task found with ID: <id></tool_use_error>\', is_error); ours implements the SDK-documented BashOutput/KillShell lifecycle (poll incrementally, kill, poll status). Encoded as per-arm expectations in L3-BG-01.',
  },
  {
    id: 'KD-L3-20',
    tool: 'Glob',
    note: 'result ordering: ours emits newest-first (mtime desc, per COMPAT claim); official 2.1.201 emitted a.txt,b.txt,sub/c.txt under ascending utimes pins - mtime-ASCENDING or lexicographic, indistinguishable with this fixture (observed live 2026-07-05). Same path SET required; ours-side newest-first order locked separately.',
    applies: (o, u) => {
      const strip = (t) =>
        t
          .split('\n')
          .filter((l) => !/^Found \d+ (file|files|match|matches)/i.test(l))
          .map((l) => l.replace(/^<CWD>\//, '').trim())
          .filter((l) => l.length > 0)
          .sort();
      const a = strip(o);
      const b = strip(u);
      return a.length > 0 && a.length === b.length && a.every((l, i) => l === b[i]);
    },
  },
  {
    id: 'KD-L3-21',
    tool: 'Grep',
    note: 'content-mode path prefix: ours prefixes every content line with the absolute file path (rg multi-file convention); official 2.1.201 prints bare N:/N- prefixed lines for a single-file search (observed live 2026-07-05). Line numbers, match/context separators and text identical after stripping the prefix.',
    applies: (o, u) => {
      const t = u
        .split('\n')
        .map((l) => l.replace(/^<CWD>\/[^:]+?([:-])(?=\d)/, ''))
        .join('\n');
      return t !== u && t === o;
    },
  },

  {
    id: 'KD-L3-22',
    tool: 'mcp (sdk server)',
    note:
      'thrown MCP handler wording: official 2.1.201 relays the bare handler error message as the ' +
      "error tool_result text; ours wraps it as \"Tool '<name>' failed: <msg>\" (registry " +
      'encoding). Semantics identical: is_error true, handler message carried verbatim inside. ' +
      'Stable across 2 runs (2026-07-05, L3-MCP tranche 1).',
    applies: (o, u) => /^Tool '[^']+' failed: /.test(u) && u.endsWith(o),
  },
  {
    id: 'KD-L3-23',
    tool: 'mcp (sdk server)',
    note:
      'unknown-MCP-tool wording: official 2.1.201 emits "<tool_use_error>Error: No such tool ' +
      'available: <name></tool_use_error>"; ours emits "No such tool: <name>" (no XMLish wrapper, ' +
      'registry wording). Semantics identical: is_error true, refused without execution, tool ' +
      'name carried. Stable across 2 runs (2026-07-05, L3-MCP tranche 1).',
    applies: (o, u) => {
      const om = o.match(/^<tool_use_error>Error: No such tool available: (.+)<\/tool_use_error>$/);
      const um = u.match(/^No such tool: (.+)$/);
      return om !== null && um !== null && om[1] === um[1];
    },
  },
];

/** First `max` differing line pairs between two normalized texts. */
export function diffExcerpt(officialText, oursText, max = 3) {
  const a = officialText.split('\n');
  const b = oursText.split('\n');
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < max; i++) {
    if (a[i] !== b[i]) {
      out.push({
        line: i + 1,
        official: a[i] ?? '(end)',
        ours: b[i] ?? '(end)',
      });
    }
  }
  return out;
}

/**
 * Compare one official/ours tool_result text pair under the KD contract.
 * kdCandidates: KD ids the CASE declares consumable for this step - an
 * unlisted textual diff stays 'divergent' even if some KD predicate would
 * match, so the allowlist can never quietly widen.
 */
export function compareToolResultTexts(
  officialRaw,
  oursRaw,
  officialEnv,
  oursEnv,
  flags = {},
  kdCandidates = [],
) {
  const o = normalizeToolResult(officialRaw, officialEnv, flags);
  const u = normalizeToolResult(oursRaw, oursEnv, flags);
  const kdHits = new Set();

  // Structural (normalization-tag) KDs: report asymmetries even when the
  // canonicalized texts end up equal. These two are GLOBAL guards exempt
  // from the per-case kdCandidates listing below by design: they fire only
  // on a normalization-tag asymmetry (never on a content difference), so a
  // case cannot use them to excuse an arbitrary text delta.
  if (o.applied.has('gutter-arrow') && u.applied.has('gutter-tab')) {
    kdHits.add('KD-L3-01');
  }
  if (o.applied.has('system-reminder') && !u.applied.has('system-reminder')) {
    kdHits.add('KD-L3-02');
  }

  if (o.text === u.text) {
    return {
      status: kdHits.size > 0 ? 'known' : 'match',
      kdHits: [...kdHits].sort(),
      diff: [],
      officialText: o.text,
      oursText: u.text,
    };
  }

  const claimed = KNOWN_TOOL_DIVERGENCES.filter(
    (d) =>
      kdCandidates.includes(d.id) &&
      typeof d.applies === 'function' &&
      d.applies(o.text, u.text),
  );
  for (const d of claimed) kdHits.add(d.id);

  return {
    status: claimed.length > 0 ? 'known' : 'divergent',
    kdHits: [...kdHits].sort(),
    diff: diffExcerpt(o.text, u.text),
    officialText: o.text,
    oursText: u.text,
  };
}
