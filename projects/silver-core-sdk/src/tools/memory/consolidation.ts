/**
 * Memory consolidation protocol (keeper ruling 2026-07-27): the HOW of tidying
 * a memory store, as SDK-provided discipline rather than model improvisation.
 *
 * Where this sits — the three layers of "tidying", and why only the middle one
 * belongs to the SDK:
 *
 *  1. WHETHER to tidy — `assessMemoryStoreHealth()` (health.ts). Already shipped.
 *  2. HOW to tidy — this module. Design principle 4 lists "整理" (tidying) among
 *     the behaviors that must have a harness-enforced floor instead of relying
 *     on model discipline; the SDK already ships the write-side floors (R7
 *     timing, R9 cards, the pitfall protocol) and this is the missing one.
 *  3. WHEN to run it, on what model, on whose machine — NOT the SDK's (spec N1:
 *     no server-side/offline pipeline, no background process). This module adds
 *     no process and no scheduler: it returns a STRING the consumer passes to
 *     its own `query()` call, whenever it decides to.
 *
 * SECURITY — read before wiring this up. A consolidation round is a broad,
 * cross-file WRITE pass. On a multi-tenant store it MUST run under S1 mounts
 * instantiated for the scope being tidied (`options.memory.mounts`), exactly
 * like an interactive session: without them, one tidy-up round rewrites every
 * user's memories. "It's only a background task" is not a reason to hand it the
 * whole tree — it is the reason it needs the routing most, since no one is
 * watching it work.
 */

import type { MemoryStoreAssessment } from './health.js';
import { MEMORY_INDEX_PATH } from './paths.js';

/**
 * The four-phase consolidation skeleton (sdk-original, adapted from the
 * published dream-consolidation shape: orient -> gather -> merge -> prune).
 *
 * Phase 4 is the one that matters for the failure this was built for: an index
 * that accumulates prose instead of pointers stops being navigable, and every
 * later session pays for it in `view` round-trips. Merging without pruning the
 * index leaves that intact.
 *
 * Tool references are deliberately limited to the `memory` tool: a
 * consolidation round is defined over the memory store, and naming any other
 * tool would describe a capability the round may not have been granted.
 */
export const MEMORY_CONSOLIDATION_PROTOCOL =
  'MEMORY CONSOLIDATION\n' +
  'You are doing a consolidation pass over the memory store — not a task. ' +
  'Work only through your `memory` tool, and change nothing outside it.\n' +
  'Phase 1 — Orient: view the memory directory and read ' +
  `${MEMORY_INDEX_PATH}. Skim the topic files you are about to touch, so you ` +
  'IMPROVE existing files instead of creating near-duplicates.\n' +
  'Phase 2 — Gather: for each item in the task list below, read the files it ' +
  'names and decide what the durable content actually is. Verify before you ' +
  'rewrite: a record that is merely OLD is not necessarily wrong, and a record ' +
  'that is wrong should be deleted rather than preserved for tidiness.\n' +
  'Phase 3 — Merge: fold related records into the topic file that already owns ' +
  'the subject, keeping the strongest evidence and dropping what it supersedes. ' +
  'When you retire a file in favour of another, note `supersedes: <path>` in the ' +
  'surviving file so the chain stays checkable. Prefer editing files over ' +
  'creating them; prefer deleting a stale file over leaving it to rot.\n' +
  `Phase 4 — Prune the index: rewrite ${MEMORY_INDEX_PATH} so it is an INDEX ` +
  'and nothing else — one line per entry, roughly 150 characters or less, ' +
  '"- [<title>](<file path>) — one-line hook". Never leave memory CONTENT in the ' +
  'index: content belongs in the file the line points at. Drop entries whose ' +
  'files no longer exist, and merge entries that point at the same subject.\n' +
  'Report at the end: what you merged, what you deleted, and what you chose to ' +
  'leave alone and why.';

export type ConsolidationPromptOptions = {
  /** Extra consumer guidance appended after the task list (e.g. scope rules,
   *  retention policy). */
  instructions?: string;
  /** Cap on how many paths any single finding lists before it says "and N
   *  more" — keeps the prompt bounded on a large store. Default 10. */
  maxPathsPerFinding?: number;
};

