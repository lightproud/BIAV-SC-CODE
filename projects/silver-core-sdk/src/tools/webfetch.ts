/**
 * Built-in WebFetch tool: fetch a URL and return its content as plain text.
 *
 * There is no summarizer model in the direct-API design, so this returns the
 * converted + truncated page text rather than a prompt-answered summary; the
 * `prompt` input is carried by the model's own turn and it consumes the text
 * next turn.
 *
 * Safety: an SSRF guard blocks localhost / private / link-local / ULA / CGNAT
 * addresses (IP literals AND resolved DNS results) unless
 * ctx.allowPrivateWebFetch is true.
 *
 * DNS pinning (audit 2026-07-14 M-3): the guard's lookup and the fetch used
 * to be two INDEPENDENT resolutions, leaving a classic DNS-rebinding window
 * (validate public IP, then the attacker's DNS answers a private IP for the
 * actual connection). The default path now connects through node:https with a
 * custom `lookup` that returns ONLY the guard-validated addresses, while Host
 * and TLS SNI/cert verification stay on the original hostname. Redirect hops
 * re-run guard + pinning per hop. HONEST LIMIT: a caller-injected
 * ctx.fetchImpl does its own connection handling and BYPASSES pinning (it
 * still goes through the per-hop guard); injection is a test/ops escape hatch
 * and inherits the old rebinding window.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { sliceSurrogateSafe } from '../internal/text.js';
import { MAX_READ_OUTPUT_CHARS } from './fsutil.js';
import type { WebFetchStructuredOutput } from '../types/tool-outputs.js';
import { AbortError, isAbortError } from '../errors.js';
import { SDK_USER_AGENT } from '../version.js';
import { WEBFETCH_DESCRIPTION } from './descriptions.js';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
/**
 * A fetched page enters the context as raw text, exactly like a Read of a
 * remote file, so it shares Read's cap. (Claude Code's 100_000 is NOT the same
 * quantity: there it bounds the markdown handed to a summarizer model, and only
 * that model's summary reaches the context. This harness has no summarizer, so
 * copying that number made WebFetch the one tool able to push 100K chars of the
 * least controllable source — an arbitrary web page — straight into the
 * context, twice what a local Read may push. Referenced, not re-literalled, so
 * the two gates cannot drift apart; fsutil.ts:32 already documents the
 * intended alignment.)
 */
export const MAX_OUTPUT_CHARS = MAX_READ_OUTPUT_CHARS;
const USER_AGENT = SDK_USER_AGENT;
const ACCEPT_HEADER =
  'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain;q=0.8,*/*;q=0.5';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/** Diagnosable message for ANY thrown value (audit 2026-07-17 L74). L74 fixed
 *  websearch.ts and resources.ts — the two tools that call a HOST-supplied
 *  callback — and missed WebFetch, which calls one too (`ctx.fetchImpl`). An
 *  injected fetch rejecting with a string or a plain object rendered
 *  "WebFetch failed: undefined" through the blind `(e as Error).message` cast,
 *  losing the only diagnostic there was. */
function thrownMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

// -- SSRF address classification --------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function ipv4Blocked(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  const inRange = (base: string, prefix: number): boolean => {
    const b = ipv4ToInt(base);
    if (b === null) return false;
    if (prefix === 0) return true;
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network / unspecified
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) || // IETF protocol assignments
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    n === 0xffffffff // broadcast
  );
}

