import { useState, useRef, useEffect } from 'react'
import type { ProviderStatus } from '../types'

interface Props {
  providers: ProviderStatus[]
  provider: string
  model: string
  onSelect: (provider: string, model: string) => void
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
}

export default function ModelSelector({ providers, provider, model, onSelect }: Props) {
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

  const currentProvider = providers.find((p) => p.provider === provider)
  const currentModel = currentProvider?.models.find((m) => m.id === model)
  const displayName = currentModel?.name || model

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-bpt-muted hover:text-bpt-text hover:bg-bpt-border/60 transition-colors"
      >
        <span className="text-bpt-gold font-medium">{PROVIDER_LABELS[provider] || provider}</span>
        <span className="text-bpt-border">/</span>
        <span>{displayName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 w-56 bg-bpt-surface border border-bpt-border rounded-lg shadow-xl z-50 py-1 overflow-hidden">
          {providers.map((p) => (
            <div key={p.provider}>
              <div className="px-3 py-1.5 text-xs text-bpt-muted flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.available ? 'bg-bpt-success' : 'bg-bpt-danger'}`}
                />
                {PROVIDER_LABELS[p.provider] || p.provider}
              </div>
              {p.models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onSelect(p.provider, m.id)
                    setOpen(false)
                  }}
                  disabled={!p.available}
                  className={`w-full text-left px-6 py-1.5 text-sm transition-colors ${
                    p.provider === provider && m.id === model
                      ? 'text-bpt-gold bg-bpt-border/50'
                      : 'text-bpt-text hover:bg-bpt-border/30'
                  } ${!p.available ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
