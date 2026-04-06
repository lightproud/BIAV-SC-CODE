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
    <div ref={ref} className="relative titlebar-no-drag">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
      >
        <span className="text-biav-gold">{PROVIDER_LABELS[provider] || provider}</span>
        <span>/</span>
        <span>{displayName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-biav-surface border border-biav-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          {providers.map((p) => (
            <div key={p.provider}>
              <div className="px-3 py-1.5 text-xs text-biav-muted flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.available ? 'bg-biav-success' : 'bg-biav-danger'}`}
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
                      ? 'text-biav-gold bg-biav-border/50'
                      : 'text-biav-text hover:bg-biav-border/30'
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
