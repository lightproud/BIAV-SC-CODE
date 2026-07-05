/**
 * Stream normalization + comparison for the L1 differential.
 *
 * normalizeStream() reduces an arm's SDKMessage sequence to shape tokens -
 * volatile identity (uuid / session_id / timings / cost) is dropped, only
 * grammar remains. compareStreams() aligns the two token sequences under the
 * KNOWN_DIVERGENCES allowlist: every allowlisted difference is reported (not
 * hidden), anything NOT allowlisted makes the scenario DIVERGENT.
 *
 * Verdicts: MATCH | MATCH_WITH_KNOWN_DIFFS | DIVERGENT.
 */

/** One SDKMessage -> one shape token. */
export function tokenOf(msg) {
  const type = msg?.type ?? 'unknown';
  if (type === 'system') return `system/${msg.subtype ?? '?'}`;
  if (type === 'result') return `result/${msg.subtype ?? '?'}`;
  if (type === 'user') {
    const content = msg.message?.content;
    const hasToolResult =
      Array.isArray(content) && content.some((b) => b?.type === 'tool_result');
    return hasToolResult ? 'user/tool_result' : 'user/echo';
  }
  return type;
}

export function normalizeStream(messages) {
  const tokens = messages.map(tokenOf);
  const resultMsg = messages.filter((m) => m?.type === 'result').pop();
  const toolResults = messages
    .filter((m) => m?.type === 'user')
    .flatMap((m) => (Array.isArray(m.message?.content) ? m.message.content : []))
    .filter((b) => b?.type === 'tool_result').length;
  return {
    tokens,
    checks: {
      resultSubtype: resultMsg?.subtype ?? null,
      resultText: typeof resultMsg?.result === 'string' ? resultMsg.result : null,
      toolResults,
    },
  };
}

/**
 * Known divergences between the official arm and this SDK, each observed
 * live (spike 2026-07-05) or documented in COMPAT.md. Three kinds:
 *   official-only token  -> { official: token }
 *   ours-only token      -> { ours: token }
 *   alias (same event, different wire shape) -> { official, ours, alias: true }
 * The comparator consumes matching tokens per this table and REPORTS every
 * consumption - allowlisted means "known and documented", never "invisible".
 */
export const KNOWN_DIVERGENCES = [
  { id: 'KD-01', official: 'active_goal', note: 'official-only status variant (engine 2.1.x); outside the pinned 0.3.199 type surface, typed-not-emitted here' },
  { id: 'KD-02', official: 'rate_limit_event', note: 'official broadcasts rate-limit STATUS even on success; this SDK emits rate_limit_event only on an actual 429' },
  { id: 'KD-03', official: 'system/api_retry', ours: 'api_retry', alias: true, note: 'same retry event; official wire shape is system+subtype, ours is a top-level discriminator (official docs are internally inconsistent here - see COMPAT observability note)' },
  { id: 'KD-04', ours: 'user/echo', note: 'this SDK yields a prompt-echo user message for string prompts; the official arm does not (spike S1 observation)' },
  { id: 'KD-05', granularity: true, note: 'message granularity: the official arm splits one assistant turn into one SDKMessage per content block and yields one user message per tool_result; this SDK batches per turn (one assistant message, one user message carrying all tool_results). End state equal - alignment candidate for a future surface batch, since per-message UI renderers see chunkier updates on the official engine (first caught live by two-reads-one-turn, 2026-07-05)' },
];

/** Collapse consecutive identical tokens; reports whether anything collapsed
 *  so the KD-05 granularity divergence is recorded, never hidden. */
function coalesce(tokens) {
  const out = [];
  let collapsed = false;
  for (const t of tokens) {
    if (out[out.length - 1] === t) collapsed = true;
    else out.push(t);
  }
  return { tokens: out, collapsed };
}

export function compareStreams(rawOfficialTokens, rawOursTokens) {
  // KD-05 granularity normalization: compare at turn granularity by
  // coalescing consecutive identical tokens on both sides.
  const a = coalesce(rawOfficialTokens);
  const b = coalesce(rawOursTokens);
  const officialTokens = a.tokens;
  const oursTokens = b.tokens;

  const officialOnly = new Map(
    KNOWN_DIVERGENCES.filter((d) => d.official && !d.alias).map((d) => [d.official, d]),
  );
  const oursOnly = new Map(
    KNOWN_DIVERGENCES.filter((d) => d.ours && !d.alias).map((d) => [d.ours, d]),
  );
  const aliases = KNOWN_DIVERGENCES.filter((d) => d.alias);

  const knownDiffsHit = new Set();
  if (a.collapsed || b.collapsed) knownDiffsHit.add('KD-05');
  const divergences = [];
  let i = 0;
  let j = 0;
  while (i < officialTokens.length || j < oursTokens.length) {
    const a = officialTokens[i];
    const b = oursTokens[j];
    if (a !== undefined && b !== undefined && a === b) {
      i += 1; j += 1;
      continue;
    }
    const alias = aliases.find((d) => d.official === a && d.ours === b);
    if (alias) {
      knownDiffsHit.add(alias.id);
      i += 1; j += 1;
      continue;
    }
    if (a !== undefined && officialOnly.has(a)) {
      knownDiffsHit.add(officialOnly.get(a).id);
      i += 1;
      continue;
    }
    if (b !== undefined && oursOnly.has(b)) {
      knownDiffsHit.add(oursOnly.get(b).id);
      j += 1;
      continue;
    }
    divergences.push({ atOfficial: i, atOurs: j, official: a ?? '(end)', ours: b ?? '(end)' });
    // Advance both to keep producing signal instead of cascading one offset.
    if (a !== undefined) i += 1;
    if (b !== undefined) j += 1;
  }

  const verdict =
    divergences.length > 0
      ? 'DIVERGENT'
      : knownDiffsHit.size > 0
        ? 'MATCH_WITH_KNOWN_DIFFS'
        : 'MATCH';
  return { verdict, knownDiffs: [...knownDiffsHit].sort(), divergences };
}
