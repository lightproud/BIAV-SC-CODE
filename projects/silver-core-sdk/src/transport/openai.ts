/**
 * Silver Core SDK - OpenAI-protocol translating transport (BPT-EXTENSION).
 *
 * Implements the same internal `Transport` contract as AnthropicTransport but
 * drives an OpenAI-compatible Chat Completions endpoint
 * (`POST {base}/chat/completions`, `stream: true`). The engine keeps speaking
 * Anthropic Messages API shapes end to end; this module translates at the wire
 * boundary only:
 *
 *   request  : StreamRequest (Messages API shape) -> Chat Completions body
 *   response : chat.completion.chunk SSE          -> RawMessageStreamEvent
 *
 * That keeps the agent loop, accumulator, tools, permissions and sessions
 * byte-identical across providers — the seam is exactly the one the module-A
 * contract drew. Selected via `ProviderConfig.protocol: 'openai-chat'`;
 * default stays 'anthropic' (zero behavior change for existing consumers).
 *
 * Translation limits (documented in docs/OPENAI-PROTOCOL.md):
 *  - `thinking` config does not translate and is DROPPED from the wire
 *    (use `provider.openai.reasoningEffort` for OpenAI reasoning models);
 *    DeepSeek-style `reasoning_content` deltas in the RESPONSE are surfaced
 *    as thinking blocks (empty signature; never replayed on the wire).
 *  - `cache_control` breakpoints are stripped (OpenAI-side caching is
 *    automatic); cached prompt tokens are read back from
 *    `usage.prompt_tokens_details.cached_tokens`.
 *  - image blocks translate to `image_url` parts (base64 -> data URL, with a
 *    media-type whitelist + base64 hygiene checks so a bad image fails with a
 *    locatable error HERE instead of an opaque gateway image-processing
 *    error); base64-PDF document blocks translate to the official `file`
 *    part (data URL in file_data); URL documents keep an honest placeholder.
 *  - images/PDFs inside a tool_result are FANNED OUT into the user message
 *    following the tool messages (the OpenAI `tool` role is text-only), each
 *    labeled with its tool_call_id; the tool body keeps a forward-reference
 *    marker.
 *
 * The HTTP retry/backoff/watchdog policy mirrors AnthropicTransport (the
 * resolve* helpers and semaphore are imported from it); the request loop is
 * kept local rather than refactoring the Anthropic path, so the conformance-
 * locked Anthropic transport stays byte-untouched.
 */

import { performance } from 'node:perf_hooks';
import {
  AbortError,
  APIConnectionError,
  APIStatusError,
  ConfigurationError,
  isAbortError,
} from '../errors.js';
import { extractProviderErrorObject } from '../error-normalize.js';
import type {
  APIMessageParam,
  APIToolDefinition,
  ApiKeySource,
  ContentBlockParam,
  DocumentBlockParam,
  ImageBlockParam,
  OpenAIProtocolOptions,
  ProviderCapabilities,
  ProviderConfig,
  RawMessageStreamEvent,
  StopReason,
  TextBlockParam,
  ToolChoice,
  ToolResultBlockParam,
} from '../types.js';
import type { RetryInfo, StreamRequest, Transport } from '../internal/contracts.js';
import { parseSSE } from './sse.js';
import {
  firePreconnect,
  getNodeFetch,
  resolveHttpClient,
  resolvePreconnect,
} from './node-http.js';
import { SDK_USER_AGENT } from '../version.js';
import {
  RequestSemaphore,
  resolveMaxConcurrent,
  resolveMaxRetries,
  resolveStreamIdleMs,
  resolveStreamMaxMs,
} from './anthropic.js';
import {
  SUPPORTED_IMAGE_MEDIA_TYPES,
  SUPPORTED_IMAGE_MEDIA_TYPES_LIST,
} from '../internal/media.js';
import { sliceSurrogateSafe } from '../internal/text.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 600_000;
/** setTimeout's signed-32-bit ceiling — the "effectively disabled" stand-in
 *  for timeoutMs:0 (AbortSignal.timeout has no "never" value). */
const MAX_TIMEOUT_MS = 2_147_483_647;
const USER_AGENT = SDK_USER_AGENT;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 60_000;
/** Bounded jitter applied ON TOP of an explicit Retry-After delay (audit
 *  2026-07-14 L-2): the delay is multiplied by [1.0, 1.0 + this factor], so a
 *  concurrent fan-out (subagent fleets) does not retry at the same instant.
 *  Never retries EARLIER than the server asked; the jittered total stays
 *  capped at RETRY_AFTER_MAX_MS (the same ceiling the parser applies). */
const RETRY_AFTER_JITTER = 0.25;

/** Normalized (Anthropic-vocabulary) error type per HTTP status, so engine-
 *  side handling keyed on Messages API error types works unchanged. */
const STATUS_ERROR_TYPE: Record<number, string> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  408: 'timeout_error',
  413: 'request_too_large',
  429: 'rate_limit_error',
  529: 'overloaded_error',
};

type ResolvedCredential = { value: string; source: ApiKeySource };

type TransportConfig = {
  provider?: ProviderConfig;
  env: Record<string, string | undefined>;
  debug: (m: string) => void;
};

// ---------------------------------------------------------------------------
// Request encoding: Messages API shape -> Chat Completions body
// ---------------------------------------------------------------------------

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  /** Official Chat Completions PDF-input part (base64 data URL in file_data). */
  | { type: 'file'; file: { filename: string; file_data: string } };

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIChatMessage =
  // 'developer' is the reasoning-model system role (o1/o3 on api.openai.com
  // 400 on role:'system'); opt-in via OpenAIProtocolOptions.systemRole so
  // lenient gateways that accept 'system' are unaffected (audit r4 Soa-3).
  | { role: 'system' | 'developer'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Join the system field's text blocks. The engine's cache-split blocks are
 *  slices/sections of one logical prompt; '\n' matches the engine's own
 *  single-string join (loop.ts flat path). */
function encodeSystem(system: string | TextBlockParam[] | undefined): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === 'string') return system.length > 0 ? system : undefined;
  const text = system.map((b) => b.text).join('\n');
  return text.length > 0 ? text : undefined;
}

/** Per-request attachment-translation stats for the debug channel. Log
 *  hygiene: carries ONLY MIME types and base64 character counts — never
 *  image/document bytes, credentials, or any slice of the request body. */
type ImageStats = { mediaTypes: string[]; dataChars: number[] };

/** RFC 4648 alphabet (padding allowed only at the end). Catches garbage that
 *  would otherwise ride into the data URL and fail server-side. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Whitespace-normalize + validate base64 payload for a data URL. Raw
 *  newlines (line-wrapped file encoders), an accidental nested `data:` prefix
 *  and off-alphabet bytes are exactly the malformed shapes gateways reject
 *  opaquely at their media-processing stage (e.g.
 *  `image_moderation_server_error`) — fail HERE, locatably, instead. All
 *  error messages are byte-free (never include the payload). */
function cleanBase64(raw: string, where: string, what: string): string {
  const data = raw.replace(/\s+/g, '');
  if (data.length === 0) {
    throw new ConfigurationError(
      `openai-chat: empty base64 ${what} data at ${where}; ` +
        `supply the ${what} bytes or drop the block`,
    );
  }
  if (data.startsWith('data:')) {
    throw new ConfigurationError(
      `openai-chat: ${what} data at ${where} already carries a "data:" URL prefix; ` +
        `pass RAW base64 in source.data (or use source.type 'url' for a full URL)`,
    );
  }
  if (!BASE64_RE.test(data)) {
    throw new ConfigurationError(
      `openai-chat: ${what} data at ${where} is not valid base64 (${data.length} chars)`,
    );
  }
  // Alphabet + trailing padding pass BASE64_RE, but a length ≡ 1 (mod 4) can
  // never be valid base64 (each 4-char group encodes 3 bytes; a final lone
  // char is impossible, e.g. "YWJjZ"), and any '=' padding requires the total
  // to complete a 4-char group. Both decode-fail opaquely at the gateway's
  // media stage — reject HERE, byte-free. (audit r4 Y6-1.)
  const padded = data.endsWith('=');
  if (data.length % 4 === 1 || (padded && data.length % 4 !== 0)) {
    throw new ConfigurationError(
      `openai-chat: ${what} data at ${where} has an invalid base64 length ` +
        `(${data.length} chars; base64 encodes in 4-character groups)`,
    );
  }
  return data;
}

function imagePartUrl(block: ImageBlockParam, where: string, stats?: ImageStats): string {
  if (block.source.type !== 'base64') {
    // http(s) or ready-made data URL: the Chat Completions image_url part
    // takes it verbatim.
    stats?.mediaTypes.push('url');
    stats?.dataChars.push(block.source.url.length);
    return block.source.url;
  }
  const mediaType = block.source.media_type.trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new ConfigurationError(
      `openai-chat: unsupported image media_type "${block.source.media_type}" at ${where}; ` +
        `supported: ${SUPPORTED_IMAGE_MEDIA_TYPES_LIST}`,
    );
  }
  const data = cleanBase64(block.source.data, where, 'image');
  stats?.mediaTypes.push(mediaType);
  stats?.dataChars.push(data.length);
  return `data:${mediaType};base64,${data}`;
}

/** Translate a document block into an OpenAI content part. Base64 PDFs map to
 *  the official Chat Completions `file` part (data URL in `file_data`,
 *  v0.56.0 — previously an honest text placeholder); text sources inline
 *  their text; URL sources have no Chat Completions equivalent and keep the
 *  honest placeholder. */
function documentPart(
  block: DocumentBlockParam,
  where: string,
  stats?: ImageStats,
): OpenAIContentPart {
  if (block.source.type === 'text') return { type: 'text', text: block.source.data };
  if (block.source.type === 'url') {
    return {
      type: 'text',
      text: `[document "${block.title ?? block.source.url}" omitted: URL documents have no Chat Completions equivalent]`,
    };
  }
  const data = cleanBase64(block.source.data, where, 'document');
  stats?.mediaTypes.push('application/pdf');
  stats?.dataChars.push(data.length);
  return {
    type: 'file',
    file: {
      filename: block.title ?? 'document.pdf',
      file_data: `data:application/pdf;base64,${data}`,
    },
  };
}

