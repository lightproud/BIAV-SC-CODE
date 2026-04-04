'use client'

import type { Conversation } from '@/lib/types'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export default function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <aside className="w-64 h-full flex flex-col bg-biav-bg border-r border-biav-border">
      {/* Header */}
      <div className="p-4 border-b border-biav-border">
        <h1 className="font-serif text-biav-gold-bright text-lg font-bold tracking-wider">
          Brain in a Vat
        </h1>
        <p className="text-biav-text-dimmer text-xs mt-0.5">B.I.A.V. Studio</p>
      </div>

      {/* New Chat */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg
                     border border-biav-border hover:border-biav-gold-dark
                     text-biav-text-dim hover:text-biav-gold transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`group flex items-center rounded-lg px-3 py-2.5 mb-0.5 cursor-pointer transition-colors
              ${activeId === conv.id
                ? 'bg-biav-card border border-biav-border text-biav-gold-bright'
                : 'text-biav-text-dim hover:bg-biav-card hover:text-biav-text'
              }`}
            onClick={() => onSelect(conv.id)}
          >
            <span className="flex-1 text-sm truncate">{conv.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(conv.id)
              }}
              className="opacity-0 group-hover:opacity-100 text-biav-text-dimmer hover:text-biav-risk
                         transition-opacity p-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-biav-border text-center">
        <span className="text-biav-text-dimmer text-xs">v0.1.0</span>
      </div>
    </aside>
  )
}
