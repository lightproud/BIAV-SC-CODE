/**
 * Context-tips subsystem — the consuming feature for the reproduced context-tip
 * prompts. A host surfaces at most ONE brief feature tip when the transcript
 * matches a catalog situation (selectContextTip), then later judges whether the
 * shown tip landed (evaluateTipReception). Both are single-shot utility calls
 * over the shipped v0.6 runtime.
 *
 * Fail-SAFE defaults: the selector defaults to NO tip (the prompt's own default
 * — never interrupt on a garbled reply), and it only ever returns a feature_id
 * that is actually in the caller's eligible set + catalog (a hallucinated id is
 * dropped to no-tip). The reception evaluator defaults to neutral/unknown.
 */

import {
  extractJsonObject,
  runUtilityCall,
  type UtilityCallOptions,
} from '../generators/runtime.js';
import {
  CONTEXT_TIP_CATALOG,
  renderCatalog,
  type ContextTipSituation,
} from './catalog.js';
import {
  CONTEXT_TIP_SELECTOR_OUTPUT_CONTRACT,
  CONTEXT_TIP_SELECTOR_SYSTEM,
  TIP_RECEPTION_OUTPUT_CONTRACT,
  TIP_RECEPTION_SYSTEM,
} from './prompts.js';

// ---------------------------------------------------------------------------
// selectContextTip
// ---------------------------------------------------------------------------

/** Session metadata the selector may weigh (all optional). */
export interface TipSessionMetadata {
  numStartups?: number;
  teamMcpServers?: string[];
  teamSkills?: string[];
  [key: string]: unknown;
}

/** Input for a tip-selection call. */
export interface SelectContextTipInput {
  /** Recent transcript text the selector matches against. */
  transcript: string;
  /** Feature ids eligible for THIS user/state (the selector may only pick these). */
  eligibleIds: string[];
  /** Ids ruled out by local state (never picked). */
  ineligibleIds?: string[];
  /** Session metadata (numStartups drives tone; team data outranks generic tips). */
  sessionMetadata?: TipSessionMetadata;
  /** Catalog to match against; defaults to the archived seed catalog. */
  catalog?: readonly ContextTipSituation[];
}

/** A selected tip, or the (default) decision to stay silent. */
export type ContextTipDecision =
  | { hasTip: false }
  | { hasTip: true; tip: string; featureId: string; action: string };

/**
 * Decide whether to surface ONE brief feature tip. Fails SAFE to no-tip: a
 * garbled reply, a missing/blank tip, or a feature_id that is not in BOTH the
 * eligible set AND the catalog all collapse to { hasTip: false } — a tip is
 * never fabricated and an ineligible/hallucinated id is never surfaced.
 */
export async function selectContextTip(
  input: SelectContextTipInput,
  opts: UtilityCallOptions = {},
): Promise<ContextTipDecision> {
  const catalog = input.catalog ?? CONTEXT_TIP_CATALOG;
  // Function-form replacement so a catalog situation containing `$$` / `$&` /
  // `$\`` is inserted literally, not misread as a String.replace macro.
  const system =
    CONTEXT_TIP_SELECTOR_SYSTEM.replace('{situations}', () => renderCatalog(catalog)) +
    '\n\n' +
    CONTEXT_TIP_SELECTOR_OUTPUT_CONTRACT;
  const user = buildSelectorUserTurn(input);
  const raw = await runUtilityCall(system, user, opts, 256);
  return parseContextTip(raw, input.eligibleIds, catalog);
}

/** Assemble the selector user turn (transcript + eligibility + metadata). */
export function buildSelectorUserTurn(input: SelectContextTipInput): string {
  const meta = input.sessionMetadata ?? {};
  const parts = [
    `Transcript:\n${input.transcript}`,
    `<eligible_ids>${input.eligibleIds.join(', ')}</eligible_ids>`,
    `<ineligible_ids>${(input.ineligibleIds ?? []).join(', ')}</ineligible_ids>`,
    `session_metadata: ${JSON.stringify(meta)}`,
  ];
  if (typeof meta.numStartups === 'number') parts.push(`numStartups: ${meta.numStartups}`);
  return parts.join('\n\n');
}

