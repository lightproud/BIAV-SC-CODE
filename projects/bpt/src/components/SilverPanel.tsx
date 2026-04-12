import { useState } from 'react';
import { useSilverSearch, useSilverStatus } from '../lib/hooks';

export default function SilverPanel() {
  const [query, setQuery] = useState('');
  const { results, loading, error, search } = useSilverSearch();
  const status = useSilverStatus();

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h2 className="text-sm font-bold text-bpt-gold">Silver Core</h2>
        <p className="text-xs text-bpt-text-dim mt-0.5">
          {status.mcpConnected
            ? `Connected (${status.mcpTools.length} tools)`
            : 'Connecting...'}
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
            placeholder="Search memory..."
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
        {results.map((r, i) => (
          <div
            key={i}
            className="p-2 bg-bpt-bg border border-bpt-border rounded text-xs hover:border-bpt-gold-dim transition-colors"
          >
            <div className="flex justify-between items-center mb-1">
              <span className="text-bpt-accent truncate max-w-[70%]">{r.file}</span>
              <span className="text-bpt-text-dim">{r.score.toFixed(2)}</span>
            </div>
            <p className="text-bpt-text-dim line-clamp-3">{r.preview}</p>
          </div>
        ))}
        {results.length === 0 && !loading && !error && (
          <p className="text-center text-bpt-text-dim text-xs mt-4">
            Search Silver Core memory
          </p>
        )}
      </div>
    </div>
  );
}
