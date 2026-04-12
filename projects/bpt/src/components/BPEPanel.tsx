import { useState } from 'react';
import { useBpeSearch, useBpeStatus } from '../lib/hooks';
import type { BPEChunk, CiteBlock } from '../types';

interface BPEPanelProps {
  conversationId: string | null;
  onCite: (cite: CiteBlock) => void;
}

export default function BPEPanel({ conversationId, onCite }: BPEPanelProps) {
  const [query, setQuery] = useState('');
  const { results, loading, error, search } = useBpeSearch();
  const status = useBpeStatus();

  const handleSearch = () => {
    if (query.trim()) {
      search(query);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleCite = (chunk: BPEChunk) => {
    if (!conversationId) return;

    const cite: CiteBlock = {
      type: 'cite',
      source: chunk.file,
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      text: chunk.text.slice(0, 3000), // Cap cite size
    };

    onCite(cite);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h2 className="text-sm font-bold text-bpt-gold">Black Pool Explorer</h2>
        <p className="text-xs text-bpt-text-dim mt-0.5">
          {status.loaded
            ? `Index loaded${status.hasKeywords ? ' (FTS5)' : ''}${status.hasVectors ? ' (Vector)' : ''}`
            : 'No index loaded'}
        </p>
      </div>

      {/* Search */}
      <div className="p-2">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search code & configs..."
            className="flex-1 bg-bpt-bg border border-bpt-border rounded px-2 py-1 text-xs
                       focus:outline-none focus:border-bpt-gold-dim placeholder:text-bpt-text-dim"
          />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-2 py-1 bg-bpt-gold/20 text-bpt-gold rounded text-xs hover:bg-bpt-gold/30 disabled:opacity-50"
          >
            {loading ? '...' : 'Go'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-2 p-2 bg-bpt-error/10 border border-bpt-error/30 rounded text-xs text-bpt-error">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {results.map((chunk) => (
          <div
            key={chunk.id}
            className="p-2 bg-bpt-bg border border-bpt-border rounded text-xs hover:border-bpt-gold-dim transition-colors"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-bpt-accent truncate max-w-[60%]">
                {chunk.file}:{chunk.lineStart}
              </span>
              <div className="flex gap-1 items-center">
                <span className="text-bpt-text-dim text-[10px]">{chunk.language}</span>
                <button
                  onClick={() => handleCite(chunk)}
                  disabled={!conversationId}
                  className="px-1.5 py-0.5 bg-bpt-gold/20 text-bpt-gold rounded text-[10px]
                             hover:bg-bpt-gold/30 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  @Cite
                </button>
              </div>
            </div>
            <pre className="text-bpt-text-dim whitespace-pre-wrap overflow-hidden max-h-20 text-[11px] leading-tight">
              {chunk.text.slice(0, 300)}
            </pre>
            {chunk.summary && (
              <p className="mt-1 text-bpt-text-dim italic text-[10px]">{chunk.summary}</p>
            )}
          </div>
        ))}
        {results.length === 0 && !loading && !error && (
          <p className="text-center text-bpt-text-dim text-xs mt-4">
            Search Black Pool code & configs
          </p>
        )}
      </div>
    </div>
  );
}
