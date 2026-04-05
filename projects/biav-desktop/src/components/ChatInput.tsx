import { useState, useRef, useCallback } from 'react'

interface Props {
  onSend: (content: string) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
}

export default function ChatInput({ onSend, onStop, isStreaming, disabled }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed || isStreaming || disabled) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-biav-border px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            adjustHeight()
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-biav-surface border border-biav-border rounded-xl px-4 py-2.5 text-sm text-biav-text placeholder-biav-muted focus:outline-none focus:border-biav-gold-dim transition-colors"
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            className="shrink-0 w-10 h-10 rounded-xl bg-biav-danger/20 text-biav-danger flex items-center justify-center hover:bg-biav-danger/30 transition-colors"
            title="停止"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || disabled}
            className="shrink-0 w-10 h-10 rounded-xl bg-biav-gold/20 text-biav-gold flex items-center justify-center hover:bg-biav-gold/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="发送"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
