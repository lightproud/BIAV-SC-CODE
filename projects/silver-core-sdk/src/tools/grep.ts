/**
 * Grep built-in tool (module D).
 *
 * Content search over files enumerated with fast-glob, matched with JS
 * RegExp, formatted following ripgrep conventions. Binary files and files
 * larger than 10MB are skipped. The dash-prefixed input keys (-i, -n, -A,
 * -B, -C) are literal JSON field names - part of the compat surface.
 */

import fg from 'fast-glob';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AbortError } from '../errors.js';
import { guardRegexPattern } from '../internal/regex-guard.js';
import { sliceSurrogateSafe } from '../internal/text.js';
import { GREP_DESCRIPTION } from './descriptions.js';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';

const IGNORE_PATTERNS = ['**/node_modules/**', '**/.git/**'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_HEAD_LIMIT = 250;
const MAX_LINE_DISPLAY_CHARS = 2000;

/** File-type name -> glob patterns (mirrors common ripgrep type sets). */
const TYPE_GLOBS: Record<string, string[]> = {
  js: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  ts: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  py: ['**/*.py', '**/*.pyi'],
  rust: ['**/*.rs'],
  go: ['**/*.go'],
  java: ['**/*.java'],
  c: ['**/*.c', '**/*.h'],
  cpp: ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.hh', '**/*.hxx'],
  md: ['**/*.md', '**/*.markdown'],
  json: ['**/*.json'],
  html: ['**/*.html', '**/*.htm'],
  css: ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less'],
  sh: ['**/*.sh', '**/*.bash', '**/*.zsh'],
  yaml: ['**/*.yaml', '**/*.yml'],
  toml: ['**/*.toml'],
  xml: ['**/*.xml'],
  sql: ['**/*.sql'],
  rb: ['**/*.rb'],
  php: ['**/*.php'],
  swift: ['**/*.swift'],
  kotlin: ['**/*.kt', '**/*.kts'],
  scala: ['**/*.scala', '**/*.sc'],
  cs: ['**/*.cs'],
  lua: ['**/*.lua'],
  vue: ['**/*.vue'],
  svelte: ['**/*.svelte'],
  ex: ['**/*.ex', '**/*.exs'],
  dart: ['**/*.dart'],
  r: ['**/*.r', '**/*.R'],
  proto: ['**/*.proto'],
  tex: ['**/*.tex'],
};

// V6-4 (audit r4): sniffing only the first 8KB let a file with a text header
// and a binary tail slip through the guard — grep then emitted the raw binary
// bytes of its tail. The whole buffer is already resident (<= 10MB read cap)
// and Buffer.includes is native memchr, so scan all of it: a NUL anywhere marks
// the file binary and it is skipped whole (ripgrep-style).
function looksBinary(buf: Buffer): boolean {
  return buf.includes(0);
}

/** Extension set ('.ext') for a type's glob patterns, for glob+type filtering. */
function extensionsForType(patterns: string[]): Set<string> {
  const exts = new Set<string>();
  for (const p of patterns) {
    const dot = p.lastIndexOf('.');
    if (dot >= 0) exts.add(p.slice(dot).toLowerCase());
  }
  return exts;
}

// ripgrep glob semantics: a pattern with no slash matches at ANY depth
// (gitignore-style), so `-g '*.ts'` finds nested files. fast-glob instead
// anchors a bare `*.ts` to the search root, silently missing nested matches —
// the exact `*.js`-style example this tool's own description advertises. So a
// slash-less positive pattern gets a globstar prefix to restore ripgrep depth
// semantics; patterns that already carry a slash, or a leading `!` negation,
// are left as authored.
function normalizeGlobDepth(glob: string): string {
  if (glob.includes('/') || glob.startsWith('!')) return glob;
  return `**/${glob}`;
}

/** Offsets (into the raw text) where each line starts. */
function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) offsets.push(i + 1);
  }
  return offsets;
}

