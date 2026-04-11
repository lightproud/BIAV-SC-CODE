import { useState, useEffect } from 'react'
import type { Settings } from '../types'
import { useLocale } from '../hooks/useLocale'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>({
    api_key: '',
    api_base_url: '',
    model_list: '',
  })
  const [saving, setSaving] = useState(false)
  const { locale, setLocale, supportedLocales } = useLocale()

  useEffect(() => {
    window.bpt.getSettings().then(setSettings)
  }, [])

  async function handleSave() {
    setSaving(true)
    await window.bpt.setSettings(settings)
    setSaving(false)
    onClose()
  }

  function handleChange(key: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[500px] bg-bpt-surface border border-bpt-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bpt-border">
          <h2 className="font-serif text-bpt-gold-bright text-lg">设置</h2>
          <button onClick={onClose} className="p-1 rounded-md text-bpt-muted hover:text-bpt-text hover:bg-bpt-border/40 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Language selector */}
          <div>
            <label className="block text-xs text-bpt-muted mb-1.5">语言 / Language</label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full bg-bpt-bg border border-bpt-border rounded-lg px-3 py-2 text-sm text-bpt-text focus:outline-none focus:border-bpt-gold-dim transition-colors"
            >
              {supportedLocales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-bpt-muted mb-1.5">API Key</label>
            <input
              type="password"
              value={settings.api_key}
              onChange={(e) => handleChange('api_key', e.target.value)}
              placeholder="sk-ant-..."
              className="w-full bg-bpt-bg border border-bpt-border rounded-lg px-3 py-2 text-sm text-bpt-text placeholder-bpt-muted/50 focus:outline-none focus:border-bpt-gold-dim transition-colors font-mono"
            />
          </div>

          {/* API Base URL */}
          <div>
            <label className="block text-xs text-bpt-muted mb-1.5">
              API 地址
              <span className="text-bpt-muted/60 ml-1">（留空使用默认）</span>
            </label>
            <input
              type="text"
              value={settings.api_base_url}
              onChange={(e) => handleChange('api_base_url', e.target.value)}
              placeholder="https://api.anthropic.com"
              className="w-full bg-bpt-bg border border-bpt-border rounded-lg px-3 py-2 text-sm text-bpt-text placeholder-bpt-muted/50 focus:outline-none focus:border-bpt-gold-dim transition-colors font-mono"
            />
          </div>

          {/* Model List */}
          <div>
            <label className="block text-xs text-bpt-muted mb-1.5">
              模型列表
              <span className="text-bpt-muted/60 ml-1">（逗号分隔）</span>
            </label>
            <textarea
              value={settings.model_list}
              onChange={(e) => handleChange('model_list', e.target.value)}
              placeholder="claude-sonnet-4-20250514, claude-opus-4-20250514, claude-haiku-4-20250506"
              rows={3}
              className="w-full bg-bpt-bg border border-bpt-border rounded-lg px-3 py-2 text-sm text-bpt-text placeholder-bpt-muted/50 focus:outline-none focus:border-bpt-gold-dim transition-colors font-mono resize-none"
            />
            <p className="text-[10px] text-bpt-muted mt-1">
              输入模型 ID，用逗号分隔。保存后模型选择器会自动更新。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-bpt-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-bpt-muted hover:text-bpt-text hover:bg-bpt-border transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-bpt-gold/20 text-bpt-gold hover:bg-bpt-gold/30 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
