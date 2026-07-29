/**
 * The daily "dream" task (施工封面 §2 第二战): merge the day's patrol
 * findings into one memory card. Deliberately deterministic (no model call —
 * the unattended cron carries no API key); what makes it a real exercise of
 * the family is the plumbing: the card content is VALIDATED with the agent
 * SDK's frontmatter schema machinery (validateMemoryFrontmatter — the cards
 * validator it replaced retired in 2.0.0; the card body kept its shape, only
 * the head changed to the official YAML frontmatter), written through the
 * memory store's six-command engine, and the resident /memories/MEMORY.md
 * index (R6 shape) is refreshed — memory tools + ledger + scheduling all
 * genuinely in play for one job.
 */

import { parseMemoryFrontmatter, validateMemoryFrontmatter } from 'silver-core-agent-sdk';
import {
  CARDS_PREFIX,
  INDEX_PATH,
  REPORTS_PREFIX,
  listCardDates,
  listReportDates,
  pruneOld,
  readIfExists,
  replaceFile,
} from './memory.mjs';

/** Pick the newest date for which at least one inspector report exists. */
async function newestReportDate(store, inspectorIds) {
  let newest = null;
  for (const id of inspectorIds) {
    const dates = await listReportDates(store, id);
    const last = dates[dates.length - 1];
    if (last !== undefined && (newest === null || last > newest)) newest = last;
  }
  return newest;
}

const STATUS_RANK = { ok: 0, blocked: 1, warn: 2, fail: 3 };

/**
 * Merge one day's reports into /memories/cards/{date}.md. Prefers `date`;
 * when that day has no reports yet (e.g. the dream fired before the
 * inspectors on a fresh ledger) it honestly falls back to the newest day
 * that has any. Returns a summary string for the ledger's query row.
 */
export async function dream(store, { date, inspectorIds, keepDays = 45 }) {
  let day = date;
  const haveToday = (
    await Promise.all(inspectorIds.map((id) => readIfExists(store, `${REPORTS_PREFIX}/${id}/${day}.md`)))
  ).some((r) => r !== null);
  if (!haveToday) {
    const fallback = await newestReportDate(store, inspectorIds);
    if (fallback === null) return 'dream: no reports exist yet — nothing to merge';
    day = fallback;
  }

  const sections = [];
  let worst = 'ok';
  const perInspector = [];
  for (const id of inspectorIds) {
    const raw = await readIfExists(store, `${REPORTS_PREFIX}/${id}/${day}.md`);
    if (raw === null) {
      perInspector.push(`${id}=missing`);
      if (STATUS_RANK.warn > STATUS_RANK[worst]) worst = 'warn';
      continue;
    }
    const status = /- status: (\w+)/.exec(raw)?.[1] ?? 'warn';
    // An off-vocabulary status must never BECOME `worst`: STATUS_RANK[worst]
    // would then be undefined and every later `rank > undefined` is false, so
    // a real 'fail' sitting behind it would be silently downgraded. Rank the
    // unknown as warn and carry a known key forward (summaryLine still
    // reports the raw status verbatim).
    const ranked = STATUS_RANK[status] === undefined ? 'warn' : status;
    if (STATUS_RANK[ranked] > STATUS_RANK[worst]) worst = ranked;
    perInspector.push(`${id}=${status}`);
    const findingCount = raw.split('\n').filter((l) => /^- \[(warn|fail)\]/.test(l)).length;
    if (findingCount > 0) sections.push({ id, findingCount });
  }

  const summaryLine = perInspector.join(' ');
  const evidence = `reports/{${inspectorIds.join(',')}}/${day}.md — ${summaryLine}`;
  // 全绿 is claimed from `worst`, NOT from "no warn/fail lines were found":
  // a blocked patrol (rate-limited ratchet reports status blocked with only
  // info findings) and a MISSING report file both produce zero finding lines
  // and are emphatically not green — the old test declared 巡检全绿 over them.
  const conclusionBits =
    sections.length > 0
      ? `整体 ${worst}: ` + sections.map((s) => `${s.id} ${s.findingCount} 条发现`).join('; ')
      : worst === 'ok'
        ? `巡检全绿 (${summaryLine})`
        : `整体 ${worst}: 无 warn/fail 条目 (${summaryLine})`;

  // Frontmatter head (2.0.0 migration): the description is the picker's
  // relevance signal, so it carries the day + worst verdict, capped well
  // under the validator's 150-char line budget.
  const description = `值班归并 ${day} worst=${worst}`.slice(0, 150);
  const card = [
    '---',
    `name: duty-card-${day}`,
    `description: ${description}`,
    'metadata:',
    '  type: project',
    '---',
    `## 值班归并 ${day}`,
    `结论: ${conclusionBits}`,
    `依据: ${evidence}`,
    `过期条件: 出现更新一天的值班卡后本卡仅作历史`,
    '',
  ].join('\n');

  // Schema discipline: the card must survive the agent SDK's own frontmatter
  // validator before it is allowed into memory — same floor a model write
  // would face.
  const invalid = validateMemoryFrontmatter(card);
  if (invalid !== null) throw new Error(`dream produced an invalid card: ${invalid}`);
  const parsed = parseMemoryFrontmatter(card);
  if (!parsed.ok) throw new Error(`dream card failed to parse back: ${parsed.reason}`);

  // The card file stays STRICTLY cards-valid (finding detail already lives in
  // the day's report files — the card carries conclusions and pointers only).
  // replaceFile, not create: the ledger retries a failed attempt, and attempt
  // 2 must not die on the card attempt 1 already wrote.
  await replaceFile(store, `${CARDS_PREFIX}/${day}.md`, card);

  // Refresh the resident index head (R6 shape: a small, always-current map).
  // This path is rewritten EVERY run by construction, so it must go through
  // replaceFile — plain create only ever succeeds on the very first day.
  const cardDates = await listCardDates(store);
  const recent = cardDates.slice(-7).reverse();
  await replaceFile(
    store,
    INDEX_PATH,
    [
      '# testbed memory index',
      '',
      `- newest card: cards/${cardDates[cardDates.length - 1]}.md`,
      `- recent cards: ${recent.join(', ')}`,
      `- reports live under reports/{inspector}/{date}.md`,
      '',
    ].join('\n'),
  );

  const pruned = await pruneOld(store, inspectorIds, day, keepDays);
  return `dream: merged ${day} (${summaryLine}) worst=${worst}${pruned > 0 ? ` pruned=${pruned}` : ''}`;
}