const DEFAULT_MAX_PATHS = 10;

function pathList(paths: string[], cap: number): string {
  const shown = paths.slice(0, cap);
  const rest = paths.length - shown.length;
  return shown.join(', ') + (rest > 0 ? `, and ${rest} more` : '');
}

/**
 * Render a health assessment into the consolidation round's prompt: the
 * four-phase protocol plus a task list derived from what the scan actually
 * found. Findings the scan could not make (a backend without mtimes) are
 * stated as unavailable, never silently omitted — the round should know what
 * it is blind to.
 *
 * Returns a prompt string for the consumer's own `query()` call; this function
 * performs no I/O and starts nothing.
 */
export function buildConsolidationPrompt(
  assessment: MemoryStoreAssessment,
  options: ConsolidationPromptOptions = {},
): string {
  const cap = options.maxPathsPerFinding ?? DEFAULT_MAX_PATHS;
  const tasks: string[] = [];

  if (assessment.warnDirectories.length > 0) {
    const detail = assessment.waterlines
      .filter((w) => w.warn)
      .map((w) => `${w.path} (${w.files} files, ${w.remaining} below the ${w.limit} cap)`);
    tasks.push(
      `Directories at their file-count waterline — merge related files here first: ` +
        `${pathList(detail, cap)}.`,
    );
  }

  if (assessment.staleness.available) {
    if (assessment.staleness.staleFiles > 0) {
      tasks.push(
        `${assessment.staleness.staleFiles} file(s) unchanged for over ` +
          `${assessment.staleness.staleAfterDays} days — decide per file: still true ` +
          `(leave), superseded (merge and delete), or wrong (delete). Oldest first: ` +
          `${pathList(assessment.staleness.staleList, cap)}.`,
      );
    }
  } else {
    tasks.push(
      `Staleness could not be assessed (${assessment.staleness.note}) — judge age ` +
        `from the file contents instead, and do not assume anything is fresh.`,
    );
  }

  if (assessment.capacity.filesOverHalfByteLimit > 0) {
    const largest = assessment.capacity.largestFile;
    tasks.push(
      `${assessment.capacity.filesOverHalfByteLimit} file(s) are over half the ` +
        `${assessment.limits.maxFileBytes}-byte per-file limit — split by subject or ` +
        `condense` +
        (largest !== null ? `; the largest is ${largest.path} (${largest.sizeBytes} bytes)` : '') +
        `.`,
    );
  }

  if (assessment.supersede.broken.length > 0) {
    const detail = assessment.supersede.broken.map((b) => `${b.file} -> ${b.target}`);
    tasks.push(
      `Broken supersede references (the target no longer exists) — fix or remove the ` +
        `reference: ${pathList(detail, cap)}.`,
    );
  }

  if (assessment.readWriteRatio !== null && assessment.readWriteRatio < 1) {
    tasks.push(
      `This store is written far more than it is read (read/write ratio ` +
        `${assessment.readWriteRatio.toFixed(2)}) — that is hoarding, not remembering. ` +
        `Be aggressive about merging and deleting rather than adding.`,
    );
  }

  if (assessment.truncatedScan) {
    tasks.push(
      `The scan hit its entry bound, so these numbers are a LOWER bound — there may be ` +
        `more to tidy than is listed here.`,
    );
  }

  const taskBlock =
    tasks.length > 0
      ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : `No threshold was breached (${assessment.files} files, ${assessment.directories} ` +
        `directories, ${assessment.totalBytes} bytes). Do phase 1 and phase 4 only: ` +
        `confirm the index still points at what exists and is free of memory content.`;

  const extra = options.instructions;
  return (
    `${MEMORY_CONSOLIDATION_PROTOCOL}\n\n` +
    `TASK LIST (from a health scan of this store):\n${taskBlock}` +
    (extra !== undefined && extra.length > 0 ? `\n\n${extra}` : '')
  );
}
