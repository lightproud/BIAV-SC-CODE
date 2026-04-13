/**
 * reranker.ts -- Optional Haiku reranker for BPE search results.
 *
 * Why reranking: Vector/FTS5 retrieval gets ~top-20 candidates with rough
 * relevance. A small LLM (Haiku) reads the query + each candidate and picks
 * the best 5 with one-sentence summaries. Cost: ~$0.003/query.
 *
 * Why optional: If the gateway is unreachable or budget is tight, users
 * disable reranking in settings. The search still works, just with raw scores.
 */

import { getConfig } from '../core/config';
import { logger } from '../core/logger';
import type { BPEChunk } from '../../src/types';

/**
 * Rerank BPE search results using Haiku.
 * Returns the top `limit` chunks with summaries, or the original results
 * if reranking fails or is disabled.
 */
export async function rerankWithHaiku(
  query: string,
  candidates: BPEChunk[],
  limit: number = 5,
): Promise<BPEChunk[]> {
  const enabled = getConfig('bpeRerankerEnabled') as boolean;
  if (!enabled) return candidates.slice(0, limit);

  if (candidates.length <= limit) return candidates;

  const endpoint = getConfig('endpoint') as {
    baseUrl: string;
    apiKey: string;
    provider?: string;
  } | undefined;

  if (!endpoint?.apiKey) {
    logger.warn('bpe-reranker', 'No API key configured, skipping rerank');
    return candidates.slice(0, limit);
  }

  try {
    // Build a compact prompt listing each candidate
    const candidateList = candidates.map((c, i) => {
      const preview = c.text.slice(0, 300);
      return `[${i}] ${c.file}:${c.lineStart} (${c.language})\n${preview}`;
    }).join('\n---\n');

    const prompt = `You are a search result reranker. Given a query and candidate code/config snippets, select the ${limit} most relevant results.

Query: "${query}"

Candidates:
${candidateList}

Reply with ONLY a JSON array of objects, each with:
- "index": the candidate number [0-${candidates.length - 1}]
- "summary": one sentence explaining why this result is relevant

Example: [{"index": 2, "summary": "Defines the critical hit rate for berserker class"}, ...]`;

    // Use the configured endpoint, but prefer Haiku model for cost
    const model = (endpoint.provider === 'openai')
      ? 'gpt-4o-mini'
      : 'claude-haiku-4-5-20251001';

    const baseUrl = (endpoint.baseUrl || '').replace(/\/+$/, '');
    const isOpenAi = endpoint.provider === 'openai';

    const url = isOpenAi
      ? `${baseUrl}/v1/chat/completions`
      : `${baseUrl || 'https://api.anthropic.com'}/v1/messages`;

    const body = isOpenAi
      ? {
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
        }
      : {
          model,
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (isOpenAi) {
      headers['Authorization'] = `Bearer ${endpoint.apiKey}`;
    } else {
      headers['x-api-key'] = endpoint.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.warn('bpe-reranker', `Rerank API returned ${response.status}`);
      return candidates.slice(0, limit);
    }

    const result = await response.json() as Record<string, unknown>;

    // Extract text from response (handle both Anthropic and OpenAI formats)
    let text = '';
    if (isOpenAi) {
      const choices = result.choices as Array<Record<string, unknown>>;
      const msg = choices?.[0]?.message as Record<string, unknown>;
      text = (msg?.content as string) ?? '';
    } else {
      const content = result.content as Array<Record<string, unknown>>;
      text = (content?.[0]?.text as string) ?? '';
    }

    // Parse the JSON array from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.warn('bpe-reranker', 'No JSON array in reranker response');
      return candidates.slice(0, limit);
    }

    const ranked = JSON.parse(jsonMatch[0]) as Array<{ index: number; summary: string }>;

    return ranked.slice(0, limit).map((r) => {
      const original = candidates[r.index];
      if (!original) return candidates[0]; // Safety fallback
      return { ...original, summary: r.summary };
    }).filter(Boolean);
  } catch (err) {
    logger.warn('bpe-reranker', 'Reranking failed, returning raw results', {
      error: err instanceof Error ? err.message : String(err),
    });
    return candidates.slice(0, limit);
  }
}
