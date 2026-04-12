/**
 * ArtifactsPanel.tsx -- Browse and view saved tool result artifacts.
 *
 * Why: Prime Directive T2 truncates large tool results to save tokens.
 * This panel lets users browse and read the full, untruncated content
 * that was saved locally when truncation occurred.
 */

import { useState, useEffect, useCallback } from 'react';
import { getBpt } from '../lib/ipc';

interface ArtifactMeta {
  id: string;
  toolName: string;
  conversationId: string;
  createdAt: number;
  size: number;
  preview: string;
}

interface ArtifactFull extends ArtifactMeta {
  content: string;
}

interface ArtifactsPanelProps {
  conversationId: string | null;
}

export default function ArtifactsPanel({ conversationId }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([]);
  const [selected, setSelected] = useState<ArtifactFull | null>(null);
  const [loading, setLoading] = useState(false);

  const loadArtifacts = useCallback(async () => {
    try {
      const list = await getBpt().artifactList(conversationId ?? undefined) as ArtifactMeta[];
      setArtifacts(Array.isArray(list) ? list : []);
    } catch {
      setArtifacts([]);
    }
  }, [conversationId]);

  useEffect(() => {
    loadArtifacts();
    setSelected(null);
  }, [loadArtifacts]);

  const handleSelect = async (id: string) => {
    setLoading(true);
    try {
      const full = await getBpt().artifactGet(id) as ArtifactFull | null;
      setSelected(full);
    } catch {
      setSelected(null);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    await getBpt().artifactDelete(id);
    if (selected?.id === id) setSelected(null);
    loadArtifacts();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h2 className="text-sm font-bold text-bpt-gold">Artifacts</h2>
        <p className="text-xs text-bpt-text-dim mt-0.5">
          Full tool results saved when truncated
        </p>
      </div>

      {/* Content area */}
      {selected ? (
        /* Detail view */
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-bpt-border">
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-bpt-gold hover:underline"
            >
              Back
            </button>
            <span className="text-xs text-bpt-text-dim truncate flex-1">
              {selected.toolName} - {formatTime(selected.createdAt)}
            </span>
            <span className="text-[10px] text-bpt-text-dim">{formatSize(selected.size)}</span>
          </div>
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-xs text-bpt-text whitespace-pre-wrap break-words font-mono leading-relaxed">
              {selected.content}
            </pre>
          </div>
        </div>
      ) : (
        /* List view */
        <div className="flex-1 overflow-y-auto">
          {artifacts.length === 0 && (
            <p className="p-4 text-xs text-bpt-text-dim text-center">
              No artifacts yet. Large tool results will appear here when truncated.
            </p>
          )}
          {artifacts.map((art) => (
            <div
              key={art.id}
              className="group border-b border-bpt-border/50 px-3 py-2 hover:bg-bpt-border/30 cursor-pointer"
              onClick={() => handleSelect(art.id)}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-bpt-accent">{art.toolName}</span>
                <span className="text-[10px] text-bpt-text-dim">{formatTime(art.createdAt)}</span>
              </div>
              <p className="text-[11px] text-bpt-text-dim mt-0.5 truncate">{art.preview}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-bpt-text-dim">{formatSize(art.size)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(art.id); }}
                  className="hidden group-hover:inline text-[10px] text-bpt-error hover:underline"
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bpt-bg/50">
          <span className="text-xs text-bpt-text-dim">Loading...</span>
        </div>
      )}
    </div>
  );
}
