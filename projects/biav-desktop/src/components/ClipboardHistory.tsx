import { useState, useEffect, useCallback } from 'react'
import type { ClipboardEntry } from '../types'

interface Props {
  onClose: () => void
}

export default function ClipboardHistory({ onClose }: Props) {
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refreshHistory = useCallback(async () => {
    setLoading(true)
    const list = await window.biav.clipboardHistory()
    setEntries(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[480px] max-h-[70vh] flex flex-col bg-biav-surface border border-biav-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-biav-border shrink-0">
          <h2 className="font-serif text-biav-gold-bright text-lg">剪贴板历史</h2>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <button
                className="text-xs text-biav-muted hover:text-red-400 transition-colors px-2 py-1"
                onClick={handleClear}
              >
                清空
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md text-biav-muted hover:text-biav-text hover:bg-biav-border/40 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-6 py-10 text-center text-sm text-biav-muted">加载中…</div>
          ) : entries.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-biav-muted">暂无复制记录</div>
          ) : (
            entries.map((entry, i) => (
              <button
                key={`${entry.timestamp}-${i}`}
                className="w-full text-left px-6 py-3 hover:bg-biav-border/40 transition-colors border-b border-biav-border/30 last:border-b-0"
                onClick={() => handleCopy(entry.text)}
                title="点击复制"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      entry.source === 'code'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-biav-gold/20 text-biav-gold'
                    }`}
                  >
                    {entry.source === 'code' ? '代码' : '消息'}
                  </span>
                  <span className="text-[10px] text-biav-muted ml-auto">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
                <div className="text-xs text-biav-text line-clamp-2 whitespace-pre-wrap break-words">
                  {entry.text.length > 200 ? entry.text.slice(0, 200) + '…' : entry.text}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
