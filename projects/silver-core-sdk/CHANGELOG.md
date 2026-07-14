# Changelog — silver-core-sdk

Renamed from **bpt-agent-sdk** to **silver-core-sdk** as of 0.41.0 (keeper
ruling 2026-07-10). Entries below 0.41.0 keep the historical name and tarball
labels (`bpt-agent-sdk-<version>.tgz`) as shipped — this ledger is not
rewritten retroactively.

Consumer-facing build ledger (BPT pins `npm pack` tarballs by this version:
`silver-core-sdk-<version>.tgz`). Discipline, in force since 0.6.2: **every
merge that changes shipped runtime code (`src/` or runtime dependencies)
bumps the version** — bug fixes bump patch, new capability bumps minor —
and adds one line here. A CI guard (`scripts/check-version-bump.mjs`) reds
any src-changing merge that forgets. 0.6.1 and 0.6.2 below are retroactive
labels for builds that shipped under a duplicated "0.6.0". The **0.1–0.5**
entries at the bottom are likewise retroactive — reconstructed from the commit
sequence (no per-merge ledger existed before the 0.6.2 discipline), so their
granularity stops at the commit-title level.

## 0.57.3 — 2026-07-14

Audit 2026-07-14 P0 batch — the three HIGH findings, each with regressions:

- **H-1 (transport, both twins)**: a non-2xx error body is now drained with
  the abort listeners still attached (caller interrupt / request timeout can
  cancel it) and capped by `ERROR_BODY_TIMEOUT_MS` (10s, falls back to the
  status line). Before, a gateway that sent error headers and then stalled
  the body hung the conversation forever, uninterruptibly (the default
  'node' http client has no body timeout).
- **H-2 (session-manager)**: transparent auto-resume now retires the
  abandoned query (`q.return()`) BEFORE re-driving, so its run() teardown —
  background-shell kill, sandbox tmpdir removal, subagent settle, SessionEnd
  hooks, session-store flush — actually executes; the flush lands before the
  resumed query re-reads persisted history. Before, each resume leaked all
  of that.
- **H-3 (subagents)**: child ToolContext now threads the checkpoint
  recorder (`getRecordFileChange`, resolved at spawn time), so subagent
  Write/Edit pre-images land in the same per-turn checkpoint index as the
  root loop's and `rewindConversation` actually restores child edits.
  Before, rewind reported success while child edits stayed in place.

## 0.57.2 — 2026-07-14

**Directory-full memory error now carries self-rescue guidance (keeper ruling
2026-07-14).** BPT reported that when a `/memories` directory hit the
`maxFilesPerDirectory` cap (default 64), the model would loop on `create` and
effectively stop recording — it had no idea the directory was full only for
*new* files, nor how to reorganize. Root cause was purely the terse error
string: `directoryFullError` said "already contains the maximum number of
memory files (N)" and nothing else. The message now appends actionable
guidance — the cap is per-directory and blocks only new-file creation
(str_replace / insert / delete / rename on existing files still work), and the
three ways to make room: consolidate related files, delete stale files, or
create under a new subdirectory (each subdirectory has its own limit). No
default, limit, or enforcement change; the reference prefix is preserved
verbatim so existing substring assertions hold. Test: `memory-m2.test.ts` (the
per-directory cap case now also asserts the guidance and the edit/delete/
re-create recovery path).

## 0.57.1 — 2026-07-14

**Unified upstream-error normalization: no more bare 500s穿透ing to the host
(BPT P1, keeper ruling 2026-07-14).** BPT saw a raw
`{ error: { message: "Internal server error", code: null, status: 500 } }`
object reach the host un-classified — it bypassed the retry / error chain, so
the user got an opaque 500 with no way to tell provider, retryability, or
request id. Root cause: the Anthropic arm's SSE error detector only recognized
the native `type: 'error'` frame, so a gateway that wrapped the failure as a
bare top-level `{ error: {...} }` / `{ message, status }` data frame (no
`event: error` name, no `type` discriminator) was neither caught as an error
nor a valid stream event — it穿透ed. New unified layer
(`src/error-normalize.ts`):

- **`NormalizedProviderError`** — one STABLE shape every upstream failure maps
  to: `name`, `message` (readable, never `[object Object]`), `status`, `code`,
  `provider`, `model`, `requestId`, `retryable`, `retryAfterMs`, `phase`,
  `rawType`. `normalizeProviderError()` maps an `APIStatusError`,
  `APIConnectionError`, a bare gateway error object, a plain `Error`, or an
  opaque value; `normalizeRetry()` builds one for a retry-in-progress.
- **Detection widened** — both transports now recognize the wrapped
  `{ error: {...} }` and bare `{ message, status }` shapes (`looksLikeErrorObject`
  cannot swallow a real stream event: those always carry a known `type`).
- **Richer extraction** — `APIStatusError` gained `providerErrorCode` +
  `retryAfterMs`; transports lift `code` / `status` / `request_id` from the body
  (accepting `request_id` / `requestId` / `x-request-id` / `X-Request-Id`
  spellings, header preferred), for the Anthropic Messages API, the
  OpenAI-compatible Chat Completions protocol, SSE in-stream error frames, and
  non-streaming HTTP paths alike.
- **Retry policy** (status-based, so it never string-matches "quota"/
  "allocation" to force a non-retry): 408/429 and every 5xx retryable; other
  4xx (400/401/403/404/…) not. `APIConnectionError` honors the existing
  replay-safe contract (a started stream is not blind-retried).
- **Host surfaces** — the `error_during_execution` result, the `api_retry`
  message (now also carrying `retryable` / `retry_remaining` / `retry_reason`),
  and the `rate_limit_event` all carry `providerError`. A 500 with no assistant
  content is surfaced as an error, never a silent empty success.
- **Redaction (硬约束)** — the normalized message is bounded (2 KB) and scrubs
  API keys / Bearer tokens / Authorization; the raw error object is never
  attached.

Additive-only (drop-in surface gains fields, never changes existing ones).
New tests: 24 normalizer unit + 11 transport/end-to-end integration; the two
mandated integration shapes (JSON `{error:{…,request_id:"test-500"}}` and
`text/plain` 500) both assert the host gets `status: 500` / readable message /
`retryable: true` / `requestId` / an explicit error event.

## 0.57.0 — 2026-07-14

**openai-chat default maxOutputTokens 8192 -> 128000 (BPT ruling 2026-07-14).**
The global 8192 default rode onto every OpenAI-compatible request as
`max_tokens: 8192`, starving agentic turns on large-output gateway models. The
default is now PROTOCOL-AWARE: 128000 on `openai-chat`, 8192 unchanged on
`anthropic` (that API 400s a max_tokens above the model's output ceiling —
e.g. claude-sonnet-4-5 caps at 64000 — and no per-model output table is
bundled, so a blanket 128000 would have killed default Claude sessions on
turn 1). `provider.maxOutputTokens` overrides either default, both directions.
Boundary behavior locked by tests (`tests/max-output-tokens-default.test.ts`):
128000 is sendable (incl. via `maxTokensParam` rename); a gateway whose model
caps lower rejects with a clear surfaced `APIStatusError` (HTTP 400,
`invalid_request_error`, the server's own message preserved verbatim, exactly
one POST — 400 is never retried). Cross-protocol subagent caveat documented in
OPENAI-PROTOCOL.md. Removed a dead duplicate `DEFAULT_MAX_OUTPUT_TOKENS` in
query.ts. BPT: passing an explicit 128000 keeps working and is now redundant
on openai-chat.

## 0.56.0 — 2026-07-13

**openai-chat image input: hardened translation + tool_result fan-out + PDF
`file` parts + MCP mimeType whitelist (keeper ruling 2026-07-13).** Four
related gaps closed in one capability bump. (1) Base64 image blocks already
translated to `image_url` data URLs but rode through UNVALIDATED — an
unsupported media_type, empty/line-wrapped base64, or a nested `data:` prefix
produced a malformed data URL gateways reject opaquely at their
image-processing stage (`image_moderation_server_error`). The translator now
enforces the Messages API four-type whitelist (JPEG/PNG/GIF/WebP), normalizes
media_type case and base64 whitespace, and throws a locatable
`ConfigurationError` (block path + media_type, never image bytes) for empty /
double-prefixed / non-base64 data BEFORE any network call. (2) Images / base64
PDFs inside a tool_result — a screenshot an MCP tool returned, an image file
Read produced — previously degraded to a text placeholder on openai-chat (the
`tool` role is text-only): the model never saw them. They now FAN OUT into the
user message following the tool messages, each labeled with its tool_call_id;
a malformed tool-OUTPUT attachment degrades to an explicit omission marker
(never bricks the turn) while user-turn blocks stay fail-fast. (3) Base64 PDF
`document` blocks translate to the official Chat Completions `file` content
part (data URL in `file_data`) instead of a placeholder; URL documents keep
the honest placeholder. (4) The MCP result mapper whitelists image mimeTypes
against the shared vocabulary (`src/internal/media.ts`) — an off-vocabulary
type (image/bmp, …) becomes an explicit text marker at the dispatch seam
instead of 400-ing the whole next request on the Anthropic protocol. One
byte-free debug summary line per request (protocol, image/file counts, MIME
types, base64 lengths, outcome). Anthropic-protocol wire shape untouched
(fixture-locked). Docs: OPENAI-PROTOCOL.md "Image input".

## 0.55.2 — 2026-07-13

**OpenAI arm: metadata-only stream + `[DONE]` no longer billed as a silent
success (BPT idealab "turn stop / hasAssistantMessage:false", 2026-07-13).**
0.55.1 fixed the Anthropic arm's degraded-200 shape and asserted the OpenAI arm
"already self-heals its analog" — true only for the ZERO-chunk case (the
empty-stream retry). The metadata-then-`[DONE]` case was still mis-routed: an
HTTP 200 that streamed only role-only / usage-only chunks (so `chunkCount > 0`)
and then closed with a bare `data: [DONE]`, carrying NO `delta.content`, NO
`reasoning_content`, NO `tool_calls` and NO `finish_reason`, satisfied the old
`chunkCount > 0 && (doneSeen || sawFinishReason())` success gate and was
finalized as an empty assistant with `stop_reason: null` — the exact idealab
"turn stop, hasAssistantMessage:false, lastAssistantMessage:''" log shape.
Fix: the translator now tracks VALID assistant content (`sawContent()`)
separately from the raw chunk count — flipped only by a non-empty text /
reasoning delta or a tool_call fragment bearing an id/name/arguments — and
`finish_reason` counts only when a non-empty string. The transport now
completes only on an explicit `finish_reason` (protocol semantics preserved,
incl. an empty-text `finish_reason:'stop'`) OR a `[DONE]` paired with valid
content; a `[DONE]` with neither throws a diagnosable `empty_message`
`APIConnectionError` (not `turnReplaySafe`/`midStreamTruncation`, so NOT
retried — a started stream is not replay-safe), which the engine surfaces as
`error_during_execution` (error_code `empty_message`). Preserved unchanged:
zero-chunk `empty_stream` retry, partial-content-without-terminator truncation
salvage, and the honest empty-text-with-`finish_reason` path (all existing
mutation-lock suites still pass without re-baselining). +12 test cases
(transport: role-only, usage-only, empty-first-delta, no-terminator truncation,
empty-text-finish_reason, tool_call-fragment; translator content tracking x3;
engine end-to-end error_code x3); docs/OPENAI-PROTOCOL.md updated.
## 0.55.1 — 2026-07-13