/** An image/document lifted out of a tool_result and carried into the user
 *  message that follows the tool messages (fan-out, v0.56.0): the OpenAI
 *  `tool` role is text-only, so without the carry the model NEVER sees a
 *  screenshot an MCP tool returned or an image file Read produced. The label
 *  ties the attachment back to its tool call. */
type CarriedAttachment = { label: string; part: OpenAIContentPart };

/** Flatten a tool_result's content to the string an OpenAI `tool` message
 *  carries. Images and base64-PDF documents are lifted into `carry` (see
 *  CarriedAttachment) with a forward-reference marker left in the tool body;
 *  an attachment that fails validation degrades to an explicit omission
 *  marker with the reason (never a thrown error — a malformed tool OUTPUT
 *  must not brick the turn the way a malformed caller INPUT should; user-turn
 *  blocks stay strict). An `is_error` tool_result gets a deterministic
 *  textual marker: the OpenAI `tool` role has no is_error field, so without
 *  it the model can no longer tell a failed tool call (a non-zero Bash exit,
 *  a builtin error) from a successful one — it would treat the error text as
 *  a normal result. */
function flattenToolResultContent(
  block: ToolResultBlockParam,
  where: string,
  carry: CarriedAttachment[],
  stats?: ImageStats,
): string {
  const content = block.content;
  let imageNo = 0;
  let documentNo = 0;
  const body =
    content === undefined
      ? ''
      : typeof content === 'string'
        ? content
        : content
            .map((item, j) => {
              if (item.type === 'text') return item.text;
              if (item.type === 'image') {
                imageNo += 1;
                try {
                  const url = imagePartUrl(item, `${where}.content[${j}]`, stats);
                  carry.push({
                    label: `[image #${imageNo} from tool call ${block.tool_use_id}]`,
                    part: { type: 'image_url', image_url: { url } },
                  });
                  return `[image #${imageNo}: attached in the user message after the tool results]`;
                } catch (err) {
                  return `[image #${imageNo} omitted: ${errorMessage(err)}]`;
                }
              }
              // document
              try {
                const part = documentPart(item, `${where}.content[${j}]`, stats);
                // documentPart returns text (inline/placeholder) or file only.
                if (part.type !== 'file') {
                  return part.type === 'text' ? part.text : '';
                }
                documentNo += 1;
                carry.push({
                  label: `[document #${documentNo} ("${part.file.filename}") from tool call ${block.tool_use_id}]`,
                  part,
                });
                return `[document #${documentNo} ("${part.file.filename}"): attached in the user message after the tool results]`;
              } catch (err) {
                return `[document omitted: ${errorMessage(err)}]`;
              }
            })
            .join('\n');
  return block.is_error === true
    ? body.length > 0
      ? `[tool error] ${body}`
      : '[tool error]'
    : body;
}

/** Translate one Anthropic message-param into its OpenAI message(s). A user
 *  turn carrying tool_result blocks fans out into `tool` role messages (which
 *  must directly follow the assistant tool_calls turn), then any remaining
 *  user content. */
function encodeMessage(
  msg: APIMessageParam,
  where = 'messages[?]',
  stats?: ImageStats,
): OpenAIChatMessage[] {
  if (typeof msg.content === 'string') {
    return msg.role === 'user'
      ? [{ role: 'user', content: msg.content }]
      : [{ role: 'assistant', content: msg.content }];
  }
  if (msg.role === 'assistant') {
    const texts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];
    for (const block of msg.content) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      }
      // thinking / redacted_thinking never translate to the OpenAI wire.
    }
    const content = texts.length > 0 ? texts.join('\n') : null;
    if (content === null && toolCalls.length === 0) return [];
    return [
      {
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }
  // user turn with blocks: tool results first (protocol adjacency), then the
  // remaining text/image parts as one user message.
  const out: OpenAIChatMessage[] = [];
  const parts: OpenAIContentPart[] = [];
  const carry: CarriedAttachment[] = [];
  const blocks = msg.content as ContentBlockParam[];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    switch (block.type) {
      case 'tool_result':
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattenToolResultContent(block, `${where}.content[${i}]`, carry, stats),
        });
        break;
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;
      case 'image':
        parts.push({
          type: 'image_url',
          image_url: { url: imagePartUrl(block, `${where}.content[${i}]`, stats) },
        });
        break;
      default:
        if ((block as { type?: string }).type === 'document') {
          parts.push(
            documentPart(
              block as unknown as DocumentBlockParam,
              `${where}.content[${i}]`,
              stats,
            ),
          );
        }
        // tool_use / thinking blocks never appear in user turns.
        break;
    }
  }
  // Carried tool_result attachments ride in the user message FOLLOWING the
  // tool messages (protocol adjacency: tool messages must directly follow the
  // assistant tool_calls turn). Each is preceded by its text label so the
  // model can tie it back to the tool call; appended AFTER any genuine user
  // content so original block order within the turn is preserved.
  for (const { label, part } of carry) {
    parts.push({ type: 'text', text: label }, part);
  }
  if (parts.length > 0) {
    const onlyText = parts.every((p) => p.type === 'text');
    out.push({
      role: 'user',
      content: onlyText
        ? parts.map((p) => (p as { type: 'text'; text: string }).text).join('\n')
        : parts,
    });
  }
  return out;
}

function encodeToolChoice(
  choice: ToolChoice,
): { tool_choice?: unknown; parallel_tool_calls?: boolean } {
  const parallel =
    'disable_parallel_tool_use' in choice && choice.disable_parallel_tool_use === true
      ? { parallel_tool_calls: false }
      : {};
  switch (choice.type) {
    case 'auto':
      return { tool_choice: 'auto', ...parallel };
    case 'any':
      return { tool_choice: 'required', ...parallel };
    case 'tool':
      return {
        tool_choice: { type: 'function', function: { name: choice.name } },
        ...parallel,
      };
    case 'none':
      return { tool_choice: 'none' };
  }
}

/**
 * Encode one StreamRequest as a Chat Completions request body. Exported for
 * unit tests (pure function, no I/O; the optional `debug` sink receives one
 * image-translation summary line — MIME types and base64 lengths only, never
 * image bytes / credentials / body content).
 */
