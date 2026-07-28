/**
 * Structured tool results (`toolUseResult`) — the PRODUCING side of the output
 * types that already lived in `types/tools.ts`.
 *
 * Correcting the record, because the first pass of the 2026-07-27 divergence
 * sweep got this wrong: it grepped for `outputSchema`, found none, and reported
 * "this SDK declares no output surface at all". The TYPES were there the whole
 * time — `GlobOutput`, `GrepOutput`, `WebFetchOutput`, `FileReadOutput`,
 * `BashOutput`, the Task quintet — faithfully mirroring the official shapes.
 * What was missing was that nothing ever POPULATED them: typed-not-populated,
 * which is exactly the failure mode this repository has a name for. So this
 * module deliberately declares almost nothing new; it re-exports the existing
 * types under producing-side names and adds only the two things that genuinely
 * did not exist.
 *
 * Why a caller needs this at all: a fact about a tool call — did Glob truncate,
 * what offset did Grep actually apply, what was the exit code — was previously
 * recoverable only by PARSING the human-facing string. Official states the
 * principle in its own comment on `truncatedByTokenCap`: that field "survives
 * output reconstruction (unlike the render-time banner)". A banner is a
 * rendering; a rendering is not an interface.
 *
 * Fidelity notes so these are not mistaken for byte-parity with official:
 * - Fields official derives from machinery this SDK does not ship (git diffs,
 *   image transcode metadata, official background-task ids) stay UNPOPULATED
 *   rather than faked. An absent optional field is honest; a zero-filled one
 *   is not.
 * - Official emits one `toolUseResult` per user message because it emits one
 *   tool_result per message. This engine batches a turn's results into a single
 *   user turn, so the message carries a RECORD keyed by tool_use_id. That is a
 *   real shape divergence, documented in docs/COMPAT.md.
 */

import type {
  BashOutput,
  EnterWorktreeOutput,
  FileEditOutput,
  FileReadOutput,
  FileWriteOutput,
  GlobOutput,
  GrepOutput,
  TodoWriteOutput,
  WebFetchOutput,
} from './tools.js';

export type { BashOutput, FileReadOutput, GlobOutput };

/**
 * Grep / WebFetch as this SDK populates them: the existing official-shaped
 * type plus a `truncated` flag. NEW because official reports truncation for
 * these through fields this engine does not produce (Grep's `totalFiles` /
 * `totalLines` pair, WebFetch's summarizer path), and "was this cut short" is
 * the single most load-bearing fact a caller needs — it decides whether the
 * result may be treated as complete. Additive, so an existing consumer typed
 * against the base shape keeps compiling.
 */
export type GrepStructuredOutput = GrepOutput & { truncated: boolean };
export type WebFetchStructuredOutput = WebFetchOutput & { truncated: boolean };
export type { GrepOutput, WebFetchOutput };

/**
 * Read's char-cap flag. NEW here, and named differently from official's
 * `truncatedByTokenCap` ON PURPOSE: official measures tokens, this SDK
 * measures characters (a documented divergence), and a same-named field
 * carrying a different unit is worse than a differently-named one — it reads
 * as parity and behaves as drift.
 */
export type ReadTextOutputWithCap = Extract<FileReadOutput, { type: 'text' }> & {
  file: { truncatedByCharCap?: boolean };
};

/** What Read actually produces here: the official union, with the cap flag
 *  available on the text arm. */
export type ReadOutput = ReadTextOutputWithCap | Exclude<FileReadOutput, { type: 'text' }>;

/**
 * Bash's result as this SDK populates it. Extends the existing `BashOutput`
 * with the two facts this engine knows and official carries elsewhere in its
 * own task model: the process exit code, and whether the stream cap bit.
 */
export type BashStructuredOutput = BashOutput & {
  exitCode: number | null;
  truncated: boolean;
};

/**
 * Write / Edit / TodoWrite / EnterWorktree — the second batch of producers
 * (keeper ruling 2026-07-27, "全补").
 *
 * These four were found by `scripts/type-parity.mjs`'s first run and the
 * follow-up producer census: each already DECLARED an official-shaped output
 * type in `types/tools.ts`, none had ever populated it, and every fact a
 * caller wanted was reachable only by parsing the human-facing sentence —
 * `Overwrote existing file "/x" (1234 bytes written).` is not an interface.
 * Write is the sharpest case: `bytes` was already computed and then spent on
 * string interpolation.
 *
 * What stays absent, and why absence is the honest answer:
 * - `structuredPatch` (Write, Edit) needs a diff algorithm this SDK does not
 *   ship. An empty array would read as "no changes".
 * - `gitDiff` (Write, Edit) needs git plumbing this SDK does not ship.
 * - `userModified` (Edit) is official's editor-integration signal; adjudicated
 *   unshipped, see docs/COMPAT.md.
 * - `originalFile` (Write) is captured only when file checkpointing is on —
 *   Write does not otherwise read the file it is about to replace, and forcing
 *   a read to fill a field would make every write pay for it. Optional here,
 *   required in official: a documented divergence, not a silent one.
 */
export type WriteStructuredOutput = Omit<
  FileWriteOutput,
  'structuredPatch' | 'originalFile' | 'gitDiff'
> & {
  /** Present when file checkpointing captured a lossless pre-image. */
  originalFile?: string | null;
  /** UTF-8 byte length actually written. Not an official field; this engine
   *  computes it for its own message and a caller should not have to re-derive
   *  it from `content`. */
  bytes: number;
};

export type EditStructuredOutput = Omit<
  FileEditOutput,
  'structuredPatch' | 'gitDiff' | 'userModified'
> & {
  /** How many occurrences were actually replaced (1 unless `replace_all`).
   *  Official carries this only inside `structuredPatch`, which this engine
   *  cannot build. */
  replacedCount: number;
};

/** Complete — every field is a fact this tool already holds. */
export type EnterWorktreeStructuredOutput = EnterWorktreeOutput;

/**
 * Complete, but note what had to be built to make it so: `oldTodos` demanded
 * per-session state the tool never kept (it validated the incoming list and
 * rendered it). The list now persists on the session-key WeakMap — the sanctioned
 * per-query state pattern — so a caller can see the TRANSITION rather than just
 * the new list. A first call in a session honestly reports `oldTodos: []`.
 */
export type TodoWriteStructuredOutput = TodoWriteOutput;

/** The per-message map described in the module header. */
export type ToolUseResults = Record<string, unknown>;
