import React, { useState, useRef, useEffect } from 'react'

export default function QuickEntry() {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && text.trim()) {
      window.bpt.submitQuickEntry(text.trim())
      setText('')
    } else if (e.key === 'Escape') {
      setText('')
      window.bpt.hideQuickEntry()
    }
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center p-2">
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="快速提问..."
        className="w-full rounded-2xl border border-bpt-gold-dim bg-bpt-surface/95 px-5 py-4 text-lg text-bpt-text placeholder-bpt-muted shadow-2xl outline-none backdrop-blur focus:border-bpt-gold"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      />
    </div>
  )
}
