# Memory governance, incognito sessions and the structured tool-call log (spec S1–S6)

Archived requirements + implementation record for the 2026-07-11 keeper
dispatch《Silver Core SDK 需求说明:记忆系统、隐私治理与会议记录支持》(Draft v1,
source: the BPT memory-system discussion series — recall → voice input →
team/personal governance → incognito → meeting notes). This layer sits ON TOP
of the memory system itself (spec R1–R9, `docs/MEMORY.md`): R1–R9 built the
tool; S1–S6 make it governable in a multi-user application.

Problem statement (from the dispatch): BPT is implementing a three-layer
memory architecture (L1 hand-written instruction cards / L2 model-written
working memory / L3 nightly synthesis) with team/personal partitioning under
"radical transparency + an incognito escape hatch". The SDK lacked three
pieces of infrastructure — memory permission routing, an incognito session
primitive, and a structured tool-call log — without which the application can
only approximate those guarantees in fragile prompt-level ways.

Status: **S1 + S2 + S3 (all P0) and S4 (P1) shipped in v0.48.0.** S5 is
satisfied by existing per-query composition (documented below, no new
runtime); S6 is an architectural reservation honored by the S3 record design.

## S1 — Memory scope routing and permission enforcement (P0, shipped)

`options.memory.mounts` declares which `/memories` subtrees a query may touch
and with what rights:

```ts
const q = query({ prompt, options: {
  memory: {
    mounts: [
      { path: '/memories/team',        mode: 'read-only'  },
      { path: '/memories/users/alice', mode: 'read-write' },
    ],
  },
}});
```

Semantics (enforced at the SDK tool layer in `src/tools/memory/memory-tool.ts`,
AFTER R4 path validation and BEFORE the store is called — never via the system
prompt):

- **Write commands** (create / str_replace / insert / delete / rename) must
  target a `read-write` mount. A write into a read-only mount returns a
  structured error naming the writable mounts; a write outside every mount
  returns an error naming all mounts, so the model can reroute.
- **rename is gated at both ends** — moving a file OUT of read-only territory
  is a write there too.
- **Nesting: the most specific mount decides** (audit 2026-07-17 H2-3). A
  read-only mount nested inside a read-write one protects its subtree —
  the read-write ancestor does not override it — and, symmetrically, a
  read-write mount nested inside a read-only one keeps working. Duplicate
  declarations of the same path resolve read-only (restrictive). A recursive
  delete (or rename-away) whose target subtree CONTAINS a read-only mount is
  rejected with a structured error naming the protected areas, so read-only
  territory cannot be destroyed by deleting its ancestor.
- **Reads** must land inside a mount. A strict ANCESTOR directory of a mount
  (e.g. `/memories` itself) stays viewable so the protocol's "view your memory
  directory first" navigation works, but its listing is FILTERED to entries on
  the path to (or inside) a mount: user A's session never sees user B's
  directory names. Viewing a non-mounted sibling path directly is rejected.
- **Resident index (R6)** only injects when `/memories/MEMORY.md` is readable
  under the mounts — the injection is a read and obeys the same routing.
- **No `mounts`** = unrestricted `/memories` (pre-S1 behavior). An empty array
  is a `ConfigurationError` (it would make everything inaccessible); so are
  malformed mount paths and modes.

Mounts are **per-query state**: the embedder instantiates them from its own
session context, which is what the acceptance demanded ("挂载点按会话上下文
实例化而非全局固定"). Traversal attacks (`../`, absolute paths, URL-encoded
variants) are rejected by the R4 layer before mounts are even consulted.

Acceptance mapping (tests: `tests/memory-mounts.test.ts`):

- [x] writes against `/memories/team` (ro) → structured rejection
- [x] reads/writes in the session's own rw mount → pass through
- [x] `../` / absolute escapes → rejected (R4 stacks under S1)
- [x] enforcement at the SDK layer, zero prompt dependence
- [x] user A cannot read or write user B's directory (incl. filtered listings)
- [x] nested ro-in-rw mounts protected (most-specific precedence + subtree
      delete/rename guard, audit 2026-07-17 H2-3)

## S2 — Incognito session primitive (P0, shipped)

`options.incognito: true` makes the "exists only in memory" promise a
one-flag SDK guarantee:

1. **Memory degrades to read-only** — `view` stays available ("knows you,
   doesn't record you"), the five write commands return the exported
   `INCOGNITO_MEMORY_ERROR` constant. RATIFIED (keeper ruling
   2026-07-12 Beijing, todo T27): read-kept IS the settled default. The
   de-personalization variant ("don't even read memory this time") stays a
   consumer-side option — `disallowedTools: ['memory']` or
   `memory: { enabled: false }` — no SDK change needed.
2. **Zero SDK-side persistence** — the session transcript is not written
   (`persistSession` forced off), no `tool_call` records (S3) are written, and
   both R7 memory write rounds (compaction flush, session-end progress card)
   are disabled. Combining with `sessionStore` is a `ConfigurationError`.
3. **Data-source-level exclusion** — downstream consumers that read sessions
   through the SDK surfaces (`listSessions` / `getSessionMessages` /
   `getSessionToolCalls`) see nothing for the session: there is no transcript
   to scan, not merely a filtered one.

Promise boundary (state this in any consumer-facing copy): incognito means
**nothing enters SDK storage or the memory store**. Requests are still sent to
the configured model API and remain subject to its commercial terms; files the
model edits in the WORKSPACE via Write/Edit/Bash are the user's own actions
and are outside this promise (as is any consumer-configured `debugFile`, which
carries metadata-level lines).

The leak-test checklist from the dispatch runs as integration tests
(`tests/incognito.test.ts`): a lured write is rejected with zero memory
artifacts; a unique marker token ("purple-whale-protocol") greps to zero
residue across every SDK-writable root after the run; the same script WITHOUT
incognito does persist (the test discriminates); export surfaces return empty.

## S3 — Structured tool-call log (P0, shipped)

Origin lesson (from the dispatch): a real tool call whose transcript kept only
the text was later misjudged as a fabricated call. Text is not evidence;
dispatch-time telemetry is.

Every dispatched tool_use block — root loop AND subagents — now also persists
one `tool_call` record to the session JSONL, at the same level as the message
lines:

```json
{"type":"tool_call","uuid":"…","session_id":"…","seq":3,
 "timestamp":"2026-07-11T07:00:00.000Z","tool_use_id":"toolu_…",
 "tool_name":"memory","tool_input":"{\"command\":\"create\",…}",
 "status":"ok","duration_ms":12,"result_summary":"File created successfully…",
 "parent_tool_use_id":"toolu_task_…"}
```

- `status` 'error' covers execution failures, permission denials, hook stops
  and unknown tools alike (detail in `result_summary`); aborts record
  `[aborted]` before rethrowing, so the audit trail never loses a dispatched
  call.
- `tool_input` is JSON truncated at 2048 chars; the UNTRUNCATED input lives in
  the assistant message's tool_use block under the same `tool_use_id`, so full
  replay ("传了什么、拿回了什么") joins on that key. `duration_ms` spans the
  whole dispatch pipeline (hooks + gate + execution).
- `parent_tool_use_id` is stamped on subagent calls (the spawning Task block),
  keeping child work attributable in the same session file.
- Consumers read records back with `getSessionToolCalls(sessionId, options)`
  (local JSONL or an external `sessionStore`); `type` distinguishes tool calls
  from text without parsing natural language, and `timestamp`/`seq` keep them
  alignable with the message sequence — the Layer-3 synthesis contract.
- Persist-gated: `persistSession: false` and incognito (S2) write none.
- Recording is dispatch-time telemetry in the engine
  (`src/engine/tool-dispatch.ts` → `EngineDeps.onToolRecord` → the query
  layer's session append), never reconstruction from message content.

Tests: `tests/tool-call-log.test.ts`.

## S4 — Tool-claim verification helper (P1, shipped as a reference implementation)

`auditToolClaims({ assistantTexts, toolCalls, detectors? })` flags assistant
texts that CLAIM a tool action with no backing record in the S3 log;
`auditSessionToolClaims(sessionId, options)` is the persisted-session
convenience form (the "flag suspicious turns when the loop ends" entry point).

The default detector set covers memory-write claims in zh + en ("已写入记忆" /
"I've saved that to memory" / subject-less "saved it to memory"), backed only
by a SUCCESSFUL memory write command in the records — a failed write or a
`view` does not back a write claim. Detectors are consumer-extensible
(`ToolClaimDetector`: a claim regex + a record predicate). Heuristic by
design: false positives go to human review; the patterns are deliberately
broad because the spec prioritizes low miss rate ("误报可接受,漏报优先压低").
Session-scoped matching (not per-turn alignment) for the same reason: a claim
summarizing an earlier turn's real call must not be flagged.

Tests: `tests/tool-call-log.test.ts` (S4 describe block).

## S5 — Batch task runner and per-task model selection (P1, satisfied by composition)

No new runtime was added; the acceptance criteria fall out of existing
per-query composition, which this doc records as the supported pattern:

- **Non-interactive batch**: `query({ prompt, options })` with a string prompt
  IS the batch primitive (no interactive surface is required); callers loop
  over documents, with retry, and write outputs where they choose.
- **Per-task model**: `options.model` is per-query — a synthesis task on a
  strong model coexists with interactive sessions on another.
- **Per-task memory rights**: the S1 acceptance's own proof — the SAME store
  serves a user session (`/memories/team` read-only) and a synthesis task
  (`/memories/team` read-write) concurrently, because mounts are per-query
  (test: "a user session (team ro) and a synthesis task (team rw) coexist on
  the same store").

If a future dispatch wants a first-class runner (queueing, retry policy,
output layout), it builds on these three without further SDK hooks.

## S6 — Memory-entry metadata convention (P2, architectural reservation honored)

Nothing to implement in v1 by design. The reservation the spec asked for
holds: frontmatter conventions (date / source_session / supersedes) are
BPT-prompt-driven, and `source_session` is recoverable from the SDK side
because every write is now an S3 record carrying `session_id` + `timestamp` +
`tool_use_id` — "which session produced this entry" joins the memory file to
its writing session without any new SDK surface.

## Out of scope (per the dispatch's non-goals)

Real-time voice input (deferred), a semantic-retrieval/embedding stack (stays
retired), the STT engine itself, and any personnel-information filtering
system. The BPT-application-layer work items (L2 prompts, L3 synthesis
pipeline, meeting pipeline, STT selection, "view my memory" UI) live outside
this repository's SDK scope and are tracked in the dispatch document.