/** Expand an IPv6 literal to its 8 16-bit groups; null when unparseable. */
function parseIpv6Groups(ip: string): number[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s.length === 0) return [];
    const out: number[] = [];
    for (const h of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };
  const head = toGroups(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 2) {
    const tail = toGroups(halves[1] ?? '');
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

function ipv6Blocked(ipRaw: string): boolean {
  let ip = ipRaw.toLowerCase();
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct); // strip zone id
  // IPv4-mapped (::ffff:a.b.c.d, dotted form) -> evaluate the embedded IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (mapped) return ipv4Blocked(mapped[1] ?? '');
  const groups = parseIpv6Groups(ip);
  if (groups === null || groups.length !== 8) return false;
  // IPv4-mapped / IPv4-compatible in HEX group form. The WHATWG URL parser
  // (and Node's) normalizes "[::ffff:169.254.169.254]" to the hex spelling
  // "[::ffff:a9fe:a9fe]" BEFORE the guard ever sees it, so the dotted regex
  // above never fires on a parsed URL host — the whole IPv4 blocklist would be
  // bypassable via the mapped IPv6 form. Reconstruct the embedded IPv4 from the
  // trailing two 16-bit groups and run it through ipv4Blocked. ::ffff:x:y is
  // the mapped range (groups 0..4 zero, group 5 == 0xffff); ::x:y with all of
  // groups 0..5 zero is the deprecated IPv4-compatible form — both embed an
  // IPv4 address that must be classified, not waved through.
  const embedsIpv4Mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const embedsIpv4Compatible = groups.slice(0, 6).every((g) => g === 0);
  if (embedsIpv4Mapped || embedsIpv4Compatible) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    const embedded = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    // ::  and ::1 are the unspecified/loopback literals, handled just below;
    // do not misclassify them as an embedded 0.0.0.x / 0.0.0.1 IPv4.
    if (!(embedsIpv4Compatible && hi === 0 && (lo === 0 || lo === 1))) {
      if (ipv4Blocked(embedded)) return true;
    }
  }
  const last = groups[7] ?? 0;
  const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0);
  if (allZeroExceptLast && (last === 0 || last === 1)) return true; // :: and ::1
  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function addressBlocked(address: string, family: number): boolean {
  if (family === 4) return ipv4Blocked(address);
  if (family === 6) return ipv6Blocked(address);
  return false;
}

/** One guard-validated address, pinned for the actual connection (M-3). */
export type PinnedAddress = { address: string; family: number };

type SsrfVerdict =
  | { blocked: string; addresses?: undefined }
  | { blocked: null; addresses: PinnedAddress[] };

/**
 * Validates a host and, when permitted, returns the exact addresses the
 * validation saw so the connection can be PINNED to them (audit 2026-07-14
 * M-3 — without pinning, the fetch's own second resolution reopened the
 * DNS-rebinding window this guard exists to close).
 */
async function ssrfGuard(hostname: string, signal: AbortSignal): Promise<SsrfVerdict> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { blocked: `blocked host "${hostname}" (localhost)` };
  }
  // URL.hostname keeps the surrounding brackets on an IPv6 literal
  // (e.g. "[2606:4700:4700::1111]"); strip them so isIP()/lookup() see the
  // bare address and the IPv6 classifier is actually engaged.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const literalFamily = isIP(bare);
  if (literalFamily !== 0) {
    if (addressBlocked(bare, literalFamily)) {
      return {
        blocked: `blocked IP literal "${hostname}" (private/loopback/link-local range)`,
      };
    }
    return { blocked: null, addresses: [{ address: bare, family: literalFamily }] };
  }
  // Resolve and reject if ANY resolved address is in a blocked range.
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(bare, { all: true });
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { blocked: `could not resolve host "${hostname}": ${(e as Error).message}` };
  }
  if (signal.aborted) throw new AbortError();
  for (const rec of records) {
    if (addressBlocked(rec.address, rec.family)) {
      return {
        blocked: `blocked host "${hostname}" -> ${rec.address} (private/loopback/link-local range)`,
      };
    }
  }
  return {
    blocked: null,
    addresses: records.map((r) => ({ address: r.address, family: r.family })),
  };
}

// -- DNS-pinned fetch (default path, audit 2026-07-14 M-3) --------------------

/** Module-private sentinel: the pinned set has no address usable for the
 *  socket's requested family. Mirrors an ENOTFOUND lookup failure. */
