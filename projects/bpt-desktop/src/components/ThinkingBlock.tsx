import { useState, useRef, useEffect } from 'react'

interface Props {
  thinking: string
  isStreaming?: boolean
  duration?: number
}

export default function ThinkingBlock({ thinking, isStreaming, duration }: Props) {
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [thinking, expanded])

  const label = isStreaming
    ? '思考中...'
    : `已思考 ${duration ?? 0} 秒`

  return (
    <div className="mb-2 border border-bpt-border rounded-lg bg-bpt-surface/50 overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-bpt-muted hover:text-bpt-text transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span>
          {isStreaming && (
            <span className="inline-flex gap-0.5 mr-1">
              <span className="animate-pulse">●</span>
            </span>
          )}
          {label}
        </span>
      </button>
      <div
        className="transition-[max-height] duration-300 ease-in-out overflow-hidden"
        style={{ maxHeight: expanded ? contentHeight + 'px' : '0px' }}
      >
        <div
          ref={contentRef}
          className="px-4 pb-3 text-xs text-bpt-muted leading-relaxed whitespace-pre-wrap border-t border-bpt-border/50 pt-2"
        >
          {thinking}
        </div>
      </div>
    </div>
  )
}
