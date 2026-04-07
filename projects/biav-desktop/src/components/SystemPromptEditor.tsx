import { useState, useEffect, useRef } from 'react'

const PRESETS: { label: string; value: string }[] = [
  { label: '默认', value: '' },
  { label: '翻译助手', value: '你是一位专业翻译，擅长中英日三语互译。请根据用户输入自动判断源语言并翻译为目标语言。保持原文语气和风格，术语翻译准确。' },
  { label: '代码专家', value: '你是一位资深软件工程师，擅长多种编程语言和框架。请提供清晰、高效、可维护的代码方案，附带简要解释。遵循最佳实践和设计模式。' },
  { label: '创意写作', value: '你是一位才华横溢的创意写作助手。善于构思故事、塑造角色、营造氛围。语言生动优美，富有想象力。请根据用户的要求进行创作。' },
]

interface Props {
  conversationId: string | null
  systemPrompt: string
  onSystemPromptChange: (prompt: string) => void
}

export default function SystemPromptEditor({ conversationId, systemPrompt, onSystemPromptChange }: Props) {
  const [open, setOpen] = useState(false)
  const [localValue, setLocalValue] = useState(systemPrompt)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setLocalValue(systemPrompt)
  }, [systemPrompt])

  function handleBlur() {
    if (localValue !== systemPrompt) {
      onSystemPromptChange(localValue)
    }
  }

  function handlePresetSelect(value: string) {
    setLocalValue(value)
    onSystemPromptChange(value)
  }

  return (
    <div className="relative">
      <button
        className={`px-2 py-1 text-xs rounded transition-colors ${
          systemPrompt
            ? 'bg-biav-gold/20 text-biav-gold-bright hover:bg-biav-gold/30'
            : 'text-biav-muted hover:bg-biav-border hover:text-biav-text'
        }`}
        onClick={() => setOpen(!open)}
        title="系统提示"
      >
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4z" />
            <path d="M9 22v-4h6v4" />
            <path d="M7 22h10" />
          </svg>
          系统提示
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-biav-bg-secondary border border-biav-border rounded-lg shadow-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-biav-text">系统提示</span>
            <select
              className="text-xs bg-biav-bg border border-biav-border rounded px-2 py-1 text-biav-text"
              value={PRESETS.find((p) => p.value === localValue) ? localValue : '__custom__'}
              onChange={(e) => {
                if (e.target.value !== '__custom__') {
                  handlePresetSelect(e.target.value)
                }
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
              {!PRESETS.some((p) => p.value === localValue) && localValue && (
                <option value="__custom__">自定义</option>
              )}
            </select>
          </div>

          <textarea
            ref={textareaRef}
            className="w-full h-28 text-xs bg-biav-bg border border-biav-border rounded p-2 text-biav-text resize-none focus:outline-none focus:ring-1 focus:ring-biav-gold/50 placeholder:text-biav-muted"
            placeholder="输入系统提示词，为 AI 设定角色和行为..."
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
          />

          <div className="flex justify-between items-center">
            <span className="text-[10px] text-biav-muted">
              {localValue ? `${localValue.length} 字符` : '未设置'}
            </span>
            <button
              className="text-xs text-biav-muted hover:text-biav-text"
              onClick={() => {
                setLocalValue('')
                onSystemPromptChange('')
              }}
            >
              清除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
