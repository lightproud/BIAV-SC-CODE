/**
 * The testbed's memory area, held through the agent SDK's PUBLIC memory
 * machinery (createLocalFilesystemMemoryStore): patrol reports and dream
 * cards live under the virtual /memories tree, every byte written and read
 * through the six memory commands' semantics engine — R4 path validation,
 * R8 governance limits and the reference formats all genuinely exercised,
 * nothing hand-rolled onto the filesystem.
 *
 * Layout:
 *   /memories/MEMORY.md                     resident index (R6 head)
 *   /memories/reports/{inspector}/{date}.md one patrol report per day
 *   /memories/cards/{date}.md               one dream card per day (R9 shape)
 */

import { createLocalFilesystemMemoryStore } from 'silver-core-agent-sdk';

export const REPORTS_PREFIX = '/memories/reports';
export const CARDS_PREFIX = '/memories/cards';
export const INDEX_PATH = '/memories/MEMORY.md';

/** Open the testbed memory store rooted at `<baseDir>/memories`. */
export function openMemory(baseDir) {
  return createLocalFilesystemMemoryStore(baseDir);
}

/** view() returns the reference format ("Here's the content of <path> with
 *  line numbers:" header + numbered lines); strip it back to raw text. */
export function stripView(viewText) {
  const lines = viewText.split('\n');
  if (/^Here's the content of .* with line numbers:$/.test(lines[0] ?? '')) lines.shift();
  return lines
    .map((line) => {
      const m = /^\s*\d+\t(.*)$/.exec(line);
      return m === null ? line : m[1];
    })
    .join('\n');
}

/** Raw content of a memory file, or null when it does not exist. Prefers
 *  the store's raw `read` (gap G4, adopted in 0.69.0); stripView stays as
 *  the fallback for stores that omit the optional accessor. */
export async function readIfExists(store, path) {
  try {
    if (typeof store.read === 'function') return await store.read(path);
    return stripView(await store.view(path));
  } catch {
    return null;
  }
}

/** Create-or-overwrite a day's patrol report for one inspector. */
export async function writeReport(store, inspectorId, date, markdown) {
  await store.create(`${REPORTS_PREFIX}/${inspectorId}/${date}.md`, markdown);
}

/** The report dates present for one inspector (parsed out of the dir view). */
export async function listReportDates(store, inspectorId) {
  try {
    const listing = await store.view(`${REPORTS_PREFIX}/${inspectorId}`);
    return [...new Set([...listing.matchAll(/(\d{4}-\d{2}-\d{2})\.md/g)].map((m) => m[1]))].sort();
  } catch {
    return [];
  }
}

/** The dream-card dates present. */
export async function listCardDates(store) {
  try {
    const listing = await store.view(CARDS_PREFIX);
    return [...new Set([...listing.matchAll(/(\d{4}-\d{2}-\d{2})\.md/g)].map((m) => m[1]))].sort();
  } catch {
    return [];
  }
}

/**
 * Retention pruning (R8 hygiene: 64-files-per-directory governance cap —
 * daily files would hit it in ~2 months): delete report/card files older
 * than `keepDays`. Returns the number of deleted files.
 */
export async function pruneOld(store, inspectorIds, today, keepDays = 45) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - keepDays * 86_400_000;
  const tooOld = (date) => new Date(`${date}T00:00:00Z`).getTime() < cutoff;
  let deleted = 0;
  for (const id of inspectorIds) {
    for (const date of await listReportDates(store, id)) {
      if (tooOld(date)) {
        await store.delete(`${REPORTS_PREFIX}/${id}/${date}.md`);
        deleted += 1;
      }
    }
  }
  for (const date of await listCardDates(store)) {
    if (tooOld(date)) {
      await store.delete(`${CARDS_PREFIX}/${date}.md`);
      deleted += 1;
    }
  }
  return deleted;
}
