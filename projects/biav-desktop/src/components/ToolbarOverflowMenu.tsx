import { useState, useRef, useEffect } from 'react'

interface Props {
  conversationId: string | null
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
  onOpenClipboard: () => void
}

export default function ToolbarOverflowMenu({ conversationId, systemPrompt, onSystemPromptChange, onOpenClipboard }: Props) {
  const [open, setOpen] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const [localPrompt, setLocalPrompt] = useState(systemPrompt)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalPrompt(systemPrompt)
  }, [systemPrompt])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setShowSystemPrompt(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleExport(format: 'md' | 'json') {
    setOpen(false)
    if (!conversationId) return
    await window.biav.exportConversation(conversationId, format)
  }

  function handleSaveSystemPrompt() {
    onSystemPromptChange(localPrompt)
    setShowSystemPrompt(false)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative titlebar-no-drag">
      <button
        className={`p-1.5 rounded-md transition-colors ${open ? 'text-biav-text bg-biav-border/60' : 'text-biav-muted hover:text-biav-text hover:bg-biav-border/60'}`}
        onClick={() => { setOpen(!open); setShowSystemPrompt(false) }}
        title="更多工具"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>

      {open && !showSystemPrompt && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-biav-surface border border-biav-border rounded-lg shadow-xl z-50 py-1 overflow-hidden">
          {/* System Prompt */}
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-biav-text hover:bg-biav-border/40 transition-colors"
            onClick={() => setShowSystemPrompt(true)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4z" />
              <path d="M9 22v-4h6v4" />
              <path d="M7 22h10" />
            </svg>
            <span>系统提示</span>
            {systemPrompt && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-biav-gold shrink-0" />
            )}
          </button>

          {/* Clipboard History */}
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-biav-text hover:bg-biav-border/40 transition-colors"
            onClick={() => {
              setOpen(false)
              onOpenClipboard()
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            <span>剪贴板历史</span>
          </button>

          <div className="my-1 border-t border-biav-border" />

          {/* Export */}
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-biav-text hover:bg-biav-border/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleExport('md')}
            disabled={!conversationId}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>导出 Markdown</span>
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-biav-text hover:bg-biav-border/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleExport('json')}
            disabled={!conversationId}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>导出 JSON</span>
          </button>
        </div>
      )}

      {/* System Prompt Sub-panel */}
      {open && showSystemPrompt && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-biav-surface border border-biav-border rounded-lg shadow-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSystemPrompt(false)}
              className="p-0.5 rounded hover:bg-biav-border/60 text-biav-muted hover:text-biav-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs font-medium text-biav-text">系统提示</span>
            <div className="flex-1" />
            <button
              className="text-xs text-biav-muted hover:text-biav-text transition-colors"
              onClick={() => {
                setLocalPrompt('')
                onSystemPromptChange('')
              }}
            >
              清除
            </button>
          </div>

          <textarea
            className="w-full h-28 text-xs bg-biav-bg border border-biav-border rounded-md p-2 text-biav-text resize-none focus:outline-none focus:ring-1 focus:ring-biav-gold/40 placeholder:text-biav-muted transition-shadow"
            placeholder="输入系统提示词，为 AI 设定角色和行为..."
            value={localPrompt}
            onChange={(e) => setLocalPrompt(e.target.value)}
          />

          <div className="flex justify-between items-center">
            <span className="text-[10px] text-biav-muted">
              {localPrompt ? `${localPrompt.length} 字符` : '未设置'}
            </span>
            <button
              onClick={handleSaveSystemPrompt}
              className="px-3 py-1 text-xs rounded-md bg-biav-gold/15 text-biav-gold hover:bg-biav-gold/25 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
