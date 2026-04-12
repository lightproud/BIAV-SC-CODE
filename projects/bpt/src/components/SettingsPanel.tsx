/**
 * SettingsPanel.tsx — API endpoint and model configuration UI.
 *
 * Why a panel, not a modal: Settings are frequently adjusted during
 * development (switching models, checking gateway URL). A persistent
 * side panel is faster to access than a dialog.
 */

import { useState, useEffect } from 'react';
import { getBpt } from '../lib/ipc';

interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  provider?: string;
}

const DEFAULT_MODELS = [
  { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6', provider: 'claude' },
  { label: 'Claude Opus 4.6', value: 'claude-opus-4-6', provider: 'claude' },
  { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001', provider: 'claude' },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'openai' },
  { label: 'GPT-4o-mini', value: 'gpt-4o-mini', provider: 'openai' },
  { label: 'DeepSeek V3', value: 'deepseek-chat', provider: 'openai' },
  { label: 'Custom', value: '', provider: '' },
];

export default function SettingsPanel() {
  const [config, setConfig] = useState<EndpointConfig>({
    id: 'default',
    name: 'Claude (Gateway)',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
  });
  const [saved, setSaved] = useState(false);
  const [customModel, setCustomModel] = useState('');

  // Load current config
  useEffect(() => {
    const load = async () => {
      try {
        const endpoint = await getBpt().configGet('endpoint') as EndpointConfig | null;
        if (endpoint) {
          setConfig(endpoint);
          // Check if model matches a preset
          const preset = DEFAULT_MODELS.find((m) => m.value === endpoint.model);
          if (!preset || preset.value === '') {
            setCustomModel(endpoint.model);
          }
        }
      } catch {
        // Config not ready
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    try {
      await getBpt().configSet('endpoint', config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    }
  };

  const handleModelSelect = (value: string) => {
    const preset = DEFAULT_MODELS.find((m) => m.value === value);
    if (preset && preset.value !== '') {
      setConfig((prev) => ({
        ...prev,
        model: preset.value,
        provider: preset.provider,
      }));
    } else {
      // Custom model
      setConfig((prev) => ({
        ...prev,
        model: customModel,
      }));
    }
  };

  const isCustomModel = !DEFAULT_MODELS.some(
    (m) => m.value !== '' && m.value === config.model,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h2 className="text-sm font-bold text-bpt-gold">Settings</h2>
        <p className="text-xs text-bpt-text-dim mt-0.5">API endpoint & model configuration</p>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Provider selection */}
        <div>
          <label className="block text-xs text-bpt-text-dim mb-1">Provider</label>
          <select
            value={config.provider ?? 'claude'}
            onChange={(e) => setConfig((prev) => ({ ...prev, provider: e.target.value }))}
            className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                       focus:outline-none focus:border-bpt-gold-dim"
          >
            <option value="claude">Anthropic (Claude)</option>
            <option value="openai">OpenAI Compatible</option>
          </select>
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-xs text-bpt-text-dim mb-1">Base URL</label>
          <input
            type="text"
            value={config.baseUrl}
            onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="https://api.anthropic.com"
            className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                       focus:outline-none focus:border-bpt-gold-dim placeholder:text-bpt-text-dim"
          />
          <p className="text-[10px] text-bpt-text-dim mt-0.5">
            {config.provider === 'openai'
              ? 'OpenAI-compatible endpoint (e.g., http://gateway/v1)'
              : 'Leave default for official API, or enter gateway URL'}
          </p>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs text-bpt-text-dim mb-1">API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder="sk-..."
            className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                       focus:outline-none focus:border-bpt-gold-dim placeholder:text-bpt-text-dim"
          />
        </div>

        {/* Model selection */}
        <div>
          <label className="block text-xs text-bpt-text-dim mb-1">Model</label>
          <select
            value={isCustomModel ? '' : config.model}
            onChange={(e) => handleModelSelect(e.target.value)}
            className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                       focus:outline-none focus:border-bpt-gold-dim"
          >
            {DEFAULT_MODELS.map((m) => (
              <option key={m.value || 'custom'} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom model input */}
        {isCustomModel && (
          <div>
            <label className="block text-xs text-bpt-text-dim mb-1">Custom Model ID</label>
            <input
              type="text"
              value={customModel || config.model}
              onChange={(e) => {
                setCustomModel(e.target.value);
                setConfig((prev) => ({ ...prev, model: e.target.value }));
              }}
              placeholder="model-name"
              className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                         focus:outline-none focus:border-bpt-gold-dim placeholder:text-bpt-text-dim"
            />
          </div>
        )}

        {/* Endpoint name */}
        <div>
          <label className="block text-xs text-bpt-text-dim mb-1">Endpoint Name</label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="My Endpoint"
            className="w-full bg-bpt-bg border border-bpt-border rounded px-2 py-1.5 text-xs
                       focus:outline-none focus:border-bpt-gold-dim placeholder:text-bpt-text-dim"
          />
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          className={`w-full py-2 rounded text-xs font-medium transition-colors ${
            saved
              ? 'bg-bpt-success/20 text-bpt-success'
              : 'bg-bpt-gold/20 text-bpt-gold hover:bg-bpt-gold/30'
          }`}
        >
          {saved ? 'Saved' : 'Save Configuration'}
        </button>

        {/* Status display */}
        <div className="pt-2 border-t border-bpt-border">
          <p className="text-[10px] text-bpt-text-dim">
            Current: {config.provider ?? 'claude'} / {config.model || 'not set'}
          </p>
          <p className="text-[10px] text-bpt-text-dim">
            API Key: {config.apiKey ? `...${config.apiKey.slice(-4)}` : 'not set'}
          </p>
        </div>
      </div>
    </div>
  );
}
