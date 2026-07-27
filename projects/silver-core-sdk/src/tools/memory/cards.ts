/**
 * Structured memory-card mode (spec R9 + A1 extension, keeper ruling
 * 2026-07-27): in `schema: 'cards'` every written memory file must be one or
 * more cards in a fixed format, so write-side quality has a harness-enforced
 * floor instead of relying on model discipline.
 *
 * TWO card kinds, told apart by their field set (PlugMem evaluation item A1 /
 * audit finding P1-3: one propositional mould flattened every "how it was
 * done" and every progress card written under cards mode):
 *
 *   PROPOSITION (facts — what is true):
 *     ## <title>
 *     结论: <conclusion>
 *     依据: <evidence>
 *     过期条件: <expiry condition>
 *
 *   PRESCRIPTION (strategies — how it was done / is to be done):
 *     ## <title>
 *     意图: <what this achieves>
 *     步骤: <the workflow that worked>
 *     结果: <observed outcome>
 *     适用边界: <where this applies / stops applying>
 *
 * A progress card maps onto the prescription kind (意图 = the task goal,
 * 步骤 = done + remaining, 结果 = current state, 适用边界 = valid until the
 * next session updates it). Mixing fields from both kinds in one card is an
 * error naming the mix. Field lines accept a half-width or full-width colon;
 * a field's value may continue over following lines until the next field or
 * card heading. Blank lines between cards are fine. Validation failures
 * return a STRUCTURED error string that restates both formats so the model
 * can repair and retry (acceptance: 非法卡片返回结构化错误).
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

/** A parsed card: the discriminant is which field set the card used. */
export type MemoryCard =
  | { kind: 'proposition'; title: string; conclusion: string; evidence: string; expiry: string }
  | { kind: 'prescription'; title: string; intent: string; steps: string; outcome: string; scope: string };

const propositionSchema = z.object({
  title: z.string().trim().min(1),
  conclusion: z.string().trim().min(1),
  evidence: z.string().trim().min(1),
  expiry: z.string().trim().min(1),
});
const prescriptionSchema = z.object({
  title: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  steps: z.string().trim().min(1),
  outcome: z.string().trim().min(1),
  scope: z.string().trim().min(1),
});

type FieldKey = 'conclusion' | 'evidence' | 'expiry' | 'intent' | 'steps' | 'outcome' | 'scope';

const PROPOSITION_FIELDS: ReadonlyArray<[key: FieldKey, label: string]> = [
  ['conclusion', '结论'],
  ['evidence', '依据'],
  ['expiry', '过期条件'],
];
const PRESCRIPTION_FIELDS: ReadonlyArray<[key: FieldKey, label: string]> = [
  ['intent', '意图'],
  ['steps', '步骤'],
  ['outcome', '结果'],
  ['scope', '适用边界'],
];
const ALL_FIELDS: ReadonlyArray<[key: FieldKey, label: string]> = [
  ...PROPOSITION_FIELDS,
  ...PRESCRIPTION_FIELDS,
];

const PROPOSITION_KEYS = new Set(PROPOSITION_FIELDS.map(([k]) => k));

function fieldOfLine(line: string): { key: FieldKey; value: string } | null {
  for (const [key, label] of ALL_FIELDS) {
    if (line.startsWith(`${label}:`) || line.startsWith(`${label}：`)) {
      return { key, value: line.slice(label.length + 1).trim() };
    }
  }
  return null;
}

/** A line that, taken literally, would read as a card heading (`## `) or a
 *  field marker of either kind (half- or full-width colon). */
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
    const fields: Partial<Record<FieldKey, string>> = {};
    let currentField: FieldKey | null = null;
    for (const line of raw.lines) {
      const field = fieldOfLine(line);
      if (field !== null) {
        if (fields[field.key] !== undefined) {
          return { ok: false, reason: `${where} repeats the field ${JSON.stringify(line.split(/[:：]/)[0])}` };
        }
        fields[field.key] = field.value;
        currentField = field.key;
        continue;
      }
      if (line.trim().length === 0) continue;
      if (currentField === null) {
        return {
          ok: false,
          reason: `${where} has content outside the card fields: ${JSON.stringify(line.slice(0, 40))}`,
        };
      }
      // Continuation line of the current field; a leading backslash escapes a
      // line that would otherwise read as a heading/field marker (audit r4 U4-9).
      fields[currentField] = `${fields[currentField]}\n${unescapeMarkerLine(line)}`.trim();
    }

    // Kind detection: which field set did this card draw from? A card using
    // fields from BOTH sets is rejected by name (the mix is always a mistake,
    // and a silent pick would train the model on the wrong template).
    const usedKeys = Object.keys(fields) as FieldKey[];
    const usedProp = usedKeys.filter((k) => PROPOSITION_KEYS.has(k));
    const usedPresc = usedKeys.filter((k) => !PROPOSITION_KEYS.has(k));
    if (usedProp.length > 0 && usedPresc.length > 0) {
      const label = (k: FieldKey): string => ALL_FIELDS.find(([key]) => key === k)![1];
      return {
        ok: false,
        reason:
          `${where} mixes proposition fields (${usedProp.map(label).join(' / ')}) with ` +
          `prescription fields (${usedPresc.map(label).join(' / ')}) — a card is one kind or the other`,
      };
    }

    const wantPrescription = usedPresc.length > 0;
    const wanted = wantPrescription ? PRESCRIPTION_FIELDS : PROPOSITION_FIELDS;
    const schema = wantPrescription ? prescriptionSchema : propositionSchema;
    const parsed = schema.safeParse({ title: raw.title, ...fields });
    if (!parsed.success) {
      const missing = wanted
        .filter(([key]) => {
          const v = fields[key];
          return v === undefined || v.trim().length === 0;
        })
        .map(([, label]) => label);
      const detail =
        missing.length > 0
          ? `missing or empty field(s): ${missing.join(' / ')}`
          : raw.title.trim().length === 0
            ? 'empty card title'
            : 'invalid card';
      return { ok: false, reason: `${where}: ${detail}` };
    }
    cards.push(
      wantPrescription
        ? { kind: 'prescription', ...(parsed.data as z.infer<typeof prescriptionSchema>) }
        : { kind: 'proposition', ...(parsed.data as z.infer<typeof propositionSchema>) },
    );
  }
  return { ok: true, cards };
}

/**
 * Validate content for a cards-mode write. Returns null when valid, else the
 * STRUCTURED error string surfaced to the model (restates both formats so the
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
    `Memory files must contain one or more cards, each in exactly one of these formats:\n` +
    `## <card title>\n结论: <conclusion>\n依据: <evidence>\n过期条件: <expiry condition>\n` +
    `(a factual proposition), or\n` +
    `## <card title>\n意图: <what this achieves>\n步骤: <the workflow>\n结果: <observed outcome>\n适用边界: <where this applies>\n` +
    `(a reusable prescription / progress card). Every card needs all of its kind's ` +
    `fields; limits: ${cfg.maxCardsPerFile} cards per file, ${cfg.maxCardChars} ` +
    `characters per card. Fix the content and retry the command.`
  );
}