class PinnedLookupExhaustedError extends Error {
  readonly code = 'ENOTFOUND';
  constructor(hostname: string, family: number) {
    super(
      `DNS pinning: no validated${family === 4 ? ' IPv4' : family === 6 ? ' IPv6' : ''} ` +
        `address available for "${hostname}"`,
    );
    this.name = 'PinnedLookupExhaustedError';
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * Builds a node `lookup` override that answers ONLY from the guard-validated
 * address set — the socket can no longer be steered to a different (private)
 * address by a second DNS answer, because no second DNS query ever happens.
 * Handles both node call shapes: (hostname, cb) and (hostname, options, cb),
 * with options.family / options.all honored. Exported for unit tests.
 */
export function makePinnedLookup(
  addresses: PinnedAddress[],
): (hostname: string, options: unknown, callback?: LookupCallback) => void {
  return (hostname, options, callback) => {
    const cb: LookupCallback =
      typeof options === 'function' ? (options as LookupCallback) : (callback as LookupCallback);
    const opts =
      typeof options === 'object' && options !== null
        ? (options as { family?: number | string; all?: boolean })
        : {};
    const family =
      opts.family === 4 || opts.family === 'IPv4'
        ? 4
        : opts.family === 6 || opts.family === 'IPv6'
          ? 6
          : 0;
    const usable = family === 0 ? addresses : addresses.filter((a) => a.family === family);
    const first = usable[0];
    if (first === undefined) {
      cb(new PinnedLookupExhaustedError(hostname, family));
      return;
    }
    if (opts.all === true) {
      cb(
        null,
        usable.map((a) => ({ address: a.address, family: a.family })),
        0,
      );
      return;
    }
    cb(null, first.address, first.family);
  };
}

/** Minimal request-issuing seam so tests can observe the pinned wiring
 *  without touching the network. Defaults to node:https request. */
export type PinnedRequestImpl = (
  options: RequestOptions,
) => ReturnType<typeof httpsRequest>;

/**
 * Fetch-shaped GET over node:https with the connection pinned to the
 * guard-validated addresses (`pinned`; null = no pinning, used only under
 * ctx.allowPrivateWebFetch where nothing was validated). Host header and TLS
 * SNI / certificate verification stay on the ORIGINAL hostname — node derives
 * both from `hostname`, and the custom `lookup` only replaces the address the
 * socket dials. Returns a real WHATWG Response wrapping the socket stream, so
 * the existing redirect / body-cap / conversion pipeline is unchanged.
 */
export async function pinnedFetch(
  url: URL,
  init: { signal: AbortSignal; headers: Record<string, string> },
  pinned: PinnedAddress[] | null,
  requestImpl: PinnedRequestImpl = httpsRequest,
): Promise<Response> {
  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname;
  const res = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = requestImpl({
      hostname,
      port: url.port !== '' ? Number(url.port) : 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: init.headers,
      signal: init.signal,
      ...(pinned !== null ? { lookup: makePinnedLookup(pinned) } : {}),
    } as RequestOptions);
    req.once('response', resolve);
    req.once('error', reject);
    req.end();
  });
  const status = res.statusCode ?? 0;
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (typeof value === 'string') headers.set(key, value);
  }
  const statusText = res.statusMessage ?? '';
  // Null-body statuses may not carry a body per the Response contract.
  if (status === 204 || status === 205 || status === 304) {
    res.resume(); // drain so the socket is released
    return new Response(null, { status, statusText, headers });
  }
  const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
  return new Response(body, { status, statusText, headers });
}

// -- HTML -> text conversion -------------------------------------------------

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
}

/**
 * Strip every `<tag …>…</tag>` pair, replacing each with `repl` — the LINEAR
 * equivalent of `text.replace(/<tag\b[^>]*>[\s\S]*?<\/tag\s*>/gi, repl)`.
 *
 * Scale defect (wave10): the lazy paired regex re-scans to END OF INPUT for
 * every opener that has no closer after it, so its cost is O(openers × length)
 * — quadratic on a body this tool has no control over. Measured: 20k
 * `<script src=x>` openers in a 1.3MB body took 2.1s, and the fetch body cap
 * is 5MB, where the same shape (~300k openers, no closer) runs for HOURS with
 * the event loop pinned and the AbortSignal powerless (the work is one
 * synchronous regex call). A 5MB page of `<script…>` is a two-line web server.
 *
 * Exactly equivalent because closers are found in increasing positions: once
 * no closer exists at or after some offset, no LATER opener can match either,
 * so the scan can stop instead of retrying every remaining opener. Both cursors
 * only move forward, making the whole pass linear.
 */
