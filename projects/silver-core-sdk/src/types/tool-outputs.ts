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
  FileReadOutput,
  GlobOutput,
  GrepOutput,
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

/** The per-message map described in the module header. */
export type ToolUseResults = Record<string, unknown>;
