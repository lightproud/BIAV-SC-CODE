/**
 * Structured memory-card mode (spec R9): in `schema: 'cards'` every written
 * memory file must be one or more cards in a fixed format, so write-side
 * quality has a harness-enforced floor instead of relying on model
 * discipline. A card is:
 *
 *   ## <title>
 *   结论: <conclusion>
 *   依据: <evidence>
 *   过期条件: <expiry condition>
 *
 * Field lines accept a half-width or full-width colon; a field's value may
 * continue over following lines until the next field or card heading. Blank
 * lines between cards are fine. Validation failures return a STRUCTURED
 * error string that restates the expected format so the model can repair and
 * retry (acceptance: 非法卡片返回结构化错误).
 */

import { z } from 'zod';

export type MemoryCardsConfig = {
  /** Maximum characters per card (title + fields). Default 500. */
  maxCardChars: number;
  /** Maximum cards per file. Default 50. */
  maxCardsPerFile: number;
};

export const DEFAULT_CARDS_CONFIG: MemoryCardsConfig = {
  maxCardChars: 500,
  maxCardsPerFile: 50,
};

export type MemoryCard = {
  title: string;
  conclusion: string;
  evidence: string;
  expiry: string;
};

const cardSchema = z.object({
  title: z.string().trim().min(1),
  conclusion: z.string().trim().min(1),
  evidence: z.string().trim().min(1),
  expiry: z.string().trim().min(1),
});

const FIELD_NAMES: ReadonlyArray<[key: keyof Omit<MemoryCard, 'title'>, label: string]> = [
  ['conclusion', '结论'],
  ['evidence', '依据'],
  ['expiry', '过期条件'],
];

function fieldOfLine(line: string): { key: keyof Omit<MemoryCard, 'title'>; value: string } | null {
  for (const [key, label] of FIELD_NAMES) {
    if (line.startsWith(`${label}:`) || line.startsWith(`${label}：`)) {
      return { key, value: line.slice(label.length + 1).trim() };
    }
  }
  return null;
}

/** A line that, taken literally, would read as a card heading (`## `) or a
 *  field marker (`结论:` / `依据:` / `过期条件:`, half- or full-width colon). */
function looksLikeMarker(line: string): boolean {
  return line.startsWith('## ') || fieldOfLine(line) !== null;
}

/** Strip one leading backslash that escapes a marker line, so a field value
 *  whose continuation line begins with `## ` or a field marker round-trips as
 *  literal content instead of derailing the parse into a bogus heading/field
 *  (audit r4 U4-9). A line that is not an escaped marker is returned as-is. */
function unescapeMarkerLine(line: string): string {
  return line.startsWith('\\') && looksLikeMarker(line.slice(1)) ? line.slice(1) : line;
}

export type CardsParseResult =
  | { ok: true; cards: MemoryCard[] }
  | { ok: false; reason: string };

/** Parse card-mode file content into cards, or a human-readable reason. */
export function parseMemoryCards(
  content: string,
  cfg: MemoryCardsConfig = DEFAULT_CARDS_CONFIG,
): CardsParseResult {
  const lines = content.split('\n');
  const rawCards: Array<{ title: string; lines: string[]; charCount: number }> = [];
  let current: { title: string; lines: string[]; charCount: number } | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [], charCount: line.length };
      rawCards.push(current);
      continue;
    }
    if (line.trim().length === 0 && current === null) continue;
    if (current === null) {
      return {
        ok: false,
        reason: `content before the first card heading (every card starts with "## <title>"): ${JSON.stringify(line.slice(0, 40))}`,
      };
    }
    current.lines.push(line);
    current.charCount += line.length + 1;
  }
  if (rawCards.length === 0) {
    return { ok: false, reason: 'no cards found (a memory file must contain at least one card)' };
  }
  if (rawCards.length > cfg.maxCardsPerFile) {
    return {
      ok: false,
      reason: `${rawCards.length} cards exceed the per-file limit of ${cfg.maxCardsPerFile}`,
    };
  }

  const cards: MemoryCard[] = [];
  for (const [idx, raw] of rawCards.entries()) {
    const where = `card ${idx + 1}${raw.title !== '' ? ` ("${raw.title}")` : ''}`;
    if (raw.charCount > cfg.maxCardChars) {
      return {
        ok: false,
        reason: `${where} has ${raw.charCount} characters, over the per-card limit of ${cfg.maxCardChars}`,
      };
    }
    const card: Record<string, string> = { title: raw.title };
    let currentField: keyof Omit<MemoryCard, 'title'> | null = null;
    for (const line of raw.lines) {
      const field = fieldOfLine(line);
      if (field !== null) {
        if (card[field.key] !== undefined) {
          return { ok: false, reason: `${where} repeats the field ${JSON.stringify(line.split(/[:：]/)[0])}` };
        }
        card[field.key] = field.value;
        currentField = field.key;
        continue;
      }
      if (line.trim().length === 0) continue;
      if (currentField === null) {
        return {
          ok: false,
          reason: `${where} has content outside the three fields: ${JSON.stringify(line.slice(0, 40))}`,
        };
      }
      // Continuation line of the current field; a leading backslash escapes a
      // line that would otherwise read as a heading/field marker (audit r4 U4-9).
      card[currentField] = `${card[currentField]}\n${unescapeMarkerLine(line)}`.trim();
    }
    const parsed = cardSchema.safeParse(card);
    if (!parsed.success) {
      const missing = FIELD_NAMES.filter(([key]) => {
        const v = card[key];
        return v === undefined || v.trim().length === 0;
      }).map(([, label]) => label);
      const detail =
        missing.length > 0
          ? `missing or empty field(s): ${missing.join(' / ')}`
          : raw.title.trim().length === 0
            ? 'empty card title'
            : 'invalid card';
      return { ok: false, reason: `${where}: ${detail}` };
    }
    cards.push(parsed.data);
  }
  return { ok: true, cards };
}

/**
 * Validate content for a cards-mode write. Returns null when valid, else the
 * STRUCTURED error string surfaced to the model (restates the format so the
 * model can retry).
 */
export function validateCardsContent(
  content: string,
  cfg: MemoryCardsConfig = DEFAULT_CARDS_CONFIG,
): string | null {
  const parsed = parseMemoryCards(content, cfg);
  if (parsed.ok) return null;
  return (
    `Error: cards-mode validation failed: ${parsed.reason}. ` +
    `Memory files must contain one or more cards in exactly this format:\n` +
    `## <card title>\n结论: <conclusion>\n依据: <evidence>\n过期条件: <expiry condition>\n` +
    `Every card needs all three fields; limits: ${cfg.maxCardsPerFile} cards per file, ` +
    `${cfg.maxCardChars} characters per card. Fix the content and retry the command.`
  );
}