function stripPairedBlocks(text: string, tag: string, repl: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const close = new RegExp(`</${tag}\\s*>`, 'gi');
  let out = '';
  let copied = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    close.lastIndex = m.index + m[0].length;
    const c = close.exec(text);
    if (c === null) break; // no closer left anywhere: no later opener can match
    const end = c.index + c[0].length;
    out += text.slice(copied, m.index) + repl;
    copied = end;
    open.lastIndex = end;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/** Strip every `<!-- … -->` comment — the LINEAR, literal-indexOf equivalent of
 *  `.replace(/<!--[\s\S]*?-->/g, repl)`, quadratic for the same reason. */
function stripComments(text: string, repl: string): string {
  let out = '';
  let copied = 0;
  for (let i = text.indexOf('<!--'); i !== -1; i = text.indexOf('<!--', copied)) {
    const end = text.indexOf('-->', i + 4);
    if (end === -1) break; // unterminated: the tail rule below cuts it
    out += text.slice(copied, i) + repl;
    copied = end + 3;
  }
  return copied === 0 ? text : out + text.slice(copied);
}

/**
 * Strip every `<…>` tag — the LINEAR equivalent of `.replace(/<[^>]+>/g, ' ')`.
 *
 * The worst of the family: `[^>]+` backtracks one character at a time at EVERY
 * `<` that has no `>` after it, so a body of bare `<` characters is O(n²) with
 * a huge constant. Measured: 200KB of `<` took 35 SECONDS; at the 5MB body cap
 * that is hours of a pinned event loop. `<` with no `>` needs no server
 * cooperation at all — a truncated page can end that way.
 */
function stripTags(text: string, repl: string): string {
  let out = '';
  let copied = 0;
  for (let lt = text.indexOf('<'); lt !== -1; lt = text.indexOf('<', lt + 1)) {
    const gt = text.indexOf('>', lt + 1);
    if (gt === -1) break; // no `>` left: no later `<` can close either
    // `[^>]+` needs at least one character, so a bare `<>` is not a tag.
    if (gt === lt + 1) continue;
    out += text.slice(copied, lt) + repl;
    copied = gt + 1;
    lt = gt; // resume after the tag (the loop's ++ moves to gt+1)
  }
  return copied === 0 ? text : out + text.slice(copied);
}

function htmlToText(html: string): string {
  const withoutBlocks = stripComments(
    stripPairedBlocks(stripPairedBlocks(html, 'script', ' '), 'style', ' '),
    ' ',
  )
    // An UNCLOSED script/style/comment runs to EOF per the HTML parsing rules.
    // The 5MB body cap routinely cuts a page mid-<script>, deleting the
    // closing tag — the lazy paired regexes above then leave the whole block,
    // and megabytes of raw JS leak into the output as page prose. Any such
    // opener surviving the paired strips has no closing tag left, so cut it
    // (and everything after it) here; the optional `>` group also covers a cut
    // landing inside the opening tag itself.
    .replace(/<(?:script|style)\b[^>]*(?:>[\s\S]*)?$/i, ' ')
    .replace(/<!--[\s\S]*$/, ' ');
  const withoutTags = stripTags(withoutBlocks, ' ');
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Read a response body into a Buffer with a hard byte cap, streaming chunks so
 * an oversized payload is never fully buffered in memory. Aborts the read once
 * `cap` bytes have accumulated. `overflow` is true when the source exceeded the
 * cap (so the caller can mark the output truncated).
 */
export async function readCappedBody(
  response: Response,
  cap: number,
): Promise<{ buf: Buffer; overflow: boolean }> {
  const body = response.body;
  if (!body) {
    // No readable stream (some fetch impls / mocks): fall back but still cap.
    const full = Buffer.from(await response.arrayBuffer());
    return { buf: full.subarray(0, cap), overflow: full.length > cap };
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = cap - total;
      // Strictly GREATER than remaining = genuine overflow (this chunk carries
      // more than fits). A chunk that EXACTLY fills the cap is not overflow —
      // take it whole and let the next read()'s `done` distinguish "body is
      // exactly `cap` bytes" (no overflow) from "more follows" (overflow on the
      // next iteration, where remaining is 0). Mirrors the non-stream fallback's
      // `full.length > cap`; `>=` here falsely flagged an exactly-cap body.
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(Buffer.from(value.subarray(0, remaining)));
        overflow = true;
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Stream already closed / errored; nothing to release.
    }
  }
  return { buf: Buffer.concat(chunks), overflow };
}

function isTextualContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('text/') ||
    ct.includes('application/json') ||
    ct.includes('application/xml') ||
    ct.includes('+xml') ||
    ct.includes('+json')
  );
}

