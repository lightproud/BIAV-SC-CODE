import { useState, useEffect } from 'react';
import { getBpt } from '../lib/ipc';

interface ConvEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface SidebarProps {
  currentId: string | null;
  onSelect: (id: string) => void;
  onToggleSilver: () => void;
  onToggleBpe: () => void;
  onToggleSettings: () => void;
}

export default function Sidebar({ currentId, onSelect, onToggleSilver, onToggleBpe, onToggleSettings }: SidebarProps) {
  const [conversations, setConversations] = useState<ConvEntry[]>([]);

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
  }, []);

  const handleNew = async () => {
    try {
      const entry = await getBpt().convCreate('New Conversation') as ConvEntry;
      setConversations((prev) => [entry, ...prev]);
      onSelect(entry.id);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await getBpt().convDelete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
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
        className="mx-2 mt-2 px-3 py-1.5 text-xs border border-bpt-border rounded hover:bg-bpt-border transition-colors"
      >
        + New Conversation
      </button>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto mt-2">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className={`group px-3 py-2 mx-1 rounded cursor-pointer text-sm truncate transition-colors ${
              conv.id === currentId
                ? 'bg-bpt-border text-bpt-text'
                : 'text-bpt-text-dim hover:bg-bpt-border/50'
            }`}
          >
            <span className="truncate">{conv.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(conv.id); }}
              className="hidden group-hover:inline ml-2 text-bpt-error text-xs"
            >
              x
            </button>
          </div>
        ))}
      </div>

      {/* Panel toggles */}
      <div className="p-2 border-t border-bpt-border space-y-1">
        <button
          onClick={onToggleSilver}
          className="w-full px-2 py-1 text-xs text-left text-bpt-gold-dim hover:text-bpt-gold transition-colors"
        >
          Silver Core
        </button>
        <button
          onClick={onToggleBpe}
          className="w-full px-2 py-1 text-xs text-left text-bpt-gold-dim hover:text-bpt-gold transition-colors"
        >
          Black Pool Explorer
        </button>
        <button
          onClick={onToggleSettings}
          className="w-full px-2 py-1 text-xs text-left text-bpt-text-dim hover:text-bpt-text transition-colors"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
