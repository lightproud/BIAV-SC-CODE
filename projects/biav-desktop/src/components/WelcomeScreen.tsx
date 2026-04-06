import type { ProviderStatus } from '../types'

interface Props {
  providers: ProviderStatus[]
  onOpenSettings: () => void
  onSuggestion: (text: string) => void
}

const suggestions = [
  { icon: '🌍', text: '解释忘却前夜的世界观' },
  { icon: '🐍', text: '帮我写一段 Python 代码' },
  { icon: '🔤', text: '翻译这段文字' },
  { icon: '📊', text: '分析最近的社区动态' },
]

export default function WelcomeScreen({ providers, onOpenSettings, onSuggestion }: Props) {
  const hasApiKey = providers.some((p) => p.available)

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      {/* Logo / Title */}
      <h1 className="text-5xl font-serif text-biav-gold-bright mb-2 select-none">
        缸中之脑
      </h1>
      <p className="text-sm text-biav-muted mb-10">
        Brain in a Vat &middot; Desktop v0.1.0
      </p>

      {/* API key setup prompt */}
      {!hasApiKey && (
        <div className="mb-8 rounded-xl bg-biav-surface border border-biav-border px-6 py-4 text-center max-w-md">
          <p className="text-biav-text mb-3">请先配置 API Key</p>
          <button
            onClick={onOpenSettings}
            className="rounded-lg bg-biav-gold/20 border border-biav-gold px-4 py-2 text-sm text-biav-gold hover:bg-biav-gold/30 transition-colors"
          >
            打开设置
          </button>
        </div>
      )}

      {/* Suggestion cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
        {suggestions.map((s) => (
          <button
            key={s.text}
            onClick={() => onSuggestion(s.text)}
            className="bg-biav-surface border border-biav-border rounded-xl px-4 py-3 text-left text-sm text-biav-text hover:border-biav-gold transition-colors"
          >
            <span className="mr-2">{s.icon}</span>
            {s.text}
          </button>
        ))}
      </div>

      {/* Shortcut hints */}
      <p className="mt-10 text-xs text-biav-muted select-none">
        快捷键: Cmd+N 新对话, Cmd+/ 快捷键帮助
      </p>
    </div>
  )
}