/** Binary search: index of the line containing text offset `pos`. */
function lineIndexAt(offsets: number[], pos: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function clipLine(s: string): string {
  // R7s-1 (audit r4): a bare slice at 2000 can split a surrogate pair, leaving
  // a lone surrogate that serializes as U+FFFD in the grep tool_result the model
  // sees. Cut on a codepoint boundary via the shared helper.
  return s.length > MAX_LINE_DISPLAY_CHARS
    ? `${sliceSurrogateSafe(s, MAX_LINE_DISPLAY_CHARS)} [line truncated]`
    : s;
}

type FileScan = {
  /** CRLF-normalized file content (`\r\n` -> `\n`) — the single text every
   *  scan phase runs on (F6, audit 2026-07-17: detection used to scan the RAW
   *  text while -o extraction scanned a CR-stripped rebuild, so a pattern
   *  crossing a CRLF boundary was detected yet extracted zero matches — the
   *  file silently vanished from the output — and `$`-anchor behavior
   *  flipped between the two phases). */
  text: string;
  /** File content split into lines (trailing empty line dropped). */
  lines: string[];
  /** Sorted, de-duplicated 0-based indices of matching lines. */
  matches: number[];
};

/** Why a file produced no scan. `oversize` is disclosed to the caller (V6-1);
 *  the others are ordinary silent skips. */
type ScanSkip = { skipped: 'unreadable' | 'binary' | 'oversize' };

/** Scan one file; a `skipped` result means unreadable / binary / oversize. */
async function scanFile(
  file: string,
  pattern: string,
  flags: string,
  multiline: boolean,
): Promise<FileScan | ScanSkip> {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return { skipped: 'unreadable' };
  }
  if (!stat.isFile()) return { skipped: 'unreadable' };
  // V6-1 (audit r4): an oversize file used to be indistinguishable from every
  // other skip, so the caller silently dropped it — a 10.5MB log that DID
  // contain the search term reported a bare "No matches found" with no hint it
  // was never scanned. Signal oversize distinctly so the caller can disclose it.
  if (stat.size > MAX_FILE_SIZE_BYTES) return { skipped: 'oversize' };

  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return { skipped: 'unreadable' };
  }
  if (looksBinary(buf)) return { skipped: 'binary' };

  // CRLF-normalize ONCE so line splitting, multiline detection and -o
  // extraction all see the same text (F6). Lone `\r` was never a separator
  // before and still is not.
  const raw = buf.toString('utf8');
  const text = raw.includes('\r') ? raw.replace(/\r\n/g, '\n') : raw;
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const matchSet = new Set<number>();
  if (multiline) {
    // Whole-content scan: every line spanned by a match counts as matching.
    const re = new RegExp(pattern, `${flags}g`);
    const offsets = lineStartOffsets(text);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const startLine = lineIndexAt(offsets, m.index);
      const endLine = lineIndexAt(
        offsets,
        m.index + Math.max(m[0].length - 1, 0),
      );
      for (let i = startLine; i <= endLine && i < lines.length; i++) {
        matchSet.add(i);
      }
      if (m[0].length === 0) re.lastIndex++; // avoid zero-length-match loops
    }
  } else {
    const re = new RegExp(pattern, flags); // non-global: stateless .test()
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i] ?? '')) matchSet.add(i);
    }
  }
  return { text, lines, matches: [...matchSet].sort((a, b) => a - b) };
}

type Hunk = { start: number; end: number };

/** Expand match lines by context and merge overlapping/adjacent ranges. */
function buildHunks(
  matches: number[],
  before: number,
  after: number,
  lastLine: number,
): Hunk[] {
  const hunks: Hunk[] = [];
  for (const m of matches) {
    const start = Math.max(0, m - before);
    const end = Math.min(lastLine, m + after);
    const prev = hunks[hunks.length - 1];
    if (prev !== undefined && start <= prev.end + 1) {
      prev.end = Math.max(prev.end, end);
    } else {
      hunks.push({ start, end });
    }
  }
  return hunks;
}

