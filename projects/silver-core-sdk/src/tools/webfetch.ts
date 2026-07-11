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
 * ctx.allowPrivateWebFetch is true. Residual DNS-rebinding risk between the
 * lookup and the fetch is documented and not fully closed.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError, isAbortError } from '../errors.js';
import { SDK_USER_AGENT } from '../version.js';
import { WEBFETCH_DESCRIPTION } from './descriptions.js';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 100_000;
const USER_AGENT = SDK_USER_AGENT;
const ACCEPT_HEADER =
  'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain;q=0.8,*/*;q=0.5';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
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

/** Returns a blocked-reason string, or null when the host is permitted. */
async function ssrfGuard(hostname: string, signal: AbortSignal): Promise<string | null> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return `blocked host "${hostname}" (localhost)`;
  }
  // URL.hostname keeps the surrounding brackets on an IPv6 literal
  // (e.g. "[2606:4700:4700::1111]"); strip them so isIP()/lookup() see the
  // bare address and the IPv6 classifier is actually engaged.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const literalFamily = isIP(bare);
  if (literalFamily !== 0) {
    if (addressBlocked(bare, literalFamily)) {
      return `blocked IP literal "${hostname}" (private/loopback/link-local range)`;
    }
    return null;
  }
  // Resolve and reject if ANY resolved address is in a blocked range.
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(bare, { all: true });
  } catch (e) {
    if (isAbortError(e)) throw e;
    return `could not resolve host "${hostname}": ${(e as Error).message}`;
  }
  if (signal.aborted) throw new AbortError();
  for (const rec of records) {
    if (addressBlocked(rec.address, rec.family)) {
      return `blocked host "${hostname}" -> ${rec.address} (private/loopback/link-local range)`;
    }
  }
  return null;
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

function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(/[ \t\r\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Read a response body into a Buffer with a hard byte cap, streaming chunks so
 * an oversized payload is never fully buffered in memory. Aborts the read once
 * `cap` bytes have accumulated. `overflow` is true when the source exceeded the
 * cap (so the caller can mark the output truncated).
 */
async function readCappedBody(
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
      if (value.byteLength >= remaining) {
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

      const fetchImpl = ctx.fetchImpl ?? globalThis.fetch;
      let response: Response | undefined;

      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!ctx.allowPrivateWebFetch) {
          const blocked = await ssrfGuard(current.hostname, ctx.signal);
          if (blocked) return errorResult(`WebFetch failed: ${blocked}.`);
        }

        const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
        const res = await fetchImpl(current.toString(), {
          redirect: 'manual',
          signal,
          headers: { 'user-agent': USER_AGENT, accept: ACCEPT_HEADER },
        });

        // Manual redirect handling.
        if (res.status >= 300 && res.status < 400) {
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
            return {
              content: `Redirected to ${next.toString()} ; call WebFetch again with that URL to continue.`,
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

      if (response.status < 200 || response.status >= 300) {
        return errorResult(
          `WebFetch failed: request returned HTTP ${response.status} ${response.statusText}.`,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!isTextualContentType(contentType)) {
        return errorResult(
          `WebFetch failed: unsupported content type "${contentType || 'unknown'}" (only text, JSON, and XML are supported).`,
        );
      }

      // Reject early on a declared Content-Length over the cap, before reading
      // a single body byte (content-type is attacker-controlled, so the textual
      // gate above is not a size guard).
      const declaredLen = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
        return errorResult(
          `WebFetch failed: response body too large (Content-Length ${declaredLen} bytes exceeds ${MAX_BODY_BYTES}-byte cap).`,
        );
      }

      // Stream with a running byte cap so a body that lies about (or omits) its
      // length can never buffer more than MAX_BODY_BYTES into memory.
      const { buf, overflow } = await readCappedBody(response, MAX_BODY_BYTES);
      const bodyText = buf.toString('utf8');

      const isHtml =
        contentType.toLowerCase().includes('html') || /^\s*<(?:!doctype|html)\b/i.test(bodyText);
      let text = isHtml ? htmlToText(bodyText) : bodyText;

      let truncated = overflow;
      if (text.length > MAX_OUTPUT_CHARS) {
        text = text.slice(0, MAX_OUTPUT_CHARS);
        truncated = true;
      }
      if (truncated) {
        text += '\n\n[truncated]';
      }

      ctx.debug(`WebFetch: ${current.toString()} -> ${text.length} chars (${contentType})`);
      return { content: text };
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('WebFetch was aborted');
      return errorResult(`WebFetch failed: ${(e as Error).message}`);
    }
  },
};