/** Pure parser for the selector reply (unit-testable, no I/O). FAILS SAFE. */
export function parseContextTip(
  raw: string,
  eligibleIds: string[],
  catalog: readonly ContextTipSituation[],
): ContextTipDecision {
  const obj = extractJsonObject(raw);
  if (obj === null || typeof obj !== 'object') return { hasTip: false };
  const rec = obj as Record<string, unknown>;
  if (rec.has_tip !== true) return { hasTip: false };
  const tip = typeof rec.tip === 'string' ? rec.tip.trim() : '';
  const featureId = typeof rec.feature_id === 'string' ? rec.feature_id.trim() : '';
  // A tip must name a feature_id that is BOTH eligible AND in the catalog, and
  // carry non-empty tip text. Anything else -> stay silent (never surface an
  // ineligible or hallucinated id).
  // Case-insensitive id matching (audit 2026-07-17 L47): the model routinely
  // re-cases ids ("Manual-Polling" -> "manual-polling"), and a case-sensitive
  // compare silently dropped valid selections. The CANONICAL id (catalog
  // casing) is what gets returned, never the model's spelling.
  const featureIdLower = featureId.toLowerCase();
  const eligible = eligibleIds.some((id) => id.toLowerCase() === featureIdLower);
  const entry = catalog.find((s) => s.featureId.toLowerCase() === featureIdLower);
  if (tip.length === 0 || !eligible || entry === undefined) return { hasTip: false };
  // Use the catalog's AUTHORITATIVE action for the chosen feature, not the
  // model's free-text `action` field — a host may display/run this, so it must
  // be the vetted catalog command, never unvalidated model output.
  return { hasTip: true, tip, featureId: entry.featureId, action: entry.action };
}

// ---------------------------------------------------------------------------
// evaluateTipReception
// ---------------------------------------------------------------------------

/** How a shown tip was received. */
export type TipReception = 'positive' | 'neutral' | 'negative' | 'unknown';

const RECEPTIONS: ReadonlySet<string> = new Set([
  'positive',
  'neutral',
  'negative',
  'unknown',
]);

/** The reception verdict for a shown tip. */
export interface TipReceptionResult {
  actedOn: boolean;
  reception: TipReception;
}

/**
 * Judge whether a shown tip was acted on / well-received from the transcript
 * that followed. Fails SAFE to { actedOn: false, reception: 'unknown' } and
 * defaults an unrecognized reception to 'neutral' (the prompt's stated default),
 * never inventing a positive/negative signal from a garbled reply.
 */
export async function evaluateTipReception(
  input: { tip: string; action: string; transcriptAfter: string },
  opts: UtilityCallOptions = {},
): Promise<TipReceptionResult> {
  const system = TIP_RECEPTION_SYSTEM + '\n\n' + TIP_RECEPTION_OUTPUT_CONTRACT;
  const user = `Tip shown: ${input.tip}\nSuggested action: ${input.action}\n\nTranscript after the tip:\n${input.transcriptAfter}`;
  const raw = await runUtilityCall(system, user, opts, 128);
  return parseTipReception(raw);
}

/** Pure parser for the reception reply (unit-testable, no I/O). FAILS SAFE. */
export function parseTipReception(raw: string): TipReceptionResult {
  const obj = extractJsonObject(raw);
  if (obj === null || typeof obj !== 'object') {
    return { actedOn: false, reception: 'unknown' };
  }
  const rec = obj as Record<string, unknown>;
  const r = typeof rec.reception === 'string' ? rec.reception.trim().toLowerCase() : '';
  // Unrecognized/garbled reception -> 'unknown', the documented fail-safe:
  // mapping it to 'neutral' over-counted neutral in host aggregations and
  // made bad replies indistinguishable from real neutrals (audit 2026-07-17
  // L66). A garbled reply never fabricates positive/negative/neutral.
  const reception: TipReception = RECEPTIONS.has(r) ? (r as TipReception) : 'unknown';
  return { actedOn: rec.acted_on === true, reception };
}

export { CONTEXT_TIP_CATALOG, renderCatalog } from './catalog.js';
export type { ContextTipSituation } from './catalog.js';
export {
  CONTEXT_TIP_SELECTOR_SYSTEM,
  TIP_RECEPTION_SYSTEM,
  TIP_PROVENANCE,
  type TipProvenance,
} from './prompts.js';
