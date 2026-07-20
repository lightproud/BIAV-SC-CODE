/**
 * Built-in WebSearch tool: route a query to the host-provided search backend.
 *
 * This SDK ships no search engine. The host wires a backend via
 * options.webSearch (-> ctx.webSearch). When absent the tool returns a
 * not-configured error result. A backend may return a WebSearchResult[]
 * (rendered here to a numbered text list, after domain filtering) or a
 * pre-rendered string (passed through verbatim).
 *
 * Note: modelUsage.webSearchRequests is NOT incremented - WebSearch is a host
 * callback, not a billed server-side tool (documented limitation).
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import type { WebSearchResult } from '../types.js';
import { AbortError, isAbortError } from '../errors.js';
import { WEBSEARCH_DESCRIPTION } from './descriptions.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
}

/** Parse an optional string[] input field; returns undefined when absent. */
function parseDomainList(
  value: unknown,
  field: string,
): { ok: true; value: string[] | undefined } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (!Array.isArray(value) || value.some((d) => typeof d !== 'string')) {
    return { ok: false, message: `WebSearch failed: "${field}" must be an array of strings.` };
  }
  const cleaned = (value as string[])
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  return { ok: true, value: cleaned.length > 0 ? cleaned : undefined };
}

/** host === domain, or host is a subdomain of domain. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Extract a lowercase hostname from a result URL; '' when unparseable. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function filterResults(
  results: WebSearchResult[],
  allowed: string[] | undefined,
  blocked: string[] | undefined,
): WebSearchResult[] {
  if (!allowed && !blocked) return results;
  return results.filter((r) => {
    const host = hostOf(r.url);
    if (allowed && !allowed.some((d) => hostMatches(host, d))) return false;
    if (blocked && blocked.some((d) => hostMatches(host, d))) return false;
    return true;
  });
}

function renderResults(results: WebSearchResult[]): string {
  if (results.length === 0) return 'No results.';
  // audit r4 Sd-1: the description advertises results "formatted as search
  // result blocks, including links as markdown hyperlinks". Render each result's
  // link as a markdown hyperlink (the URL line used to be bare text — not a
  // hyperlink) and separate results into blocks with a blank line. The native
  // API `web_search_result` content-block form is a host-callback subset (text),
  // recorded honestly in docs/COMPAT.md ("Tool-description ↔ implementation
  // fidelity").
  const blocks = results.map((r, i) => {
    const lines = [`${i + 1}. ${r.title}`, `   [${r.url}](${r.url})`];
    if (r.snippet && r.snippet.length > 0) lines.push(`   ${r.snippet}`);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

/** Diagnosable message for ANY thrown value (audit 2026-07-17 L74): a
 *  non-Error throw (string / object) rendered "failed: undefined" via the
 *  blind `(e as Error).message` cast, losing the diagnostic. */
function thrownMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

export const webSearchTool: BuiltinTool = {
  name: 'WebSearch',
  description: WEBSEARCH_DESCRIPTION,
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      allowed_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only include results from these domains (and their subdomains).',
      },
      blocked_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Never include results from these domains (or their subdomains).',
      },
    },
    required: ['query'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const query = input['query'];
    if (typeof query !== 'string' || query.trim().length === 0) {
      return errorResult('WebSearch failed: "query" must be a non-empty string.');
    }

    const allowed = parseDomainList(input['allowed_domains'], 'allowed_domains');
    if (!allowed.ok) return errorResult(allowed.message);
    const blocked = parseDomainList(input['blocked_domains'], 'blocked_domains');
    if (!blocked.ok) return errorResult(blocked.message);

    if (!ctx.webSearch) {
      return errorResult(
        'WebSearch is not configured: provide options.webSearch to enable web search.',
      );
    }

    let raw: WebSearchResult[] | string;
    try {
      raw = await ctx.webSearch(query, {
        allowedDomains: allowed.value,
        blockedDomains: blocked.value,
        signal: ctx.signal,
      });
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('WebSearch was aborted');
      return errorResult(`WebSearch failed: ${thrownMessage(e)}`);
    }

    if (typeof raw === 'string') {
      return { content: raw };
    }
    if (!Array.isArray(raw)) {
      return errorResult('WebSearch failed: backend returned an unexpected value.');
    }

    const filtered = filterResults(raw, allowed.value, blocked.value);
    ctx.debug(`WebSearch: "${query}" -> ${raw.length} results, ${filtered.length} after filter`);
    return { content: renderResults(filtered) };
  },
};