/**
 * G2 (audit r2): decode the body per its DECLARED charset instead of assuming
 * UTF-8 — a Shift_JIS / GBK / ISO-8859-1 page (routine in the CN/JP fetch
 * paths this SDK serves) decoded as UTF-8 is silent mojibake. Priority:
 * Content-Type `charset=` > an HTML `<meta charset>` sniffed from the first
 * 1024 bytes (ASCII-compatible prefix, safe for every supported encoding) >
 * UTF-8. An unrecognized label falls back to UTF-8 rather than failing the
 * fetch.
 */
function decodeBody(buf: Buffer, contentType: string): string {
  let charset = /charset\s*=\s*"?([\w.-]+)"?/i.exec(contentType)?.[1];
  if (charset === undefined) {
    const head = buf.subarray(0, 1024).toString('latin1');
    charset =
      /<meta[^>]+charset\s*=\s*["']?([\w.-]+)/i.exec(head)?.[1] ??
      /<\?xml[^>]+encoding\s*=\s*["']([\w.-]+)["']/i.exec(head)?.[1];
  }
  if (charset === undefined || /^utf-?8$/i.test(charset)) return buf.toString('utf8');
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function normalizeUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: `WebFetch failed: "${raw}" is not a valid URL.` };
  }
  if (url.protocol === 'http:') {
    url.protocol = 'https:'; // upgrade
  } else if (url.protocol !== 'https:') {
    return {
      ok: false,
      message: `WebFetch failed: unsupported URL scheme "${url.protocol}" (only http/https).`,
    };
  }
  return { ok: true, url };
}

