import { useState, useEffect } from 'react'

interface StreamingStatusProps {
  tokens: number
  duration: number
}

export default function StreamingStatus({ tokens, duration }: StreamingStatusProps) {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const timer = setInterval(() => {
      setDotCount((c) => (c % 3) + 1)
    }, 500)
    return () => clearInterval(timer)
  }, [])

  const tokensPerSec = duration > 0 ? (tokens / duration).toFixed(1) : '—'
  const dots = '.'.repeat(dotCount)

  return (
    <div className="max-w-3xl mx-auto px-4 py-1">
      <div className="flex items-center gap-2 text-xs text-bpt-muted bg-bpt-bg-secondary/50 rounded px-3 py-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-bpt-gold animate-pulse" />
        <span>
          生成中{dots.padEnd(3, '\u00A0')} ~{tokens} tokens · {duration}s · {tokensPerSec} tok/s
        </span>
      </div>
    </div>
  )
}
