import { useState, useRef, useEffect, useCallback } from 'react'
import type { ClipboardEntry } from '../types'

export default function ClipboardHistory() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  const refreshHistory = useCallback(async () => {
    const list = await window.biav.clipboardHistory()
    setEntries(list)
  }, [])

  // Load history when panel opens
  useEffect(() => {
    if (open) {
      refreshHistory()
    }
  }, [open, refreshHistory])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text)
  }

  async function handleClear() {
    await window.biav.clipboardClear()
    setEntries([])
  }

  function formatTime(timestamp: number) {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div ref={panelRef} className="relative titlebar-no-drag">
      <button
        className="p-1 rounded hover:bg-biav-border text-biav-muted"
        onClick={() => setOpen(!open)}
        title="剪贴板历史"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 rounded-md border border-biav-border bg-biav-surface shadow-lg z-50 flex flex-col" style={{ maxHeight: '300px' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-biav-border shrink-0">
            <span className="text-sm font-medium text-biav-text">剪贴板历史</span>
            {entries.length > 0 && (
              <button
                className="text-xs text-biav-muted hover:text-red-400 transition-colors"
                onClick={handleClear}
              >
                清空
              </button>
            )}
          </div>

          {/* Entries */}
          <div className="overflow-y-auto flex-1">
            {entries.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-biav-muted">
                暂无复制记录
              </div>
            ) : (
              entries.map((entry, i) => (
                <button
                  key={`${entry.timestamp}-${i}`}
                  className="w-full text-left px-3 py-2 hover:bg-biav-border/50 transition-colors border-b border-biav-border/30 last:border-b-0"
                  onClick={() => handleCopy(entry.text)}
                  title="点击复制"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      entry.source === 'code'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-biav-gold/20 text-biav-gold'
                    }`}>
                      {entry.source === 'code' ? '代码' : '消息'}
                    </span>
                    <span className="text-[10px] text-biav-muted ml-auto">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                  <div className="text-xs text-biav-text truncate">
                    {entry.text.length > 100 ? entry.text.slice(0, 100) + '...' : entry.text}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
