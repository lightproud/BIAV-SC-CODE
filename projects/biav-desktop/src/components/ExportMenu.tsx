import { useState, useRef, useEffect } from 'react'

interface ExportMenuProps {
  conversationId: string | null
}

export default function ExportMenu({ conversationId }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleExport(format: 'md' | 'json') {
    setOpen(false)
    if (!conversationId) return
    await window.biav.exportConversation(conversationId, format)
  }

  return (
    <div ref={menuRef} className="relative titlebar-no-drag">
      <button
        className="p-1 rounded hover:bg-biav-border text-biav-muted disabled:opacity-40"
        onClick={() => setOpen(!open)}
        disabled={!conversationId}
        title="导出对话"
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
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-biav-border bg-biav-surface shadow-lg z-50">
          <button
            className="w-full text-left px-3 py-2 text-sm text-biav-text hover:bg-biav-border/50 rounded-t-md"
            onClick={() => handleExport('md')}
          >
            导出为 Markdown
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm text-biav-text hover:bg-biav-border/50 rounded-b-md"
            onClick={() => handleExport('json')}
          >
            导出为 JSON
          </button>
        </div>
      )}
    </div>
  )
}
