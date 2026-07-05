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
 * live (spike 2026-07-05, L1 M1, L2 M2) or documented in COMPAT.md. Kinds:
 *   official-only token(s) -> { official: token | [tokens] }
 *   ours-only token(s)     -> { ours: token | [tokens] }
 *   alias (same event, different wire shape) -> { official, ours, alias: true }
 *   documentation-only     -> { terminal: true } / { behavioral: true } -
 *     comparator-inert; consumed by runner-level recording (run-l2
 *     terminalShape) or per-arm scenario encodings, never by token matching.
 * An entry may carry `scenarios: [ids]` to SCOPE its consumption to specific
 * scenario ids (comparator context.scenario) - used where a global allowlist
 * would be able to hide a genuine drift elsewhere (e.g. a missing
 * tool_result). Unscoped entries apply everywhere.
 * The comparator consumes matching tokens per this table and REPORTS every
 * consumption - allowlisted means "known and documented", never "invisible".
 */
export const KNOWN_DIVERGENCES = [
  { id: 'KD-01', official: 'active_goal', note: 'official-only status variant (engine 2.1.x); outside the pinned 0.3.199 type surface, typed-not-emitted here' },
  { id: 'KD-02', official: 'rate_limit_event', note: 'official broadcasts rate-limit STATUS even on success; this SDK emits rate_limit_event only on an actual 429' },
  { id: 'KD-03', official: 'system/api_retry', ours: 'api_retry', alias: true, note: 'same retry event; official wire shape is system+subtype, ours is a top-level discriminator (official docs are internally inconsistent here - see COMPAT observability note)' },
  { id: 'KD-04', ours: 'user/echo', note: 'this SDK yields a prompt-echo user message for string prompts; the official arm does not (spike S1 observation)' },
  { id: 'KD-05', granularity: true, note: 'message granularity: the official arm splits one assistant turn into one SDKMessage per content block and yields one user message per tool_result; this SDK batches per turn (one assistant message, one user message carrying all tool_results). End state equal - alignment candidate for a future surface batch, since per-message UI renderers see chunkier updates on the official engine (first caught live by two-reads-one-turn, 2026-07-05)' },
  { id: 'KD-06', ours: 'permission_denied', note: 'this SDK yields a permission_denied observability message before the deny tool_result on every permission-gate deny (scoped disallowedTools rule, allowedTools default-mode fallthrough, canUseTool deny, PreToolUse hook deny); the official arm answers with the error tool_result only. Deny SEMANTICS agree on both arms: fs untouched, result.permission_denials populated, run continues to success (observed live L2 s3/s4/s8-deny/s9, 2026-07-05)' },
  { id: 'KD-07', official: ['user/tool_result', 'user/echo'], scenarios: ['s10-interrupt'], note: 'interrupt flush: after interrupt() the official engine still yields the in-flight tool_result and a trailing prompt-echo user message before result/error_during_execution; this SDK ends immediately after the error result. Wire agreement holds (1 POST, no turn 2). SCOPED to the interrupt scenario so a genuinely missing tool_result anywhere else still surfaces as DIVERGENT (observed live L2 s10, 2026-07-05)' },
  { id: 'KD-08', official: 'system/status', note: 'official-only status message (engine 2.1.x emits system/status early in a streaming run); typed-not-emitted here for the same reason as KD-01 - a headless engine has no source event for it (observed live L2 s11, 2026-07-05)' },
  { id: 'KD-09', official: 'stream_event', scenarios: ['s11-partial-messages'], note: 'stream_event/assistant interleaving under includePartialMessages: the official engine keeps yielding stream_events (message_delta/message_stop) AFTER the assistant message it belongs to; this SDK yields the assistant message once all of its stream_events are out. Event sets agree post-coalesce; SCOPED so an official-only stream_event outside a partial-messages scenario still surfaces (observed live L2 s11, 2026-07-05)' },
  { id: 'KD-10', terminal: true, note: 'terminal shape: the official SDK query() iterator THROWS "Claude Code returned an error result: ..." AFTER yielding the error-subtype result message; this SDK ends the stream cleanly after the result. Token streams align; run-l2 records the official throw as terminalShape under this id instead of a kdCandidate (observed live L2 s1/s12, 2026-07-05)' },
  { id: 'KD-11', behavioral: true, note: 'subagent delegation split: the delegation tool is named Task on the official engine vs Agent on this SDK (COMPAT: Agent a.k.a. Task), and official 2.1.201 delegation produced 4 POSTs (an extra child request) vs our deterministic parent+child+parent 3. Comparator-inert documentation entry; s13-agents-task arm-parametrizes the NAME only and demotes to a single-arm lock on official topology drift (observed live L2 s13, 2026-07-05)' },
  { id: 'KD-12', official: 'system/api_retry', ours: 'rate_limit_event', alias: true, scenarios: ['l4-429-retry-after-recover', 'l4-429-storm-two-vs-budget'], note: '429 retry-notification WIRE SHAPE: same per-retry event; the official arm reports each honored 429 retry as system/api_retry (plus its usual trailing KD-02 rate_limit_event status broadcast), while this SDK types the 429 retry notification itself rate_limit_event and reserves api_retry for non-429 retryables (loop.ts observability contract; on 5xx both arms take the api_retry shape and KD-03 already aliases it). SCOPED to the L4 429 scenarios so an unexpected rate_limit_event elsewhere still surfaces (observed stable across 2 L4 runs, 2026-07-05)' },
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

export function compareStreams(rawOfficialTokens, rawOursTokens, context = {}) {
  // KD-05 granularity normalization: compare at turn granularity by
  // coalescing consecutive identical tokens on both sides.
  const a = coalesce(rawOfficialTokens);
  const b = coalesce(rawOursTokens);
  const officialTokens = a.tokens;
  const oursTokens = b.tokens;

  // Scoped entries only apply when the caller identifies the scenario
  // (context.scenario); a scoped entry can never fire in an unrelated run.
  const inScope = (d) =>
    !d.scenarios || (context.scenario !== undefined && d.scenarios.includes(context.scenario));
  const applicable = KNOWN_DIVERGENCES.filter(inScope);
  const tokensOf = (v) => (Array.isArray(v) ? v : [v]);
  const officialOnly = new Map();
  const oursOnly = new Map();
  for (const d of applicable) {
    if (d.alias) continue;
    if (d.official) for (const t of tokensOf(d.official)) officialOnly.set(t, d);
    if (d.ours) for (const t of tokensOf(d.ours)) oursOnly.set(t, d);
  }
  const aliases = applicable.filter((d) => d.alias);

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
    if (a !== undefined && officialOnly.has(a) && b !== undefined && oursOnly.has(b)) {
      // Both sides allowlistable at once: one-token lookahead so a skip
      // never eats a token the other stream is about to match (seen live on
      // s11: official stream_event vs ours user/echo - greedy official-side
      // consumption would misalign the paired stream_events that follow).
      if (oursTokens[j + 1] === a) {
        knownDiffsHit.add(oursOnly.get(b).id);
        j += 1;
      } else {
        knownDiffsHit.add(officialOnly.get(a).id);
        i += 1;
      }
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