**Degraded empty stream no longer billed as a silent success (BPT "空 stopReason
轮次", 2026-07-13; keeper ruling C).** A degraded HTTP 200 that emitted
`message_start` but delivered NO content block AND no terminal
`message_delta.stop_reason` (a gateway hiccup / proxy buffering cutoff — the API
always sends stop_reason before message_stop) fell between the transport's
no-message_start empty-retry and its mid-stream-truncation salvage. The engine
then finalized an EMPTY assistant and billed a `subtype:'success'` result with
`stop_reason: null` — the exact "round ended, no assistant message, empty stop"
shape BPT reported (five in a row = the gateway hiccuping five times, each
silently accepted). Fix: the Anthropic arm now detects `message_start` seen +
no content + no stop_reason at BOTH stream-exit points (message_stop present and
natural close) and throws a diagnosable `empty_message` `APIConnectionError`. It
is NOT flagged `turnReplaySafe`/`midStreamTruncation` and is NOT retried inside
the transport — honoring the deliberate "a started stream is not replay-safe /
no phantom empty-retry" contract — so the engine surfaces it as
`error_during_execution` (error_code `empty_message`) instead of a silent empty
success. The OpenAI arm already self-heals its analog (zero-chunk retry +
synthesized stop_reason), so it is unchanged. +5 tests (transport S1/S2, engine
end-to-end, re-baselined mutation lock); the honest empty end_turn
(stop_reason present) and partial-content paths are untouched.

## 0.55.0 — 2026-07-13

**Cross-protocol routing extended to utility + compaction calls (closes the
0.54.0 gap's siblings).** The two remaining engine-internal call sites that
target a NON-session model had the same wrong-route failure mode as
subagents: utility generator calls (hook `condition` evaluation on the
default Haiku-tier model) built their transport from the single session
provider, and the compaction summarizer (`compaction.model`) streamed through
the session transport unconditionally. Both now route through the SAME
`Options.resolveSubagentTransport` policy, distinguished by a new required
`purpose` field on the resolver input (`'subagent' | 'utility' |
'compaction'`). Plumbing: the query layer composes one `transportForModel`
closure (owned-resolution disposal at query teardown, alongside the subagent
runtime's own set); `EngineDeps.transportForModel` carries it to the
compaction summarizer in the root loop AND every child loop;
`UtilityCallOptions.resolveTransport` (public, host-usable) carries it into
`runUtilityCall` with precedence explicit `transport` >
`resolveTransport(model)` > provider-built default. Resolver absent -> every
call keeps its previous transport path byte-for-byte. The standard resolver
ignores `purpose` (routes purely by model), so 0.54.0 hosts only rebuild.
+4 tests (utility precedence x2, compaction routed/same-model x2).

## 0.54.2 — 2026-07-13

Official chase 0.3.205 → 0.3.207 (empirical diff report
`Public-Info-Pool/Resource/repo-engineering/silver-core-sdk-vs-official-diff-20260713.md`;
keeper ruling 「追」). A type-surface diff of the official tarballs found the
pinned 0.3.205 baseline drifted 2 patch versions behind npm latest `0.3.207`
(published after the 0.3.205 pin) with **zero exported-symbol change** (232 =
232) — the drift is entirely field-level/additive:

- **`TerminalReason` union +6 members** — `api_error`,
  `malformed_tool_use_exhausted`, `budget_exhausted`,
  `structured_output_retry_exhausted`, `tool_deferred_unavailable`,
  `turn_setup_failed`. Added to the type for drop-in exhaustiveness;
  typed-not-populated (this field has no engine emission site here). Exhaustive
  lock in `tests/b2c-alignment.test.ts` (12 → 18).
- **N/A-by-design additive fields registered in the COMPAT ledger** (no code):
  `mcp_call` staging (`input_files`/`output_files`/`expires_at`/`timeout_ms`,
  Cowork file-lane) rides the control_request protocol this headless engine
  does not implement; the PostToolUse-family structured-tool-output field and
  the `SDKModelRefusalNoFallbackMessage` per-category-routing doc refinement
  are additive-optional. docs/COMPAT.md pin bumped to 0.3.207.

## 0.54.1 — 2026-07-13

**MCP stdio shutdown reaps the server process TREE (BPT stability, 2026-07-13).**
`StdioMcpConnection` spawned the server WITHOUT `detached:true` and terminated
it with a bare `child.kill('SIGTERM'/'SIGKILL')`, which signals only the direct
child PID. Real MCP servers are launched through a wrapper (`npx`/`cmd /c`/
`uvx`/`python -m`/`node launcher`) whose actual, long-lived server is a
GRANDCHILD — so on abort/close the wrapper died but the server was orphaned,
and its inherited stdio handles could keep the host from exiting within the
teardown grace window (force-kill fallback). On Windows the whole tree survived
(`child.kill()` = single-PID TerminateProcess). Fix: spawn `detached:true` (a
POSIX process-group leader) and terminate via the shared `planProcessKill`
planner — POSIX `process.kill(-pid)` group kill / Windows `taskkill /PID <pid>
/T /F` — the same tree-safe posture `bash.ts` / `shells.ts` already use. The
planner moved to `internal/process-kill.ts` (single source of truth; re-exported
from `tools/kill-plan.ts` for existing consumers) so `mcp/` can reuse it within
the import-discipline rules. +1 regression test (grandchild-orphan, POSIX-CI).

## 0.54.0 — 2026-07-13

**Cross-protocol subagent transport routing (BPT P0).** An isolated subagent
whose resolved model is served on a different wire protocol than the parent
(e.g. an `openai-chat` parent whose Haiku-tier children map to a model only
on the gateway's Anthropic route) previously rode the parent transport
unconditionally and 400'd "model not found" on the wrong endpoint. New
`Options.resolveSubagentTransport` callback (host-owned model→protocol
policy) is consulted once per isolated spawn after the child model resolves:
a resolution routes the child through its own transport; `undefined` (or
omitting the option) shares the parent transport — byte-for-byte the previous
behavior, so single-protocol consumers are unchanged. Forks never consult it
(a fork's cached prefix requires the parent model + transport).
`createSubagentTransportResolver()` ships the standard implementation:
per-protocol transport memoization through the same
`createProviderTransport()` switch point the root query uses, with
protocol-agnostic provider knobs (retries / timeouts / fetch / httpClient /
preconnect / pricing) carried from the parent and protocol-SPECIFIC fields
(baseUrl / credentials / apiVersion / openai.\*) deliberately NOT copied —
the two protocols append different URL suffixes and resolve different env
chains, so a blind copy mis-routes. Thinking is re-derived for
transport-switched children: resolution values win; otherwise a non-Claude
child model drops the inherited config (safe degradation — a Claude-shaped
`thinking` param on a non-Claude model is gateway-rejected more often than
honored); shared-transport children inherit unchanged. Resolutions with
`owned: true` are disposed once at query teardown (after every child settled
— SendMessage can revive a finished child until then); `Transport.dispose?()`
added as an optional contract member (the built-ins self-clean and implement
none). The spawn debug log now records `{parentModel, childModel,
parentProtocol, childProtocol, transportMode}` per child. +18 tests (routing
matrix, fork inheritance, concurrency model-integrity, owned disposal,
thinking degradation, resolver provider derivation).

## 0.53.8 — 2026-07-13

**Foreground Agent batch serialization fix (child-agent serialization report,
2026-07-13).** Independent foreground `Agent` calls issued in one assistant
batch ran strictly one-after-another (three 5s timer children showed zero
overlap, ~12s start-to-start gaps), while `run_in_background: true` overlapped
fine — the engine's concurrent tool grouping admitted only read-only tools,
and Agent is `readOnly: false`, so every foreground spawn fell into the
sequential branch. Root cause was the loop's grouping predicate, not the
transport (the request semaphore defaults to unlimited) and not the subagent
runtime (no global lock). Fix: a new `BuiltinTool.parallelSafe` flag — set on
Agent, whose children each run their own isolated loop — widens ONLY the
engine's parallel grouping (`isParallelSafeTool` = readOnly OR parallelSafe);
permission semantics (plan-mode allow, default-mode auto-approve) still key
off `readOnly` untouched. Batched foreground agents now start together under
one `Promise.all`, results stay in tool_use order, and mutating tools keep
the strict sequential contract. +5 tests (engine grouping 3: Agent×2 overlap /
mixed Read+Agent group / non-parallelSafe still serial; runtime concurrent
spawn overlap 1; Agent tool metadata 1). Docs: SUBAGENTS.md + CONCURRENCY.md
now state the foreground-batch concurrency contract.

## 0.53.7 — 2026-07-13

**Second multi-subsystem audit batch: 5 verified fixes across subagents, MCP
tools, and sessions (BPT stability, 2026-07-13).** A three-cluster audit
(subagents/task runtime, sessions/accumulator, workflow/misc tools) surfaced
five more concrete defects, each with a regression test. Ranked:

- **Background SendMessage continuations had no stall watchdog (subagents).**
  The initial background launch wraps the child in a `StallWatchdog` that aborts
  a silent stream; `runContinuation` (the SendMessage follow-up path) constructed
  none, so a continuation whose stream went silent never aborted — `turn` never
  settled, the background delivery promise never pushed its `<task-notification>`,
  and a coordinator waiting on the reply hung until whole-query teardown. Fix:
  wire the same watchdog into the continuation, AND return a stalled continuation
  as an error RESULT (not a thrown abort) so the delivery path surfaces a FAILED
  note to the coordinator instead of swallowing it in its `.catch`.
- **Foreground child result discarded if the SubagentStop hook aborted
  (subagents).** The foreground path awaited `fireSubagentStop(…, params.signal)`
  bare; an outer abort landing during that await made the hook throw and rejected
  spawn(), discarding the child's already-computed answer. The background path
  already fired the stop hook with a fresh signal and a `.catch`; the foreground
  path now mirrors it (the child has finished — the hook is a notification, not a
  gate on returning the result).
- **`readCappedBody` off-by-one flagged an exactly-cap body as truncated
  (webfetch).** The streaming path used `value.byteLength >= remaining`, so a
  body exactly `MAX_BODY_BYTES` long (or a chunk landing right on the boundary)
  was marked overflow though nothing was dropped — appending a misleading
  `[truncated]`. The non-stream fallback correctly used `> cap`. Fix: `>` in the
  streaming path too; an exactly-cap chunk is taken whole and the next read()'s
  `done` distinguishes "exactly cap" from "more follows".
- **`auditToolClaims` reused a stateful RegExp across texts (sessions).** A
  consumer-supplied detector whose `claimPattern` carries the `g`/`y` flag is
  stateful; exec() advanced `lastIndex`, so matching resumed mid-string on the
  next assistant text and a genuinely-unbacked claim was silently missed. Fix:
  reset `lastIndex` before each exec.
- **`list()`/`getSessionInfo` dropped a meta_update gitBranch (sessions).**
  `load()` honored an updated `gitBranch` on a `meta_update` record; the
  `loadInfo()` scan behind `list()`/`listSessions()` read only `customTitle`/`tag`,
  so the two read paths reported different branches for the same session. Fix:
  read `gitBranch` in `loadInfo` too.

+4 regression tests (the foreground stop-hook fix mirrors the already-tested
background path). Full suite 2175 passing + 2 skipped; typecheck + build clean.

## 0.53.6 — 2026-07-13

**Multi-subsystem audit batch: 5 verified fixes across MCP, hooks, permissions,
grep, and the engine (BPT stability, 2026-07-13).** A four-cluster audit
(permissions/hooks, file/shell tools, engine/transport, MCP/sessions/subagents)
surfaced (and this release fixes) five concrete defects, each with a regression
test. Ranked:

- **ReDoS guard was bypassable by a nested group (hooks matcher).** The
  catastrophic-backtracking detector used `[^()]` around the inner quantifier,
  so it only recognized a nested quantifier when the quantified group held no
  further parens — `((a+))+$` and `(a(b+))+$` evaded it, reached
  `new RegExp().test()`, and froze the event loop synchronously (confirmed: a
  33-char value ran past a 5s timeout). Fix: replaced the flat regex with a
  paren-stack star-height walk that flags any repetition-bearing group that is
  itself quantified, at any nesting depth; safe linear patterns
  (`(foo|bar)+`, `Edit.*`, `^mcp__`) keep working.
- **auto-mode classifier `deny` was bypassed by an ask route (permissions
  gate).** The auto classifier lived inside the `!routeToPrompt` mode switch, so
  any active ask route (hook `ask`, session ask rule, requiresUserInteraction,
  sandboxEscape) skipped it and routed a classifier-DENY call to `canUseTool` —
  which could ALLOW it, inverting the module's own documented deny > ask
  invariant. Fix: the classifier `deny` verdict is now evaluated as its own
  guard, regardless of the ask route (a hook `allow` still outranks it); the
  `allow`/`prompt` verdicts stay behind the ask route so it still prompts.
  Bites consumers who inject a custom classifier.
- **stdio elicitation reply could leak an unhandled rejection (MCP).** The
  server-initiated `elicitation/create` reply chain had only two `.then/.catch`
  links; when the connection was closing, the fallback decline `write()` threw
  again with no terminal catch → unhandled rejection → process crash under a
  strict policy. The HTTP arm already had the terminal `.catch` (finding 15);
  it was missed on the stdio arm. Fix: mirror the terminal `.catch`.
- **`grep` multiline + `-o` reported "No matches found" for a matching file.**
  In only-matching mode the substring extraction ran the regex per-line, so a
  `multiline` pattern whose match spans a newline extracted nothing and
  fell through to the empty-result guard — a false negative, while
  `files_with_matches`/`count` correctly reported the match. Fix: multiline `-o`
  scans the reconstructed whole content and emits each match with its starting
  line number (ripgrep -oU semantics).
- **`grep -o` emitted spurious empty output lines for a zero-length pattern.**
  A pattern that can match the empty string (e.g. `x*`) pushed a blank entry at
  every offset. Fix: skip zero-length matches (ripgrep omits them).
- **thinking `budget_tokens` could be emitted below the API's 1024 floor
  (engine).** For pre-adaptive models the code guarded only the upper bound
  (`< max_tokens`), so a positive-but-sub-1024 budget (e.g.
  `maxThinkingTokens: 500`) passed straight through and 400'd the turn — then
  every turn. Fix: clamp up to the 1024 floor; when `max_tokens` cannot fit the
  floor, disable thinking rather than emit a guaranteed-400 request.

+11 regression tests. Full suite 2171 passing + 2 skipped; typecheck + build clean.
## 0.53.5 — 2026-07-13

**Conversation-stability follow-up: the three deferred light items from 0.53.4
(BPT stability, 2026-07-13).** Keeper asked the remaining trio be closed out.

- **T2 — retry-budget amplification (both transports).** The empty-stream
  re-issue counter was INDEPENDENT of `requestWithRetries`' own attempt counter,
  each bounded by `maxRetries` — so a gateway alternating errors and empty-200s
  under fan-out throttle could burn ~`maxRetries²` POSTs on an already-struggling
  endpoint. Fix: one `{ used }` budget threaded through BOTH the request-phase
  retries and the empty-stream re-issues, capping the total extra POSTs at
  `maxRetries` (so `maxRetries+1` attempts overall). Anthropic + OpenAI arms.
- **killAgent status race (subagent runtime).** `stopTask`/`killAgent` racing a
  child's completion could emit a `stopped` notification contradicting a
  `completed` one and flip `record.status` between the two. Fix: killAgent no
  longer clobbers a record that already reached a terminal status (the
  completed→kill direction), and the completion body only reports completion
  while the record is still `running` (the kill→completed direction) — mirroring
  the catch arm's existing guard. Both directions now resolve to one consistent
  terminal signal.
- **T3 — pre-message_start ping "leak" — assessed WAI, left unchanged.** A ping
  keep-alive is yielded to the consumer as it arrives BY DESIGN: live ping
  delivery is load-bearing (the idle-watchdog / hard-cap / progress paths and
  their tests depend on the consumer seeing keep-alives in real time). The
  theoretical leak of a discarded empty-retry attempt's pings is harmless (pings
  carry no content; the accumulator ignores them), so buffering them — which
  would degrade live delivery — is not worth it. Documented in-code.

+2 regression tests (`tests/conversation-stability-followups.test.ts`, T2 bound).
Full suite 2160 passing + 2 skipped; typecheck + build clean.

## 0.53.4 — 2026-07-13

**Conversation-stability audit batch: 13 verified fixes across compaction,
sessions, transport, accumulator, MCP (BPT stability, 2026-07-13).** A
four-subsystem audit surfaced (and this release fixes) a set of defects that
could crash, corrupt, or silently degrade conversations — several specific to
running MULTIPLE conversations over shared state. Ranked:

- **H1 — compaction was a no-op for pure tool-loops (default-path, highest
  blast radius).** `partitionForCompaction` only accepted GENUINE user turns as
  cut points, so a single string prompt driving an autonomous
  assistant↔tool_result loop (the SDK's headline shape) had zero valid cut
  points after index 0 → compaction never folded → context grew unbounded until
  a `prompt too long` 400 with no retry. Fix: fall back to ASSISTANT-turn
  boundaries (pairing-safe) with a user-TERMINATED fold, so such loops compact
  while role alternation stays valid. Compaction is on by default, so this hit
  the most common long-running run.
- **H2 — concurrent cross-host resume double-materialized the transcript.**
  `MirroringSessionStore.load` appended the external transcript per racing
  loader and `JsonlSessionStore.load` did no uuid dedup, so two workers resuming
  one session replayed the whole conversation TWICE (compounding every turn).
  Fix: read-time uuid dedup (cross-process backstop) + in-process load
  coalescing + a post-fetch re-check.
- **M1 — an unmodeled content-block type crashed the turn.** The accumulator's
  `content_block_start` handled only text/thinking/redacted_thinking/tool_use;
  a `server_tool_use` (or any future block) left its index unregistered and the
  next `content_block_delta` threw. Fix: register unknown blocks opaquely,
  ignore their deltas, round-trip them into the message.
- **M2 — the Anthropic arm silently accepted a truncated turn.** A clean EOF
  after partial content with no `message_stop`/terminal `stop_reason` was
  finalized as a complete, billed success (asymmetric with the OpenAI arm). Fix:
  surface `midStreamTruncation` so E3 salvage runs and the fault shows in the
  result's `errors` — but only when partial CONTENT was delivered and no
  stop_reason arrived (a start-only or stop_reason-carrying stream still
  completes normally).
- **M3 — concurrent same-session file checkpoints collided on the blob path.**
  `seq` was recovered per-instance, so two stores bound to one session wrote the
  same `{seq}.blob`, and a later rewind restored the WRONG file's bytes. Fix:
  qualify blob names with a per-instance token (collision-free; the index stores
  the full name so rewind reads the exact pre-image).
- **M4 — MCP `connectEntry` double-spawned under a connect/reconnect race.**
  `entry.connection` was published only after the up-to-60s handshake, so a
  concurrent connect/reconnect passed the guard and spawned a second child
  process (the loser leaked). Fix: an in-flight connect latch coalesces callers.
- **M5 — a retained suffix could exceed the budget and re-fold forever.** When
  even the minimal viable suffix overflowed, compaction re-folded a tiny prefix
  and still 400'd. Fix: pre-tier-shed the retained suffix's oversized string
  tool_results (pairing-preserving) so the request fits the window.
- **L1** — the subagent `ChildMcpFilter` forwarded lifecycle MUTATORS
  (setEnabled/setServers/closeAll) to the shared registry, so one subagent could
  disrupt its siblings; these are now inert on a child view (reconnect, a shared
  recovery, still passes through).
- **L2** — the free-socket TTL destroy raced socket reuse; the dying socket is
  now evicted from the agent's `freeSockets` BEFORE `destroy()`.
- **L3** — the CJK token estimator omitted CJK Symbols & Punctuation, Fullwidth
  Forms, and Enclosed CJK (the primary workload's punctuation), biasing the
  compaction trigger late; those ranges now count ~1 token/codepoint.
- **L4** — file rewind could only target turns that changed a file; `beginTurn`
  now writes a (seq-free) turn-position marker so a chat-only turn is a valid
  rewind target.
- **L5** — a thinking block with an EMPTY signature (malformed/gateway-rewritten
  upstream) 400'd every later Anthropic request on resend; such blocks are now
  stripped from the wire body (no-op / byte-identical on well-formed requests).
- **L6** — `JsonlSessionStore.loadInfo` leaked a file descriptor on the
  sidechain early-return and error paths; the read stream is now destroyed in a
  `finally` (mirrors `isSidechainFile`).

+12 regression tests (`tests/conversation-stability-fixes.test.ts`); two
existing mutation-kill tests updated for the new checkpoint marker + Anthropic
truncation surface. Full suite 2157 passing + 3 skipped. Deferred (noted, not
fixed): the nested empty-stream retry budget (bounded ~maxRetries², not
infinite), cross-attempt ping replay (benign), and a narrow killAgent status
race (reporting only).

## 0.53.3 — 2026-07-13

**Free-socket idle TTL: keep-alive pool no longer accumulates zombie
sockets (BPT stability, 2026-07-13).** Symptom: turns hang with NO output
— worst with several concurrent conversations — on gateway deployments
(azure/* and friends). Root cause: the default node HTTP client (0.45.0)
held pooled sockets "until the SERVER closes it", but middleboxes
(Azure LB, ALB, nginx, corporate proxies) drop idle flows SILENTLY — no
FIN/RST — so the pool filled with sockets that look alive to node.
A request written onto one stalls for the full request-phase timeout
(default 600s), and each retry can pick the NEXT zombie; concurrency
multiplies exposure (more sockets idling between turns). The pre-0.45
undici client recycled pooled connections after ~4s idle, which had
masked the entire class. Fix: a free socket is destroyed after 55s of
pool idleness (`FREE_SOCKET_TTL_MS`, under the common 60s middlebox idle
floor; timer unref'd, cleared + re-armed on reuse) — an expired socket
costs one fresh TCP+TLS handshake (~100-300ms, TLS session resumption
intact), never a 600s stall. Agents also pin `scheduling: 'lifo'`
(node's default, now explicit: most-recently-used socket first minimizes
zombie-pick odds inside the TTL window). `createNodeFetch()` accepts
`{ freeSocketTtlMs }` for tests/tuning. Consumer escape hatches
unchanged (`provider.httpClient: 'fetch'` / `BPT_HTTP_CLIENT=fetch`).
+2 tests (TTL destroy + reuse re-arm).

## 0.53.2 — 2026-07-13

**Tool schema boundary validation (BPT P0, 2026-07-13).** Symptom: on
`azure/*` (OpenAI Chat Completions-compatible) gateways, whole
conversations died at request time with
`tools.N.custom.input_schema: Field required` — one tools[] entry with a
missing/invalid `input_schema` (a lax MCP server, or a misconfigured
`serverTools: [{type:'custom',...}]` entry) fails the ENTIRE model call
before generation. Root cause: the SDK assembled and encoded tool
definitions without validating schemas at either boundary. Fix, three
layers: (1) agent loop (`src/engine/loop.ts`) — builtin/MCP
`inputSchema` values that are not plain objects (missing, null, array,
primitive) are normalized to the safe empty-object schema
`{type:'object',properties:{}}` with a tool-name-bearing debug line;
(2) server-declared tools — `serverTools` entries whose type is
`'custom'` (or empty) are skipped with a diagnostic instead of being
advertised schema-less; a skipped entry no longer suppresses the
same-named builtin; Anthropic-typed entries (e.g. `memory_20250818`)
pass through verbatim, unchanged; (3) OpenAI wire encoder
(`src/transport/openai.ts`) — last-line filter keeps only tools whose
`input_schema` is a non-array object, so no schema-less entry can reach
a Chat Completions body; valid tools translate byte-identically as
before. +10 tests (loop normalization x6, encoder filter x4).

## 0.53.1 — 2026-07-13

**Corpus-sync re-sync to upstream ccVersion 2.1.205.** The weekly
claude-code-system-prompts refresh advanced the archived upstream prompts
(2.1.129 → 2.1.205) and drifted two faithfully-reproduced surfaces:
- **Background-agent state classifier** (`src/generators/prompts.ts`): eight
  example/schema lines were reworded upstream. Re-synced verbatim — six
  `detail` example strings (`dedicated column beats a composite index…`,
  `localhost:4000 restarted on local CCR`, `venn.png + scripts/venn.R`,
  `~16K/min notif drop confirmed`, `option B: reuses the table…`, `added at
  the logging call site`), the OUTPUT schema (`<one line, ≤64 chars>`), and
  the `detail` guidance clause (`…phone lock screen and as the one-line status
  column in a session list…`). Note: the `generators.test.ts` guard is a
  first-60-char substring check, so only two of these tripped it; all eight
  were still drift and are now fixed.
- **Bash sandbox note** (`src/tools/descriptions.ts`): upstream deleted the
  standalone `-user-permission-prompt` archive fragment. The SDK keeps the
  sentence "This will prompt the user for permission" as its own framing (the
  escape hatch does gate on a prompt here) but reclassified it `faithful:
  false` / `slug: ''` — never claim verbatim provenance for text upstream
  dropped. Assembled sandbox-note output is byte-unchanged.

No behavior change beyond the reproduced prompt text. Full vitest green.

## 0.53.0 — 2026-07-13

**Persist message uuids at write time (keeper ruling 2026-07-13).** The
property-fuzz campaign surfaced that user/assistant transcript records
carried no identity: `getSessionMessages` minted RANDOM uuids on every
read, so two reads of the same file disagreed and anything keyed on
message uuid (fork reconciliation, external consumers) silently
mismatched. Now every user/assistant record is written WITH a uuid, and
the streamed SDKMessage and the persisted record share ONE identity
(the yield-time uuid is threaded into the persist call). Fork copies
mint fresh identities (fork semantics). Backward tolerant: legacy
records without a uuid still read fine - the read path keeps its
mint-on-miss fallback, so old transcripts stay non-idempotent (only
newly written turns gain stable identity). Session JSONL stays
append-only; no schema version change. +5 tests.

## 0.52.1 — 2026-07-13

**Dev-only: overnight quality-campaign harness (shipped runtime unchanged).**
No `src/` behavior change beyond the version constant; this bump exists
because the version guard rightly counts dependency-manifest changes as
shipped-content changes. Added devDependencies: `@stryker-mutator/core` +
`@stryker-mutator/vitest-runner` (mutation testing, `stryker.conf.json`,
in-place mode so corpus-sync tests keep their repo-root archive paths) and
`fast-check` (property tests). New test assets: property suites for the SSE
parser (byte-level chunking/noise/truncation invariance), the permission
gate partial order (deny-dominance metamorphic + ask-routing + totality),
and session JSONL corruption robustness; 39 mutation-kill tests for the
permissions module (Stryker score 79.97% -> 92.87%, no-coverage 36 -> 0);
keyless emulator soak probes (`tests/integration/soak-emulator.mjs` +
`soak-report.mjs`) for long-run leak curves. +48 tests (full suite 1968
passed + 2 skipped).

## 0.52.0 — 2026-07-12

**`options.resilience.salvageMode` (E3 continue-after-truncation) + exact
byte sizes in prompt composition.** Two keeper rulings from the loop-1
retrospective. (1) `resilience: { salvageMode: 'continue' }` (default
`'accept'`, drop-in): a mid-stream truncation is re-driven through the
bounded turn replay to a COMPLETE answer instead of accepting the partial
blocks — a fresh turn, so no duplicated prefix; a persistently truncating
turn still degrades to the error path once replays exhaust. `'accept'`
keeps the official 2.1.201 salvage semantics byte-for-byte. The dc-03 eval
harness turns it on. (2) `promptComposition.bytes` (`system` / `toolDefs` /
`messages` / `total`): EXACT UTF-8 byte sizes of the assembled request,
complementary to the existing token estimates — what a host sizing against
a byte envelope (the tok-06 measurement anchor) or a byte-precise context
panel needs. Computed from the wire content; no new estimator. +5 tests.

## 0.51.2 — 2026-07-12

**Fix: run-log appends are serialized (ledger order = arrival order) +
`RunLogSink.flush()`.** Two fire-and-forget `appendFile` calls could land
out of arrival order — surfaced as a CI flake in the sink's own ordering
test, and a consumer reading `runlog-*.jsonl` as a timeline would see the
same inversion. Appends now ride one promise chain (each link swallows its
own failure, so a bad append never wedges the chain; still fire-and-forget
for the run). `flush()` resolves once everything observed so far is
appended — tests and shutdown paths await durability instead of sleeping.

## 0.51.1 — 2026-07-12

**Fix: replay-backoff timer no longer unref'd — headless consumers survive
disconnect recovery.** The engine's turn-replay backoff (loop.ts) ran on an
unref'd timer; it fires exactly when the dead connection was often the
process's last live handle, so a plain-script (top-level-await) consumer's
event loop drained mid-recovery and node exited with code 13. Found by the
first LIVE eval round with the Phase 2 fault harness (run 29178257816,
zero output); invisible under vitest, whose runner handles keep the loop
alive. The timer is now deliberately ref'd — an in-flight retry IS active
work; unref() stays for idle watchdogs and pooled sockets only. Regression
guard: `tests/replay-backoff-process-exit.test.ts` spawns a real child node
process (separate emulator process, dc-02-parity client-side stream cut)
and asserts exit 0 + turnReplays >= 1 (negative control re-adding unref
reproduces exit 13). Eval-side (non-runtime): the harness stream cutter
errors before a fire-and-forget cancel (an awaited cross-process cancel can
hang a pull), and mem-06's mount spec used `access` where the SDK contract
is `mode` — the question had ERRORed in every LIVE round; scenario/rubric
byte-identical, manifest re-signed. +1 test.

## 0.51.0 — 2026-07-12

**Self-improvement loop: REQ-1.2 trend deltas + Phase 2 eval harness +
REQ-2.2 regression gate.** `compareReports(dateA, dateB, {logDir})`
re-aggregates the run-signal ledger per UTC day and returns key-metric
`b - a` deltas (records/sessions, transport faults total + per cause,
unrecovered, failures, tokens, cache-hit pp, cost, tool calls/failure-rate
pp) with an agent-readable Markdown table; a data-less day reads as explicit
nulls / 无数据, never zeros. `aggregateDay` exported alongside.
`generateRuntimeReport` now prunes `runtime-report-*.md` older than
`retentionDays` (default 30, `0` disables); the raw ledger is only pruned on
explicit `ledgerRetentionDays` opt-in. Eval side (scripts, outside the
shipped runtime): `scripts/eval-harnesses.mjs` registers Phase 2 runners for
all 8 `driver:"manual"` questions — request-phase/mid-stream/permanent fault
injection at the provider.fetch seam (byte-precise SSE cuts), hard-kill +
session-resume (dc-04), compaction pressure with R7 flush evidence
(mem-03/tok-04) — question files stay byte-identical (governance boundary);
run-evals.mjs gains the registry dispatch plus a `--judge-batches` lane
(Message Batches API, the 50% nightly judge rate; same pinned params as
inline). `scripts/check-eval-regression.mjs` (REQ-2.2): dimension-mean drop
> 0.5 vs the committed `evals-baseline.json` emits `::warning::` only —
no baseline → explicit SKIP; `--write-baseline` seeds from a LIVE report;
wired into the run-evals-live job (run_evals input is now a choice:
false/inline/batches — GitHub's 10-input dispatch cap). +17 tests.

## 0.50.0 — 2026-07-12

**Self-improvement loop 1 signal side (SCS-REQ-002 REQ-1.1).**
`options.runLog` mirrors every consumer-facing result message as one
facts-only JSONL line (`runlog-{date}.jsonl`: subtype, counters, usage,
cache ratio, cost, transportHealth ledger, per-tool calls/errors, model
ids — no conversation content; incognito records keep transport/token
stats but no identity/tag/error per spec §6.4; fire-and-forget appends
never break the run; observed at the Query-wrapper choke point so every
result path is covered). `generateRuntimeReport()` folds a rolling
window (default 24h) of ledger lines into `runtime-report-{date}.md`
with the four spec sections (传输健康 + 未恢复清单 / token 消耗按场景 /
工具调用×失败率 / 失败会话仅事实); absent signals render explicit 无数据
markers, lists are capped with the cap stated, a missing log dir degrades
instead of throwing. New `docs/REPORTING.md`; +8 tests. REQ-1.2
compareReports stays pending (P1).

## 0.49.0 — 2026-07-11

**Self-improvement loop Phase 0 + Phase 1 landing (SCS-REQ-002).** Phase 0
(REQ-3.2): `options.memory.pitfalls` opt-in injects the sdk-original
pitfall-recording protocol — non-obvious failures go to `/memories/pitfalls/`
(one kebab-case file per pitfall: symptom / root cause / fix / avoidance),
technical facts only (stripping rule: nothing evaluative about people, no
PII), applies in both assembly modes, forced off on incognito sessions
(`MEMORY_PITFALLS_FRAGMENT`, `MemoryRuntime.pitfalls`). Phase 1 (REQ-2.1,
non-shipped tooling): `evals/` maintainer-curated behavior set (20 questions
r0 draft, 3 dimensions, hybrid sourcing per keeper ruling 2026-07-11) with
tamper-evidence manifest (`scripts/update-evals-manifest.mjs` +
`tests/evals-governance.test.ts`), pinned judge contract
(`evals/judge-prompt.md`, judge model `claude-sonnet-5`), and the two-layer
runner `scripts/run-evals.mjs` (baseline = full vitest pass/fail; behavior =
per-question harness + LLM grading; STUB mode without a key; PENDING_HARNESS
questions named explicitly, never silently skipped). +11 tests.

## 0.48.10 — 2026-07-11

**World-class review pass (cont.), shell resolution**: a non-existent ABSOLUTE
`CLAUDE_CODE_GIT_BASH_PATH` override was handed to spawn unconditionally. The
background shell path cannot fall back on its own (spawn's ENOENT is async and
fires after `spawnBackground` has already returned a shell id — reported
"launched" yet never running), so a misconfigured override there silently broke
`run_in_background` / Monitor. `resolvePosixShells` now drops an absolute
override that does not exist, so both the foreground and background paths fall
through to the platform defaults (bash/sh, or the Git Bash probes). A bare-name
override is kept (PATH-resolved by spawn). +1 regression test.

## 0.48.9 — 2026-07-11

**World-class review pass (cont.), ping-only stream = empty non-start**: the
Anthropic transport's empty-stream retry keyed on `eventCount === 0`, but a
`ping` keep-alive counts as an event — so a stream of only pings that then
closed (no `message_start`) looked non-empty, skipped the retry, and let the
engine's accumulator throw a raw `finalize before message_start`. The empty
check now keys on whether `message_start` was actually seen, so a ping-only
non-start is retried like any other empty stream (eventCount still counts pings
for the "after N event(s)" diagnostics; the twinned `mapStreamError` is
untouched). +1 regression test.

## 0.48.8 — 2026-07-11

**World-class review pass (cont.), shared-MCP cross-session isolation**: a
SessionManager-managed query's `toggleMcpServer` / `setEnabled` passed straight
through to the SHARED registry, so one conversation disabling a server blanked
that tool for every sibling conversation. The shared layer cannot offer
per-session enable/disable views, so it is now refused loudly (like
`setMcpServers`). `reconnect` still passes through — a failed server is failed
for all borrowers and reconnecting is shared recovery, not a per-session
preference. +1 regression test.

## 0.48.7 — 2026-07-11

**World-class review pass (cont.), interrupt vs resume**: a per-turn
`interrupt()` left the write-ahead `pending_turn` checkpoint dangling, so a
later `resume` auto-redrove the request the user had DELIBERATELY cancelled —
re-billing the API call and re-executing a rejected intent. A per-turn
interrupt now settles the checkpoint (the resume redrive only fires on genuine
crash evidence — a thrown error or an `error_during_execution` result); a caller
`AbortController` abort / `close()` keeps the recover-on-resume posture. +1
regression test.

## 0.48.6 — 2026-07-11

**World-class review pass (cont.), subagent finalizer hardening**:

- **isolation worktree released when SubagentStart throws**: the worktree is
  created before the per-branch run body's try/finally, so an aborted or
  throwing `SubagentStart` hook leaked the worktree (and its `git worktree list`
  registration). It is now released before the throw propagates.
- **`sidechain_end` written on every exit path**: the sidechain transcript's
  terminal marker was written AFTER the run loop, so an abort or thrown error
  mid-run skipped it — leaving the transcript unterminated and breaking the
  `settleAll` M4 contract that waits for it. The marker is now written in a
  finally (pessimistic `is_error: true` when the run did not complete cleanly).

+1 regression test.

## 0.48.5 — 2026-07-11

**World-class review pass (cont.), worktree data safety**: a subagent isolation
worktree (`Agent({ isolation: 'worktree' })`) is a DETACHED checkout. Cleanup
kept it only when the working tree was dirty (`git status --porcelain`), so a
child that COMMITTED its work left a clean tree and the worktree — with its
detached commits — was removed, orphaning the commits (gc'd after the grace
period). `addWorktree` now records the base HEAD and `removeWorktreeIfClean`
keeps the worktree when HEAD has moved past it (commits made), not only when the
tree is dirty — "never destroy work", committed or not. Named EnterWorktree
worktrees are unaffected (their commits live on a branch). +1 regression test.

## 0.48.4 — 2026-07-11

**World-class review pass (cont.), OpenAI-gateway compatibility**:

- **`stream_options` is now suppressible**: `stream_options: { include_usage:
  true }` was hardcoded AFTER the `extraBody` spread, so a gateway that 400s on
  it (older vLLM, some one-api variants) had no escape hatch. When `extraBody`
  declares `stream_options` (e.g. `null`), its value now stands.
- **in-stream error status is classified, not hardcoded 500**: a mid-stream
  error chunk (the response was 200, so there is no HTTP status) threw a
  hardcoded `500`, so a mid-stream rate-limit / quota / auth error looked like a
  server error to the engine's fallback and the caller. Its `type` is now mapped
  to the right status (429 / 401 / 400 / …), mirroring the Anthropic arm.

+2 regression tests.

## 0.48.3 — 2026-07-11

**World-class review pass (cont.), Retry-After handling** (both transport arms):
the parser only recognized the numeric delta-seconds form (an HTTP-date
`Retry-After`, common from proxies/CDNs, was `Number()`→NaN and silently dropped
to exponential backoff), and it clamped a value above the 60s exponential cap
down to 60s — so a server's explicit "wait 90s" retried at 60s, straight back
into the same limit and burning a retry. Now the HTTP-date form is parsed
(delta-from-now, past date → retry immediately) and an explicit Retry-After is
honored as given, bounded by a 120s ceiling so a pathological value can't hang
the agent; only the exponential fallback stays capped at 60s. +3 regression
tests; twin-drift guard kept green.

## 0.48.2 — 2026-07-11

**World-class review pass (cont.), session-integrity batch**:

- **forkSession keeps the write-ahead checkpoint pairing consistent**: the fork
  minted a fresh uuid for every record but left the cross-references
  (`turn_complete.pending_uuid` → the pending_turn's uuid, `pending_turn.turn_ref`
  → the user message's uuid) pointing at the OLD uuids. A forked session then
  read as a permanently-interrupted turn (bad list/getSessionInfo metadata), and
  a source ending on a user turn phantom-redrove an already-completed request (a
  duplicate billed API call) on resume. A single old→new uuid map now rewrites
  the record uuids AND their references together.
- **`continue: true` never resurrects a subagent sidechain**: `latestSessionId`
  (and `list()`/`getSessionInfo`) scanned every `.jsonl` by mtime, not
  distinguishing a main session from a subagent sidechain transcript. A
  background child that finished after the parent's last write became the newest
  file, so "resume the most recent session" loaded a `sidechain_start`-marked
  transcript that holds only assistant turns — repairPairing then welded it into
  a garbled conversation. Both discovery paths now skip a transcript whose first
  record is `sidechain_start`.

+2 regression tests.

## 0.48.1 — 2026-07-11

**World-class review pass — six-track audit fixes** (one consolidated entry; the
branch bumped through 0.47.1–0.47.10 pre-merge, rebased onto 0.48.0's memory
governance). A six-way parallel deep review of all 103 source files surfaced,
verified, and fixed the following, each with a regression test:

- **P0 — aggregate agent-tree budget ceiling**: each subagent got a full copy of
  `maxBudgetUsd` and the parent gate saw only its own cost, so a coordinator
  fanning out N concurrent subagents could spend (1+N)×maxBudgetUsd in one
  prompt. A shared `familyBudget` ledger is threaded through the root loop and
  every subagent loop; each loop adds its own cost and every gate trips on the
  aggregate. Single-loop behavior is byte-identical.
- **Security — WebFetch SSRF**: an IPv4-mapped IPv6 host (`[::ffff:169.254.169.254]`)
  is normalized by the URL parser to hex before the guard runs, bypassing the
  entire private/loopback/link-local/metadata IPv4 blocklist. The embedded IPv4
  is now reconstructed and run through `ipv4Blocked`.
- **P1**: memory×toolSearch registered ToolSearch into the wrong builtin map
  (all deferred tools unreachable); a thinking-only assistant turn stripped to
  `content:[]` and 400'd every later request (permanent session death); OpenAI
  transport crashed on a zero-consumption `[DONE]` stream and dropped a
  late-arriving tool_call id / split name; the concurrency gate ignored abort
  while a request was queued; a PreCompact `decision:'deny'` vetoed the memory
  flush but not the fold (memory loss); a refusal turn kept an orphan tool_use;
  `run()` never closed the input pump on early exit (unbounded queue + caller
  generator leak); `close()` aborted the caller's shared AbortController (killing
  sibling queries — now a query-owned `life` controller); the `Bash(git:*)`
  colon boundary matched a bare prefix (`git-crypt`, `github`); a stalled
  background worker never notified its coordinator; a fork subagent inherited
  only `systemPrompt` (breaking the shared-cache byte-match); a doubly-failed
  fallback attempt's usage went unbilled.
- **P2**: SSE parser accumulated one reaction per chunk on a never-settling abort
  promise (megabytes on long streams — now cancels the reader); Bedrock
  `apac.`/`global.`/`us-gov.` inference-profile prefixes priced at $0 (silently
  unenforceable `maxBudgetUsd`); an `is_error` tool_result lost its failure
  signal on the OpenAI protocol (now a `[tool error]` marker).

Baseline 1786 → full suite green with +25 review regression tests; `tsc` +
`build` exit 0. Deferred for keeper adjudication (documented in the PR): the
SessionManager auto-resume resource/accounting semantics, the auto-mode
`allowedTools` question, sandbox writable-dir sync, and a P2 long-tail.


## 0.48.0 — 2026-07-11

**Memory governance P0 set (spec S1–S4, BPT-EXTENSION — docs/MEMORY-GOVERNANCE.md)**:
the SDK-layer footing for BPT's team/personal memory partitioning, incognito
mode and auditability. S1 scope routing: `options.memory.mounts` declares
per-query subtree rights (`read-only` / `read-write`), enforced at the tool
layer on top of R4 traversal protection — writes outside a read-write mount
and any access outside every mount are rejected with structured errors,
ancestor-directory listings are FILTERED to mount-visible entries (user A
never sees user B's names), rename is gated at both ends, and the resident
index (R6) only injects when `/memories/MEMORY.md` is mount-readable. S2
incognito primitive: `options.incognito` forces zero SDK-side persistence —
transcript writes off (`sessionStore` combination is a ConfigurationError),
memory degraded to read-only (view stays; the five writes return
`INCOGNITO_MEMORY_ERROR`), both R7 write rounds off, S3 records off; the
leak-test checklist from the requirements doc runs as integration tests
(marker-grep across every SDK-writable root). S3 structured tool-call log:
one `tool_call` JSONL record per dispatched tool_use block (root loop AND
subagents, `parent_tool_use_id`-stamped) with name / truncated input JSON /
timestamp / seq / status / duration / result summary, `type`-distinguishable
from message lines and joinable to the untruncated tool_use block via
tool_use_id; read back with `getSessionToolCalls()`. S4 claim verification:
`auditToolClaims` / `auditSessionToolClaims` flag assistant turns that CLAIM
a tool action with no backing record (default zh+en memory-write detector,
consumer-extensible; low-miss over precision by design). +32 tests, full
suite 1812 green.

## 0.47.0 — 2026-07-11

**Memory system M2 (spec R7–R9, BPT-EXTENSION `options.memory` — docs/MEMORY.md)**:
harness-enforced write timing + governance over the M1 base. R7 lifecycle: a
pre-compaction FLUSH turn (one memory-write opportunity injected before each
auto-compaction fold, PreCompact-deniable, once per episode) and a session-end
progress-card round on normal termination only (its result absorbed into
accounting — the task's own result stays last; `sessionEndUpdate: false` /
`flushOnCompaction: false` to disable). R8 governance: 64KB file / 64
files-per-dir / 16k-char view truncation with a view_range hint (configurable
`memory.limits`, enforced in the store engine + tool layer), and
`metrics.memoryHealth` counters (ops/reads/writes/errors/bytes + resident-index
tokens). R9 `schema: 'cards'`: writes must validate as 结论/依据/过期条件 cards
(zod; structured retryable errors; `memory.cards` limits). Live-smoke phase 3
(native-mode memory against the real API) + conformance memory-axis wire locks.
+31 tests (1782 green).

## 0.46.0 — 2026-07-11

**Memory system M1 (spec R1–R6, BPT-EXTENSION `options.memory` — docs/MEMORY.md)**:
`memory_20250818`-equivalent six-command memory tool with client-injected
storage. Dual assembly (R2): native typed entry on the Anthropic protocol /
SDK-defined custom tool + docs-verbatim protocol prompt on any protocol —
one consuming surface, identical store artifacts. `MemoryStore` contract +
`MemoryFileOps` primitives + `createMemoryStore` semantics engine (byte-exact
docs reference strings, golden-tested) + `createLocalFilesystemMemoryStore`
default + publishable `runMemoryStoreContractSuite` (R3). SDK-layer path
validation with a 23-variant traversal attack corpus as a release gate (R4).
Resident `/memories/MEMORY.md` index injection with line/byte caps (R6).
80 new tests; typed `MemoryToolError`.

## 0.45.0 — 2026-07-11

**Network layer: built-in keep-alive client (方案丁转正) + preconnect (方案丙)**
(keeper ruling 2026-07-11 「做」, after the measured evaluation reversed the
earlier 甲/乙 recommendation — probes summarized in docs/PERFORMANCE.md):

- **Default HTTP client is now the SDK's own zero-dependency node:http(s)
  adapter** (`src/transport/node-http.ts`), shared process-wide, behind the
  provider.fetch seam — transports and the twin discipline untouched.
  Long keep-alive agents end the per-turn TCP+TLS re-handshake
  (~100-300ms) that global fetch's ~4s idle pool imposed on any turn whose
  tool run exceeded it; TLS sessions resume across reconnects; idle pooled
  sockets are unref'd so a warm pool never blocks process exit. Honest
  divergences from fetch (inert against the Messages API): no redirects, no
  accept-encoding, bodies always carry explicit content-length.
  `provider.httpClient: 'fetch'` / env `BPT_HTTP_CLIENT=fetch` restores the
  pre-v0.45 late-bound global fetch (undici semantics: setGlobalDispatcher,
  NODE_USE_ENV_PROXY, global-fetch test stubs). `provider.fetch` still wins
  over everything.
- **`provider.preconnect`** (default off; env `BPT_PRECONNECT=1`): one
  fire-and-forget unauthenticated HEAD at transport construction overlaps
  DNS+TCP+TLS with query init (~100-300ms off first-turn TTFT).
- **HTTP/2 evaluated and parked**: undici `allowH2` measured either
  one-session-per-request (no multiplexing) or serialized streams (8
  concurrent SSE turns 223ms → 1262ms) — no deliverable win; noted in
  PERFORMANCE.md.
- ARCHITECTURE.md error-class whitelist: `TypeError` allowed in
  `src/transport/` for the adapter's fetch-shape fidelity (WHATWG fetch
  rejects TypeError on invalid URL/scheme/body).
- +9 tests (`tests/transport-node-http.test.ts`: fetch-shape fidelity,
  explicit content-length, keep-alive reuse, abort, idle-socket unref,
  resolution precedence, node-client emulator e2e incl. tool loop / 429 /
  interrupt); suite pins BPT_HTTP_CLIENT=fetch for its global-fetch-stub
  tests. 1675 passed / 2 skipped (80 files).

## 0.44.0 — 2026-07-11

**Response-time pass** (keeper dispatch 「审视 silver core sdk，优化响应时间」).
Measured first (`tests/integration/perf-overhead.mjs`, new zero-key
emulator-driven probe), then trimmed what the engine controls:

- **`provider.fetch` injection seam (BPT-EXTENSION, both transports)**: custom
  fetch used for every HTTP request the transport issues (retries included).
  The headline consumer win: Node's built-in fetch pools connections with a
  ~4s idle keep-alive, so any turn whose tool run exceeds that re-pays a
  TCP+TLS handshake (~100-300ms) — binding requests to a long-keep-alive
  undici Agent removes that per-turn tax. Late-bound: when absent, the
  CURRENT global fetch resolves at call time. Recipes in new
  `docs/PERFORMANCE.md` (keep-alive agent, first-turn preconnect, perceived
  latency). Twin discipline held (`requestWithRetries` stays token-identical).
- **Idle-watchdog lazy re-arm (both transports)**: per-SSE-event cost drops
  from a clearTimeout+setTimeout pair to one timestamp write; a single timer
  re-arms for the remaining gap (abort still lands exactly idleMs after the
  last event). ~1 timer per idle window instead of 1 per event.
- **One tool-def build per turn (engine loop)**: the compaction estimate and
  every stream attempt of a turn (replay/fallback included) now share one
  `buildToolDefs()` product instead of building twice per turn; the tool-def
  token estimate (a full-schema JSON.stringify) is cached by tool-name set.
- **SSE parser: offset line scan**: `drainBuffer` re-slices the buffer once
  per chunk instead of once per line (was quadratic in lines-per-chunk).

Probe medians (repeat=9, same machine): 30-turn tool-loop engine bookkeeping
29.7ms → 18.0ms (-39%); 8000-delta stream wall 57.4ms → 48.6ms, CPU
53.3ms → 46.3ms. +3 tests (fetch injection, both transports + retry path);
1666 passed / 2 skipped.

## 0.43.0 — 2026-07-10

**Resilience: layered disconnect survival** (keeper ruling 「全量」; design in
`docs/RESILIENCE.md`). Closes the gap behind "it still disconnects for various
reasons" with three shipped layers plus a measurement plane:

- **P0-1 bounded turn replay**: a stream failure that consumed nothing (zero
  events, a zero-event stall, or a discarded unsalvageable partial) now
  replays the turn up to 2 times with short backoff instead of killing the
  run — re-issuing is semantically safe (no tool ran, no content accepted).
  Visible as `api_retry` messages with `reason: "turn_replay:<code>"`.
- **P0-2 disconnect ledger**: every result's `metrics.transportHealth`
  (BPT-EXTENSION) counts network/HTTP/empty-stream retries, mid-stream drops,
  idle stalls, hard-cap aborts, salvages, and replays — "various reasons"
  becomes a measurable spectrum. `RetryInfo` gains a `kind` tag.
- **P1 body governance**: `timeoutMs` now governs the request phase only;
  a flowing stream is governed by the idle watchdog plus the new optional
  `streamMaxDurationMs` hard cap (`BPT_STREAM_MAX_DURATION_MS`; new error
  code `stream_max_duration`) — healthy long turns are no longer cut at the
  10-minute wall clock. Fallback: both governors off -> `timeoutMs` keeps
  bounding the body (never unbounded). Timeout/hard-cap truncations are now
  salvageable (E3), and zero-event failures carry `turnReplaySafe`.
- **P2 consumer recipe**: `docs/RESILIENCE.md` documents the four-layer
  model, all knobs, ledger interpretation, and the session auto-resume loop
  (layer 4) for BPT Desktop.

Both transports (Anthropic + OpenAI-compat) share the full change via the
twin discipline.

## 0.42.0 — 2026-07-10

**O-B2: SendMessage tool body + subagent continuation + coordinator presets**
(keeper ruling 「全部开工」). New `SendMessage` built-in `{to, summary?,
message}` continues a previously spawned subagent by agentId with its FULL
transcript intact — the runtime now retains every child (live history array +
deps/config) for the query's life in a continuation registry; messages to the
same agent serialize; stopped (killed) workers are revivable (fresh
controller), per official semantics. Foreground children reply as the tool
result; background children ack and reply on a later drained turn. Background
drain notes now use the official `<task-notification>` XML shape (task-id /
status / summary / result / usage) — consumers matching the old
`[background subagent …]` prefix must switch to the XML block. `TaskStop`
additionally accepts a subagent agentId (official v2.1.198) before falling
through to shells. Coordinator presets ship alongside (red-line now
satisfied): `COORDINATOR_MODE_PROMPT` (adapted reproduction,
system-prompt-coordinator-mode-orchestration @ 2.1.199) +
`COORDINATOR_WORKER_AGENT` / `COORDINATOR_WORKER_INSTRUCTIONS` (faithful,
system-prompt-coordinator-worker-instructions @ 2.1.182), exported from the
package root. Isolated children never see SendMessage; fork children keep the
schema (prefix byte-match) and error honestly. 17 new tests
(tests/sendmessage.test.ts) incl. corpus-sync anchors; red-line guard extended
to both coordinator prompts.

## 0.41.1 — 2026-07-10

**Rename-review fixes** (keeper ruling 「全部修复」). MCP handshake
`clientInfo.version` in the streamable-HTTP and stdio connections was still
hardcoded `'0.1.0'` — a leftover the 2026-07-10 D9 single-version-source audit
fixed for the User-Agent and init message but missed for MCP; both now import
`SDK_VERSION`. `docs/MIGRATION.md` gains an explicit rename note for consumers
crossing the `bpt-agent-sdk` -> `silver-core-sdk` boundary (dependency name +
tarball pin must be updated together).

## 0.41.0 — 2026-07-10

**Rename: bpt-agent-sdk -> silver-core-sdk** (keeper ruling 2026-07-10).
Package name, directory (`projects/silver-core-sdk/`), User-Agent
(`silver-core-sdk/<version>`), MCP clientInfo name, stderr log prefix
(`[silver-core-sdk]`), and `NotImplementedError` message prefix all follow the
new name. No behavioral change beyond these identity strings; minor bump
because the shipped identity surface (UA / clientInfo) is consumer-visible.
Tarball pin becomes `silver-core-sdk-<version>.tgz` from this version on.

## 0.40.0 — 2026-07-10

**Chase the official surface 0.3.201 -> 0.3.205** (keeper ruling 「追」). A
type-surface diff of the official tarballs (`sdk.d.ts` + `package.json`) found
the pinned baseline 4 patch versions behind npm latest `0.3.205` (published
2026-07-08); seven new exported types, zero removed. Reconciled onto this SDK
following the NEW-IN-DOCS posture — typed for drop-in exhaustiveness, emitted
only where a headless direct-API engine has an honest source (none here):

- **`Query.interrupt()` now returns the official `{ still_queued }` receipt**
  (`SDKControlInterruptResponse`) instead of `void`. This engine keeps no
  uuid-stamped async message queue surviving an abort, so the receipt is always
  `{ still_queued: [] }`. Source-compatible: `await q.interrupt()` that ignores
  the return is unaffected.
- **`SessionMessage.parent_agent_id`** (0.3.202) — the spawning subagent's
  agentId, surfaced by `getSessionMessages` from persisted metadata (null when
  the transcript lacks it, per the official contract).
- **New typed-not-emitted variants**: `SDKActiveGoalMessage`
  (`active_goal`), `SDKConversationResetMessage` (`conversation_reset`) added to
  the `SDKMessage` union; `SDKBackgroundTasksChangedMessage`
  (`system`/`background_tasks_changed`, 0.3.203),
  `SDKControlRequestProgressMessage` (`system`/`control_request_progress`) added
  to the observability arm. Plus the control-protocol request types
  `SDKControlGetPlanRequest` / `SDKControlGetWorkspaceDiffRequest` (N/A-by-design
  — no control_request wire protocol here).

Tests: `tests/compat-0-3-205.test.ts` (new — assignability, interrupt receipt,
`parent_agent_id` round-trip) and `tests/observability.test.ts` (union
completeness, 25 -> 27 sampled variants). `docs/COMPAT.md` baseline bumped to
0.3.205. No runtime behavior change beyond the additive interrupt return value.

## 0.39.0 — 2026-07-10

**Stop-hook block semantics** (keeper's "/goal 线" dispatch — the goal-gating
primitive): the engine now HONORS a Stop hook's `decision: 'block'` at natural
end instead of logging it — the block reason is fed back as a user turn
(history + request view, so resume replays it) and the loop runs another
assistant turn; `stop_hook_active` reports true on subsequent Stop inputs so a
well-behaved hook can break the cycle. `continue: false` forces the stop and
wins over block (official precedence). ROOT LOOP ONLY: child loops
(parentToolUseId set) stay governed by SubagentStop, so a goal gate never
captures subagents. A stubborn block still honors maxTurns / maxBudgetUsd.
Combined with hook `condition` (model-evaluated, already shipped), this is the
full engine-side /goal-equivalent — the host registers a Stop hook with a
natural-language condition; no prompt reproduction involved. COMPAT hooks
table: Stop row updated (the pre-0.39 "FULL" overstated log-only behavior).
Tests: tests/stop-hook-block.test.ts (5).

**Version-constant repair**: the 0.38.0 release landed on main with
`src/version.ts` / `package.json` still reading 0.37.1 — a rebase-conflict
resolution picked `--ours` (which during rebase means the BASE branch, not the
feature branch; lesson filed). 0.39.0 re-aligns the version single-source with
the ledger.

## 0.38.0 — 2026-07-10

**Custom slash commands** (`.claude/commands`, keeper "全面实现建议" phase-1
work order): open reproduction of the official custom-command surface,
SDK-side subset. New `src/engine/slash-commands.ts` loads project + user
command markdown per `settingSources` (subdirectory ':' namespacing, project
wins collisions, built-in names reserved, I/O failures degrade to none);
a pure-text `/name [args]` user turn expands to the command body with
`$ARGUMENTS`/`$1`..`$9` substituted before hitting the wire (raw text still
shown to `UserPromptSubmit` hooks and session `firstPrompt` meta; expanded
body is what history/persistence/resume carry). `system/init.slash_commands`
and `supportedCommands()` now report the REAL command set (built-in `compact`
+ custom) in the official `SlashCommand` shape — `SlashCommand` type aligned
to official (`description`/`argumentHint` required, `aliases?`). Deliberately
NOT reproduced (declared in COMPAT.md, not silent): `!command` inline bash,
`@file` references, `allowed-tools`/`model` frontmatter, model-invoked
SlashCommand tool. Tests: `tests/slash-commands.test.ts` (21: loader /
frontmatter subset / expansion rules / query() wiring e2e); two stale
`toEqual([])` assertions in query.test.ts realigned. Full suite 1620 pass /
2 skip; `tsc` + `build` exit 0.

## 0.37.1 — 2026-07-10

**Port the empty-stream retry arm (断流继续臂) to the OpenAI-protocol transport.**
The 0.36.0 fix taught `AnthropicTransport` to self-heal an HTTP 200 that closes
with ZERO SSE events (a replay-safe gateway non-start) instead of crashing the
turn, but the OpenAI translating transport (0.35.0) shipped without that arm —
`OpenAIChatTransport.streamRequest` issued the request once and, on a clean
close with zero chunks (no `[DONE]`, no `finish_reason`), threw an unretryable,
unsalvageable `APIConnectionError` (`midStreamTruncation` false because
`chunkCount === 0`) that took down the whole `query()` turn. On any
OpenAI-compatible gateway (DeepSeek / vLLM / one-api) exhibiting the same
throttle-under-fan-out shape, main conversation and subagents alike died where
the Anthropic arm would have recovered.

- **fix:** `OpenAIChatTransport.streamRequest` now wraps request+stream in the
  same `for (;;)` retry loop. A clean close with `chunkCount === 0` re-issues
  the whole request (exponential backoff + jitter, honoring the caller abort),
  bounded by the same `maxRetries` budget; on exhaustion it throws a
  retryable-class `APIConnectionError` with the stable code `empty_stream`
  ("empty stream (HTTP 200, zero SSE chunks) after N attempt(s)"). The retry
  lives INSIDE the transport, so subagents self-heal with no host involvement.
- **unchanged semantics preserved:** chunks-then-clean-close-without-marker is
  still a MID-STREAM truncation (`midStreamTruncation: true`, E3 salvage, never
  retried); a mid-stream network ERROR still routes through `mapStreamError` and
  stays terminal. `streamRequest` is a deliberate per-arm copy (translation vs
  raw passthrough), so it is not a transport twin — noted for
  `tests/transport-twin-drift.test.ts`.
- **tests:** `tests/transport-openai.test.ts` gains the mirror suite (heal on
  retry, exhaustion → `empty_stream`, `maxRetries: 0` still throws, `onRetry`
  network-level shape, abort-during-backoff wins).

## 0.36.0 — 2026-07-09

**Retry an empty stream (HTTP 200, zero SSE events) instead of crashing the turn**
(black-pool request). Under concurrent fan-out the idealab gateway occasionally
answered a request with HTTP 200 but a body that closed with ZERO SSE events —
not even `message_start`. The transport's streaming loop `for await`-ed nothing,
returned normally, and the engine fell through to `accumulator.finalize()`, which
threw a raw `Protocol error: finalize before message_start` OUTSIDE the streaming
try/catch — an uncaught crash of the whole `query()` turn. Subagents run on the
same transport out of reach of any host-level retry, so a fan-out child that hit
this died outright (the black-pool `streamSdkPinned` symptom patch only covered
the main conversation).

- **root cause: empty stream ≠ mid-stream truncation.** A drop *after* events
  (`eventCount > 0`) is a truncated turn — never replayable, salvaged by E3. An
  empty stream (`eventCount === 0`) is a replay-SAFE non-start: zero events
  consumed, zero yielded. It had no dedicated handling and fell to finalize's
  raw throw.
- **fix: transport-internal empty-stream retry.** `AnthropicTransport.streamRequest`
  now wraps the request+stream in a retry loop: a stream that ends with zero
  events is re-issued (exponential backoff + jitter, honoring the caller abort),
  bounded by the same `maxRetries` budget. Because the retry lives INSIDE the
  transport, both the main conversation AND subagents self-heal with no host
  involvement. The transport now NEVER returns a zero-event stream normally —
  it either heals to a real stream or, on budget exhaustion, throws a
  retryable-class `APIConnectionError` with the new stable code `empty_stream`
  (message: "empty stream (HTTP 200, zero SSE events) after N attempt(s)"). The
  finalize raw-throw is therefore unreachable from empty streams even at
  `maxRetries: 0`.
- **observability: an empty-stream retry fires `onRetry`** with a network-level
  shape (no HTTP status), so the loop emits an `api_retry` message exactly like a
  dropped socket.
- **new error code:** `empty_stream` added to the `ErrorCode` union (append-only;
  attached by the transport at its throw site).
- **unchanged:** normal streams, real mid-stream truncation (E3 salvage,
  `eventCount > 0`), caller abort, and idle-watchdog timeout all keep their exact
  behavior — a stalled stream (connected then silent) is still the idle
  watchdog's job (`stream_idle_timeout`), distinct from an empty stream (closed
  at once with no event).
- **deferred (deliberate scope):** the related "subagent stuck on a silent
  stream" ask — a shorter, per-loop/per-subagent `streamIdleTimeoutMs` — is a
  separate change to the `StreamRequest` contract + subagent runtime and is NOT
  in this build. Filed as a follow-up; the current transport-wide
  `streamIdleTimeoutMs` (default 300000ms) is unchanged.
- Tests: `tests/transport.test.ts` (empty-stream retry + heal, exhaustion →
  `empty_stream`, `maxRetries: 0` still throws not returns, `onRetry` shape,
  abort-during-backoff); `tests/engine.test.ts` (end-to-end: an empty first
  stream self-heals and the loop yields the assistant reply — the black-pool
  crash regression). Full suite 1554 pass / 2 skip (rebased onto 0.35.0's
  OpenAI translating transport; no interaction).
## 0.37.0 — 2026-07-10

**Audit debt payoff** (full ledger:
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-optimization-review-20260710.md`).

Defect fixes: OpenAI translator keeps interleaved tool_calls intact
(per-index open blocks) and treats a clean stream end without
[DONE]/finish_reason as a truncated turn (E3 salvage) instead of a fabricated
success; orphan tool_use blocks are filtered on the structured-output-retry
and background-drain persist paths (was: every later same-query request
400s); blocking TaskOutput honors abort + caps model-supplied timeouts;
terminal engine decisions (budget/turns/refusal) settle the WAL pending_turn
so resume cannot re-bill a spent budget cap; SIGKILL escalation timers cancel
on exit; workflow runs cancel honestly when aborted mid-flight.

Hardening/perf: per-message token-estimate cache + real-usage floor kill the
O(n^2) compaction-trigger scan and the silent 'prompt too long' overflow
path; hooks aggregate in deterministic registration order with a new
`hookFailureMode: 'closed'` fail-safe knob; session list() is a meta-only
scan; teardown awaits background-subagent finalizers before the mirror
flush; retry observability survives exhausted retries.

OpenAI gateway: `provider.openai.modelMap` / `authHeaderName` (Azure) /
`extraQueryParams`; `provider.pricing` overrides; silent-failure
`informational` warnings (unpriceable maxBudgetUsd, dropped thinking,
ignored betas/apiVersion) — the `informational` message type is now emitted,
including one listing any ACCEPTED-IGNORED options present.

Structure (audit P2): import-discipline test enforces the ARCHITECTURE.md
edges table (engine<->subagents cycle broken via internal/model-alias);
transport twin anti-drift guard; tool dispatch, EngineConfig assembly,
session persistence/WAL, session accounting and async primitives extracted
from the two mega-files (query.ts 2008->~1530 lines, loop.ts 1519->~1160);
system wire-field derivation single-sited with an assembly<->derivation
contract test; ToolContext gains formal `sessionKey`/`permissionGate`;
workflow-engine moved to tools/. `src/version.ts` is the single version
source (User-Agent / init now report the real version; guard REDS drift).
Docs reconciled (settingSources tri-doc contradiction, electron-host example
message pump + smoke guard, README tools/env tables, ERRORS wiring notes).
Monthly scheduled L5 real-API conformance round. 1600+ unit tests green.

## 0.35.0 — 2026-07-09

**OpenAI protocol support** (`provider.protocol: 'openai-chat'`, BPT-EXTENSION).
A translating transport (`src/transport/openai.ts`) drives any OpenAI-compatible
Chat Completions endpoint (api.openai.com / DeepSeek / vLLM / one-api gateways)
while the engine keeps speaking Messages API shapes end to end — requests are
encoded (system/tools/tool_choice/images/tool_result fan-out/response_format),
`chat.completion.chunk` streams are synthesized back into Anthropic stream
events (text, tool_calls -> tool_use + input_json_delta, DeepSeek
`reasoning_content` -> thinking blocks, finish_reason/usage mapping with
cached-token split). Same retry/backoff/idle-watchdog/concurrency policy as the
Anthropic transport; errors normalize to Messages API error-type vocabulary.
New `ProviderConfig.protocol` + `provider.openai` tuning
(`maxTokensParam`/`reasoningEffort`/`extraBody`); `OPENAI_API_KEY` /
`OPENAI_BASE_URL` env fallbacks. All transport construction sites (query /
session manager / generators) route through a shared factory
(`src/transport/factory.ts`); default stays 'anthropic' — zero behavior change
for existing consumers. Docs: `docs/OPENAI-PROTOCOL.md`. +21 unit tests
(1548 green).

## 0.34.1 — 2026-07-09

**Remove the leftover `[bpt-usage]` diagnostic probe** (black-pool request). A
one-off token-accounting probe added 2026-07-08 printed each turn's raw
`input_tokens` / `cache_read` / `cache_creation` to stderr via `console.error`,
which downstream log layers surface as a spurious ERROR-level red line every
turn. Its own comment scoped it to "remove once the cache-behavior numbers are
captured" — they were. Deleted the comment + `console.error` call in
`recordUsage()` (src/engine/loop.ts); the accounting logic (`totalUsage` /
`modelUsage` / cost) is untouched. `src/` now contains no `console.*` calls.

## 0.34.0 — 2026-07-09

**Unified tool-search: defer COLD BUILT-IN schemas, not just MCP tools** (keeper
ruling 2026-07-09). Tool-search previously deferred only MCP tool schemas; the
built-in schemas were always advertised inline every turn (~16k tokens, cold-written
at the start of every conversation — the single largest fixed request cost, and the
one the prompt cache does not amortize on a fresh conversation). The ONE `ToolSearch`
builtin now searches and lazily loads a cold BUILT-IN set through the same registry:
one shared `loaded` namespace, one catalog. `Workflow` (~4.9k tokens, the largest
built-in schema) leads the cold set.

- **new: unified deferral, opt-in via `toolSearch: true`.** When set, the cold set
  (`DEFAULT_DEFERRED_BUILTINS` — Workflow / Monitor / ExitPlanMode / EnterWorktree /
  WebFetch / WebSearch / the background-shell + task tools / MCP-resource tools) is
  withheld from the request `tools[]` and lazily loaded on demand — **even with zero
  MCP servers configured**. The reflexive core (Read/Write/Edit/Bash/Glob/Grep, plus
  Agent, AskUserQuestion and ToolSearch itself) stays hot. A withheld built-in still
  EXECUTES if called (has()-stays-true — context-saving, not access control), exactly
  like a deferred MCP tool, and its schema resurfaces the turn after a ToolSearch load.
- **unchanged default (drop-in safe): `toolSearch` undefined defers nothing built-in.**
  Every built-in stays inline exactly as before; MCP-only deferral past the threshold
  is untouched. `toolSearch: false` still disables all deferral. The conformance wire
  surface is byte-identical on the default path (`toolNames`/`toolCount` were already
  excluded from the reference ratchet).
- **new export: `silverCoreToolOptions()`** — the SVN-world variant bundle
  (`{ toolSearch: true, disallowedTools: ['EnterWorktree'] }`). The faithful
  `createBuiltinTools()` factory is UNCHANGED; the variant is a separate opt-in caller
  surface that additionally REMOVES `EnterWorktree` (git worktrees are unusable under
  SVN) via the existing bare-`disallowedTools` path — removed, not merely deferred.
  Pass `{ disableWorktree: false }` to keep it (deferred).
- **new exports: `DEFAULT_DEFERRED_BUILTINS`** (the cold set) and the
  `DeferredBuiltinEntry` type / the `DeferredMcpRegistry` cold-built-in surface
  (`attachColdBuiltins` / `isBuiltinDeferred` / `coldBuiltinCatalog`).

## 0.33.0 — 2026-07-09

**Collapse the harness-prompt variant ladder to a single default** (keeper ruling
2026-07-08). The v1-v4 opt-in variants (a BPT A/B experiment) and the minimal
`undefined`-systemPrompt fallback are removed; there is now ONE harness prompt —
the comprehensive faithful reproduction of the official Claude Code main loop
(the former v5). A measured A/B had already shown it is ~3x cheaper in multi-turn
than the terse variants (its large stable prefix caches; the tiny ones fell below
the cache threshold), so it is the sole default.

- **removed (breaking): `Options.harnessPromptVariant`.** The variant-selection
  knob is gone; callers that passed `'v1'..'v4'` now get the single default.
  `PromptContext.variant` (on the `buildSystemPromptParts` export) is removed too.
- **behavior change: an unset `systemPrompt` now resolves to the full default
  harness**, not the prior 2-line minimal prompt — `undefined` and the
  `claude_code` preset converge to the same prompt. A string systemPrompt is
  still owned verbatim; `append` remains preset-only.
- `src/engine/prompts.ts`: deleted `minimalStable` / `defaultHarnessStable` (v1) /
  `V2` / `V3` / `V4`; the sole builder is renamed `defaultHarnessStable` and
  composes from the fragment store (`assembleMainLoop`, byte-locked by
  `prompt-assembler.test` / `v5-mainloop-golden.json`, unchanged).
- tests/docs: `prompts.test.ts` / `query.test.ts` / `harness-base-export.test.ts`
  retargeted to the single default (+ new locks that `undefined` and the preset
  match); `ARCHITECTURE.md` updated; the `--variant` dimension removed from the
  `cache-probe` / `ab-benchmark` integration probes.

## 0.32.0 — 2026-07-09

- **feat (prompt-composition observability — black-pool ContextRing "上下文构成"
  panel request)**: the SDK now exposes the two pieces it knows for certain the
  moment it assembles a request, so a downstream context-composition panel stops
  reverse-engineering the transcript with character estimates.
  - **需求 A — per-part estimate**: `analyzeRequestComposition(request, system?)`
    returns `promptComposition` = `{ systemBase, systemAppend[], toolDefs, messages,
    totalEstTokens }`, each with a token estimate from the SDK's OWN estimator
    (`engine/tokens.ts`) — the same one the compaction layer uses to size the
    context window, so the panel shares the SDK's accounting口径 instead of a
    re-implemented tokenizer. `systemAppend` entries carry the caller's label.
  - **需求 B — cache-breakpoint map**: `cacheBreakpoints` = `[{ afterPart,
    prefixEstTokens }]`, one per `cache_control` marker on the outgoing request,
    each annotated with the estimated size of the prefix it seals (tools → system
    → messages order). Lets the panel map the API's REAL `usage` counts onto
    content buckets at zero extra calls (`cache_read_input_tokens` ≈ a matched
    cached prefix; `input_tokens` + `cache_creation` ≈ this turn's new tail).
  - **Delivery**: `analyzeRequestComposition` is exported for synchronous use, and
    the same payload is emitted per-request as a `system` / `prompt_composition`
    observability message when `options.includePromptComposition` is set (default
    off — zero cost when off; the wire request is never affected).
  - **Labeled append segments (the "带 label" ideal)**: the `claude_code` preset
    `systemPrompt` gains `appendSegments?: { label, text }[]` (BPT-EXTENSION) and
    `SystemPromptSegment` gains `label?` — labels are metadata only (never
    serialized; wire output byte-identical to passing the same text via `append`),
    so the breakdown can attribute each append bucket (e.g. Root / Runtime /
    Memory) separately.
  - **Serves the ContextRing "Skills" bucket too** (2nd black-pool request,
    keeper ruling 2026-07-09 "复用 systemAppend label"): an active skill whose
    instructions persist as a re-injected SYSTEM-PROMPT segment (via
    `appendSegments` / `append` / the `segments` form) is now attributable —
    label the segment (e.g. `skill:<id>`) and its per-turn resident tokens land
    in `systemAppend`, so the host can lift persistent skill occupancy out of the
    panel's Unknown residual. Boundary: this SDK has NO skills subsystem (session
    `skills` is ACCEPTED-IGNORED, no `load_skill` tool), so first-load `tool_result`
    tokens stay in the `messages` bucket (the host already sees that via the
    transcript), and a skill that persists as re-injected MESSAGE content (not a
    system segment) falls in the aggregate `messages` bucket — the host authored
    that injection and can meter it directly; per-message-segment attribution is a
    separate future request.
  - Same lineage as `buildSystemPromptParts` / `enumerateBuiltinToolMetadata`
    (ADR 0014 / ADR 0022): the SDK surfaces what it knows at build time.
    Complements — does NOT replace — per-segment EXACT truth, which still needs
    the Messages API `count_tokens` endpoint (out of scope here).

## 0.31.0 — 2026-07-08

- **feat (TaskOutput / TaskStop built-in tools — official-name alignment)**: the
  official 0.3.201 names for reading and stopping a background task now ship as
  registered built-in tools, closing the last drop-in tool-surface gap besides
  the deliberate NotebookEdit omission (built-in tools 21/24 → 23/24). A
  background task in this SDK IS a background shell, so both delegate to the same
  per-query `ShellManager` that backs the legacy `BashOutput` / `KillShell`
  tools — all four ship during the transition, and the reproduced Bash / Monitor
  tool descriptions still steer the model to `BashOutput` / `KillShell`.
  - `TaskOutput` (`{ task_id, block, timeout }`): reads output accumulated since
    the previous read plus status; `block: true` polls up to `timeout` ms
    (default 60000) for new output or a terminal status. No `filter` param (not
    in the official schema — use `BashOutput` for per-line filtering).
  - `TaskStop` (`{ task_id, shell_id? }`, `shell_id` deprecated): SIGTERM→SIGKILL
    on the background shell's process group; already-terminal tasks report their
    status without re-killing.
  - Drop-in types added to `src/tool-types.ts` and re-exported: `TaskOutputInput`,
    `TaskStopInput`, `TaskStopOutput` (TaskOutput has no official output member, so
    it is absent from `ToolOutputSchemas`, matching the official union).
- **docs (documentation-lag fixes surfaced by the 2026-07-08 interface re-audit)**:
  - `debugFile` moved out of the runtime-ACCEPTED-IGNORED block in `src/types.ts`
    and re-documented as FULL (it has been honored since the P2 pass); the
    `debug`/`debugFile` COMPAT row is unchanged, only the type JSDoc caught up.
  - `docs/COMPAT.md`: the ACCEPTED-Options row note claiming those 22 fields are
    "NOT declared on the TS Options type" was stale (they were typed in T2-3);
    corrected to state they are typed-but-inert.
  - `tests/red-line-tool-names.test.ts`: `TaskStop` removed from the
    unshipped-tool denylist (it now ships), mirroring the ExitPlanMode precedent.

## 0.30.0 — 2026-07-08

- **feat (public harness-base constructor export, black-pool ContextRing request
  2026-07-08)**: the package entry now re-exports `buildSystemPromptParts` and
  `buildSystemPrompt` (plus the `SystemPromptParts` / `EnvironmentContext` /
  `PromptContext` types) from `engine/prompts.js`. A host can now size the
  built-in harness base — the V5 preset prose (~11.7k chars ≈ ~2.9k tokens)
  injected on the `claude_code` preset path — via the public API:
  `buildSystemPromptParts(opt, ctx).base`. `.base` is the vN harness prose ONLY
  (no caller `append`, project instructions, or `<env>` tail), the exact segment
  the engine measures as `base` in `query.ts` — so with the same `toolNames` /
  `variant` it is byte-identical to what preset mode injects. Read-only, zero side
  effects; same rationale as `enumerateBuiltinToolMetadata` (ADR 0014), retiring
  the host-side `dist/engine/prompts.js` file-path stopgap.
- **temp (one-off token-accounting diagnostic)**: `engine/loop.ts` prints each
  turn's raw `input_tokens` / `cache_read_input_tokens` /
  `cache_creation_input_tokens` to stderr (`[bpt-usage] …`). Throwaway — to be
  removed once the cache-behavior numbers are captured.

## 0.29.0 — 2026-07-08

**Revert the entire i18n-zh prompt campaign back to English** (keeper ruling,
2026-07-08). The v0.19.0–0.28.0 batches translated every shipped prompt surface
to Chinese; this release restores them all to their prior **faithful English
reproductions**, undoing the on-the-wire divergence documented in `docs/COMPAT.md`.

- **restored to English (on the wire):** every built-in **tool description**
  (`src/tools/descriptions.ts`, was v0.19.0–0.23.0) and every **system / utility
  prompt** — the main-loop fragment store (`prompt-fragments.ts` +
  `prompt-assembler.ts`), the opt-in harness variants and `<env>` assembly
  (`prompts.ts`), the subagent + worker-fork framing (`subagents/agents.ts`), the
  hook-condition evaluators (`hooks/condition.ts`), the adversarial verifier
  (`verifier/prompts.ts`), the context-tip surfaces (`tips/prompts.ts`), and the
  utility-call generators (`generators/prompts.ts`, was v0.24.0–0.28.0).
- **tests:** the five `*-i18n-zh.test.ts` structural suites (which asserted the
  prompts were Chinese) are removed; the **English-archive corpus-sync guards**
  retired as inert during the campaign are restored alongside the reverted test
  files; the `v5-mainloop-golden.json` byte-lock is regenerated back to English.
- **provenance:** reproduced fragments are once again byte-faithful English
  reproductions of the archived Claude Code prompts (`faithful: true`),
  re-establishing the official-parity claim without the translation layer.
- **also retired:** the now-inert i18n token-cost probes
  (`tests/integration/token-probe.mjs` + `token-probe-perfile.mjs` + the
  `i18n-*` fixtures) and their `token_probe` job / dispatch input in
  `.github/workflows/bpt-agent-sdk.yml`. The harness compared EN-vs-ZH prompt
  token cost, moot once both sides are English again; the unrelated
  `ab-benchmark` / `cache-probe` / `live-real-api` / `emulator-e2e` integration
  probes are kept.

## 0.28.0 — 2026-07-08

i18n-zh **Phase 2 batch E** (keeper ruling B): the **opt-in harness prompt
variants** to Chinese. **This completes the i18n-zh prompt campaign.**

- **change: the opt-in harness variants are now Chinese** (on the wire):
  `minimalStable` (the `undefined`-systemPrompt default) and v1–v4
  (`defaultHarnessStable` / `V2` / `V3` / `V4`). Tool names, the
  `file_path:line_number` token, and the `calc.mjs:12` / `total([1,2,3,4])`
  example are kept English; the `可用工具：` label replaces `Available tools:`.
  v5 (the production default) was already Chinese since batch A.
- **DELIBERATELY STILL ENGLISH — a documented scope boundary:** the runtime
  `<env>` context block (`environmentBlock` / the `volatileTail` path-guidance)
  and the CLAUDE.md/AGENTS.md `<system-reminder>` wrapper. These are not tool
  descriptions or system prompts but a **conformance-LOCKED** reproduction of the
  official Claude Code runtime-context assembly (working directory, git status,
  date, model line), byte-asserted by `conformance-l2-locks` / `api-surface` /
  `engine` / `cache-control`. Translating them would break the SDK's
  official-parity claim (its core design property), so they stay English — the
  same scope boundary drawn for the runtime stderr hints in batch 5.
- `tests/prompts.test.ts` / `query.test.ts`: v1–v4 English-marker assertions
  retargeted to the translated wording; the `<env>`-block assertions are
  unchanged (block stays English).

### i18n-zh campaign summary (batches → this release)

Every built-in **tool description** (v0.19.0–0.23.0) and every **system /
generator / classifier prompt** (v0.24.0–0.28.0) that this SDK ships on the wire
is now Chinese, with all tool names, wire parameter names, output-contract tokens
(JSON keys, enums), code/command tokens, and few-shot example blocks preserved
English verbatim. The only surfaces intentionally left English are the
conformance-locked runtime `<env>` block and the runtime execution-feedback hints
(sandbox-failure stderr, win32 cmd-habit hint) — both distinct from "descriptions
and prompts". See docs/COMPAT.md.

## 0.27.0 — 2026-07-08

i18n-zh **Phase 2 batch D** (keeper ruling B): the **two big classifier prompts**
— the most output-contract-sensitive prompts in the SDK — to Chinese.

- **change: `COMMAND_PREFIX_SYSTEM` and `BACKGROUND_STATE_SYSTEM` are now Chinese**
  (on the wire).
  - `COMMAND_PREFIX_SYSTEM` (Bash command-injection detection, a SECURITY prompt):
    the framing + definitions + safety instructions are translated; the entire
    `<policy_spec>` `command => prefix` few-shot example block and the output
    values (`none` / `command_injection_detected`) are kept verbatim.
  - `BACKGROUND_STATE_SYSTEM` (the ~180-line phone-notification state classifier):
    the framing, the four-state definitions, the hard-boundary rules, the marker /
    error / disambiguation guidance, and the output-contract explanations are
    translated; the state enum (`working`/`blocked`/`done`/`failed`), the tempo
    enum (`active`/`idle`/`blocked`), the JSON template + keys, and ALL few-shot
    example tails + the CONTRASTIVE PAIRS block are kept verbatim (they are the
    demonstration data that carries the classifier's signal, and the tails match
    real English agent output).
- Both flip `faithful:false` — **all 7 entries of `GENERATOR_PROVENANCE` are now
  translated**, so the English corpus-sync guard is fully inert (skips on
  `!faithful`).
- New `tests/classifiers-i18n-zh.test.ts`: both prompts Chinese + emoji-free +
  every output-contract/enum/JSON token preserved, with explicit verbatim checks
  on the command-injection example block and the background-state JSON template.
- **Still English (final Phase-2 batch):** the opt-in v1–v4 harness variants and
  the runtime `<env>` block in `src/engine/prompts.ts`.

## 0.26.0 — 2026-07-08

i18n-zh **Phase 2 batch C** (keeper ruling B): the **small generator + context-tip
prompts** to Chinese.

- **change: seven more utility prompts are now Chinese** (on the wire): the five
  small generators — session-title (`SESSION_TITLE_SYSTEM`), title+branch
  (`TITLE_AND_BRANCH_SYSTEM`), session-name (`SESSION_NAME_SYSTEM`), away-summary
  (`AWAY_SUMMARY_SYSTEM`), memory-file selection (`MEMORY_FILES_SYSTEM` +
  contract) — and the two context-tip prompts (`CONTEXT_TIP_SELECTOR_SYSTEM`,
  `TIP_RECEPTION_SYSTEM` + contracts).
- **Output contracts + few-shot demonstrations kept verbatim** — only prose is
  translated: JSON keys/fields (`title`/`branch`/`name`/`has_tip`/`feature_id`/
  `action`/`acted_on`/`reception`), enum values
  (`positive`/`neutral`/`negative`/`unknown`), the `claude/` branch prefix, the
  `{description}` / `{situations}` placeholders, `<session>`/`<description>` tags,
  `[user]`/`[project]` memory markers, and the JSON/`Decision:` few-shot examples
  stay English. Parsers unchanged; their unit tests pass untouched.
- The 5 generators + 2 tips flip `faithful:false`; their archive corpus-sync
  guards go inert for translated fragments (skip on `!faithful`) while the two
  big classifiers (command-prefix, background-state) stay English + checked.
- New `tests/gen-tips-i18n-zh.test.ts`: each translated prompt Chinese +
  emoji-free + output-contract-token-preserving.
- **Still English (final Phase-2 batches):** the two big classifiers
  (`COMMAND_PREFIX_SYSTEM` — command-injection detection; `BACKGROUND_STATE_SYSTEM`
  — the phone-notification state classifier), the opt-in v1–v4 harness variants,
  and the runtime `<env>` block. See COMPAT.

## 0.25.0 — 2026-07-08

i18n-zh **Phase 2 batch B** (keeper ruling B): the **auxiliary generator
prompts** — the judge/verdict/delegate group — to Chinese.

- **change: three internal generator prompts are now Chinese** (on the wire):
  the hook-condition evaluators (`HOOK_CONDITION_SYSTEM`,
  `HOOK_STOP_CONDITION_SYSTEM`), the adversarial verifier prompt
  (`VERIFY_VERDICT_SYSTEM` + `THREE_STATE_VERDICT_DEFINITIONS` +
  `RECALL_BIAS_GUIDANCE`), and the subagent framing (`GENERAL_PURPOSE_PROMPT`,
  `WORKER_FORK_FRAMING` + the two subagent descriptions).
- **Output contracts preserved verbatim** — these prompts drive PARSED output,
  so only instructional prose is translated: the hook JSON keys/booleans
  (`ok`/`reason`/`impossible`/`true`/`false`), the verifier verdict enum
  (`CONFIRMED`/`PLAUSIBLE`/`REFUTED`) and JSON keys
  (`verdict`/`quote`/`rationale`/`confirms`), and tool tokens (`Agent`, `Read`,
  `*.md`, `README`) stay English. The parsers are unchanged; their unit tests
  (which feed English JSON) still pass untouched.
- `VERIFY_KEEP_RULE` is a doc/anchor constant (never sent to the model), so it
  stays English + `faithful:true`; only the on-the-wire fragments flip
  `faithful:false`. The archive corpus-sync guards go inert for translated
  fragments (they skip on `!faithful`) while staying wired for English ones.
- New `tests/aux-prompts-i18n-zh.test.ts`: each translated prompt is Chinese +
  emoji-free + output-contract-token-preserving.
- **Still English (later Phase-2 batch):** the larger `src/generators/prompts.ts`
  set (command-prefix / background-state / session-title / title-and-branch /
  session-name / away-summary / memory-files) and `src/tips/prompts.ts`, plus
  the opt-in v1–v4 harness variants and the runtime `<env>` block. See COMPAT.

## 0.24.0 — 2026-07-08

i18n-zh **Phase 2 batch A** (keeper ruling B, 全部推进 including main-loop): the
**main-loop system prompt** — the agent's core behavioral contract — to Chinese.

- **change: the v5 default main-loop system prompt is now Chinese** (on the
  wire). All 30 fragments in `prompt-fragments.ts` (security-assistance,
  doing-tasks discipline, tool-use, executing-actions-with-care, outcome-first
  communication, code style, emoji-avoidance, safety) are translated in-place,
  plus the `可用工具：` (Available tools) assembler label. Tool names, wire
  parameter names (`old_string`/`replace_all`/`subject`/`activeForm`/`content`/
  `in_progress`/`completed`/`addBlocks`/`addBlockedBy`), and command/code tokens
  (`git status`, `--no-verify`, `git reset --hard`, `rm -rf`, `-u`,
  `file_path:line_number`, `A -> B -> fails`, `"Sources:"`, `CLAUDE.md`) stay
  English; only prose is translated. Tool-gating and red-line invariants are
  unchanged (the Agent clause still only appears when the Agent tool ships).
- All fragments flip `faithful: true → false`; the English corpus-sync guard
  (`prompt-fragments-provenance.test.ts`) goes inert for translated (CJK) text
  while staying wired for any future re-added English fragment.
- The byte-identity golden fixture (`tests/fixtures/v5-mainloop-golden.json`) is
  regenerated from the translated fragments; the assembler byte-lock still holds.
- New `tests/prompt-fragments-i18n-zh.test.ts`: every fragment Chinese +
  emoji-free + wire-token-preserving; the assembled prompt keeps `可用工具：`
  and its gated clauses.
- Opt-in variants v1–v4 (terser / older reproductions) and the runtime `<env>`
  block remain English — later Phase-2 batches. See docs/COMPAT.md.

## 0.23.0 — 2026-07-08

i18n-zh batch 5 (keeper ruling B): the Bash tool description — the last and most
safety-critical one — to Chinese. **The tool-description surface is now fully
Chinese.**

- **change: Bash description + win32 note + all 18 sandbox-note fragments are now
  Chinese** (on the wire). Translated with the safety-critical logic preserved
  exactly: the Git Safety Protocol negations ("NEVER …" → "绝不…"), every git
  command (`git reset --hard`, `git push --force`, `--no-verify`, `--amend`,
  `git add -A`, …), the HEREDOC and `gh pr create` example blocks, and the
  sandbox escape rules (`dangerouslyDisableSandbox: true`, `$TMPDIR`, `/tmp`,
  `~/.ssh/*`, `"Operation not permitted"`) stay verbatim; only prose is
  translated.
- All 18 `BASH_SANDBOX_FRAGMENTS` flip `faithful: true → false` (a translation is
  not a faithful English reproduction), so the archive-verbatim corpus-sync guard
  in `tests/sandbox.test.ts` skips them; the `slug` still records the English
  source each was translated from.
- Bash removed from `TOOL_DESCRIPTION_PROVENANCE` — the English corpus-sync guard
  now tracks nothing (array kept as a home for any future re-added English tool).
- New coverage in `tests/tool-descriptions-i18n-zh.test.ts`: the Bash description,
  the win32 note, and the assembled sandbox note in all three forms (default
  net-on/off, mandatory) — asserted Chinese, emoji-free, safety-token-preserving.
- **Scope boundary (kept English):** runtime execution feedback — the
  sandbox-failure stderr hint (`src/sandbox/evidence.ts`) and the win32 cmd-habit
  hint / mandatory-mode refusal (`src/tools/bash.ts`) — is a distinct
  failure-time surface, not a tool description, and is left English by this batch.
  Translating it would be a separate follow-up. See docs/COMPAT.md.

## 0.22.0 — 2026-07-08

i18n-zh batch 4 (keeper ruling B): the Workflow tool description to Chinese.

- **change: Workflow description is now Chinese** (on the wire). This is the
  longest tool description (~148 lines) — all prose is translated: the opt-in
  rules, the Understand/Design/Review/Migrate patterns, the Ultracode section,
  the `agent()`/`pipeline()`/`parallel()`/`log()`/`phase()`/`args`/`budget`/
  `workflow()` API bullets, the barrier doctrine, and the quality-pattern
  catalogue. Every script/meta code block, function signature, and inline
  identifier stays verbatim — the honest synchronous-adaptation clauses
  (synchronous run, `budget.total` always null, the min(16, cpu-2) / 1000 /
  4096 caps) are preserved in the translated wording. Removed from
  `TOOL_DESCRIPTION_PROVENANCE`; covered by the i18n structural guard. Now the
  only English tool description left is **Bash** (+ its git protocol + sandbox
  fragments), held for a later, safety-critical batch. See docs/COMPAT.md.

## 0.21.0 — 2026-07-08

i18n-zh batch 3 (keeper ruling B): the Monitor tool description to Chinese.

- **change: Monitor description is now Chinese** (on the wire). Shell command
  examples, inline code, and the tool references (BashOutput/KillShell/
  run_in_background) stay verbatim; only prose is translated. Removed from
  `TOOL_DESCRIPTION_PROVENANCE`; covered by the i18n structural guard. Still
  English: Bash (+ git protocol + sandbox fragments), Workflow (later batches).

## 0.20.0 — 2026-07-08

i18n-zh batch 2 (keeper ruling B): 10 more tool descriptions to Chinese in-place.

- **change: TaskCreate / TaskGet / TaskUpdate / TaskList / TodoWrite / WebFetch /
  WebSearch / AskUserQuestion / ExitPlanMode / EnterWorktree descriptions are now
  Chinese** (on the wire). Same discipline as batch 1: tool names + wire
  parameter/field names + status enum values (`pending`/`in_progress`/
  `completed`/`deleted`) + JSON examples stay English; only prose is translated.
  Removed from `TOOL_DESCRIPTION_PROVENANCE`, covered by the structural guard
  `tests/tool-descriptions-i18n-zh.test.ts`. Still English: Bash (+ git protocol
  + sandbox fragments), Monitor, Workflow (later batches). See docs/COMPAT.md.

## 0.19.0 — 2026-07-08

i18n-zh (keeper ruling B): translate built-in tool descriptions to Chinese
IN-PLACE, on the wire — batch 1 of N.

- **change: Read / Edit / Write / Grep / Glob descriptions are now Chinese.**
  A DELIBERATE divergence from the official English tool surface (keeper chose
  in-place replacement over a selectable variant). Tool NAMES and wire PARAMETER
  names stay English (identifiers); only prose is translated. The five tools are
  removed from `TOOL_DESCRIPTION_PROVENANCE` (the English corpus-sync guard,
  which no longer applies) and covered by a new structural guard
  `tests/tool-descriptions-i18n-zh.test.ts` (is-Chinese, emoji-free, wire tokens
  preserved). Remaining tools (Bash + git protocol, Task*, TodoWrite, Web*,
  AskUserQuestion, ExitPlanMode, EnterWorktree, Monitor, Workflow, sandbox
  fragments) stay English until later batches land. See docs/COMPAT.md.


Hook parity: populate the official base `transcript_path` on every hook.

- **fix: `BaseHookInput.transcript_path` was never populated on any hook.** The
  official hook base carries `transcript_path` (the transcript of the session
  that fired the hook) as a required field; this SDK left it absent everywhere,
  a divergence separate from the `agent_transcript_path` gap fixed in 0.18.2.
  Now resolved from the store for a path-backed persisted session:
  - engine-layer hooks (PreToolUse / PostToolUse / PostToolBatch / Stop / …) via
    a new `EngineConfig.transcriptPath` threaded into `baseHookFields`;
  - query-layer hooks (SessionStart / UserPromptSubmit / SessionEnd);
  - the subagent runtime: SubagentStart / SubagentStop now carry the MAIN
    session's `transcript_path` alongside the subagent's `agent_transcript_path`
    (the two are distinct), and a subagent's own internal hooks carry the child
    transcript.
  New single-source duck-typed helper `resolveTranscriptPath(store, sessionId)`
  (also now backing `agent_transcript_path`); absent for non-path stores /
  persistence off, so nothing is fabricated. Tests in engine.test.ts,
  subagents.test.ts, sessions-v2.test.ts.


Bug fix: `agent_transcript_path` was undefined on SubagentStop under an injected
external session store.

- **fix: `MirroringSessionStore` did not forward `filePath` to its wrapped local
  store.** `runtime.ts` populates the SubagentStop hook's `agent_transcript_path`
  by duck-typing `store.filePath(agentId)` — a `JsonlSessionStore` concretion
  that is not on the `InternalTranscriptStore` interface. `MirroringSessionStore`
  (the wrapper used whenever an external `sessionStore` is injected) lacked
  `filePath` and never forwarded, so the field stayed `undefined` for those
  consumers even though the local `JsonlSessionStore` had written the transcript
  under `<agentId>.jsonl`. Added a duck-typed `filePath(sessionId)` passthrough
  that forwards to `this.local` when it exposes `filePath` and returns
  `undefined` otherwise (InMemorySessionStore / bare stubs unaffected), mirroring
  the exact cast shape `runtime.ts` uses. Tests in sessions-v2.test.ts.


Windows bug fix: Bash persistent-state wrapper corrupted by backslash state dir.

- **fix: every foreground Bash call failed on Windows with `cat: '"/cwd"': No
  such file` + exit 127.** `withPersistentState` embedded the mkdtemp state dir
  into its bash wrapper verbatim; on Windows mkdtemp returns a backslash path
  (`C:\Users\…\bpt-shell-X`), and those backslashes corrupt the double-quoted
  `"$__bpt_state/cwd"` expansion, so the cwd/env replay-capture read/wrote a
  mangled path and the whole wrapper (and the wrapped command) failed. The state
  dir is now forward-slashed (`\` → `/`) for the SCRIPT form only — bash/msys
  accept forward-slash paths on Windows. The Node layer keeps the original OS
  path (mkdtemp/rmSync/`join` take either separator). No-op on POSIX. Reported
  by BPT (2026-07-08). Tests in bash-dx.test.ts; existing spawn-level persistence
  tests (shells.test.ts) cover the POSIX regression.

## 0.18.0 — 2026-07-07

Official-semantics audit follow-up: structured outputs — COMPAT honesty +
native `output_config` on the wire (finding C9).

- **docs (C9): `outputFormat` was mislabeled `FULL` in COMPAT.** It was actually
  enforced OFF the wire (system-prompt instruction + a local lenient validator +
  a bounded re-prompt), with no server-side guarantee — the official feature is
  `output_config: { format }` + `messages.parse()`. The COMPAT row is now
  `PARTIAL` and states this plainly.
- **feat (C9): native `output_config.format` on the wire, opt-in.** A new
  `outputFormat.native: true` ALSO forwards the schema as the official Messages
  API `output_config: { format: { type:'json_schema', schema } }`, for the
  server-side format guarantee. Threads `OutputFormatConfig.native →
  EngineConfig.outputFormat → StreamRequest.output_config`; the transport already
  serializes any request field verbatim. It is **off by default**: native
  structured outputs are supported-models-only (Fable 5 / Opus 4.8 / Sonnet 5 /
  Haiku 4.5 / Opus 4.5·4.1) and constrain the schema to a documented subset, so
  an unconditional send would 400 on older models / richer schemas. The local
  validator keeps running as the complement/fallback, so opting in never loses a
  constraint (`minLength`/`minimum`/… that the native subset doesn't enforce are
  still caught locally). Tests in engine.test.ts (wire assembly, opt-in gating)
  and structured-output.test.ts (`native` normalization).

## 0.17.0 — 2026-07-07

Official-semantics audit follow-up: `tool_choice` on the wire (finding C10).

- **feat (C10): `tool_choice` / `disable_parallel_tool_use` now reach the wire.**
  `Options.toolChoice` (new) is forwarded verbatim as the Messages API
  `tool_choice` param on every request that advertises tools, so a caller can
  force a specific tool (`{type:'tool', name}`), force some tool (`{type:'any'}`),
  forbid tools (`{type:'none'}`), or cap a turn at one tool call
  (`disable_parallel_tool_use: true`). It is omitted when the request carries no
  tools (the API 400s on `tool_choice` with an empty tool set). Threads
  `Options.toolChoice → EngineConfig.toolChoice → StreamRequest.tool_choice`; the
  transport already serializes any request field verbatim. Tests in
  engine.test.ts (loop assembly + the empty-tools guard) and transport.test.ts
  (wire-body serialization).

## 0.16.0 — 2026-07-07

Official-semantics audit fixes, batch 2 (pricing + streaming + replay repair).

- **fix (C1): 1h cache writes were billed at the 5-minute rate** (1.25x instead
  of 2x base) — undercounting cost ~37.5% and letting a run overshoot
  `maxBudgetUsd`. `estimateCostUsd` now takes the run's `cacheTtl` (sourced from
  config; our SDK sets one TTL per request) and prices 1h at input×2.
- **fix (S1): cloud-provider model ids costed $0** — `us.anthropic.claude-…`
  (Bedrock) and `claude-…@vertex` (Vertex) matched no price prefix, so cost was
  0 and `maxBudgetUsd` was silently unenforced. `normalizeModelId` strips the
  cloud prefix/suffix before matching.
- **fix (S5): `claude-fable-*` costed $0** — added a Fable price entry (input
  $10 / output $50 per MTok).
- **fix (S2): `citations_delta` was silently dropped** — citations now collect
  onto the text block (`TextBlock.citations`).
- **fix (S3): a missing `partial_json` fragment poisoned tool input** — a
  non-conformant frame appended the literal `"undefined"`, breaking JSON.parse;
  now guarded (`?? ''`).
- **fix (C7): API-summary compaction to a distinct model silently 400'd** — the
  summary prefix carried session-model-signed thinking blocks that the (deliberately
  different) `compaction.model` rejected, so `useApiSummary` degraded to the
  deterministic fold every time. Thinking is now stripped from the summary prefix.
- **fix (C8/S4): `repairPairing` could manufacture a role-alternation 400** —
  dropping a mid-transcript assistant turn welded two user turns together (and a
  dropped user turn could weld two assistant turns). A new pass 3 merges
  consecutive same-role turns so a resumed history always alternates.
- +8 tests. `tsc`/`build` exit 0; full suite 1469 green.

## 0.15.0 — 2026-07-07

Official-semantics audit fixes, batch 1 (stop-reason + model alias). See
`Public-Info-Pool/Resource/repo-engineering/bpt-sdk-official-semantics-audit-20260707.md`.

- **fix (C3): `fable` model alias resolved to `claude-sonnet-5`** — a silent
  wrong-model substitution (wrong price tier + capabilities). Now resolves to
  `claude-fable-5`.
- **fix (C4): `pause_turn` was dropped as a completed success** — a long
  agentic / server-tool turn paused by the API was reported as done, silently
  truncating the answer. The engine now persists the partial turn and RE-STREAMS
  to continue it (bounded by `maxTurns` so a runaway pause can't loop forever).
- **fix (C5): `refusal` was surfaced as a normal `success`** — a safety decline
  (Fable 5 / newer, HTTP 200 + `stop_reason: refusal`) was handed back as a
  valid answer and, in structured-output mode, retried against the still-refusing
  model until the retry cap. It now yields a dedicated ERROR result
  (`error_code: 'refusal'`), never a success. **Behavioral change** — a refusal
  is now an error result, not a success with empty text.
- **fix (C6): a `max_tokens` cut mid-tool-use persisted an unpaired `tool_use`** —
  poisoning the next same-session request with a 400 ("tool_use ids without
  tool_result"). The orphan `tool_use` is now dropped from the persisted
  natural-end turn (the yielded message is unchanged).
- +4 engine tests. `tsc`/`build` exit 0.

## 0.14.0 — 2026-07-07

- **fix (cross-model thinking-signature 400, BPT request 2026-07-07)**: root-cause
  fix for `400 invalid_request_error: Invalid signature in thinking block`, which
  killed a conversation on every turn once the run switched models (fallback) or
  resumed under a different model — the historical `thinking` blocks were signed
  by the original model and fail verification on any other. The engine now tracks
  each assistant turn's SIGNING model (a non-enumerable Symbol stamp that never
  reaches the wire) and, at the single outgoing-assembly choke point, strips
  `thinking`/`redacted_thinking` from every CLOSED history turn whose signer ≠ the
  target model. This mirrors Anthropic's own replay contract (same model → pass
  back as-is; different model → drop). `text`/`tool_use`/`tool_result` are never
  touched; same-model turns pass through byte-identical (cache-safe). Covers both
  the in-run fallback switch and the resume-to-another-model path (an unstamped
  resumed turn is treated as stale and stripped).
  - **hard edge (mid-tool-loop switch)**: the in-flight tool-loop turn's thinking
    is API-REQUIRED (can't be stripped) yet would fail signature verification on
    the fallback model. Rather than retry into a guaranteed 400, the engine now
    WITHHOLDS the fallback switch mid-tool-loop and surfaces the original error as
    a clean `error_during_execution` result — no 400 loop, no double tool
    execution. (Auto-recovering read-only rewind-restart is a scoped follow-up.)
  - No consumer action required — previously-failing cross-model conversations now
    just work. +13 tests; full suite 1460 green; `tsc`/`build` exit 0.

## 0.13.0 — 2026-07-07

Five keeper-directed optimizations (correctness + concurrency + DX), each with
tests. Full suite 1447 green; `tsc`/`build` exit 0.

- **fix (Grep — no more silent truncation)**: `count` and `files_with_matches`
  now default to COMPLETE results (they emit one small entry per file, so the
  old flat 250-cap silently reported a WRONG count / partial file list on repos
  with >250 matching files). `content` keeps the 250 flood guard. ALL modes now
  ANNOUNCE cap-induced truncation with a footer (`results truncated at
  head_limit=N; … set head_limit=0 for the complete result`) instead of quietly
  returning a prefix. Explicit `head_limit` still bounds every mode.
- **feat (Grep full-scan telemetry)**: each Grep emits a `grep.scan mode=…
  files_total=… files_scanned=… full_scan=… early_stop=…` line on the debug
  channel, so a host can measure the full-scan share of its Grep traffic (the
  driver of the pure-JS-vs-ripgrep cost).
- **feat (BPT-EXTENSION): `runConcurrent(mgr, tasks, opts)`** — drives many
  `mgr.query()` conversations in parallel (bounded by `concurrency`, default 8)
  with per-task failure isolation and index-aligned outcomes. Closes the
  pull-driven footgun where `for (…) { for await (…mgr.query()) }` runs
  sequentially. Exports `ManagedTask` / `RunConcurrentOutcome`; see
  `docs/CONCURRENCY.md`.
- **feat (BPT-EXTENSION): `provider.maxConcurrentRequests`** (env
  `BPT_MAX_CONCURRENT_REQUESTS`, default 0 = unlimited) — a FIFO counting
  semaphore in the transport caps concurrent in-flight Messages API requests, so
  a large multi-conversation fan-out over one shared transport does not thrash
  the rate limit. A request holds its slot for the whole streaming lifetime.
- **test (MCP concurrency hardening)**: a stress test proves 50 concurrent
  `callTool` over ONE stdio connection each route to their own response by
  JSON-RPC id (no cross-talk), and that one rejected id never corrupts sibling
  responses — confirming the shared-MCP-pool multiplexing that SessionManager
  relies on. (Mechanism was already correct; this locks it.)

## 0.12.0 — 2026-07-06

- **P2 PARTIAL-closure pass**: a row-by-row re-audit of every `docs/COMPAT.md`
  PARTIAL entry against the current source reconciled the stale rows to FULL
  (code was already at parity, mostly from the v0.7 campaign) and closed 8
  implementable REAL-GAPs with code + tests:
  - **feat**: Edit now enforces the official read-before-write gate (refuses to
    edit a file this session has not Read, matching Write and the official Edit
    tool). **Behavioral change** — see MIGRATION §P2.
  - **feat**: `stream_event` (`SDKPartialAssistantMessage`) carries the official
    `ttft_ms?`, attached once the first token latches.
  - **feat**: the `PostToolBatch` hook input carries the official `tool_calls[]`
    (`{tool_name, tool_input, tool_use_id}` each) alongside the now-deprecated
    `tool_names` (additive/dual-track).
  - **feat**: `SubagentStop` populates the official-required
    `agent_transcript_path` when the child transcript is on a path-backed store.
  - **feat**: `thinking.display` ('summarized'|'omitted') is forwarded onto the
    wire thinking param (adaptive + enabled forms).
  - **feat**: `debugFile` is now honored — debug lines are best-effort appended
    to the file (was accepted-and-ignored).
  - **feat**: `mcpServerStatus().scope` tracks config provenance
    ('project' / 'local' / 'dynamic').
  - **chore**: `maxThinkingTokens` carries the official `@deprecated` tag.
  - Deferred (honest, non-structural): Read `.ipynb` cell rendering (still raw
    JSON) and the legacy `sse` MCP transport (being retired upstream).
  - +13 tests (1427 total green); `tsc`/`build` exit 0.

## 0.11.0 — 2026-07-06

- **feat (public built-in tool metadata, black-pool ContextRing request
  2026-07-06)**: new package export `enumerateBuiltinToolMetadata(cfg?)` — a
  zero-side-effect, read-only projection of the default built-in tools as
  `{ name, description, inputJsonSchema }[]`. Internally it constructs the same
  set as `createBuiltinTools()` and maps each entry; no `execute` is ever
  called, no MCP server connects, no filesystem or network is touched. The
  `inputJsonSchema` field name (not `inputSchema`) matches the SDK MCP tool
  metadata shape, so a host can size the built-in tool block through the SAME
  token-estimation / context-composition path it already uses for MCP tools —
  turning what was a ~60K "residual" estimate into a per-tool breakdown.
  - `cfg` mirrors `createBuiltinTools`: `env` selects the task surface
    (`CLAUDE_CODE_ENABLE_TASKS=0` → TodoWrite instead of the Task quartet,
    changing which tools appear), `sandbox` swaps Bash's description+schema for
    the sandbox-aware form, `readLimits` is accepted for signature parity.
  - Exported type `BuiltinToolMetadata` rides the package entry. No source
    behavior changes — additive read surface only.

## 0.10.0 — 2026-07-06

- **feat (Read total-output cap, BPT request 2026-07-06)**: Read now caps the
  TOTAL characters it returns (default 50000), closing the tail gap where a
  2000-line file of medium-length lines could flood the context past the line
  and per-line limits (observed p99 ~90K chars; ~2% of reads exceed 50K). The
  cap applies on a LINE BOUNDARY (never mid-line); since every line is already
  ≤2000 chars, 50000 > 2000 guarantees ≥~25 lines, so output is never empty and
  offset continuation never dead-loops.
  - **footer consistency**: when the char cap (or the line limit) truncates, the
    footer reflects the REAL last line returned and the reason —
    `(Showing lines 1-N of Z; output truncated at 50000 chars. Use offset=N+1 to
    continue reading.)` — never claiming more lines than were emitted.
  - **per-line truncation is now marked**: an over-long line carries
    `…[line truncated: N chars total]` instead of a silent 2000-char slice, so
    the model doesn't mistake a half-line for the whole (correctness, not tokens).
  - **Grep hint**: a large file (>256KB) truncated with long lines nudges toward
    Grep instead of paging.
  - **configurable (§E)**: `options.readLimits: { maxOutputChars?, maxLineChars? }`
    (mechanism in the SDK, numbers are the caller's); also `createReadTool(limits)`
    / `createBuiltinTools({ readLimits })`. `SDKResultMessage` unaffected.
  - **Behavior note**: consumers that relied on Read returning >50000 chars in
    one call now get a truncated window + a continue footer; pass
    `readLimits: { maxOutputChars: <large> }` to opt out. Image/PDF/binary/empty
    reads are exempt (they return before the cap logic).

## 0.9.0 — 2026-07-06

- **feat (BPT-EXTENSION): SessionManager — in-process shared coordination +
  supervised recovery** (proposal `Public-Info-Pool/Resource/proposal/
  bpt-sdk-session-manager-20260706.md`). `createBptSession(options)` returns a
  manager that hosts multiple `mgr.query()` conversations over ONE shared
  transport + ONE shared MCP registry (connect once, multiplex — no more N×
  connections for N conversations); `mgr.usage()` aggregates cost/tokens
  read-only; `mgr.close()` is the single reaper. Ownership contract: queries
  BORROW shared connections and never tear them down; a borrowed registry
  no-ops closeAll and rejects setServers. Standalone `query()` is unchanged
  (sugar over a private manager). Per-query `provider`/`mcpServers` on a
  managed query are rejected (D1: shared-only in v1). The official Agent SDK
  has no in-process coordinator (its coordination lives in the wrapped CLI).
- **feat: supervised auto-resume**. When a managed query has a `sessionStore`
  and `recovery.autoResume !== false`, a RECOVERABLE failure (APIConnectionError,
  MCP connection-class McpError, or APIStatusError 429/5xx — classified by the
  stable E6c error `code`, never message text) is transparently re-driven from
  the store via resume, up to `recovery.maxResumes` (default 2). Terminal
  failures (abort/config/4xx/unknown — fail-closed) are forwarded/rethrown
  untouched; on exhaustion the last error carries `resumeAttempts`. A
  `system/status` observability message is emitted before each re-drive. The
  engine surfaces API failures as an `error_during_execution` RESULT (not a
  throw), so the supervisor watches error results; `SDKResultMessage` gains an
  additive `error_code` field carrying the underlying stable code.
- **feat: write-ahead turn checkpoints**. A persisting query brackets each
  engine turn with `pending_turn` / `turn_complete` store records; a resume
  whose transcript ends with a dangling `pending_turn` re-drives that request
  segment before consuming new input — never replaying already-executed tools
  (their tool_results are already paired in the replayed history).
- **feat: built-in `fileSessionStore(dir)` / `FileSessionStore`** — durable
  JSONL session store (one file per session, reversible path-safe encoding,
  torn-tail tolerant) satisfying the public `SessionStore` contract, so
  durable persistence + crash recovery is a one-line opt-in.
- **feat (DX): Bash cmd-habit correction**. On Windows the Bash description
  gains a registered note (POSIX bash, not cmd — ls/cp/mv, forward slashes);
  on any platform an exit-127 failure whose first command word is cmd-only
  (copy/move/del/erase/xcopy/robocopy/findstr/cls/md/rd/ren) gets a corrective
  hint appended (dir/type excluded — real coreutils/builtin, zero false
  positives).
- Migration: none required — all additions are additive. Consumers switching
  on `SDKResultMessage` may read the new optional `error_code`.

## 0.8.1 — 2026-07-05

- **fix (CRITICAL — thinking model-gate)**: the `claude_code` preset default no
  longer sends `thinking: {type:'adaptive'}` to models that reject it. Adaptive
  is a 4.6-generation API capability; pre-4.6 models (Haiku 4.5, Sonnet 4.5/4,
  Opus 4.5/4.1/4, 3.x) 400 on it and require `{type:'enabled', budget_tokens}` —
  and 4.7+ models are the mirror image (budget_tokens 400s). v0.7's
  unconditional-adaptive default (E7-01) therefore 400'd **every** request on
  any pre-4.6 model: the first real L5 round on haiku-4.5 (run 28753349435) was
  0/40, turns=0, cost=$0 while the official arm ran clean. `computeThinking` now
  emits, per LIVE model (recomputed each turn), whichever form the API accepts;
  the boundary is `src/engine/thinking-model.ts` (`supportsAdaptiveThinking`).
  Keyless unit tests missed this because they stub the transport — added
  thinking-model + conformance-l2 wire-form regression locks so the next one
  reds CI. No public API change.

## 0.8.0 — 2026-07-05

- **feat (BEHAVIOR REVERSAL, bump-pin ruling)**: an OMITTED `settingSources`
  now loads **user+project+local** (CLAUDE.md / AGENTS.md / project `.mcp.json`),
  matching official Claude Code and the live `@anthropic-ai/claude-agent-sdk`
  docs. This flips the earlier pinned-0.3.199 default (omitted = load nothing) —
  the last behavior-level NEW-IN-DOCS hold, gated behind the keeper up-pin
  decision because a default flip diverges from the pinned conformance arm.
  An explicit array is honored verbatim: `settingSources: []` is the explicit
  opt-OUT (load nothing); an explicit subset loads exactly that subset. Single
  source of truth: `src/internal/setting-sources.ts` (`resolveSettingSources`).
  Migration: callers who omitted the field to get "no on-disk sources" must now
  pass `settingSources: []` to keep that behavior. See MIGRATION.md §5g.
  (skills/plugins loading remains a separate PARTIAL — unchanged here.)

## 0.7.1 — 2026-07-05

- **feat (BPT-EXTENSION)**: `provider.cacheTtl?: '5m' | '1h'` selects the
  prompt-cache lifetime for the breakpoints this engine places. Omitted / '5m'
  keeps the bare `{ type: 'ephemeral' }` marker (5-minute default, byte-
  identical to before — wire ratchet unaffected); '1h' stamps `ttl: '1h'` on
  every breakpoint (2x write price, GA — no beta header). The official Agent
  SDK exposes NO cache-TTL knob (its wrapped CLI decides internally and only
  reports the 5m/1h split in usage); this direct-API engine lets the caller
  choose. No effect when `promptCaching` is false.

## 0.7.0 — 2026-07-05

Completion-inventory full-implementation batch (keeper ruling 全面实现);
BREAKING items are detailed in MIGRATION.md §4/5f. Built on 0.6.5 (this
branch merged main's 0.6.3–0.6.5 Windows/path-fence work below).

- **BREAKING (observability)**: ten reversed discriminants (task_* /
  hook_* / files_persisted / local_command_output / commands_changed)
  now emit and type as official `{type:'system', subtype:...}` with
  payloads aligned to the 0.3.201 snapshot; `cancelled`->`killed`; four
  export names flip to official spelling (deprecated aliases kept).
- **BREAKING (results/types)**: setMcpServers returns added/removed/
  errors; rewindFiles returns canRewind/error/filesChanged (unknown ids
  soft-fail); SDKResultMessage.stop_reason required on both arms;
  McpServerStatus.tools is the official object array; 22 official
  Options fields enter the type surface. See MIGRATION 5g-5l.
- **feat (wire, E7-01/E7-02)**: `claude_code` preset defaults thinking
  to `{type:"adaptive"}`; Read gains `pages`, Bash always exposes
  `dangerouslyDisableSandbox` (gate unchanged), Agent tool gains
  `model`/`isolation:'worktree'` and the official required set.
- **feat (tools)**: Task quadruplet (TaskCreate/TaskGet/TaskUpdate/
  TaskList) ships as the default task surface per official 0.3.142
  semantics (`CLAUDE_CODE_ENABLE_TASKS=0` reverts to TodoWrite);
  ExitPlanMode, EnterWorktree, Monitor, and Workflow ship, bringing the
  built-in surface to 20/24.
- **feat (types)**: ToolInputSchemas/ToolOutputSchemas exported; official
  type-name aliases; deferred_tool_use official id/name/input dual-track;
  CanUseTool requestId required; Grep `context` alias; tool() accepts the
  official extras wrapper; session rename/tag round-trips (SDKSessionInfo
  customTitle/tag/gitBranch); removeDirectories and suppressOutput honored.
- **feat (resilience)**: maxRetries 4->10 (env-capped 15), stream
  watchdog 120s->300s (env floor), new background-subagent stall
  watchdog (600s default, env-tunable, reports stalls as failed).
- **feat (errors)**: McpError taxonomy over 12 bare throws, stable
  machine-readable `code` on every error (docs/ERRORS.md), throw-
  discipline guard test; sse_malformed_frame/stream_idle_timeout wired.
- E7-03 cache-breakpoint divergence measured and kept as a documented
  KD (premise-locked); wire ratchet shrinks to Agent:params (BPT `fork`
  extension) + placement/thinking residuals.

## 0.6.5 — 2026-07-05

- **fix (Windows)**: foreground Bash termination (timeout/abort) used the same
  POSIX-only `process.kill(-pid)` process-group call as the background
  KillShell bug — a no-op on Windows with the failure swallowed. Now routes
  through planProcessKill (win32 -> taskkill /T /F). Found by the new guard,
  not a fourth pilot report.
- **test/guard**: posix-hazard static guard (`tests/posix-hazard-guard.test.ts`)
  scans src/ for engine-code Windows hazards below the tool interface
  (`process.kill(-pid)`, bare `spawn('bash'/'sh')`, hardcoded `/tmp`); an
  unmarked hit reds CI. Legit platform-branched sites carry a `win-ok:` marker.
  Machine prevention for the POSIX-first-Windows-afterthought defect class.

## 0.6.4 — 2026-07-05

- **behavior/security (keeper ruling, BPT report #2)**: Read/Write/Edit no
  longer enforce a hard cwd+additionalDirectories path fence — they resolve
  paths and reach any location the process can, with the PERMISSION GATE as
  the sole access control (official Claude Code posture). The v0.1 fence was
  BPT-specific, inconsistent (Grep/Glob/Bash never had it), and — with Bash
  present — never a real security boundary, only a false sense of one.
  `fsutil.resolveWithin` -> `resolveAbs`. `additionalDirectories` keeps its
  real role (sandbox writablePaths). Consumers relying on the fence as a
  security control must use `permissionMode` / `canUseTool` instead.

## 0.6.3 — 2026-07-05

- **fix (Windows)**: KillShell now actually terminates background shells on
  Windows (`taskkill /PID <pid> /T /F`) instead of the POSIX-only
  `process.kill(-pid)` that silently no-op'd; the swallowing empty catch is
  gone (failures go to debug). (BPT Windows pilot incident #3)
- **fix (honesty)**: background-shell terminal status is decided at exit from
  what actually happened, never forced to 'killed' when kill() is called — a
  job that runs to completion reports `completed` even if a kill lost the
  race (previously marked 'killed' forever). New `kill-plan.ts` pure
  functions (`planProcessKill`, `terminalStatus`) unit-test both the Windows
  branch and the status rule on any host.

## 0.6.2 — 2026-07-05

- **fix (Windows)**: Bash tool shell resolution — `CLAUDE_CODE_GIT_BASH_PATH`
  honored, Git for Windows probed at standard locations, actionable guidance
  instead of `spawn sh ENOENT`; bare `bash` never tried on Windows (WSL trap).
  (#479, BPT Windows pilot incident #2)
- **fix (MCP)**: server-initiated `elicitation/create` with NO `onElicitation`
  handler now auto-declines on the wire as documented (the guard that made the
  decline branch dead code removed; previously replied `-32601`). (#477)
- test-only alongside: official pins chased 0.3.199 -> 0.3.201, zero
  conformance drift (#478).

## 0.6.1 — 2026-07-05 (retroactive label)

- **fix (transport)**: gateway SSE dialect tolerance — consumption stops at
  `message_stop` (official-client lifecycle); event-less non-JSON frames
  before stop are skipped; malformed NAMED frames still throw, now with
  evidence (event, frame count, data snippet). Closes the BPT production
  incident `Malformed SSE payload for event "(none)"` behind the idealab
  gateway. (#461)
- **feat/behavior (engine alignment batch E1–E5)**: `claude_code` preset
  defaults extended thinking ON; Write enforces the official
  read-before-write gate; `maxBudgetUsd` stops BEFORE executing an
  in-flight tool group; truncated turns degrade gracefully (salvage complete
  blocks); **breaking**: `result` messages report official per-result
  semantics (`num_turns`/`usage` per result, cost/apiMs cumulative — see
  MIGRATION 5e). (#462)

## 0.6.0 — 2026-07-05

- v0.6 feature series: generators/classifiers as shipped product features
  (`src/generators/`), verifier (`src/verifier/`), context tips (`src/tips/`),
  memory-file selection, hook condition gating, worker-fork preset, default-on
  Bash sandbox (pluggable bwrap backend), prompt assembly layer Track B with
  v5 as the `claude_code` preset default.

---

_The 0.1–0.5 entries below are retroactive: the foundational series shipped on
2026-07-04 without a per-merge ledger, so these are reconstructed from the
commit sequence and their granularity stops at the commit-title level. 0.6+ above
is the real per-merge record._

## 0.5 — 2026-07-04

- Productization + docs series: generators + classifiers scaffolding
  (`src/generators/`); verifier + context tips; the prompt-assembly layer with
  the `v5` `claude_code` preset (open reproduction of the official main-loop
  prompt); the COMPAT compatibility matrix, the MIGRATION guide, and the
  positioning docs.

## 0.4 — 2026-07-04

- Interaction + subagents: AskUserQuestion + WebSearch + host callbacks
  (`onUserQuestion` / `webSearch` / `onElicitation`); tool permission
  specifiers with `allowedTools` / `disallowedTools` rule-level gating;
  subagent Task tool + worker fork.

## 0.3 — 2026-07-04

- Persistence + credentials: JSONL session store (`resume` / `continue` /
  `forkSession`); the `provider` extension + gateway (Bearer-token) auth —
  connection settings the official SDK does not expose.

## 0.2 — 2026-07-04

- Gating + external tools: permissions + hooks + `canUseTool` gating; MCP
  client with stdio + streamable-HTTP transports.

## 0.1 — 2026-07-04

- Engine skeleton: clean-room scaffold; the direct Messages-API transport
  (`fetch` + SSE) + agent engine loop; the six built-in tools
  (Read/Write/Edit/Bash/Glob/Grep). No filesystem settings are loaded
  (`settingSources` accepted but inert).
