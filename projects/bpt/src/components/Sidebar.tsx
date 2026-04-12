import { useState, useEffect } from 'react';
import { getBpt } from '../lib/ipc';

interface ConvEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

type RightPanel = 'none' | 'silver' | 'bpe' | 'settings' | 'artifacts' | 'plugins' | 'dream' | 'sentinel';

interface SidebarProps {
  currentId: string | null;
  refreshKey?: number;
  activePanel?: RightPanel;
  onSelect: (id: string) => void;
  onToggleSilver: () => void;
  onToggleBpe: () => void;
  onToggleSettings: () => void;
  onToggleArtifacts: () => void;
  onTogglePlugins: () => void;
  onToggleDream: () => void;
  onToggleSentinel: () => void;
}

/**
 * Panel button config — keeps JSX clean.
 * 'key' matches the RightPanel union value for active highlighting.
 */
const PANEL_BUTTONS: Array<{
  key: RightPanel;
  label: string;
  propName: keyof Pick<SidebarProps, 'onToggleSilver' | 'onToggleBpe' | 'onToggleArtifacts' | 'onTogglePlugins' | 'onToggleDream' | 'onToggleSentinel' | 'onToggleSettings'>;
  gold: boolean;
}> = [
  { key: 'silver', label: 'Silver Core', propName: 'onToggleSilver', gold: true },
  { key: 'bpe', label: 'Black Pool Explorer', propName: 'onToggleBpe', gold: true },
  { key: 'artifacts', label: 'Artifacts', propName: 'onToggleArtifacts', gold: true },
  { key: 'plugins', label: 'Plugins', propName: 'onTogglePlugins', gold: true },
  { key: 'dream', label: 'Dream Agent', propName: 'onToggleDream', gold: true },
  { key: 'sentinel', label: 'Sentinel', propName: 'onToggleSentinel', gold: true },
  { key: 'settings', label: 'Settings', propName: 'onToggleSettings', gold: false },
];

export default function Sidebar({
  currentId,
  refreshKey,
  activePanel = 'none',
  onSelect,
  onToggleSilver,
  onToggleBpe,
  onToggleSettings,
  onToggleArtifacts,
  onTogglePlugins,
  onToggleDream,
  onToggleSentinel,
}: SidebarProps) {
  const [conversations, setConversations] = useState<ConvEntry[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handlers: Record<string, () => void> = {
    silver: onToggleSilver,
    bpe: onToggleBpe,
    settings: onToggleSettings,
    artifacts: onToggleArtifacts,
    plugins: onTogglePlugins,
    dream: onToggleDream,
    sentinel: onToggleSentinel,
  };

  const loadConversations = async () => {
    try {
      const list = await getBpt().convList() as ConvEntry[];
      setConversations(list);
    } catch {
      // IPC not ready yet
    }
  };

  useEffect(() => {
    loadConversations();
  }, [refreshKey]);

  const handleNew = async () => {
    try {
      const entry = await getBpt().convCreate('New Conversation') as ConvEntry;
      setConversations((prev) => [entry, ...prev]);
      onSelect(entry.id);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await getBpt().convDelete(deleteTarget);
      setConversations((prev) => prev.filter((c) => c.id !== deleteTarget));
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
    setDeleteTarget(null);
  };

  return (
    <div className="w-56 bg-bpt-surface border-r border-bpt-border flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h1 className="text-sm font-bold text-bpt-gold tracking-wider">BPT</h1>
        <p className="text-xs text-bpt-text-dim">Black Pool Terminal</p>
      </div>

      {/* New conversation button */}
      <button
        onClick={handleNew}
        className="mx-2 mt-2 px-3 py-1.5 text-xs border border-bpt-border rounded
                   hover:bg-bpt-gold/10 hover:border-bpt-gold-dim/40 transition-colors"
      >
        + New Conversation
      </button>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto mt-2">
        {conversations.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-bpt-text-dim">
            <p>No conversations yet.</p>
            <p className="mt-1">Click "+ New Conversation" to start.</p>
          </div>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group px-3 py-2 mx-1 rounded cursor-pointer text-sm truncate transition-colors ${
              conv.id === currentId
                ? 'bg-bpt-gold/10 border-l-2 border-bpt-gold text-bpt-text'
                : 'text-bpt-text-dim hover:bg-bpt-border/50'
            }`}
          >
            <span className="truncate">{conv.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(conv.id); }}
              className="hidden group-hover:inline ml-2 text-bpt-error text-xs hover:underline"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="mx-2 mb-2 p-2 bg-bpt-error/10 border border-bpt-error/30 rounded text-xs">
          <p className="text-bpt-text">Delete this conversation?</p>
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={confirmDelete}
              className="px-2 py-0.5 bg-bpt-error/20 text-bpt-error rounded hover:bg-bpt-error/30 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-2 py-0.5 text-bpt-text-dim hover:text-bpt-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Panel toggles */}
      <div className="p-2 border-t border-bpt-border space-y-0.5">
        {PANEL_BUTTONS.map((btn) => {
          const isActive = activePanel === btn.key;
          const baseColor = btn.gold ? 'text-bpt-gold-dim' : 'text-bpt-text-dim';
          const hoverColor = btn.gold ? 'hover:text-bpt-gold' : 'hover:text-bpt-text';
          const activeColor = btn.gold ? 'text-bpt-gold bg-bpt-gold/10' : 'text-bpt-text bg-bpt-border/50';

          return (
            <button
              key={btn.key}
              onClick={handlers[btn.key]}
              className={`w-full px-2 py-1 text-xs text-left rounded transition-colors ${
                isActive ? activeColor : `${baseColor} ${hoverColor}`
              }`}
            >
              {isActive ? '> ' : ''}{btn.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
