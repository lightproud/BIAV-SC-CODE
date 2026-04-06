import { useState, useCallback, useEffect } from 'react'
import type { Conversation } from '../types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string) => void
  onExport?: (id: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function Sidebar({ conversations, activeId, onSelect, onDelete, onRename, onExport, onNewChat, onOpenSettings, theme, onToggleTheme }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const handleConversationContextMenu = useCallback(
    (e: React.MouseEvent, convId: string) => {
      e.preventDefault()
      window.biav.showContextMenu('conversation', { conversationId: convId })
    },
    [],
  )

  useEffect(() => {
    const cleanup = window.biav.onContextMenuAction((_event, { action, data }) => {
      if (!data?.conversationId) return
      switch (action) {
        case 'rename-conversation':
          onRename?.(data.conversationId)
          break
        case 'export-conversation':
          onExport?.(data.conversationId)
          break
        case 'delete-conversation':
          onDelete(data.conversationId)
          break
      }
    })
    return cleanup
  }, [onDelete, onRename, onExport])

  const filteredConversations = searchQuery
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations

  return (
    <div className="w-64 shrink-0 flex flex-col border-r border-biav-border bg-biav-surface h-full">
      {/* Header */}
      <div className="titlebar-drag px-4 h-12 flex items-center border-b border-biav-border">
        <span className="titlebar-no-drag font-serif text-biav-gold font-semibold tracking-wide">
          B.I.A.V.
        </span>
      </div>

      {/* New Chat */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full py-2 px-3 rounded-lg border border-biav-border text-sm text-biav-text hover:border-biav-gold hover:text-biav-gold transition-colors"
        >
          + 新对话
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-biav-muted"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话..."
            className="w-full bg-biav-bg border border-biav-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold transition-colors"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2">
        {filteredConversations.length === 0 && searchQuery ? (
          <p className="text-center text-sm text-biav-muted py-4">无匹配对话</p>
        ) : null}
        {filteredConversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center gap-1 px-3 py-2 rounded-lg cursor-pointer text-sm mb-0.5 transition-colors ${
              conv.id === activeId
                ? 'bg-biav-border text-biav-gold'
                : 'text-biav-muted hover:bg-biav-border/50 hover:text-biav-text'
            }`}
            onClick={() => onSelect(conv.id)}
            onContextMenu={(e) => handleConversationContextMenu(e, conv.id)}
            onMouseEnter={() => setHoveredId(conv.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="flex-1 truncate">{conv.title}</span>
            {hoveredId === conv.id && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(conv.id)
                }}
                className="shrink-0 text-biav-muted hover:text-biav-danger p-0.5"
                title="删除"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-biav-border flex items-center justify-between">
        <span className="text-xs text-biav-muted">v0.1.0</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleTheme}
            className="text-biav-muted hover:text-biav-gold transition-colors"
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={onOpenSettings}
            className="text-biav-muted hover:text-biav-gold transition-colors"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