export function encodeOpenAIRequest(
  req: Omit<StreamRequest, 'signal' | 'onRetry'>,
  opts: OpenAIProtocolOptions = {},
  debug?: (m: string) => void,
  caps?: ProviderCapabilities,
): Record<string, unknown> {
  const messages: OpenAIChatMessage[] = [];
  const system = encodeSystem(req.system);
  if (system !== undefined) {
    messages.push({ role: opts.systemRole ?? 'system', content: system });
  }
  const imageStats: ImageStats = { mediaTypes: [], dataChars: [] };
  for (let i = 0; i < req.messages.length; i += 1) {
    messages.push(...encodeMessage(req.messages[i]!, `messages[${i}]`, imageStats));
  }
  if (imageStats.mediaTypes.length > 0) {
    const files = imageStats.mediaTypes.filter((t) => t === 'application/pdf').length;
    debug?.(
      `openai transport: protocol=openai-chat images=${imageStats.mediaTypes.length - files} ` +
        `files=${files} types=[${imageStats.mediaTypes.join(', ')}] ` +
        `data_chars=[${imageStats.dataChars.join(', ')}] -> image_url/file parts (ok)`,
    );
  }

  // Server-declared typed entries (no input_schema, e.g. memory_20250818)
  // have no Chat Completions equivalent and are dropped honestly — the query
  // layer never assembles them on this protocol (memory runs in custom mode).
  // Last line of defense (BPT 2026-07-13): a tool whose input_schema is
  // missing or not a plain object (null, array, primitive) would 400 the
  // whole request at the gateway (`tools.N.custom.input_schema: Field
  // required`), so only wire-safe schemas make it into `tools`.
  const isWireSafeSchema = (s: unknown): boolean =>
    typeof s === 'object' && s !== null && !Array.isArray(s);
  const customTools = (req.tools ?? []).filter(
    (t): t is APIToolDefinition =>
      'input_schema' in t && isWireSafeSchema(t.input_schema),
  );
  const tools =
    customTools.length > 0
      ? customTools.map((t: APIToolDefinition) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            parameters: t.input_schema,
          },
        }))
      : undefined;

  // Tool/function names are sent verbatim. api.openai.com enforces
  // ^[A-Za-z0-9_-]{1,64}$ and 400s a name with dots/spaces or over 64 chars;
  // many OpenAI-compatible gateways are lenient, so a hard reject would break a
  // gateway that accepts the name — surface a locatable WARNING instead (twin
  // of the Claude-model-id warning in streamRequest). (audit r4 Soa-4.)
  if (tools !== undefined) {
    const badToolNames = customTools
      .map((t) => t.name)
      .filter((n) => !/^[A-Za-z0-9_-]{1,64}$/.test(n));
    if (badToolNames.length > 0) {
      debug?.(
        `openai transport: WARNING ${badToolNames.length} tool name(s) violate the OpenAI ` +
          `function-name constraint ^[A-Za-z0-9_-]{1,64}$ (likely 400 on api.openai.com): ` +
          `${badToolNames.join(', ')}`,
      );
    }
  }

  // Capability degradation (keeper memo 2026-07-18 §3): an endpoint DECLARED
  // without thinking support never receives reasoning_effort, whatever the
  // openai tuning says; declared without parallel tool calls, it is asked for
  // at most one call per turn. Reported, never silent.
  const reasoningEffort = caps?.thinking === false ? undefined : opts.reasoningEffort;
  if (caps?.thinking === false && opts.reasoningEffort !== undefined) {
    debug?.(
      'openai transport: capability degradation — reasoning_effort suppressed ' +
        '(capabilities.thinking: false)',
    );
  }
  const forceSerialTools = caps?.parallelToolCalls === false && tools !== undefined;
  if (forceSerialTools) {
    debug?.(
      'openai transport: capability degradation — parallel_tool_calls: false ' +
        '(capabilities.parallelToolCalls: false)',
    );
  }

  // reasoning_effort is accepted only by reasoning models (o-series, gpt-5
  // reasoning), which REJECT `max_tokens` and require `max_completion_tokens`.
  // When a caller asks for reasoning but did not pin the token param, default it
  // to max_completion_tokens instead of 400-ing the request; an explicit
  // maxTokensParam still wins. (audit r4 Soa-2.)
  const maxTokensParam =
    opts.maxTokensParam ??
    (reasoningEffort !== undefined ? 'max_completion_tokens' : 'max_tokens');

  // WV2-4 (audit r3, keeper ruling T60 2026-07-18, option ③): a reasoning model
  // on api.openai.com (o-series / gpt-5 reasoning) 400s on any temperature != 1.
  // Suppress a stray caller temperature ONLY when the endpoint is DECLARED as a
  // thinking endpoint (`capabilities.thinking === true`) AND reasoning is active
  // — never on an unknown gateway (caps undefined) or one declared thinking:false
  // (vLLM/Qwen-style stacks accept temperature under reasoning; silently
  // rewriting the caller's intent there would break them). temperature === 1 is
  // always safe to pass through.
  const suppressTemperature =
    caps?.thinking === true &&
    reasoningEffort !== undefined &&
    req.temperature !== undefined &&
    req.temperature !== 1;
  if (suppressTemperature) {
    debug?.(
      'openai transport: capability guard — dropped temperature ' +
        `${req.temperature} on a declared reasoning endpoint (api.openai.com reasoning ` +
        'models 400 on temperature != 1); pass temperature: 1 or omit it',
    );
  }
  return {
    // Gateway-specific extras first: translator-owned keys win on conflict.
    ...(opts.extraBody ?? {}),
    model: req.model,
    messages,
    [maxTokensParam]: req.max_tokens,
    ...(tools !== undefined ? { tools } : {}),
    ...(req.tool_choice !== undefined && tools !== undefined
      ? encodeToolChoice(req.tool_choice)
      : {}),
    ...(forceSerialTools ? { parallel_tool_calls: false } : {}),
    ...(req.temperature !== undefined && !suppressTemperature
      ? { temperature: req.temperature }
      : {}),
    ...(reasoningEffort !== undefined
      ? { reasoning_effort: reasoningEffort }
      : {}),
    // Deliberately WITHOUT `strict: true` (audit r2 B3, documented WONTFIX
    // pending a keeper ruling): OpenAI strict mode rejects any schema outside
    // its subset (every property required, additionalProperties:false, no
    // unsupported keywords), which would 400 arbitrary caller schemas that
    // work today. Best-effort schema adherence + the engine's validate-and-
    // retry corrective loop is the chosen trade-off; flipping this on must be
    // a deliberate decision, not a silent hardening.
    ...(req.output_config !== undefined
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'structured_output',
              schema: req.output_config.format.schema,
              // OPT-IN (provider.openai.strictStructuredOutput): constrained
              // decoding guarantees a schema-valid answer, killing the engine's
              // validate-and-retry churn. Off by default — strict mode 400s a
              // non-conforming schema and is unimplemented on many gateways
              // (audit r2 2026-07-17 B3).
              ...(opts.strictStructuredOutput === true ? { strict: true } : {}),
            },
          },
        }
      : {}),
    stream: true,
    // Default to asking for a usage summary, but let a consumer suppress it via
    // extraBody (e.g. `extraBody: { stream_options: null }`): some gateways
    // (older vLLM, one-api variants) 400 on `stream_options`, and the hardcoded
    // default previously always won over extraBody (spread first), leaving no
    // escape hatch. When extraBody declares the key, its value stands.
    ...('stream_options' in (opts.extraBody ?? {})
      ? {}
      : { stream_options: { include_usage: true } }),
  };
}

// ---------------------------------------------------------------------------
// Response decoding: chat.completion.chunk SSE -> RawMessageStreamEvent
// ---------------------------------------------------------------------------

type OpenAIChunk = {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      /** Structured-output / safety refusal text. OpenAI streams a decline HERE,
       *  never in `content`; decoding it keeps the user from an empty turn. */
      refusal?: string | null;
      /** DeepSeek-style reasoning stream; some gateways use `reasoning`. */
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
      /** Legacy singular function-calling delta (pre-tool_calls gateways). */
      function_call?: { name?: string; arguments?: string } | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: unknown;
};

/** The finish_reason values with a known, clean Anthropic mapping. Anything
 *  else (vLLM 'abort', DeepSeek 'insufficient_system_resource', ...) signals
 *  the GATEWAY cut the generation — treating it as end_turn would forge a
 *  clean success out of a partial answer (see ChunkTranslator.finish). */
const KNOWN_FINISH_REASONS = new Set([
  'stop',
  'length',
  'tool_calls',
  'function_call',
  'content_filter',
]);

function mapFinishReason(reason: string | null): StopReason {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    case 'stop':
    default:
      return 'end_turn';
  }
}

/**
 * Stateful chunk translator: feeds chat.completion.chunk payloads, emits
 * Anthropic stream events. One instance per stream attempt. Exported for
 * unit tests (pure state machine, no I/O).
 *
 * Blocks are keyed ('text' / 'reasoning' / `tool:${index}`) and stay OPEN
 * until finish(): providers such as vLLM interleave deltas of parallel tool
 * calls, so a close-on-switch design would seal a half-received block (empty
 * or truncated input) and route later fragments into a mis-labeled ghost
 * block. Multiple concurrently open blocks are exactly what the Anthropic
 * protocol's per-index events model; the accumulator keys by index and never
 * requires eager stops. (Audit 2026-07-10 P0-1.)
 */
export class OpenAIStreamTranslator {
  private readonly model: string;
  private started = false;
  private nextIndex = 0;
  /** Open blocks: translator key -> Anthropic block index (insertion order). */
  private readonly open = new Map<string, number>();
  private finishReason: string | null = null;
  private usage: NonNullable<OpenAIChunk['usage']> | null = null;
  private done = false;
  /**
   * Whether any delta carried VALID assistant content — as opposed to the
   * role-only / usage-only metadata chunks a gateway may stream before it
   * closes with a bare [DONE]. Tracked SEPARATELY from the transport's raw
   * chunk count: `chunkCount > 0` proves a frame arrived, not that the model
   * produced anything. Flips true on a non-empty text/reasoning delta or a
   * tool_call fragment bearing an id/name/arguments (see feed()). Used by the
   * transport to reject the "empty finish" shape (metadata + [DONE], no
   * content, no finish_reason) instead of fabricating an empty success.
   */
  private contentSeen = false;
  /**
   * Whether a delta.refusal fragment arrived. A refusal is surfaced as visible
   * assistant text (so the user sees the decline, not a blank turn) and, when no
   * stronger terminal signal contradicts it, mapped to stop_reason 'refusal'.
   * (audit r4 Roa-1.)
   */
  private refusalSeen = false;
  /**
   * Per-tool-call buffered state so a fragmented gateway does not lose the id
   * or the name. Some OpenAI-compatible gateways stream the id in a LATER chunk
   * than the one that opens the tool call, or split `function.name` across
   * chunks. The old code captured id/name only on FIRST sight and minted a
   * synthetic id immediately — so the real id (arriving next chunk) was
   * dropped, producing a tool_use_id the server later rejects (400), and a
   * split name mis-dispatched. We now hold the tool_use content_block_start
   * until an id is present, accumulating name fragments and buffering any early
   * argument deltas; conforming streams (id+name in the first delta) are
   * byte-identical since the block still emits within that same feed() call.
   */
  private readonly toolBuffers = new Map<
    string,
    { id?: string; name: string; args: string; emitted: boolean; index?: number }
  >();

  constructor(requestModel: string) {
    this.model = requestModel;
  }

  /** True once any choice carried a finish_reason (stream reached a proper
   *  end-of-message marker; used by the transport's truncation heuristic). */
  sawFinishReason(): boolean {
    return this.finishReason !== null;
  }

  /** True once any delta carried VALID assistant content — non-empty text,
   *  non-empty reasoning, or a tool_call fragment carrying an id/name/arguments.
   *  Role-only and usage-only metadata chunks do NOT flip this, so it separates
   *  a real (if short) message from the "empty finish" shape the transport must
   *  reject as an `empty_message` failure. */
  sawContent(): boolean {
    return this.contentSeen;
  }

  /** True once the first chunk arrived (message_start was emitted). */
  hasStarted(): boolean {
    return this.started;
  }

