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
  const blocks = results.map((r, i) => {
    const lines = [`${i + 1}. ${r.title}`, `   ${r.url}`];
    if (r.snippet && r.snippet.length > 0) lines.push(`   ${r.snippet}`);
    return lines.join('\n');
  });
  return blocks.join('\n');
}

export const webSearchTool: BuiltinTool = {
  name: 'WebSearch',
  description:
    'Search the web for a query and return a list of results. Supports ' +
    'optional allowed_domains (only these domains are returned) and ' +
    'blocked_domains (these domains are excluded); domain matching includes ' +
    'subdomains. Requires a host-configured search backend.',
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
      return errorResult(`WebSearch failed: ${(e as Error).message}`);
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
