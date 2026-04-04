'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  useEffect(() => adjustHeight(), [text, adjustHeight])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-biav-border bg-biav-bg px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-3">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Send a message..."
            rows={1}
            className="w-full resize-none rounded-xl px-4 py-3
                       bg-biav-card border border-biav-border
                       focus:border-biav-gold-dark focus:outline-none
                       text-biav-text text-sm placeholder:text-biav-text-dimmer
                       disabled:opacity-50 transition-colors"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || !text.trim()}
          className="flex-shrink-0 w-10 h-10 rounded-xl
                     bg-biav-gold hover:bg-biav-gold-bright disabled:bg-biav-card
                     disabled:text-biav-text-dimmer text-biav-bg
                     transition-colors flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
