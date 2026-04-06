import { useState, useEffect } from 'react'
import type { Settings } from '../types'
import { useLocale } from '../hooks/useLocale'

interface Props {
  onClose: () => void
}

export default function SettingsModal({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>({
    anthropic_api_key: '',
    openai_api_key: '',
    openai_base_url: '',
  })
  const [saving, setSaving] = useState(false)
  const { locale, setLocale, supportedLocales } = useLocale()

  useEffect(() => {
    window.biav.getSettings().then(setSettings)
  }, [])

  async function handleSave() {
    setSaving(true)
    await window.biav.setSettings(settings)
    setSaving(false)
    onClose()
  }

  function handleChange(key: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[480px] bg-biav-surface border border-biav-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-biav-border">
          <h2 className="font-serif text-biav-gold-bright text-lg">设置</h2>
          <button onClick={onClose} className="text-biav-muted hover:text-biav-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Language selector */}
          <div>
            <label className="block text-xs text-biav-muted mb-1.5">语言 / Language</label>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text focus:outline-none focus:border-biav-gold-dim transition-colors"
            >
              {supportedLocales.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Anthropic API Key"
            value={settings.anthropic_api_key}
            onChange={(v) => handleChange('anthropic_api_key', v)}
            placeholder="sk-ant-..."
            secret
          />
          <Field
            label="OpenAI API Key"
            value={settings.openai_api_key}
            onChange={(v) => handleChange('openai_api_key', v)}
            placeholder="sk-..."
            secret
          />
          <Field
            label="OpenAI Base URL (可选)"
            value={settings.openai_base_url}
            onChange={(v) => handleChange('openai_base_url', v)}
            placeholder="https://api.openai.com/v1"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-biav-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm bg-biav-gold/20 text-biav-gold hover:bg-biav-gold/30 disabled:opacity-50 transition-colors"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secret,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  secret?: boolean
}) {
  return (
    <div>
      <label className="block text-xs text-biav-muted mb-1.5">{label}</label>
      <input
        type={secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder-biav-muted/50 focus:outline-none focus:border-biav-gold-dim transition-colors"
      />
    </div>
  )
}
