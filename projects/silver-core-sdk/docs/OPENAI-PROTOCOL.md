# OpenAI protocol support (BPT-EXTENSION)

The SDK can drive an **OpenAI-compatible Chat Completions endpoint** instead of
the Anthropic Messages API. The engine — agent loop, tools, permissions, hooks,
sessions, compaction — keeps speaking Messages API shapes end to end; a
translating transport (`src/transport/openai.ts`) converts at the wire boundary
only:

```
request  : StreamRequest (Messages API shape)  ->  POST {base}/chat/completions
response : chat.completion.chunk SSE           ->  Anthropic stream events
```

This exists for host sovereignty: BPT Desktop (and any other consumer) can point
the same agent harness at api.openai.com, DeepSeek, vLLM, Ollama, or a corporate
one-api/new-api gateway whose primary surface is the OpenAI protocol — without
an Anthropic-protocol shim in front.

## Enabling

```ts
import { query } from 'silver-core-sdk';

for await (const msg of query({
  prompt: 'Summarize README.md',
  options: {
    model: 'gpt-4o',                       // a model the endpoint serves — REQUIRED
    provider: {
      protocol: 'openai-chat',
      apiKey: process.env.OPENAI_API_KEY,  // or OPENAI_API_KEY env fallback
      baseUrl: 'https://api.openai.com/v1' // or OPENAI_BASE_URL env fallback
    },
  },
})) { /* ... */ }
```