function asOptionalCount(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : undefined;
}

export const grepTool: BuiltinTool = {
  name: 'Grep',
  description: GREP_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'The regular expression to search for (JavaScript RegExp syntax).',
      },
      path: {
        type: 'string',
        description:
          'File or directory to search in. Defaults to the working directory.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter searched files (e.g. "*.ts").',
      },
      type: {
        type: 'string',
        description: `File type filter. Supported: ${Object.keys(TYPE_GLOBS).join(', ')}.`,
      },
      output_mode: {
        type: 'string',
        enum: ['files_with_matches', 'content', 'count'],
        description:
          'Output mode: "files_with_matches" (default), "content", or "count".',
      },
      '-i': {
        type: 'boolean',
        description: 'Case-insensitive search.',
      },
      '-n': {
        type: 'boolean',
        description:
          'Show line numbers in content mode (default true).',
      },
      '-A': {
        type: 'number',
        description: 'Lines of context to show after each match (content mode).',
      },
      '-B': {
        type: 'number',
        description: 'Lines of context to show before each match (content mode).',
      },
      '-C': {
        type: 'number',
        description:
          'Lines of context before and after each match (content mode).',
      },
      context: {
        type: 'number',
        description:
          'Alias for "-C": lines of context before and after each match ' +
          '(content mode). "-C" wins when both are given.',
      },
      '-o': {
        type: 'boolean',
        description:
          'Only-matching: in content mode, print each matched substring on its ' +
          'own line instead of the whole line (context flags are ignored).',
      },
      multiline: {
        type: 'boolean',
        description:
          'Multiline mode: pattern is applied to whole file content and "." matches newlines.',
      },
      head_limit: {
        type: 'number',
        description: `Limit output to the first N lines/entries (default ${DEFAULT_HEAD_LIMIT}; 0 = unlimited).`,
      },
      offset: {
        type: 'number',
        description:
          'Skip the first N lines/entries before applying head_limit ' +
          '(pagination; equivalent to "| tail -n +N | head"). Default 0.',
      },
    },
    required: ['pattern'],
  },
  readOnly: true,

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const pattern = input['pattern'];
    if (typeof pattern !== 'string' || pattern.length === 0) {
      return {
        content: "Grep: 'pattern' must be a non-empty string.",
        isError: true,
      };
    }
    if (ctx.signal.aborted) throw new AbortError();

    // --- Options -----------------------------------------------------------
    const rawMode = input['output_mode'];
    const outputMode =
      rawMode === undefined ? 'files_with_matches' : rawMode;
    if (
      outputMode !== 'files_with_matches' &&
      outputMode !== 'content' &&
      outputMode !== 'count'
    ) {
      return {
        content: `Grep: invalid output_mode ${JSON.stringify(rawMode)}. Use "files_with_matches", "content" or "count".`,
        isError: true,
      };
    }

    const caseInsensitive = input['-i'] === true;
    const showLineNumbers = input['-n'] !== false; // default true
    const multiline = input['multiline'] === true;
    const onlyMatching = input['-o'] === true;
    // `context` is the official alias for '-C'; '-C' takes precedence.
    const bothContext =
      asOptionalCount(input['-C']) ?? asOptionalCount(input['context']);
    const before = asOptionalCount(input['-B']) ?? bothContext ?? 0;
    const after = asOptionalCount(input['-A']) ?? bothContext ?? 0;
    const rawLimit = input['head_limit'];
    // V6-3 (audit r4): a NEGATIVE head_limit used to collapse via Math.max(0,…)
    // to 0 = unlimited, so `head_limit:-1` silently returned EVERY match with no
    // cap — the opposite of a caller asking to bound output. Reject it so the
    // model corrects the value instead of being flooded.
    if (
      typeof rawLimit === 'number' &&
      Number.isFinite(rawLimit) &&
      rawLimit < 0
    ) {
      return {
        content: `Grep: "head_limit" must be >= 0 (0 = unlimited). Got ${rawLimit}.`,
        isError: true,
      };
    }
    // 0 = unlimited; undefined -> a MODE-DEPENDENT default.
    // `content` can flood (many lines per file) so it keeps the 250 guard.
    // `count` and `files_with_matches` emit ONE small entry per file, and a
    // truncated result there is a WRONG count / an incomplete file list — a
    // correctness bug, not a flood — so they default to COMPLETE (unlimited).
    // An explicit head_limit still bounds every mode. (OPT-1, 2026-07-07:
    // decoupled from the flat 250 that silently truncated counts.)
    const defaultLimit = outputMode === 'content' ? DEFAULT_HEAD_LIMIT : 0;
    const headLimit =
      typeof rawLimit === 'number' && Number.isFinite(rawLimit)
        ? Math.max(0, Math.floor(rawLimit))
        : defaultLimit;
    const limited = headLimit > 0;
    // Skip the first `offset` entries before head_limit (pagination). When
    // limited we must collect offset+headLimit rows before we can stop.
    const offset = asOptionalCount(input['offset']) ?? 0;
    const collectCap = limited ? offset + headLimit : Number.POSITIVE_INFINITY;

    // m always; i on -i; s only in multiline mode (dot matches newlines).
    let flags = 'm';
    if (caseInsensitive) flags += 'i';
    if (multiline) flags += 's';
    // ReDoS guard (audit 2026-07-14 M-2, shared with hooks/matcher.ts): the
    // model-supplied pattern runs synchronously over up to 10MB per file, so a
    // catastrophic-backtracking pattern would freeze the event loop with no
    // timeout or AbortSignal able to interrupt it. Rejected patterns come back
    // as a descriptive tool error the model can rephrase — never a throw.
    const guardReason = guardRegexPattern(pattern);
    if (guardReason !== null) {
      return {
        content: `Grep: unsafe regular expression rejected: ${guardReason}.`,
        isError: true,
      };
    }
    try {
      void new RegExp(pattern, flags);
    } catch (err) {
      return {
        content: `Grep: invalid regular expression: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const rawType = input['type'];
    let typePatterns: string[] | undefined;
    if (rawType !== undefined) {
      if (typeof rawType !== 'string' || TYPE_GLOBS[rawType] === undefined) {
        return {
          content: `Grep: unknown file type ${JSON.stringify(rawType)}. Supported: ${Object.keys(TYPE_GLOBS).join(', ')}.`,
          isError: true,
        };
      }
      typePatterns = TYPE_GLOBS[rawType];
    }
    const rawGlob = input['glob'];
    const globPattern =
      typeof rawGlob === 'string' && rawGlob.length > 0
        ? normalizeGlobDepth(rawGlob)
        : undefined;

    // --- File enumeration ---------------------------------------------------
    const rawPath = input['path'];
    const searchPath = path.resolve(
      ctx.cwd,
      typeof rawPath === 'string' && rawPath.length > 0 ? rawPath : '.',
    );

    let pathStat;
    try {
      pathStat = await fs.stat(searchPath);
    } catch {
      return {
        content: `Grep: path does not exist: ${searchPath}`,
        isError: true,
      };
    }

    let files: string[];
    if (pathStat.isFile()) {
      // Explicit file target is searched regardless of glob/type filters.
      files = [searchPath];
    } else {
      const patterns = globPattern
        ? [globPattern]
        : (typePatterns ?? ['**/*']);
      const rawEntries = await fg(patterns, {
        cwd: searchPath,
        absolute: true,
        dot: false,
        // Y5-1 (audit r4): onlyFiles:true + followSymbolicLinks:false drops
        // symlinks pointing to a regular file (a non-followed symlink's dirent
        // is not a file), leaving a symlinked source file silently unsearched.
        // Enumerate with onlyFiles:false so symlink entries survive the filter;
        // scanFile fs.stat's each below (following the link) and skips whatever
        // does not resolve to a regular file. The loop guard is unaffected: a
        // non-followed symlinked directory is still never recursed into.
        onlyFiles: false,
        objectMode: true,
        ignore: IGNORE_PATTERNS,
        suppressErrors: true,
        // F1 (audit 2026-07-17): same symlink-loop guard as Glob — fast-glob
        // follows directory symlinks with no cycle detection (2^depth blowup
        // on sibling loop links, uninterruptible). ripgrep default parity.
        followSymbolicLinks: false,
      });
      files = rawEntries
        .filter((e) => e.dirent.isFile() || e.dirent.isSymbolicLink())
        .map((e) => e.path);
      if (globPattern && typePatterns) {
        // glob narrowed further by type extensions.
        const exts = extensionsForType(typePatterns);
        files = files.filter((f) => exts.has(path.extname(f).toLowerCase()));
      }
      files.sort(); // deterministic output order
    }

    // --- Scan + format ------------------------------------------------------
    const out: string[] = [];
    const useContext = before > 0 || after > 0;
    let anyMatch = false;
    let firstContentFile = true;
    // OPT-5 telemetry: how much of the corpus this call actually scanned, so a
    // host can measure the "full-scan share" of its Grep traffic (the driver of
    // the pure-JS vs ripgrep cost — see the crossover diagnostic 2026-07-07).
    let scannedFiles = 0;
    let scanStoppedEarly = false;
    // L16 (audit 2026-07-17): an inner per-file loop hitting the cap mid-file
    // has CERTAIN pending output (a match/hunk was about to be emitted); the
    // top-of-loop early-stop alone missed a cut inside the LAST scanned file.
    let matchesCut = false;
    // V6-1 (audit r4): files skipped for exceeding the 10MB scan cap, disclosed
    // in the result so their (possible) matches are not silently unreported.
    const oversizeSkipped: string[] = [];

    for (const file of files) {
      if (ctx.signal.aborted) throw new AbortError();
      if (out.length >= collectCap) {
        scanStoppedEarly = true;
        break;
      }
      scannedFiles += 1;

      const scan = await scanFile(file, pattern, flags, multiline);
      if ('skipped' in scan) {
        if (scan.skipped === 'oversize') oversizeSkipped.push(file);
        continue;
      }
      if (scan.matches.length === 0) continue;
      anyMatch = true;

      if (outputMode === 'files_with_matches') {
        out.push(file);
        continue;
      }
      if (outputMode === 'count') {
        out.push(`${file}:${scan.matches.length}`);
        continue;
      }

      // content mode
      if (onlyMatching) {
        // Print each matched substring on its own line; context is ignored.
        const re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
        if (multiline) {
          // A multiline pattern's match can SPAN newlines, so a per-line exec
          // would extract nothing and report "No matches found" for a file the
          // scanner already flagged as matching. Scan the SAME normalized text
          // the detection pass ran on (F6: a rebuilt approximation diverged
          // from it on CRLF files) and emit each match with its STARTING line
          // number (ripgrep -oU semantics).
          const text = scan.text;
          const offsets = lineStartOffsets(text);
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            if (m[0].length === 0) {
              re.lastIndex++; // zero-length match: advance, emit nothing
              continue;
            }
            if (out.length >= collectCap) {
              matchesCut = true;
              break;
            }
            const lineNo = showLineNumbers ? `${lineIndexAt(offsets, m.index) + 1}:` : '';
            out.push(`${file}:${lineNo}${clipLine(m[0])}`);
          }
          continue;
        }
        for (const i of scan.matches) {
          if (out.length >= collectCap) {
            matchesCut = true;
            break;
          }
          const line = scan.lines[i] ?? '';
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            if (m[0].length === 0) {
              re.lastIndex++; // zero-length match: advance without emitting a
              continue; //       spurious empty line (ripgrep omits empty matches)
            }
            if (out.length >= collectCap) {
              matchesCut = true;
              break;
            }
            const lineNo = showLineNumbers ? `${i + 1}:` : '';
            out.push(`${file}:${lineNo}${clipLine(m[0])}`);
          }
        }
        continue;
      }
      if (useContext && !firstContentFile) out.push('--');
      firstContentFile = false;
      const matchSet = new Set(scan.matches);
      const hunks = buildHunks(
        scan.matches,
        before,
        after,
        Math.max(scan.lines.length - 1, 0),
      );
      for (let h = 0; h < hunks.length; h++) {
        if (out.length >= collectCap) {
          matchesCut = true;
          break;
        }
        const hunk = hunks[h];
        if (hunk === undefined) continue;
        if (useContext && h > 0) out.push('--');
        for (let i = hunk.start; i <= hunk.end; i++) {
          if (out.length >= collectCap) {
            matchesCut = true;
            break;
          }
          const isMatch = matchSet.has(i);
          const sep = isMatch ? ':' : '-';
          const lineNo = showLineNumbers ? `${i + 1}${sep}` : '';
          out.push(`${file}${sep}${lineNo}${clipLine(scan.lines[i] ?? '')}`);
        }
      }
    }

    // OPT-5: emit the scan-coverage signal on the debug channel (the host taps
    // options.stderr). full_scan=true means no early stop -> this call paid the
    // full corpus cost; a host can aggregate the ratio to decide the ripgrep
    // question empirically instead of guessing.
    ctx.debug(
      `grep.scan mode=${outputMode} files_total=${files.length} ` +
        `files_scanned=${scannedFiles} full_scan=${!scanStoppedEarly} ` +
        `early_stop=${scanStoppedEarly}`,
    );

    // V6-1 (audit r4): disclose files skipped for exceeding the 10MB scan cap,
    // so an empty or partial result is never mistaken for a complete search of
    // a corpus that contains an unsearched (possibly matching) large file.
    const oversizeNote =
      oversizeSkipped.length > 0
        ? `\n(${oversizeSkipped.length} file(s) skipped: larger than the ` +
          `${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB scan cap and NOT searched — ` +
          `matches in them, if any, are not shown:\n${oversizeSkipped.join('\n')})`
        : '';

    if (!anyMatch) {
      return { content: `No matches found${oversizeNote}` };
    }
    const capped = limited
      ? out.slice(offset, offset + headLimit)
      : out.slice(offset);
    if (capped.length === 0) {
      // Zero collected rows despite anyMatch: only zero-length matches (which
      // emit nothing, ripgrep semantics) — genuinely no reportable matches.
      if (out.length === 0) {
        return { content: `No matches found${oversizeNote}` };
      }
      // L17 (audit 2026-07-17): matches DO exist, the offset just skipped
      // past all of them — "No matches found" masked real hits.
      return {
        content:
          `No results in the requested window: offset=${offset} skips all ` +
          `${out.length} collected result(s). Matches exist — lower offset.` +
          oversizeNote,
      };
    }
    // OPT-1: never truncate silently. When the head_limit cap cut the scan or
    // the display short, say so, so a caller does not mistake a partial listing
    // (or a partial per-file count) for the complete result. Certain cuts
    // (rows we collected or were mid-emitting) say "exist"; a mere early scan
    // stop (unscanned files remain, L21) only says "may exist".
    const displayTruncated = limited && out.length > offset + headLimit;
    let content = capped.join('\n');
    if (displayTruncated || matchesCut) {
      content +=
        `\n(results truncated at head_limit=${headLimit}; more matches exist` +
        ` — raise head_limit or set head_limit=0 for the complete result)`;
    } else if (scanStoppedEarly) {
      content +=
        `\n(scan stopped after collecting head_limit=${headLimit} result(s); ` +
        `${files.length - scannedFiles} file(s) not scanned — more matches may exist;` +
        ` raise head_limit or set head_limit=0 for the complete result)`;
    }
    return { content: content + oversizeNote };
  },
};