export const webFetchTool: BuiltinTool = {
  name: 'WebFetch',
  description: WEBFETCH_DESCRIPTION,
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (http or https).' },
      prompt: {
        type: 'string',
        description: 'What information you want to extract from the page.',
      },
    },
    required: ['url', 'prompt'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    const fetchStartedAt = Date.now();
    try {
      if (ctx.signal.aborted) throw new AbortError();

      const rawUrl = input['url'];
      if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
        return errorResult('WebFetch failed: "url" must be a non-empty string.');
      }
      if (typeof input['prompt'] !== 'string') {
        return errorResult('WebFetch failed: "prompt" must be a string.');
      }

      const normalized = normalizeUrl(rawUrl);
      if (!normalized.ok) return errorResult(normalized.message);
      let current = normalized.url;

      // Injection bypasses DNS pinning (audit 2026-07-14 M-3): an injected
      // fetch does its own connection handling, so we can only run the guard
      // per hop and hand it the URL — the rebinding window stays open on that
      // path. The DEFAULT path pins the connection to the guard's addresses.
      const injectedFetch = ctx.fetchImpl;
      let response: Response | undefined;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Guard + pinning re-run on EVERY hop, so a redirect cannot smuggle
        // the connection onto an unvalidated (or re-bound) address either.
        let pinned: PinnedAddress[] | null = null;
        if (!ctx.allowPrivateWebFetch) {
          const verdict = await ssrfGuard(current.hostname, ctx.signal);
          if (verdict.blocked !== null) {
            return errorResult(`WebFetch failed: ${verdict.blocked}.`);
          }
          pinned = verdict.addresses;
        }

        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
        const headers = { 'user-agent': USER_AGENT, accept: ACCEPT_HEADER };
        const res =
          injectedFetch !== undefined
            ? await injectedFetch(current.toString(), {
                redirect: 'manual',
                signal,
                headers,
              })
            : await pinnedFetch(current, { signal, headers }, pinned);

        // Manual redirect handling.
        if (res.status >= 300 && res.status < 400) {
          // The hop's body is never read; release its stream (and, on the
          // pinned path, the underlying socket) before moving on.
          if (res.body !== null) void res.body.cancel().catch(() => {});
          const location = res.headers.get('location');
          if (!location) {
            return errorResult(
              `WebFetch failed: server returned redirect status ${res.status} with no Location header.`,
            );
          }
          let next: URL;
          try {
            next = new URL(location, current);
          } catch {
            return errorResult(`WebFetch failed: invalid redirect Location "${location}".`);
          }
          if (next.protocol === 'http:') next.protocol = 'https:';
          if (next.protocol !== 'https:') {
            return errorResult(
              `WebFetch failed: redirect to unsupported scheme "${next.protocol}".`,
            );
          }
          if (next.host !== current.host) {
            // Cross-host redirect: hand back to the model rather than following.
            const handoff = `Redirected to ${next.toString()} ; call WebFetch again with that URL to continue.`;
            return {
              content: handoff,
              // Terminal NON-error branch, so it owes the structured result the
              // fetched branch already emits (Grep's per-branch sweep): without
              // it a consumer cannot tell a redirect handoff from a tool that
              // never ran. Every field is a fact in hand — `result` is the text
              // the model sees (the documented invariant for this field) and
              // `bytes` is 0 because the hop's body was cancelled unread.
              structuredOutput: {
                bytes: 0,
                code: res.status,
                codeText: res.statusText,
                url: current.toString(),
                durationMs: Date.now() - fetchStartedAt,
                result: handoff,
                truncated: false,
              } satisfies WebFetchStructuredOutput,
            };
          }
          if (hop === MAX_REDIRECTS) {
            return errorResult(
              `WebFetch failed: too many redirects (>${MAX_REDIRECTS}).`,
            );
          }
          current = next;
          continue;
        }

        response = res;
        break;
      }

      if (!response) {
        return errorResult(`WebFetch failed: too many redirects (>${MAX_REDIRECTS}).`);
      }

      // Reject-without-reading paths must release the response stream (and, on
      // the pinned path, its underlying socket) the same way the redirect
      // branch above does — otherwise the socket is held open until the 30s
      // abort timeout fires.
      const rejectUnread = (message: string): ToolResultPayload => {
        const body = response!.body;
        if (body !== null && typeof body.cancel === 'function') {
          void body.cancel().catch(() => {});
        }
        return errorResult(message);
      };

      if (response.status < 200 || response.status >= 300) {
        return rejectUnread(
          `WebFetch failed: request returned HTTP ${response.status} ${response.statusText}.`,
        );
      }

      // M20 (audit 2026-07-17): 204 No Content / 205 Reset Content are bodyless
      // SUCCESSES — they carry no content-type, so falling through to the gate
      // below misreported them as `unsupported content type "unknown"`. Report
      // the empty success honestly instead.
      if (response.status === 204 || response.status === 205) {
        const emptyBody = response.body;
        if (emptyBody !== null && typeof emptyBody.cancel === 'function') {
          void emptyBody.cancel().catch(() => {});
        }
        const emptyNote = `HTTP ${response.status} ${response.statusText || 'No Content'}: the request succeeded and returned no content.`;
        return {
          content: emptyNote,
          // Same per-branch hole as the redirect handoff above: a bodyless
          // SUCCESS is still a completed fetch and must report like one.
          structuredOutput: {
            bytes: 0,
            code: response.status,
            codeText: response.statusText,
            url: current.toString(),
            durationMs: Date.now() - fetchStartedAt,
            result: emptyNote,
            truncated: false,
          } satisfies WebFetchStructuredOutput,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!isTextualContentType(contentType)) {
        return rejectUnread(
          `WebFetch failed: unsupported content type "${contentType || 'unknown'}" (only text, JSON, and XML are supported).`,
        );
      }

      // Reject early on a declared Content-Length over the cap, before reading
      // a single body byte (content-type is attacker-controlled, so the textual
      // gate above is not a size guard).
      const declaredLen = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
        return rejectUnread(
          `WebFetch failed: response body too large (Content-Length ${declaredLen} bytes exceeds ${MAX_BODY_BYTES}-byte cap).`,
        );
      }

      // Stream with a running byte cap so a body that lies about (or omits) its
      // length can never buffer more than MAX_BODY_BYTES into memory.
      const { buf, overflow } = await readCappedBody(response, MAX_BODY_BYTES);
      const bodyText = decodeBody(buf, contentType);

      const isHtml =
        contentType.toLowerCase().includes('html') || /^\s*<(?:!doctype|html)\b/i.test(bodyText);
      let text = isHtml ? htmlToText(bodyText) : bodyText;

      // Truncation discipline (keeper ruling 2026-07-27): a cut answers three
      // questions — how much was dropped, why, and how to get it back. The old
      // footer was five characters ("[truncated]"): no amount, no cap, no
      // recovery path, while Read's footer carries all three for the SAME
      // 50000-char constant.
      const fullChars = text.length;
      let truncated = false;
      if (fullChars > MAX_OUTPUT_CHARS) {
        // WV5-5 (audit r3): surrogate-safe slice so the output cap never leaves
        // a lone surrogate at the boundary.
        text = sliceSurrogateSafe(text, MAX_OUTPUT_CHARS);
        truncated = true;
      }
      if (truncated || overflow) {
        const notes: string[] = [];
        if (overflow) {
          notes.push(
            `the source exceeded the ${MAX_BODY_BYTES}-byte fetch cap, so ` +
              `everything beyond that was never fetched`,
          );
        }
        if (truncated) {
          notes.push(
            `the fetched page converted to ${fullChars} chars and only the ` +
              `first ${text.length} are shown (output cap ${MAX_OUTPUT_CHARS})`,
          );
        }
        text +=
          `\n\n[Output truncated: ${notes.join('; ')}. The tail was dropped; ` +
          `fetch a more specific URL (a sub-page, an anchor, a raw/plain view) ` +
          `to reach the part that was cut off.]`;
      }

      ctx.debug(`WebFetch: ${current.toString()} -> ${text.length} chars (${contentType})`);
      return {
        content: text,
        structuredOutput: {
          bytes: buf.length,
          code: response.status,
          codeText: response.statusText,
          url: current.toString(),
          durationMs: Date.now() - fetchStartedAt,
          // `result` is the official field for the fetched body; this engine
          // returns it verbatim (no summarizer), so the structured copy is the
          // same text the model sees.
          result: text,
          // A body-cap overflow is as much "cut short" as the char cap: a page
          // whose tail was never fetched must not read as complete just
          // because its converted text fit the output cap.
          truncated: truncated || overflow,
        } satisfies WebFetchStructuredOutput,
      };
    } catch (e) {
      // WV5-3 (audit r3): the fetch signal merges the turn signal with a 30s
      // per-request timeout. A REAL turn cancel (ctx.signal aborted) rethrows
      // AbortError to unwind the whole turn; the tool's OWN request timeout
      // (ctx.signal not aborted) is a graceful per-fetch failure — surface it
      // as an isError result, not a turn-killing abort.
      if (isAbortError(e)) {
        if (ctx.signal.aborted) throw new AbortError('WebFetch was aborted');
        return errorResult(`WebFetch failed: request timed out after ${FETCH_TIMEOUT_MS}ms`);
      }
      return errorResult(`WebFetch failed: ${thrownMessage(e)}`);
    }
  },
};