- **Credentials**: `provider.apiKey` / `provider.authToken` (both travel as
  `Authorization: Bearer`, the protocol's only scheme) > `OPENAI_API_KEY` env.
- **Base URL**: `provider.baseUrl` > `OPENAI_BASE_URL` env >
  `https://api.openai.com/v1`. The transport appends `/chat/completions`
  (OpenAI convention: the base includes `/v1`).
- **Model**: pass a full model id the endpoint serves. The Claude short aliases
  (`haiku`/`sonnet`/`opus` in AgentDefinition.model, `compaction.model`, and
  the generators' default utility model) resolve to Claude ids — on this
  protocol set those explicitly.

Gateway examples:

```ts
// DeepSeek (reasoning stream surfaces as thinking blocks)
provider: { protocol: 'openai-chat', apiKey: '...', baseUrl: 'https://api.deepseek.com/v1' }
// model: 'deepseek-chat' | 'deepseek-reasoner'

// Local vLLM / Ollama
provider: { protocol: 'openai-chat', apiKey: 'unused', baseUrl: 'http://127.0.0.1:8000/v1' }

// api.openai.com reasoning models (max_tokens is rejected there)
provider: {
  protocol: 'openai-chat', apiKey: '...',
  openai: { maxTokensParam: 'max_completion_tokens', reasoningEffort: 'medium' },
}
```

## Tuning (`provider.openai`)

| Option | Default | Meaning |
|---|---|---|
| `maxTokensParam` | `'max_tokens'` | Wire param carrying the output-token cap. api.openai.com reasoning models require `'max_completion_tokens'`; most gateways accept the default. |
| `reasoningEffort` | unset | Forwarded verbatim as `reasoning_effort` (the OpenAI-native reasoning knob; see thinking note below). |
| `extraBody` | unset | Extra top-level body fields merged into every request (gateway params, e.g. `{ enable_thinking: false }`). Translator-owned keys win on conflict. |
| `modelMap` | unset | Wire-model remapping `{resolvedId: endpointModel}` applied just before encoding — ONE knob that also catches the Claude defaults baked into generators / verifier / subagent aliases (e.g. `{'claude-haiku-4-5': 'gpt-4o-mini'}`). Unmapped `claude-*` ids log a debug warning. |
| `authHeaderName` | `'authorization'` | Credential header. The default sends `Bearer <key>`; any other name (e.g. Azure's `'api-key'`) sends the raw key under that header. |
| `extraQueryParams` | unset | Query params appended to the endpoint URL (e.g. `{'api-version': '2024-06-01'}` for Azure-style gateways). |

Related (on `provider`, not protocol-specific): **`provider.pricing`** — USD-per-MTok
entries keyed by model-id prefix, merged over the static Claude table. Setting it
makes cost metrics and `maxBudgetUsd` enforceable for non-Claude models.

**`provider.maxOutputTokens`** — per-request output cap (`max_tokens`, or the
configured `maxTokensParam`). The default is protocol-aware since v0.57.0:
**128000 on `openai-chat`** (the previous global 8192 starved agentic turns on
large-output gateway models), 8192 on `anthropic` (that API 400s a cap above
the model's ceiling and no per-model table is bundled). A gateway/model whose
ceiling is below the cap rejects the request with a clear `APIStatusError`
(HTTP 400, the server's own message preserved, not retried) — set the value
explicitly to match your endpoint. Cross-protocol caveat: a transport-switched
subagent (`resolveSubagentTransport`) inherits the parent's resolved cap, so an
openai-chat parent on the 128000 default routing a child to an Anthropic-route
Claude model will get that clear 400 — pass an explicit `maxOutputTokens`
when mixing protocols.

## Translation map

| Messages API | Chat Completions |
|---|---|
| `system` (string or blocks) | one `system` message (blocks joined with `\n`) |
| user `text` / `image` blocks | `text` / `image_url` content parts (base64 -> data URL; JPEG/PNG/GIF/WebP whitelist + base64 hygiene — see "Image input") |
| user `tool_result` blocks | `tool` role messages (emitted first, preserving protocol adjacency); images / base64 PDFs inside a result FAN OUT into the user message that follows, each labeled with its tool_call_id (the `tool` role is text-only) — see "Image input" |
| assistant `text` + `tool_use` | `content` + `tool_calls` (arguments JSON-stringified) |
| `tools[]` | `tools[]` (`type: 'function'`, `input_schema` -> `parameters`) |
| `tool_choice` auto/any/tool/none | `'auto'` / `'required'` / `{type:'function',...}` / `'none'`; `disable_parallel_tool_use` -> `parallel_tool_calls: false` |
| `output_config.format` (structured outputs) | `response_format: { type: 'json_schema', ... }` |
| `temperature` | `temperature` |
| response `content` deltas | `text` block deltas |
| response `tool_calls` deltas | `tool_use` blocks + `input_json_delta` |
| response `reasoning_content` / `reasoning` deltas (DeepSeek-style) | `thinking` block deltas (empty signature; never replayed to the wire) |
| `finish_reason` stop/length/tool_calls/content_filter | `stop_reason` end_turn/max_tokens/tool_use/refusal |
| `usage.prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens` | `input_tokens` (minus cached) / `output_tokens` / `cache_read_input_tokens` |

Retry policy (408/429/5xx + network errors, exponential backoff + jitter,
`retry-after` honored), the **empty-stream retry** (a clean HTTP 200 that
closes with zero SSE chunks — no `[DONE]`, no `finish_reason` — is a
replay-safe non-start, re-issued within the `maxRetries` budget rather than
crashing the turn; on exhaustion it throws `APIConnectionError` code
`empty_stream`), the stream idle watchdog, per-request timeouts and the
concurrency semaphore all mirror the Anthropic transport; the same
`ProviderConfig` knobs (`maxRetries`, `timeoutMs`, `streamIdleTimeoutMs`,
`maxConcurrentRequests`) apply. A mid-stream drop *after* chunks (a truncated
turn) is never retried — it degrades gracefully via the engine's E3 salvage.

Stream completion is decided from three independent facts, **not** the raw
chunk count: whether a `[DONE]` terminator arrived, whether an explicit
non-empty `finish_reason` arrived, and whether any **valid assistant content**
arrived. Valid content means at least one of: a non-empty `delta.content`, a
non-empty `delta.reasoning_content` / `delta.reasoning`, or a `tool_calls`
fragment carrying an id / function name / arguments. A stream is finalized only
when it saw an explicit `finish_reason` (protocol semantics preserved — an
empty-text `finish_reason:'stop'` is a legitimate completed message) **or** a
`[DONE]` paired with valid content. The degenerate **"empty finish"** — an
HTTP 200 that streams only role-only / usage-only metadata chunks (`chunkCount
> 0`) then closes with a bare `[DONE]`, carrying no content, no reasoning, no
`tool_calls` and no `finish_reason` (the idealab-gateway "turn stop /
hasAssistantMessage:false" shape) — is **never** finalized as an empty
`stop_reason: null` success. Because a *started* stream is not replay-safe it
is not retried either; it throws a diagnosable `APIConnectionError` code
`empty_message` (not flagged `turnReplaySafe` / `midStreamTruncation`), which
the engine surfaces as an `error_during_execution` result with
`error_code: 'empty_message'`. This is the OpenAI twin of the Anthropic arm's
degraded-`message_stop` guard (0.55.1); the zero-chunk case still self-heals
via the `empty_stream` retry above.

Non-2xx errors surface as `APIStatusError`
with the error type **normalized to Messages API vocabulary** by status
(`401 -> authentication_error`, `429 -> rate_limit_error`, ...) so engine-side
handling is provider-agnostic.

## Image input

The engine speaks Messages API image blocks end to end; this transport
translates them at the wire boundary (v0.55.2 hardening — previously a bad
image rode through unvalidated and failed opaquely at the gateway's
image-processing stage, e.g. `image_moderation_server_error`).

**Supported input** (user-turn content blocks):

```ts
// base64 (JPEG / PNG / GIF / WebP)
{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '<raw base64>' } }
// URL (http(s) or a ready-made data: URL) — passed through verbatim
{ type: 'image', source: { type: 'url', url: 'https://…' } }
```

**Conversion rule** (base64 → data URL):

```
{ type: 'image', source: { type: 'base64', media_type: M, data: D } }
  ->  { type: 'image_url', image_url: { url: `data:${M};base64,${D}` } }
```

- `media_type` is trimmed/lowercased and must be one of `image/jpeg`,
  `image/png`, `image/gif`, `image/webp` — anything else throws a
  `ConfigurationError` naming the offending type and its block path
  (`messages[i].content[j]`) before any network call.
- `data` is whitespace-normalized (line-wrapped base64 from file encoders
  would produce a malformed data URL); empty data, a nested `data:` prefix,
  or non-base64 characters likewise throw locatable `ConfigurationError`s.
  Nothing is silently dropped.
- Text blocks stay `{ type: 'text', text }`; block order within a message is
  preserved exactly (text/image/text mixes survive as-is). A message whose
  blocks are all text still collapses to a plain string (gateway-friendliest
  shape); any image forces the array-of-parts form.
- Debug logging is byte-free by design: one summary line per request with the
  protocol, image count, MIME types, base64 character counts, and outcome —
  never the base64 payload, credentials, or the request body.

**Cross-protocol difference**: on `protocol: 'anthropic'` the same blocks are
sent to the wire in their original Messages API shape (no `image_url`
anywhere); the OpenAI translation applies only on `protocol: 'openai-chat'`.

**tool_result attachments (v0.56.0 fan-out)**: the OpenAI `tool` role is
text-only, so images and base64 PDFs inside a `tool_result` (a screenshot an
MCP tool returned, an image file `Read` produced) are lifted into the user
message that follows the tool messages — each preceded by a text label tying
it back to its tool call (`[image #1 from tool call toolu_x]`), with a
forward-reference marker left in the tool body. Validation asymmetry, by
design: a malformed attachment in a tool RESULT degrades to an explicit
omission marker with the reason (a bad tool output must not brick the turn);
a malformed image/document in a USER turn throws the locatable
`ConfigurationError` above (caller-controlled input, fail fast).

**PDF documents (v0.56.0)**: base64 PDF `document` blocks translate to the
official Chat Completions `file` content part
(`{ type: 'file', file: { filename, file_data: 'data:application/pdf;base64,…' } }`,
filename from the block's `title`, default `document.pdf`); text-source
documents inline their text. Gateways that predate the `file` part will
reject it server-side — that is their protocol surface, not a silent drop.

**Current limits**: URL-source documents keep an honest text placeholder (no
Chat Completions equivalent); no size/dimension pre-validation (gateway
limits still apply); URL image sources are not fetched or validated
client-side.

## Honest limits

- **`thinking` config is dropped from the wire** — it has no Chat Completions
  equivalent. Use `openai.reasoningEffort` for OpenAI reasoning models.
  Incoming DeepSeek-style reasoning IS surfaced (as thinking blocks), so hosts
  render it; those blocks are stripped again on the next request encode.
- **`cache_control` breakpoints are stripped** — OpenAI-side prompt caching is
  automatic, not breakpoint-driven. Cached tokens are still accounted
  (`cache_read_input_tokens` from `prompt_tokens_details.cached_tokens`), but
  the `promptCaching` / `cacheTtl` knobs have no wire effect on this protocol.
- **URL-source document blocks degrade** to a text placeholder (no protocol
  equivalent); base64 PDFs ride the official `file` part and text-source
  documents inline their text (both since v0.56.0 — see "Image input").
- **`betas` and `apiVersion` are ignored** (Anthropic header concepts).
- **Cost metrics read 0** for non-Claude models UNLESS you supply
  `provider.pricing` entries — with them, cost metrics and `maxBudgetUsd`
  are fully enforceable. When `maxBudgetUsd` is set with no price entry for
  the session model, the SDK emits an `informational` warning after init
  (as it does for a dropped `thinking` config and ignored `betas`/
  `apiVersion`) instead of failing silently.
- **Model choice changes behavior**: the harness prompts are tuned against
  Claude Code behavior (POSITIONING §2); a different model family means a
  different feel. This is the sovereignty trade the switch exists to offer.

## Capability declaration + continuation fragment (keeper memo 2026-07-18 §3)

Two seams for gateways/models that do NOT support everything:

- **`provider.capabilities`** — declare what the endpoint truly supports;
  the engine degrades per declaration instead of silently assuming full
  capability. On this protocol: `thinking: false` suppresses
  `openai.reasoningEffort` from the wire; `parallelToolCalls: false` sends
  `parallel_tool_calls: false` whenever tools are advertised;
  `usage: 'none' | 'approximate'` surfaces an informational message about
  budget/cost precision at startup (`promptCaching` is moot here — this
  translator never emits `cache_control`). On the anthropic protocol the same
  declaration strips `thinking` / `cache_control` and forces
  `disable_parallel_tool_use`. Every degradation logs a debug line. This is a
  DECLARATION seam, not a model profile: no probing, no per-model tables.
- **Automation-continuation fragment** (`options.continuationPrompt`) —
  default ON for this protocol: the default harness gets one appended
  sdk-original clause telling the model to finish ALL the work before ending
  its turn (no mid-task progress reports) — mainline non-Anthropic models
  measurably stall mid-run without it. Default OFF on anthropic; an explicit
  boolean overrides either way. Verified end-to-end against fake endpoints
  in `tests/provider-capabilities.test.ts`.

## Cross-protocol subagents (v0.54.0)

A query has ONE provider config, but a gateway often serves different models
on different routes — an `openai-chat` main model whose subagent-tier models
only exist on the gateway's Anthropic route (or vice versa). Without routing,
an isolated child rides the parent transport unconditionally and the gateway
400s "model not found" on the wrong endpoint.

`Options.resolveSubagentTransport` fixes this without hardcoding any model
naming convention in the SDK. The host owns the model→protocol table:

```ts
import { query, createSubagentTransportResolver } from 'silver-core-sdk';

const q = query({
  prompt,
  options: {
    model: 'azure/gpt-5',
    provider: { protocol: 'openai-chat', baseUrl: GW_OPENAI, apiKey: KEY },
    resolveSubagentTransport: createSubagentTransportResolver({
      protocolForModel: (m) => (m.startsWith('azure/') ? 'openai-chat' : 'anthropic'),
      providers: {
        anthropic: { baseUrl: GW_ANTHROPIC, apiKey: KEY },
      },
    }),
  },
});
```

Semantics:

- Consulted once per ISOLATED spawn, after the child model resolves
  (per-call override → agentDef.model → parent, aliases expanded). Returning
  `undefined` — or omitting the option — shares the parent transport,
  byte-for-byte the previous behavior. **Forks never consult it**: a fork's
  cached prefix requires the parent model + transport.
- The standard resolver memoizes ONE transport per protocol (children share
  warm keep-alive pools instead of paying a TCP+TLS handshake per spawn) and
  derives the child provider from the parent's protocol-AGNOSTIC knobs only
  (retries / timeouts / fetch / httpClient / preconnect / pricing).
  Protocol-SPECIFIC fields (baseUrl / credentials / apiVersion / openai.\*)
  come from the explicit per-protocol config or that protocol's own env chain
  (`ANTHROPIC_*` / `OPENAI_*`) — never copied from the parent, because the two
  protocols append different URL suffixes (`/v1/messages` vs
  `/chat/completions`) and a blind copy mis-routes.
- Thinking is re-derived for a transport-switched child: resolution values
  win; otherwise a non-Claude child model DROPS the inherited config (a
  Claude-shaped `thinking` param on a non-Claude model is gateway-rejected
  more often than honored). Shared-transport children inherit unchanged.
- Lifecycle: resolutions with `owned: true` are disposed once at query
  teardown (after all children settled — SendMessage can revive a finished
  child until then). The standard resolver returns `owned: false` (it owns
  its memoized instances; the built-in transports self-clean via unref'd
  TTL-bounded socket pools).
- Each spawn logs `{parentModel, childModel, parentProtocol, childProtocol,
  transportMode}` on the debug channel (`shared-parent` / `resolver-shared` /
  `child-owned`).
- Family budget, usage ledger, and hook wiring are transport-independent and
  unchanged.

**Utility + compaction calls (v0.55.0).** The same callback also routes the
other two engine-internal call sites that target a non-session model,
distinguished by a `purpose` field on the resolver input
(`'subagent' | 'utility' | 'compaction'`):

- **Utility generator calls** (hook `condition` evaluation on the default
  Haiku-tier utility model): the query composes the callback into
  `UtilityCallOptions.resolveTransport`; precedence is explicit `transport`
  (tests) > `resolveTransport(model)` > provider-built default. Hosts calling
  the generators/tips/verifier exports directly may pass their own
  `resolveTransport`.
- **Compaction summarizer**: when `compaction.model` differs from the session
  model, the summary stream rides the resolved transport (root loop and every
  child loop alike) instead of the session transport.

The standard resolver ignores `purpose` (it routes purely by model), so a
0.54.0 host needs no change beyond rebuilding. Resolver absent -> both call
sites keep their previous transport paths byte-for-byte.

`tests/subagent-transport.test.ts` locks the acceptance matrix.

## Tests

`tests/transport-openai.test.ts` — request encoding, stream translation
(including accumulator round-trips), credential/base-URL resolution, error
mapping, retry policy, and the factory switch. Zero network.
