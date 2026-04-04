'use client'

import { useState, useEffect, useRef } from 'react'
import type { LLMProvider, ProviderStatus } from '@/lib/types'

interface Props {
  provider: LLMProvider
  model: string
  onSelect: (provider: LLMProvider, model: string) => void
}

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  ollama: 'Ollama',
}

export default function ModelSelector({ provider, model, onSelect }: Props) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const shortModel = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                   bg-biav-card border border-biav-border hover:border-biav-gold-dark
                   text-sm text-biav-text-dim hover:text-biav-text transition-colors"
      >
        <span className="text-biav-gold text-xs font-bold">
          {PROVIDER_LABELS[provider]}
        </span>
        <span>{shortModel}</span>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-biav-border
                        bg-biav-card shadow-xl z-50 overflow-hidden">
          {providers.map((p) => (
            <div key={p.provider}>
              <div className="px-3 py-2 text-xs font-bold text-biav-gold-dark border-b border-biav-border flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${p.available ? 'bg-biav-safe' : 'bg-biav-risk'}`} />
                {PROVIDER_LABELS[p.provider]}
                {!p.available && <span className="text-biav-text-dimmer">(unavailable)</span>}
              </div>
              {p.available &&
                p.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      onSelect(p.provider, m)
                      setOpen(false)
                    }}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-biav-card-hover transition-colors
                      ${p.provider === provider && m === model
                        ? 'text-biav-gold-bright bg-biav-card-hover'
                        : 'text-biav-text'
                      }`}
                  >
                    {m}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
