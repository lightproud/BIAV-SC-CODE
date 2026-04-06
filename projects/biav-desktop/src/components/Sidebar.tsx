import { useState, useCallback, useEffect, useRef } from 'react'
import type { Conversation, Project } from '../types'

interface Props {
  conversations: Conversation[]
  projects: Project[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  onExport?: (id: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
  onNewProject: () => void
  onEditProject: (project: Project) => void
  onDeleteProject: (id: string) => void
  onMoveToProject: (conversationId: string, projectId: string | null) => void
  onPin: (id: string, pinned: boolean) => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function Sidebar({
  conversations,
  projects,
  activeId,
  onSelect,
  onDelete,
  onRename,
  onExport,
  onNewChat,
  onOpenSettings,
  onNewProject,
  onEditProject,
  onDeleteProject,
  onMoveToProject,
  onPin,
  theme,
  onToggleTheme,
}: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [moveMenuConvId, setMoveMenuConvId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)

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
        case 'rename-conversation': {
          const conv = conversations.find((c) => c.id === data.conversationId)
          if (conv) {
            setEditingId(conv.id)
            setEditingTitle(conv.title)
          }
          break
        }
        case 'export-conversation':
          onExport?.(data.conversationId)
          break
        case 'delete-conversation':
          onDelete(data.conversationId)
          break
      }
    })
    return cleanup
  }, [onDelete, onRename, onExport, conversations])

  const startEditing = useCallback((conv: Conversation) => {
    setEditingId(conv.id)
    setEditingTitle(conv.title)
    // Focus the input after it renders
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [])

  const commitRename = useCallback(() => {
    if (editingId && editingTitle.trim()) {
      onRename?.(editingId, editingTitle.trim())
    }
    setEditingId(null)
    setEditingTitle('')
  }, [editingId, editingTitle, onRename])

  const cancelEditing = useCallback(() => {
    setEditingId(null)
    setEditingTitle('')
  }, [])

  const filteredConversations = searchQuery
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  // Group conversations by project
  const projectConvMap = new Map<string | null, Conversation[]>()
  for (const conv of filteredConversations) {
    const key = conv.project_id ?? null
    if (!projectConvMap.has(key)) projectConvMap.set(key, [])
    projectConvMap.get(key)!.push(conv)
  }

  const uncategorized = projectConvMap.get(null) ?? []

  // Separate pinned conversations across all groups
  const pinnedConversations = filteredConversations.filter((c) => c.is_pinned)
  const unpinnedUncategorized = uncategorized.filter((c) => !c.is_pinned)

  function renderConversationItem(conv: Conversation) {
    return (
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
        onMouseLeave={() => { setHoveredId(null); setMoveMenuConvId(null) }}
      >
        <span className="flex-1 truncate">{conv.title}</span>
        {hoveredId === conv.id && (
          <div className="flex items-center gap-0.5 shrink-0">
            {/* Pin */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPin(conv.id, !conv.is_pinned)
              }}
              className="text-biav-muted hover:text-biav-gold p-0.5"
              title={conv.is_pinned ? '取消置顶' : '置顶'}
            >
              {conv.is_pinned ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                  <path d="M16 2L14.5 3.5 18 7l-5.5 5.5-5-5L3 12l1.5 1.5L3 15l3 3 1.5-1.5L9 18l4.5-4.5-5-5L14 3l4.5 4.5L20 6l-4-4z" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 2L14.5 3.5 18 7l-5.5 5.5-5-5L3 12l1.5 1.5L3 15l3 3 1.5-1.5L9 18l4.5-4.5-5-5L14 3l4.5 4.5L20 6l-4-4z" />
                </svg>
              )}
            </button>
            {/* Move to project */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setMoveMenuConvId(moveMenuConvId === conv.id ? null : conv.id)
                }}
                className="text-biav-muted hover:text-biav-gold p-0.5"
                title="移动到项目"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              </button>
              {moveMenuConvId === conv.id && (
                <div className="absolute right-0 top-6 z-50 bg-biav-surface border border-biav-border rounded-lg shadow-lg py-1 min-w-[140px]">
                  {conv.project_id && (
                    <button
                      className="w-full text-left px-3 py-1.5 text-xs text-biav-muted hover:bg-biav-border/50 hover:text-biav-text"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMoveToProject(conv.id, null)
                        setMoveMenuConvId(null)
                      }}
                    >
                      移除分类
                    </button>
                  )}
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-biav-border/50 ${
                        conv.project_id === p.id ? 'text-biav-gold' : 'text-biav-muted hover:text-biav-text'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onMoveToProject(conv.id, p.id)
                        setMoveMenuConvId(null)
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Delete */}
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
          </div>
        )}
      </div>
    )
  }

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

      {/* Project & Conversation List */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* Pinned Section */}
        {pinnedConversations.length > 0 && (
          <div className="mb-1">
            <div className="px-2 py-1.5 mt-1">
              <span className="text-xs font-medium text-biav-gold uppercase tracking-wider">已置顶</span>
            </div>
            {pinnedConversations.map(renderConversationItem)}
          </div>
        )}

        {/* Projects Section Header */}
        <div className="flex items-center justify-between px-2 py-1.5 mt-1">
          <span className="text-xs font-medium text-biav-muted uppercase tracking-wider">项目</span>
          <button
            onClick={onNewProject}
            className="text-biav-muted hover:text-biav-gold text-xs transition-colors"
            title="新建项目"
          >
            + 新项目
          </button>
        </div>

        {/* Project Groups */}
        {projects.map((project) => {
          const convs = (projectConvMap.get(project.id) ?? []).filter((c) => !c.is_pinned)
          const isCollapsed = collapsedProjects.has(project.id)
          return (
            <div key={project.id} className="mb-1">
              <div
                className="group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-sm text-biav-text hover:bg-biav-border/30 transition-colors"
                onClick={() => toggleProject(project.id)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-biav-gold">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <span className="flex-1 truncate font-medium">{project.name}</span>
                <span className="text-xs text-biav-muted">{convs.length}</span>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditProject(project)
                    }}
                    className="text-biav-muted hover:text-biav-gold p-0.5"
                    title="编辑项目"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteProject(project.id)
                    }}
                    className="text-biav-muted hover:text-biav-danger p-0.5"
                    title="删除项目"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="ml-3">
                  {convs.length === 0 && (
                    <p className="text-xs text-biav-muted px-3 py-1">暂无对话</p>
                  )}
                  {convs.map(renderConversationItem)}
                </div>
              )}
            </div>
          )
        })}

        {/* Uncategorized */}
        {unpinnedUncategorized.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1.5">
              <span className="text-xs font-medium text-biav-muted uppercase tracking-wider">未分类</span>
            </div>
            {unpinnedUncategorized.map(renderConversationItem)}
          </div>
        )}

        {filteredConversations.length === 0 && searchQuery ? (
          <p className="text-center text-sm text-biav-muted py-4">无匹配对话</p>
        ) : null}
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
