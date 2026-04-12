/**
 * PluginsPanel.tsx -- Plugin management UI.
 *
 * Why: Users need to see which plugins are available, enable/disable them,
 * and check their status. This panel shows all discovered plugins with
 * toggle controls and status indicators.
 */

import { useState, useEffect, useCallback } from 'react';
import { getBpt } from '../lib/ipc';

interface PluginInfo {
  name: string;
  version: string;
  description: string;
  status: 'loaded' | 'running' | 'error' | 'disabled';
  error?: string;
  permissions: string[];
  toolCount: number;
  author?: string;
}

export default function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadPlugins = useCallback(async () => {
    try {
      const list = await getBpt().pluginList() as PluginInfo[];
      setPlugins(Array.isArray(list) ? list : []);
    } catch {
      setPlugins([]);
    }
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const handleToggle = async (name: string, currentStatus: string) => {
    setLoading(true);
    try {
      if (currentStatus === 'disabled') {
        await getBpt().pluginEnable(name);
      } else {
        await getBpt().pluginDisable(name);
      }
      await loadPlugins();
    } catch (err) {
      console.error('Plugin toggle failed:', err);
    }
    setLoading(false);
  };

  const handleReload = async () => {
    setLoading(true);
    try {
      await getBpt().pluginReload();
      await loadPlugins();
    } catch (err) {
      console.error('Plugin reload failed:', err);
    }
    setLoading(false);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-bpt-success';
      case 'loaded': return 'text-bpt-accent';
      case 'error': return 'text-bpt-error';
      case 'disabled': return 'text-bpt-text-dim';
      default: return 'text-bpt-text-dim';
    }
  };

  const statusDot = (status: string) => {
    switch (status) {
      case 'running': return 'bg-bpt-success';
      case 'loaded': return 'bg-bpt-accent';
      case 'error': return 'bg-bpt-error';
      case 'disabled': return 'bg-bpt-text-dim';
      default: return 'bg-bpt-text-dim';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-bpt-gold">Plugins</h2>
            <p className="text-xs text-bpt-text-dim mt-0.5">
              Extend BPT with custom tools
            </p>
          </div>
          <button
            onClick={handleReload}
            disabled={loading}
            className="px-2 py-1 text-[10px] border border-bpt-border rounded hover:bg-bpt-border/50 transition-colors disabled:opacity-50"
          >
            Reload
          </button>
        </div>
      </div>

      {/* Plugin list */}
      <div className="flex-1 overflow-y-auto">
        {plugins.length === 0 && (
          <p className="p-4 text-xs text-bpt-text-dim text-center">
            No plugins found. Add plugin folders to plugins/ directory.
          </p>
        )}
        {plugins.map((plugin) => (
          <div key={plugin.name} className="border-b border-bpt-border/50 px-3 py-3">
            {/* Name + status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${statusDot(plugin.status)}`} />
                <span className="text-xs font-medium text-bpt-text">{plugin.name}</span>
                <span className="text-[10px] text-bpt-text-dim">v{plugin.version}</span>
              </div>
              <button
                onClick={() => handleToggle(plugin.name, plugin.status)}
                disabled={loading || plugin.status === 'error'}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  plugin.status === 'disabled'
                    ? 'border-bpt-success/30 text-bpt-success hover:bg-bpt-success/10'
                    : 'border-bpt-error/30 text-bpt-error hover:bg-bpt-error/10'
                } disabled:opacity-50`}
              >
                {plugin.status === 'disabled' ? 'Enable' : 'Disable'}
              </button>
            </div>

            {/* Description */}
            <p className="text-[11px] text-bpt-text-dim mt-1">{plugin.description}</p>

            {/* Meta */}
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-bpt-text-dim">
              <span className={statusColor(plugin.status)}>{plugin.status}</span>
              {plugin.toolCount > 0 && (
                <span>{plugin.toolCount} tool{plugin.toolCount > 1 ? 's' : ''}</span>
              )}
              {plugin.author && <span>by {plugin.author}</span>}
            </div>

            {/* Permissions */}
            {plugin.permissions.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {plugin.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="px-1.5 py-0.5 text-[9px] bg-bpt-border/50 rounded text-bpt-text-dim"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            )}

            {/* Error */}
            {plugin.error && (
              <p className="mt-1.5 text-[10px] text-bpt-error bg-bpt-error/5 px-2 py-1 rounded">
                {plugin.error}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-bpt-border text-[10px] text-bpt-text-dim text-center">
        Plugins require explicit enablement (whitelist).
      </div>
    </div>
  );
}
