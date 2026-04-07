import { useState, useRef, useEffect } from 'react'
import type { ModelParams as ModelParamsType } from '../types'

interface Props {
  params: ModelParamsType
  onChange: (params: ModelParamsType) => void
}

export default function ModelParams({ params, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative titlebar-no-drag">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-biav-muted hover:text-biav-text hover:bg-biav-border/60 transition-colors"
        title="模型参数"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span className="tabular-nums text-[11px]">
          T:{params.temperature.toFixed(1)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-64 bg-biav-surface border border-biav-border rounded-lg shadow-xl z-50 p-4 space-y-4">
          {/* Temperature */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-biav-muted">Temperature</label>
              <span className="text-xs text-biav-text tabular-nums">{params.temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={params.temperature}
              onChange={(e) =>
                onChange({ ...params, temperature: parseFloat(e.target.value) })
              }
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-biav-border accent-biav-gold"
            />
            <div className="flex justify-between text-[10px] text-biav-muted mt-0.5">
              <span>0.0</span>
              <span>1.0</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-biav-muted">Max Tokens</label>
            </div>
            <input
              type="number"
              min={256}
              max={32768}
              step={256}
              value={params.maxTokens}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val)) {
                  onChange({ ...params, maxTokens: Math.max(256, Math.min(32768, val)) })
                }
              }}
              className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-1.5 text-xs text-biav-text focus:outline-none focus:border-biav-gold-dim transition-colors tabular-nums"
            />
            <div className="flex justify-between text-[10px] text-biav-muted mt-0.5">
              <span>256</span>
              <span>32768</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