  feed(chunk: OpenAIChunk): RawMessageStreamEvent[] {
    const events: RawMessageStreamEvent[] = [];
    if (!this.started) {
      this.started = true;
      events.push({
        type: 'message_start',
        message: {
          id: chunk.id ?? 'chatcmpl-unknown',
          type: 'message',
          role: 'assistant',
          model: chunk.model ?? this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    }
    if (chunk.usage !== undefined && chunk.usage !== null) {
      // WV2-2 (audit r3): shallow-MERGE, don't replace. A gateway that splits
      // usage across chunks (prompt_tokens early, completion_tokens /
      // prompt_tokens_details in the final summary) would otherwise lose the
      // earlier fields — finish() reads them off the last object only.
      this.usage = {
        ...this.usage,
        ...chunk.usage,
        ...(chunk.usage.prompt_tokens_details !== undefined
          ? {
              prompt_tokens_details: {
                ...this.usage?.prompt_tokens_details,
                ...chunk.usage.prompt_tokens_details,
              },
            }
          : {}),
      };
    }
    const choice = chunk.choices?.[0];
    if (choice === undefined) return events;
    // Only a non-empty finish_reason string counts as an explicit terminal
    // marker: the requirement's "empty finish" shape may carry finish_reason:''
    // (or null), which must NOT be read as a real end-of-message.
    if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
      this.finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (delta === undefined) return events;

    // WV2-3 (audit r3): some OpenAI-compatible / multimodal gateways stream
    // `content` (and reasoning) as an ARRAY of parts, not a bare string. Only
    // the string case was decoded, so an array-form delta contributed nothing
    // → contentSeen never flipped → the empty-finish guard wrongly rejected the
    // whole turn as empty_message. Flatten an array of text-ish parts to a
    // joined string first.
    const flattenContent = (v: unknown): unknown => {
      if (!Array.isArray(v)) return v;
      const text = v
        .map((p) =>
          typeof p === 'string'
            ? p
            : typeof (p as { text?: unknown }).text === 'string'
              ? (p as { text: string }).text
              : '',
        )
        .join('');
      return text;
    };
    const deltaContent = flattenContent(delta.content);

    // Prefer whichever reasoning field actually carries text: `??` alone let a
    // present-but-empty `reasoning_content: ''` mask a populated `reasoning`
    // in the same delta (dual-field gateways emit both).
    const reasoningRaw =
      typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0
        ? delta.reasoning_content
        : (delta.reasoning ?? delta.reasoning_content);
    const reasoning = flattenContent(reasoningRaw);
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      this.contentSeen = true;
      const index = this.openBlock(events, 'reasoning', {
        type: 'thinking',
        thinking: '',
        signature: '',
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: reasoning },
      });
    }
    if (typeof deltaContent === 'string' && deltaContent.length > 0) {
      this.contentSeen = true;
      const index = this.openBlock(events, 'text', { type: 'text', text: '' });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: deltaContent },
      });
    }
    // A structured-output / safety refusal streams its text in delta.refusal,
    // never in delta.content. Surface it as visible assistant text (so the user
    // sees the decline instead of a blank assistant turn) and remember it for
    // the stop_reason. (audit r4 Roa-1.)
    if (typeof delta.refusal === 'string' && delta.refusal.length > 0) {
      this.contentSeen = true;
      this.refusalSeen = true;
      const index = this.openBlock(events, 'text', { type: 'text', text: '' });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta.refusal },
      });
    }
    for (const tc of delta.tool_calls ?? []) {
      // A tool_call fragment is VALID assistant content the moment it carries
      // an id, a function name, or argument bytes — even before the block can
      // be emitted (a fragmented-id gateway holds the block open). An empty
      // `{index:0}` placeholder alone does not count.
      if (
        (typeof tc.id === 'string' && tc.id.length > 0) ||
        (typeof tc.function?.name === 'string' && tc.function.name.length > 0) ||
        (typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0)
      ) {
        this.contentSeen = true;
      }
      // Key by index when present (the normal case); fall back to id, then a
      // last-resort constant. Keying an index-less call by its id keeps two
      // distinct id-bearing calls from colliding on `tool:0`.
      const key =
        tc.index !== undefined && tc.index !== null
          ? `tool:${tc.index}`
          : tc.id !== undefined
            ? `tool:id:${tc.id}`
            : 'tool:0';
      let buf = this.toolBuffers.get(key);
      if (buf === undefined) {
        buf = { name: '', args: '', emitted: false };
        this.toolBuffers.set(key, buf);
      }
      if (typeof tc.id === 'string' && tc.id.length > 0) buf.id = tc.id;
      if (typeof tc.function?.name === 'string') buf.name += tc.function.name;
      const args = tc.function?.arguments;
      if (typeof args === 'string' && args.length > 0) buf.args += args;
      // Defer content_block_start until the first ARGUMENT bytes arrive (or
      // finish() flushes an argument-less call): the block_start carries the
      // tool NAME verbatim and the Anthropic event model has no name-correction
      // event, so emitting at id-time would freeze a truncated name when a
      // fragmenting gateway delivers name fragments in chunks AFTER the
      // id-bearing one (chunk1 {id, name:"get_"}, chunk2 {name:"weather"}).
      // Gateways always complete the name before argument bytes begin, so
      // first-args is the earliest safe emission point; conforming single-chunk
      // senders (id + full name + args together) see no deferral at all.
      if (buf.id !== undefined && buf.args.length > 0) {
        if (!buf.emitted) {
          buf.index = this.openBlock(events, key, {
            type: 'tool_use',
            id: buf.id,
            name: buf.name,
            input: {},
          });
          buf.emitted = true;
        }
        if (buf.index !== undefined) {
          events.push({
            type: 'content_block_delta',
            index: buf.index,
            delta: { type: 'input_json_delta', partial_json: buf.args },
          });
          buf.args = '';
        }
      }
    }
    // Legacy singular function_call streaming (pre-tool_calls gateways):
    // mapFinishReason already treats finish_reason 'function_call' as tool_use,
    // but feed() never decoded the delta — so the turn ended stop_reason
    // 'tool_use' with ZERO tool_use blocks and the engine dropped the call.
    // Accumulate it into a dedicated buffer; this wire shape carries no id, so
    // finish()'s flush mints a synthetic one and emits one input_json_delta.
    // (audit r4 Roa-2.)
    const fc = delta.function_call;
    if (fc !== undefined && fc !== null) {
      if (
        (typeof fc.name === 'string' && fc.name.length > 0) ||
        (typeof fc.arguments === 'string' && fc.arguments.length > 0)
      ) {
        this.contentSeen = true;
      }
      const key = 'tool:function_call';
      let buf = this.toolBuffers.get(key);
      if (buf === undefined) {
        buf = { name: '', args: '', emitted: false };
        this.toolBuffers.set(key, buf);
      }
      if (typeof fc.name === 'string') buf.name += fc.name;
      if (typeof fc.arguments === 'string' && fc.arguments.length > 0) buf.args += fc.arguments;
    }
    return events;
  }

  /** Close all open blocks and emit message_delta + message_stop. Idempotent. */
  finish(): RawMessageStreamEvent[] {
    if (this.done) return [];
    this.done = true;
    if (!this.started) {
      throw new APIConnectionError(
        'Chat Completions stream ended before any chunk arrived',
      );
    }
    // An unrecognized non-empty finish_reason is a gateway-side abort (vLLM
    // 'abort', DeepSeek 'insufficient_system_resource', ...), NOT a clean
    // end-of-message: mapping it to end_turn would report a successful final
    // turn containing only the pre-abort fragment. Surface a truncated turn
    // instead — salvageable (midStreamTruncation) when content was delivered,
    // a plain failure otherwise. Started streams are never replayed.
    if (this.finishReason !== null && !KNOWN_FINISH_REASONS.has(this.finishReason)) {
      const failure = new APIConnectionError(
        `Chat Completions stream ended with unrecognized finish_reason ` +
          `"${this.finishReason}"; treating as a truncated turn, not a clean completion`,
      );
      failure.midStreamTruncation = this.contentSeen;
      throw failure;
    }
    const events: RawMessageStreamEvent[] = [];
    // Flush any tool buffer that never received an id: emit it with a synthetic
    // id (best effort) so a fragmented-id gateway still yields a callable
    // tool_use block rather than silently dropping the call. Ordered by first
    // appearance for stable indices.
    // The most-recent already-emitted tool_use block, to merge an args-only
    // orphan into (待裁④ — keeper 2026-07-16) rather than opening a bogus
    // empty-name block for it.
    let lastEmittedToolIndex: number | undefined;
    for (const b of this.toolBuffers.values()) {
      if (b.emitted && b.index !== undefined) {
        lastEmittedToolIndex =
          lastEmittedToolIndex === undefined ? b.index : Math.max(lastEmittedToolIndex, b.index);
      }
    }
    // Pass 1 — flush unemitted REAL calls (an id or a name arrived): B1 defers
    // block emission until the first argument bytes, so an argument-less call
    // (or one whose id never arrived) reaches finish() unemitted and is opened
    // here, with a synthetic id as the best-effort fallback. Runs before the
    // orphan pass so a late-flushed sibling is a valid merge target.
    for (const [key, buf] of this.toolBuffers) {
      if (buf.emitted) continue;
      if (buf.id === undefined && buf.name === '') continue; // orphans: pass 2
      buf.index = this.openBlock(events, key, {
        type: 'tool_use',
        id: buf.id ?? `call_${this.nextIndex}`,
        name: buf.name,
        input: {},
      });
      buf.emitted = true;
      if (buf.args.length > 0) {
        events.push({
          type: 'content_block_delta',
          index: buf.index,
          delta: { type: 'input_json_delta', partial_json: buf.args },
        });
      }
      lastEmittedToolIndex =
        lastEmittedToolIndex === undefined
          ? buf.index
          : Math.max(lastEmittedToolIndex, buf.index);
    }
    // Pass 2 — 待裁④: an args-only orphan (argument bytes but NO id and NO
    // name) is almost certainly a stray fragment of an already-emitted call
    // whose id/name arrived on a sibling key — a non-conforming gateway that
    // split one call across an id-only and an index-only fragment. Merge its
    // bytes into the most-recent emitted tool_use block instead of opening a
    // new empty-name block (which would never dispatch). A pure placeholder
    // buffer (`{index:N}` with nothing ever received) is skipped outright,
    // mirroring the contentSeen placeholder guard in feed().
    for (const buf of this.toolBuffers.values()) {
      if (buf.emitted) continue;
      if (buf.args === '') continue; // pure placeholder
      if (lastEmittedToolIndex !== undefined) {
        events.push({
          type: 'content_block_delta',
          index: lastEmittedToolIndex,
          delta: { type: 'input_json_delta', partial_json: buf.args },
        });
        buf.emitted = true; // consumed into the sibling block; no standalone block
        continue;
      }
      // No sibling anywhere to merge into. Every buffer reaching pass 2 is
      // NAMELESS and ID-LESS (pass 1 flushes anything carrying a name or id), so
      // emitting one would mint an empty-name tool_use block the engine can
      // never dispatch AND force stop_reason:'tool_use' for a call that does not
      // exist. Drop the stray argument bytes instead — the same "no bogus
      // empty-name block" rule the placeholder guard already applies; hasRealTool
      // below likewise does not count it. (audit r4 Roa-4.)
    }
    for (const index of [...this.open.values()].sort((a, b) => a - b)) {
      events.push({ type: 'content_block_stop', index });
    }
    this.open.clear();
    const cached = this.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const prompt = this.usage?.prompt_tokens ?? 0;
    // Missing finish_reason + real tool calls => infer 'tool_use' (audit
    // 2026-07-14 M-5): some gateways end a tool-call stream with a bare [DONE]
    // (or EOF) and never send finish_reason='tool_calls'. mapFinishReason(null)
    // defaults to 'end_turn', which makes the engine treat the turn as FINAL
    // and silently drop the model's tool calls. If this message opened/buffered
    // at least one REAL tool_use block, the only honest stop_reason is
    // 'tool_use'. An EXPLICIT finish_reason (including 'stop') is respected
    // regardless of open tool blocks — deliberate M-5 semantics. A pure
    // placeholder buffer does not count (same guard as the flush loop above).
    // A pure args-only orphan (argument bytes but no id, no name, never
    // emitted — a doubly malformed fragment dropped by pass 2) is NOT a
    // dispatchable tool call and must not force stop_reason:'tool_use' with no
    // matching block; count only buffers carrying a real dispatch signal.
    // (audit r4 Roa-4.)
    const hasRealTool = [...this.toolBuffers.values()].some(
      (b) => b.emitted || b.id !== undefined || b.name !== '',
    );
    // A delta.refusal that arrived with no stronger terminal signal (an
    // explicit tool/length/content_filter reason still wins) maps to
    // stop_reason 'refusal' rather than a fabricated 'end_turn'. (audit r4 Roa-1.)
    const stopReason: StopReason =
      this.finishReason === null && hasRealTool
        ? 'tool_use'
        : this.refusalSeen && (this.finishReason === null || this.finishReason === 'stop')
          ? 'refusal'
          : mapFinishReason(this.finishReason);
    events.push({
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      // OpenAI prompt_tokens INCLUDES cached tokens; Anthropic input_tokens
      // excludes cache reads — split so pricing/usage semantics line up.
      usage: {
        output_tokens: this.usage?.completion_tokens ?? 0,
        input_tokens: Math.max(0, prompt - cached),
        ...(cached > 0 ? { cache_read_input_tokens: cached } : {}),
      } as { output_tokens: number; input_tokens?: number },
    });
    events.push({ type: 'message_stop' });
    return events;
  }

  /** Return the block index for `key`, opening (and emitting
   *  content_block_start for) it on first sight. Blocks never close before
   *  finish() — see the class doc on interleaved deltas. */
  private openBlock(
    events: RawMessageStreamEvent[],
    key: string,
    block:
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string; signature?: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
  ): number {
    const existing = this.open.get(key);
    if (existing !== undefined) return existing;
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.open.set(key, index);
    events.push({
      type: 'content_block_start',
      index,
      content_block: block,
    });
    return index;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class OpenAIChatTransport implements Transport {
  private readonly provider: ProviderConfig;
  private readonly env: Record<string, string | undefined>;
  private readonly debug: (m: string) => void;
  private readonly credential: ResolvedCredential | null;
  private readonly endpoint: string;
  /** The HTTP client behind every request. Resolution: provider.fetch
   *  (injection seam, always wins) > httpClient 'node' (default since
   *  v0.45.0: the built-in keep-alive adapter, see node-http.ts) >
   *  httpClient 'fetch' -> undefined here, so the call site late-binds the
   *  CURRENT global fetch (a later setGlobalDispatcher / test stub still
   *  applies — the exact pre-v0.45 behavior). */
  private readonly fetchFn:
    | ((input: string | URL, init?: RequestInit) => Promise<Response>)
    | undefined;
  private readonly slots: RequestSemaphore | null;

  constructor(cfg: TransportConfig) {
    this.provider = cfg.provider ?? {};
    this.env = cfg.env;
    this.debug = cfg.debug;
    this.credential = resolveOpenAICredential(this.provider, cfg.env);
    this.fetchFn =
      this.provider.fetch ??
      (resolveHttpClient(this.provider, cfg.env) === 'node' ? getNodeFetch() : undefined);
    const maxConcurrent = resolveMaxConcurrent(this.provider, cfg.env);
    this.slots = maxConcurrent > 0 ? new RequestSemaphore(maxConcurrent) : null;
    const base = (
      this.provider.baseUrl ??
      nonEmpty(cfg.env.OPENAI_BASE_URL) ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    // Azure-style gateways route by query params (e.g. api-version); append
    // any configured extras once at construction (audit 2026-07-10 P1-4).
    const extras = Object.entries(this.provider.openai?.extraQueryParams ?? {});
    const query =
      extras.length > 0
        ? `?${new URLSearchParams(Object.fromEntries(extras)).toString()}`
        : '';
    this.endpoint = `${base}/chat/completions${query}`;
    // 方案丙: optional first-turn handshake warm-up, overlapped with query
    // init (MCP connect / session resolution). Default off.
    if (resolvePreconnect(this.provider, cfg.env)) {
      firePreconnect(this.fetchFn ?? fetch, this.endpoint, this.debug);
    }
  }

  apiKeySource(): ApiKeySource {
    return this.credential?.source ?? 'none';
  }

  async *stream(req: StreamRequest): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.slots) {
      yield* this.streamRequest(req);
      return;
    }
    // Pass the caller signal so a queued acquirer aborts promptly instead of
    // blocking on someone else's in-flight stream (twin of the Anthropic arm).
    const release = await this.slots.acquire(req.signal);
    try {
      yield* this.streamRequest(req);
    } finally {
      release();
    }
  }

  private async *streamRequest(
    req: StreamRequest,
  ): AsyncGenerator<RawMessageStreamEvent, void> {
    if (!this.credential) {
      throw new ConfigurationError(
        'No OpenAI-protocol credential found. Set options.provider.apiKey / ' +
          'options.provider.authToken or the OPENAI_API_KEY environment variable.',
      );
    }
    const { signal: callerSignal, onRetry, ...requestBody } = req;
    if (callerSignal?.aborted) throw new AbortError();

    // Wire-model remapping (audit 2026-07-10 P1-4): one knob that catches
    // every call site — main loop, generators' utility default, verifier,
    // subagent alias resolutions — instead of chasing per-site overrides.
    const opts = this.provider.openai ?? {};
    const mappedModel = opts.modelMap?.[requestBody.model] ?? requestBody.model;
    if (mappedModel !== requestBody.model) {
      this.debug(`openai transport: model ${requestBody.model} -> ${mappedModel} (modelMap)`);
    } else if (requestBody.model.includes('claude')) {
      this.debug(
        `openai transport: WARNING sending Claude model id "${requestBody.model}" to an ` +
          `OpenAI-protocol endpoint (likely 404). Map it via provider.openai.modelMap ` +
          `or set the model explicitly.`,
      );
    }
    let bodyJson: string;
    try {
      bodyJson = JSON.stringify(
        encodeOpenAIRequest(
          { ...requestBody, model: mappedModel },
          opts,
          this.debug,
          this.provider.capabilities,
        ),
      );
    } catch (err) {
      // The encode error is already locatable and byte-free (media_type +
      // block path only); mirror it on the debug channel and surface as-is.
      this.debug(`openai transport: request encoding failed (${errorMessage(err)})`);
      throw err;
    }
    const headers = this.buildHeaders(this.credential);
    // timeoutMs: 0 disables the whole-request timeout, consistent with the
    // idle-watchdog / stream-hard-cap "0 = disabled" convention (previously 0
    // armed AbortSignal.timeout(0) and instantly aborted every request).
    // AbortSignal.timeout cannot express "never", so 0 maps to the setTimeout
    // ceiling (~24.8 days — effectively unbounded for a single request).
    const configuredTimeoutMs = this.provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Clamp to Node's 32-bit setTimeout ceiling (A2 parity with the Anthropic
    // arm): an over-ceiling value overflows to ~1ms and kills every request.
    const timeoutMs =
      configuredTimeoutMs > 0
        ? Math.min(configuredTimeoutMs, MAX_TIMEOUT_MS)
        : MAX_TIMEOUT_MS;
    const maxRetries = resolveMaxRetries(this.provider, this.env);
    // Body-governance rule (resilience P1): same composite rule as the
    // Anthropic arm — request timeout governs connect->headers; the flowing
    // body is governed by the idle watchdog + optional streamMaxDurationMs
    // hard cap, with the request timeout as fallback when both are off.
    const streamMaxMs = resolveStreamMaxMs(this.provider, this.env);

    // Empty-stream retry (断流继续臂): an HTTP 200 whose SSE body carries ZERO
    // chunks before closing CLEANLY is a replay-SAFE non-start — the gateway
    // accepted the request but delivered nothing (an idealab-style throttle
    // shape observed under concurrent fan-out). Unlike a mid-stream drop
    // (chunks already yielded, which must never replay a partially consumed
    // turn), zero chunks means zero consumption, so re-issuing the whole
    // request is safe. Retried HERE, inside the transport, so BOTH the main
    // conversation and subagents (which run on this same transport, out of
    // reach of any host-level retry) self-heal without the caller seeing the
    // empty stream. Bounded by the same maxRetries budget; on exhaustion we
    // surface a retryable-class `empty_stream` APIConnectionError. This mirrors
    // AnthropicTransport's arm — a LOCAL copy because the streaming bodies
    // genuinely differ (translation vs raw passthrough), so streamRequest is
    // NOT a transport twin (see tests/transport-twin-drift.test.ts). A network
    // ERROR mid-stream (parseSSE throws) still routes through the catch below
    // and is NEVER retried, empty or not.
    let emptyStreamRetries = 0;
    // Finding T2 — one retry budget shared by request-phase retries AND
    // empty-stream re-issues (see the Anthropic arm), so the total is bounded by
    // maxRetries rather than maxRetries per re-issue on a struggling gateway.
    const retryBudget = { used: 0 };
    for (;;) {
      // ---- request phase: retries allowed ---------------------------------
      const { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals } =
        await this.requestWithRetries(
          bodyJson,
          headers,
          callerSignal,
          timeoutMs,
          maxRetries,
          retryBudget,
          onRetry,
        );

      // ---- streaming phase: NEVER retried once a chunk is delivered --------
      // OpenAI-protocol servers/gateways report the correlation id as
      // x-request-id (some proxies keep Anthropic's request-id); capture either
      // so APIStatusError carries the same diagnosability as the Anthropic arm.
      const requestId =
        response.headers.get('x-request-id') ??
        response.headers.get('request-id') ??
        undefined;
      if (!response.body) {
        // Mirror of the Anthropic arm: a body-less 2xx bypasses the stream
        // teardown, so detach the caller/timeout abort listeners before
        // throwing or they leak one pair per turn.
        releaseSignals();
        throw new APIConnectionError('Chat Completions response has no body');
      }
      const idleMs = resolveStreamIdleMs(this.provider, this.env);
      const idleController = idleMs > 0 ? new AbortController() : undefined;
      // P1 body governance (mirrors the Anthropic arm): detach the request
      // timeout from the body unless BOTH body governors are off.
      const timeoutDetached = idleController !== undefined || streamMaxMs > 0;
      if (timeoutDetached) detachRequestTimeout();
      const maxController = streamMaxMs > 0 ? new AbortController() : undefined;
      let maxTimer: ReturnType<typeof setTimeout> | undefined;
      if (maxController !== undefined) {
        maxTimer = setTimeout(() => maxController.abort(), streamMaxMs);
        (maxTimer as { unref?: () => void }).unref?.();
      }
      const signalParts = [
        signal,
        ...(idleController ? [idleController.signal] : []),
        ...(maxController ? [maxController.signal] : []),
      ];
      const streamSignal =
        signalParts.length > 1 ? AbortSignal.any(signalParts) : signal;
      // Lazily re-armed watchdog (see the anthropic twin for the rationale):
      // per-event cost is one timestamp write; the single timer re-arms for
      // the remaining gap and still aborts idleMs after the LAST event.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let lastEventAt = 0;
      // audit 2026-07-14 L-3 (twin of the anthropic arm): the watchdog
      // measures SERVER progress, not consumer progress — while the consumer
      // holds a yielded event the expiry check re-arms instead of aborting;
      // the clock restarts when the consumer resumes (resetIdle after the
      // yield). Stall detection during a long consumer pause is deferred
      // until the consumer resumes (worst case ~2x idleMs).
      let consumerHolds = false;
      // Monotonic clock (performance.now()), NOT wall-clock Date.now(): an NTP
      // step or manual clock set backward would make (now - lastEventAt) go
      // negative, so `remaining` exceeds idleMs and the watchdog re-arms forever
      // on a genuinely stalled stream. performance.now() never moves backward.
      // (audit r4 Rdt-1, openai idle-watchdog side.)
      const armIdle = (delay: number): void => {
        idleTimer = setTimeout(() => {
          const remaining = idleMs - (performance.now() - lastEventAt);
          if (remaining <= 0) {
            if (consumerHolds) armIdle(idleMs);
            else idleController!.abort();
          } else armIdle(remaining);
        }, delay);
        (idleTimer as { unref?: () => void }).unref?.();
      };
      const resetIdle = (): void => {
        lastEventAt = performance.now();
        if (!idleController || idleTimer !== undefined) return;
        armIdle(idleMs);
      };
      const translator = new OpenAIStreamTranslator(req.model);
      let chunkCount = 0;
      let doneSeen = false;
      try {
        resetIdle();
        for await (const frame of parseSSE(response.body, streamSignal)) {
          resetIdle();
          const data = frame.data.trim();
          if (data === '[DONE]') {
            doneSeen = true;
            break;
          }
          let parsed: OpenAIChunk;
          try {
            parsed = JSON.parse(data) as OpenAIChunk;
          } catch (err) {
            throw new APIConnectionError(
              `Malformed Chat Completions SSE payload after ${chunkCount} chunk(s): ` +
                data.slice(0, 120),
              err,
              'sse_malformed_frame',
            );
          }
          if (parsed.error !== undefined && parsed.error !== null) {
            const info = extractOpenAIError(parsed.error);
            // An in-stream error chunk carries no HTTP status (the response was
            // 200), so derive one from the error type instead of hardcoding 500:
            // a mid-stream rate-limit / quota / auth error must classify as
            // 429 / 401 etc. so the engine's fallback + the caller see the right
            // class (the Anthropic arm likewise maps its in-stream error type).
            // A `status` the gateway put in the body wins over the derived one.
            throw new APIStatusError(
              info.status ?? statusForOpenAIErrorType(info.type),
              info.type,
              info.message,
              info.requestId ?? requestId,
              info.code !== undefined ? { providerErrorCode: info.code } : undefined,
            );
          }
          chunkCount += 1;
          // audit 2026-07-14 L-3: mark the consumer-hold window around the
          // yield so the idle watchdog never counts a paused consumer as a
          // stalled connection; restart the idle clock when it resumes.
          consumerHolds = true;
          yield* translator.feed(parsed);
          consumerHolds = false;
          resetIdle();
        }
      } catch (err) {
        // H3 (audit T49): once an explicit finish_reason has arrived the
        // message is COMPLETE per the Chat Completions protocol — but unlike
        // the Anthropic arm (which returns at message_stop, its true terminal
        // frame), this arm keeps reading for a `[DONE]` / usage tail that a
        // gateway may never send while holding the connection open. A
        // connection-layer failure in that tail window (the idle watchdog
        // firing on the dangling socket, a reset while waiting for [DONE])
        // previously DISCARDED the fully received turn as a stream error —
        // and a retried turn re-runs whatever side effects it carried.
        // Complete the turn instead: the CONTENT is whole by protocol. The
        // trailing include_usage chunk (sent after finish_reason) may be
        // lost, under-reporting this turn's tokens — an accepted, logged
        // degradation, strictly better than voiding the whole answer. A real
        // in-stream error frame (APIStatusError) and a caller abort still
        // propagate.
        if (
          translator.sawFinishReason() &&
          !(err instanceof APIStatusError) &&
          callerSignal?.aborted !== true
        ) {
          this.debug(
            `openai transport: stream errored after finish_reason ` +
              `(${chunkCount} chunk(s)); completing the received turn ` +
              `instead of discarding it (${errorMessage(err)})`,
          );
          yield* translator.finish();
          return;
        }
        throw mapStreamError(err, {
          callerSignal,
          timeoutSignal,
          timeoutMs,
          timeoutGovernsBody: !timeoutDetached,
          chunkCount,
          sawMessageStart: translator.hasStarted(),
          idleSignal: idleController?.signal,
          idleMs,
          maxSignal: maxController?.signal,
          streamMaxMs,
        });
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        if (maxTimer) clearTimeout(maxTimer);
        releaseSignals();
      }

      // The stream ended without throwing. Decide the outcome from THREE
      // independent facts, not the raw chunk count alone: whether a terminator
      // arrived (doneSeen), whether an explicit finish_reason arrived
      // (sawFinishReason), and whether any VALID assistant content arrived
      // (sawContent). `chunkCount > 0` only proves a frame was delivered — a
      // gateway can stream role-only / usage-only metadata then close with a
      // bare [DONE], which is NOT a completed message. (BPT 2026-07-13: idealab
      // "turn stop / hasAssistantMessage:false" — an empty message billed as a
      // null-stop_reason success.)
      const sawContent = translator.sawContent();
      const sawFinish = translator.sawFinishReason();

      // Completed message, case 1: an explicit finish_reason is BOTH a
      // terminator and — per the Chat Completions protocol — a real
      // end-of-message, even when the text is empty (finish_reason:'stop' with
      // no content is a legitimate, if unusual, response). Keep its protocol
      // semantics; a finish_reason chunk always incremented chunkCount first.
      if (chunkCount > 0 && sawFinish) {
        yield* translator.finish();
        this.debug(`openai transport: stream completed after ${chunkCount} chunk(s)`);
        return;
      }
      // Completed message, case 2: a [DONE] terminator paired with valid
      // assistant content (text / reasoning / tool_calls) is the normal
      // completion path.
      if (chunkCount > 0 && doneSeen && sawContent) {
        yield* translator.finish();
        this.debug(`openai transport: stream completed after ${chunkCount} chunk(s)`);
        return;
      }
      // The "empty finish": a [DONE] arrived (chunkCount > 0, so metadata frames
      // WERE delivered — role-only / usage-only), but with NO valid assistant
      // content AND NO finish_reason. This is exactly the shape that produced
      // the idealab empty turns. It is NOT a completed message: never fabricate
      // a stop_reason:null / subtype:'success' / empty assistant message from
      // it. A started (chunkCount > 0) stream is not replay-safe, so it is NOT
      // retried; surface a diagnosable, non-replay-safe `empty_message`
      // APIConnectionError (no turnReplaySafe / midStreamTruncation flags) so
      // the engine reports error_during_execution with error_code
      // 'empty_message'. Twin of AnthropicTransport's message_stop guard.
      if (chunkCount > 0 && doneSeen && !sawContent) {
        if (callerSignal?.aborted) throw new AbortError();
        throw new APIConnectionError(
          `OpenAI Chat Completions stream received [DONE] after ${chunkCount} chunk(s) ` +
            `with no valid assistant content and no finish_reason; treating as a failed ` +
            `turn (empty message)`,
          undefined,
          'empty_message',
        );
      }

      // No end-of-message marker (or a bare [DONE] with no chunks). ZERO chunks
      // => an empty stream (replay-safe): retry the whole request within the
      // shared budget, like the Anthropic arm's idealab-throttle self-heal. Any
      // caller abort observed here wins.
      if (chunkCount === 0) {
        if (callerSignal?.aborted) throw new AbortError();
        if (retryBudget.used < maxRetries) {
          retryBudget.used += 1;
          emptyStreamRetries += 1;
          this.debug(
            `openai transport: empty stream (HTTP 200, zero SSE chunks); ` +
              `retry ${retryBudget.used}/${maxRetries}`,
          );
          // Surface it like a network-level retry (no HTTP status) so the loop
          // emits an api_retry observability message, same as a dropped socket.
          onRetry?.({ attempt: retryBudget.used, maxRetries, kind: 'empty_stream' });
          await this.backoff(retryBudget.used, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Chat Completions returned an empty stream (HTTP 200, zero SSE chunks) ` +
            `after ${emptyStreamRetries + 1} attempt(s)`,
          undefined,
          'empty_stream',
        );
      }

      // Metadata-only close WITHOUT any terminator: role-/usage-only frames,
      // then the connection ended. There is no half-received answer to
      // salvage, so this is the same "empty message" failure as the [DONE]
      // variant above — flagging it midStreamTruncation made the engine run
      // E3 salvage on an empty turn. Started streams are never replayed.
      if (!sawContent) {
        if (callerSignal?.aborted) throw new AbortError();
        throw new APIConnectionError(
          `Chat Completions stream closed after ${chunkCount} metadata-only chunk(s) ` +
            `with no valid assistant content, no finish_reason, and no [DONE]; ` +
            `treating as a failed turn (empty message)`,
          undefined,
          'empty_message',
        );
      }

      // Chunks arrived but no [DONE]/finish_reason: a MID-STREAM connection drop
      // (proxy timeout, server restart). Do NOT fabricate an end_turn success
      // from the half-received answer — surface it as a truncated turn so the
      // engine's E3 salvage applies, matching the Anthropic arm. NEVER retried
      // (replaying a partially consumed turn is unsafe). (Audit 2026-07-10 P1-2.)
      const failure = new APIConnectionError(
        `Chat Completions stream ended without [DONE] or finish_reason after ` +
          `${chunkCount} chunk(s); treating as a truncated turn`,
      );
      failure.midStreamTruncation = true;
      throw failure;
    }
  }

  /** Same retry policy as AnthropicTransport: 408/429/5xx + network errors
   *  retry with exponential backoff + jitter, honoring retry-after (seconds);
   *  other 4xx fail immediately; the streaming phase is never retried. */
  private async requestWithRetries(
    bodyJson: string,
    headers: Record<string, string>,
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
    maxRetries: number,
    // Finding T2 — shared retry budget (see streamRequest / the Anthropic arm).
    retryBudget: { used: number },
    onRetry?: (info: RetryInfo) => void,
  ): Promise<{
    response: Response;
    signal: AbortSignal;
    timeoutSignal: AbortSignal;
    /** Stop propagating the whole-request timeout into the accepted response's
     *  body (P1 body governance; called once headers arrive and a body
     *  governor — idle watchdog / hard cap — is active). */
    detachRequestTimeout: () => void;
    /** Drop the caller/timeout abort listeners once the stream is finished so
     *  a long-lived caller signal does not accumulate one listener per turn. */
    releaseSignals: () => void;
  }> {
    for (;;) {
      if (callerSignal?.aborted) throw new AbortError();
      // Fresh timeout per attempt, propagated into a DEDICATED per-attempt
      // controller so the body phase can later detach the timeout leg without
      // dropping the caller leg (AbortSignal.any is compose-once; a dedicated
      // controller is the only way to unsubscribe one source).
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const attemptController = new AbortController();
      const abortFromCaller = (): void =>
        attemptController.abort(
          (callerSignal as { reason?: unknown } | undefined)?.reason,
        );
      const abortFromTimeout = (): void =>
        attemptController.abort((timeoutSignal as { reason?: unknown }).reason);
      callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
      timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });
      const detachRequestTimeout = (): void =>
        timeoutSignal.removeEventListener('abort', abortFromTimeout);
      const releaseSignals = (): void => {
        callerSignal?.removeEventListener('abort', abortFromCaller);
        timeoutSignal.removeEventListener('abort', abortFromTimeout);
      };
      const signal = attemptController.signal;

      let response: Response;
      try {
        this.debug(
          `openai transport: POST ${this.endpoint} (attempt ${retryBudget.used + 1}/${maxRetries + 1})`,
        );
        response = await (this.fetchFn ?? fetch)(this.endpoint, {
          method: 'POST',
          headers,
          body: bodyJson,
          signal,
        });
      } catch (err) {
        releaseSignals();
        if (callerSignal?.aborted) throw new AbortError();
        // Connection failure or per-attempt timeout: retryable.
        if (retryBudget.used < maxRetries) {
          retryBudget.used += 1;
          this.debug(
            `openai transport: network error (${errorMessage(err)}); retry ${retryBudget.used}/${maxRetries}`,
          );
          onRetry?.({
            attempt: retryBudget.used,
            maxRetries,
            kind: 'network',
            message: errorMessage(err),
          });
          await this.backoff(retryBudget.used, undefined, callerSignal);
          continue;
        }
        throw new APIConnectionError(
          `Failed to reach ${this.endpoint}: ${errorMessage(err)}`,
          err,
        );
      }

      if (response.ok) {
        return { response, signal, timeoutSignal, detachRequestTimeout, releaseSignals };
      }

      // Request id: prefer the response header, fall back to a request_id the
      // gateway put in the error body.
      const requestId =
        response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined;
      // Keep the abort listeners attached while draining the error body: the
      // per-attempt signal is wired into the response stream, so a caller
      // interrupt (or the request timeout) can still cancel a gateway that
      // sent error headers and then stalled the body; the drain itself is
      // additionally capped by ERROR_BODY_TIMEOUT_MS (audit 2026-07-14 H-1).
      const info = await readOpenAIErrorInfo(response, signal).finally(releaseSignals);
      if (callerSignal?.aborted) throw new AbortError();
      const resolvedRequestId = requestId ?? info.requestId;
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      // A 429 whose machine code says the QUOTA is exhausted (OpenAI
      // `insufficient_quota`) is permanent for this key — no amount of backoff
      // revives a spent billing account. Burning the full retry budget on it
      // (minutes of futile 429→backoff rounds) delays the actionable error;
      // the in-stream arm already classifies quota separately, so the
      // request-phase gate must too. This keys on the documented machine code,
      // not fuzzy message matching (isRetryableHttpStatus's philosophy holds:
      // an ordinary 429 stays retryable).
      const permanentQuota =
        response.status === 429 &&
        (info.code === 'insufficient_quota' || info.type === 'insufficient_quota');
      const retryable =
        !permanentQuota &&
        (response.status === 408 || response.status === 429 || response.status >= 500);
      if (retryable && retryBudget.used < maxRetries) {
        retryBudget.used += 1;
        this.debug(
          `openai transport: HTTP ${response.status} (${info.type}); retry ${retryBudget.used}/${maxRetries}`,
        );
        onRetry?.({
          attempt: retryBudget.used,
          maxRetries,
          status: response.status,
          errorType: info.type,
          kind: 'http_status',
          message: info.message,
          ...(resolvedRequestId !== undefined ? { requestId: resolvedRequestId } : {}),
          ...(info.code !== undefined ? { code: info.code } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
        await this.backoff(retryBudget.used, retryAfterMs, callerSignal);
        continue;
      }
      throw new APIStatusError(
        response.status,
        info.type,
        info.message,
        resolvedRequestId,
        {
          ...(info.code !== undefined ? { providerErrorCode: info.code } : {}),
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        },
      );
    }
  }

  /** Exponential backoff (base 1s, factor 2) with jitter; retry-after wins. */
  private async backoff(
    attempt: number,
    retryAfterMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const exponential = BACKOFF_BASE_MS * BACKOFF_FACTOR ** (attempt - 1);
    // Bounded jitter in [0.5, 1.0] x the exponential delay.
    const jittered = exponential * (0.5 + Math.random() * 0.5);
    // audit 2026-07-14 L-2: jitter the explicit Retry-After path too. Without
    // it a fan-out of subagents that all receive the same "Retry-After: 30"
    // wake in the SAME instant (thundering herd). Spread UP only — never
    // EARLIER than the server asked — then re-cap at the parser's ceiling so a
    // jittered value can never exceed RETRY_AFTER_MAX_MS.
    const delay =
      retryAfterMs !== undefined
        ? Math.min(retryAfterMs * (1 + Math.random() * RETRY_AFTER_JITTER), RETRY_AFTER_MAX_MS)
        : Math.min(jittered, BACKOFF_MAX_MS);
    this.debug(`openai transport: backing off ${Math.round(delay)}ms`);
    await sleep(delay, signal);
  }

  private buildHeaders(credential: ResolvedCredential): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    };
    for (const [key, value] of Object.entries(this.provider.defaultHeaders ?? {})) {
      headers[key.toLowerCase()] = value;
    }
    // Credential header (audit 2026-07-10 P1-4): default Bearer authorization;
    // a custom header name (e.g. Azure's 'api-key') carries the RAW key.
    const authHeader = (this.provider.openai?.authHeaderName ?? 'authorization').toLowerCase();
    headers[authHeader] =
      authHeader === 'authorization' ? `Bearer ${credential.value}` : credential.value;
    return headers;
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** provider.apiKey / provider.authToken ('user') > OPENAI_API_KEY ('project');
 *  both travel as `Authorization: Bearer` (the OpenAI protocol's only scheme). */
function resolveOpenAICredential(
  provider: ProviderConfig,
  env: Record<string, string | undefined>,
): ResolvedCredential | null {
  const providerKey = nonEmpty(provider.apiKey) ?? nonEmpty(provider.authToken);
  if (providerKey) return { value: providerKey, source: 'user' };
  const envKey = nonEmpty(env.OPENAI_API_KEY);
  if (envKey) return { value: envKey, source: 'project' };
  return null;
}

/** Map an OpenAI in-stream error's `type` (or code-ish string) to an HTTP-ish
 *  status so a mid-stream failure classifies like its non-2xx counterpart —
 *  the engine's retry/fallback and the caller both switch on status. Unknown
 *  types fall back to 500 (the previous hardcoded value). */
function statusForOpenAIErrorType(type: string): number {
  switch (type) {
    case 'rate_limit_error':
    case 'rate_limit_exceeded':
    case 'insufficient_quota':
    case 'requests':
    case 'tokens':
      return 429;
    case 'invalid_request_error':
    case 'invalid_prompt':
      return 400;
    case 'authentication_error':
    case 'invalid_api_key':
      return 401;
    case 'permission_error':
    case 'insufficient_permissions':
      return 403;
    case 'not_found_error':
      return 404;
    case 'overloaded_error':
    case 'server_overloaded':
      return 529;
    default:
      return 500;
  }
}

/** Diagnostic fields lifted from an OpenAI-protocol error payload. */
type OpenAIErrorInfo = {
  type: string;
  message: string;
  code?: string;
  status?: number;
  requestId?: string;
};

function extractOpenAIError(error: unknown): OpenAIErrorInfo {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    const type = e.type;
    const message = e.message;
    // Meta (status/code/request_id) is lifted via the shared extractor by
    // wrapping the error object in an `error` envelope; the MESSAGE keeps the
    // historical semantics (string message, else JSON.stringify) so existing
    // consumers and mutation-kill tests see the exact same text.
    const meta = extractProviderErrorObject({ error: e });
    const out: OpenAIErrorInfo = {
      type: typeof type === 'string' ? type : 'api_error',
      message: typeof message === 'string' ? message : JSON.stringify(error),
    };
    if (meta?.code !== undefined) out.code = meta.code;
    if (meta?.status !== undefined) out.status = meta.status;
    if (meta?.requestId !== undefined) out.requestId = meta.requestId;
    return out;
  }
  return { type: 'api_error', message: String(error) };
}

/** Additive meta fields (code/status/requestId) of an OpenAIErrorInfo, spread
 *  into a returned info without touching type/message. */
function meta(info: OpenAIErrorInfo): Partial<OpenAIErrorInfo> {
  return {
    ...(info.code !== undefined ? { code: info.code } : {}),
    ...(info.status !== undefined ? { status: info.status } : {}),
    ...(info.requestId !== undefined ? { requestId: info.requestId } : {}),
  };
}

/** Read a non-2xx body; normalize the error type to Anthropic vocabulary by
 *  status (engine-side handling switches on those), keep the server message.
 *  A non-JSON body (a plain-text 5xx page) yields a readable message. */
/** Hard cap on draining a non-2xx error body. A gateway that returns error
 *  headers and then stalls the body must not hang the retry loop forever —
 *  the default 'node' http client has no body timeout of its own. On expiry
 *  the body is cancelled best-effort and the status-line fallback is used
 *  (audit 2026-07-14 H-1). */
const ERROR_BODY_TIMEOUT_MS = 10_000;

/** Read a response body as text, bounded by ERROR_BODY_TIMEOUT_MS and the
 *  given abort signal. Rejection means "body unavailable" — callers fall
 *  back to the status line. */
function readBodyTextBounded(
  response: Response,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const cancelBody = (): void => {
      void response.body?.cancel().catch(() => {});
    };
    const onAbort = (): void => {
      cancelBody();
      settle(() => reject(new AbortError()));
    };
    const timer = setTimeout(() => {
      cancelBody();
      settle(() => reject(new APIConnectionError('error body read timed out')));
    }, ERROR_BODY_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    response.text().then(
      (text) => settle(() => resolve(text)),
      (err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

async function readOpenAIErrorInfo(
  response: Response,
  signal?: AbortSignal,
): Promise<OpenAIErrorInfo> {
  const normalizedType =
    STATUS_ERROR_TYPE[response.status] ??
    (response.status >= 500 ? 'api_error' : 'invalid_request_error');
  let text = '';
  try {
    text = await readBodyTextBounded(response, signal);
  } catch {
    // Body unavailable (aborted / half-closed / stalled past the drain cap);
    // fall through to the fallback.
  }
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (parsed.error !== undefined && parsed.error !== null) {
        // Keep the historical message derivation (incl. a STRING error member
        // -> String(error)); meta (status/code/request_id) is additive.
        const info = extractOpenAIError(parsed.error);
        return { type: normalizedType, message: info.message, ...meta(info) };
      }
      // A bare top-level { message, status } (no error envelope).
      const bare = extractProviderErrorObject(parsed);
      if (bare !== null) {
        return {
          type: normalizedType,
          message: bare.message,
          ...(bare.code !== undefined ? { code: bare.code } : {}),
          ...(bare.status !== undefined ? { status: bare.status } : {}),
          ...(bare.requestId !== undefined ? { requestId: bare.requestId } : {}),
        };
      }
    } catch {
      // Not JSON; use raw text below.
    }
  }
  return {
    type: normalizedType,
    // sliceSurrogateSafe, not a raw slice: the 2000-char cut must not split a
    // surrogate pair and leave a lone surrogate in the error message (it would
    // serialize as U+FFFD wherever the error is logged/replayed). (audit r4
    // R7s-7, openai boundMessage side.)
    message:
      sliceSurrogateSafe(text, 2_000) || `HTTP ${response.status} ${response.statusText}`,
  };
}

/** A server Retry-After is honored fully up to this ceiling (twin of the
 *  Anthropic arm): a "wait 90s" is respected rather than clamped to the
 *  exponential cap and retried early into the same limit; bounded so a
 *  pathological value cannot hang the agent. */
const RETRY_AFTER_MAX_MS = 120_000;

/** Exported for unit tests (retry-after cap coverage). */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  // Only a plain decimal is the delta-seconds form. Number('') is 0 (not NaN),
  // so a whitespace-only header would otherwise return 0 (retry immediately)
  // instead of falling through to be ignored; Number() also over-accepts
  // '0x1f'/'1e3'. A numeric-shape gate keeps those out of the seconds branch.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, RETRY_AFTER_MAX_MS);
    }
  }
  // HTTP-date form (RFC 7231) — proxies/CDNs emit it; previously dropped.
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

type StreamErrorContext = {
  callerSignal: AbortSignal | undefined;
  timeoutSignal: AbortSignal;
  timeoutMs: number;
  timeoutGovernsBody: boolean;
  chunkCount: number;
  sawMessageStart: boolean;
  idleSignal?: AbortSignal;
  idleMs?: number;
  maxSignal?: AbortSignal;
  streamMaxMs?: number;
};

function mapStreamError(err: unknown, ctx: StreamErrorContext): Error {
  const { callerSignal, timeoutSignal, timeoutMs, chunkCount, sawMessageStart } = ctx;
  // Disconnect-taxonomy flags (resilience P0/P1): every terminal stream error
  // carries the pair the engine acts on — `midStreamTruncation` (events were
  // delivered whole; salvage may apply) and `turnReplaySafe` (NOTHING was
  // delivered, so re-issuing the turn cannot double-consume content or tool
  // side effects; the engine may replay within its bounded budget).
  // Both key on sawMessageStart, not raw eventCount: a `ping` keep-alive is a
  // processed frame but carries no message content, so a ping-only stream that
  // then dies is byte-for-byte the same silence as a zero-event one — it must
  // classify identically (replay-safe, nothing to salvage) instead of getting
  // the opposite disposition because a keep-alive happened to arrive first.
  const flag = (failure: APIConnectionError): APIConnectionError => {
    failure.turnReplaySafe = !sawMessageStart;
    return failure;
  };
  if (err instanceof APIStatusError) return err;
  if (callerSignal?.aborted) {
    return err instanceof AbortError ? err : new AbortError();
  }
  // Idle watchdog fired (checked before the whole-request timeout, which it
  // pre-empts): the stream stalled with no server event. Terminal at the
  // transport (the streaming phase is never retried here); a zero-event stall
  // is turn-replay-safe for the engine.
  if (ctx.idleSignal?.aborted) {
    return flag(
      new APIConnectionError(
        `Chat Completions stream idle for ${ctx.idleMs}ms with no server event after ` +
          `${chunkCount} chunk(s); aborted`,
        err,
        'stream_idle_timeout',
      ),
    );
  }
  // Hard cap on total streaming duration fired (streamMaxDurationMs). Unlike
  // the idle watchdog this cuts a FLOWING stream, so blocks delivered whole
  // stay salvageable.
  if (ctx.maxSignal?.aborted) {
    const failure = flag(
      new APIConnectionError(
        `Chat Completions stream exceeded the streamMaxDurationMs hard cap ` +
          `(${ctx.streamMaxMs}ms) after ${chunkCount} chunk(s); aborted`,
        err,
        'stream_max_duration',
      ),
    );
    failure.midStreamTruncation = sawMessageStart;
    return failure;
  }
  // Whole-request timeout during the body: only reachable in the fallback
  // configuration (idle watchdog disabled, no hard cap). Delivered-whole
  // blocks stay salvageable here too (P1: salvage-on-timeout).
  if (ctx.timeoutGovernsBody && timeoutSignal.aborted) {
    const failure = flag(
      new APIConnectionError(
        `Chat Completions stream timed out after ${timeoutMs}ms`,
        err,
      ),
    );
    failure.midStreamTruncation = sawMessageStart;
    return failure;
  }
  if (err instanceof APIConnectionError) return err;
  if (isAbortError(err)) {
    return err instanceof AbortError ? err : new AbortError(errorMessage(err));
  }
  const failure = flag(
    new APIConnectionError(
      `Chat Completions stream failed after ${chunkCount} chunk(s): ${errorMessage(err)}`,
      err,
    ),
  );
  // E3: a connection that dropped after delivering events is a TRUNCATED
  // turn - the engine may salvage the completed blocks (official 2.1.201
  // does; conformance run-l4 KD-L4-02/04).
  failure.midStreamTruncation = sawMessageStart;
  return failure;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
