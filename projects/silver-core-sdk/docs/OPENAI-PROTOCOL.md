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

## Translation map

| Messages API | Chat Completions |
|---|---|
| `system` (string or blocks) | one `system` message (blocks joined with `\n`) |
| user `text` / `image` blocks | `text` / `image_url` content parts (base64 -> data URL) |
| user `tool_result` blocks | `tool` role messages (emitted first, preserving protocol adjacency); non-text result content degrades to honest text placeholders |
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

## Honest limits

- **`thinking` config is dropped from the wire** — it has no Chat Completions
  equivalent. Use `openai.reasoningEffort` for OpenAI reasoning models.
  Incoming DeepSeek-style reasoning IS surfaced (as thinking blocks), so hosts
  render it; those blocks are stripped again on the next request encode.
- **`cache_control` breakpoints are stripped** — OpenAI-side prompt caching is
  automatic, not breakpoint-driven. Cached tokens are still accounted
  (`cache_read_input_tokens` from `prompt_tokens_details.cached_tokens`), but
  the `promptCaching` / `cacheTtl` knobs have no wire effect on this protocol.
- **PDF/document blocks degrade** to a text placeholder (no protocol
  equivalent); text-source documents inline their text.
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
