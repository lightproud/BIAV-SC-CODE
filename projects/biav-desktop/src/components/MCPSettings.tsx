import { useState, useEffect, useCallback } from 'react'
import type { MCPConfig, MCPServerConfig, MCPServerInfo, MCPTool } from '../types'

interface Props {
  onClose: () => void
}

export default function MCPSettings({ onClose }: Props) {
  const [config, setConfig] = useState<MCPConfig>({ mcpServers: {} })
  const [servers, setServers] = useState<MCPServerInfo[]>([])
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [tools, setTools] = useState<MCPTool[]>([])
  const [editingServer, setEditingServer] = useState<{ name: string; config: MCPServerConfig; isNew: boolean } | null>(null)
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const refresh = useCallback(async () => {
    const [cfg, srvs] = await Promise.all([
      window.biav.mcpGetConfig(),
      window.biav.mcpListServers(),
    ])
    setConfig(cfg)
    setServers(srvs)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (expandedServer) {
      window.biav.mcpListTools(expandedServer).then(setTools)
    } else {
      setTools([])
    }
  }, [expandedServer])

  async function handleStart(name: string) {
    setLoading((prev) => ({ ...prev, [name]: true }))
    await window.biav.mcpStartServer(name)
    await refresh()
    setLoading((prev) => ({ ...prev, [name]: false }))
  }

  async function handleStop(name: string) {
    setLoading((prev) => ({ ...prev, [name]: true }))
    await window.biav.mcpStopServer(name)
    await refresh()
    setLoading((prev) => ({ ...prev, [name]: false }))
  }

  async function handleDelete(name: string) {
    await window.biav.mcpStopServer(name)
    const newConfig = { ...config }
    delete newConfig.mcpServers[name]
    await window.biav.mcpSaveConfig(newConfig)
    await refresh()
    if (expandedServer === name) setExpandedServer(null)
  }

  async function handleSaveServer() {
    if (!editingServer) return
    const newConfig = { ...config, mcpServers: { ...config.mcpServers } }
    newConfig.mcpServers[editingServer.name] = editingServer.config
    await window.biav.mcpSaveConfig(newConfig)
    setEditingServer(null)
    await refresh()
  }

  function handleAddNew() {
    setEditingServer({
      name: '',
      config: { command: '', args: [], env: {} },
      isNew: true,
    })
  }

  function handleEditExisting(name: string) {
    const serverConfig = config.mcpServers[name]
    if (serverConfig) {
      setEditingServer({
        name,
        config: { ...serverConfig, args: [...(serverConfig.args || [])], env: { ...(serverConfig.env || {}) } },
        isNew: false,
      })
    }
  }

  function statusColor(status: string) {
    switch (status) {
      case 'running': return 'bg-green-500'
      case 'starting': return 'bg-yellow-500'
      case 'error': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  function statusLabel(status: string) {
    switch (status) {
      case 'running': return '运行中'
      case 'starting': return '启动中'
      case 'error': return '错误'
      default: return '已停止'
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[600px] max-h-[80vh] bg-biav-surface border border-biav-border rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-biav-border shrink-0">
          <h2 className="font-serif text-biav-gold-bright text-lg">MCP 服务器</h2>
          <button onClick={onClose} className="text-biav-muted hover:text-biav-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {editingServer ? (
            <ServerEditor
              editing={editingServer}
              onChange={setEditingServer}
              onSave={handleSaveServer}
              onCancel={() => setEditingServer(null)}
            />
          ) : (
            <>
              {servers.length === 0 && Object.keys(config.mcpServers).length === 0 && (
                <div className="text-biav-muted text-sm text-center py-8">
                  暂无 MCP 服务器配置。点击下方按钮添加。
                </div>
              )}
              {Object.keys(config.mcpServers).map((name) => {
                const info = servers.find((s) => s.name === name)
                const status = info?.status || 'stopped'
                const isExpanded = expandedServer === name
                const isLoading = loading[name]

                return (
                  <div key={name} className="border border-biav-border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Status dot */}
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusColor(status)}`} />

                      {/* Name & status */}
                      <button
                        className="flex-1 text-left"
                        onClick={() => setExpandedServer(isExpanded ? null : name)}
                      >
                        <span className="text-sm font-medium text-biav-text">{name}</span>
                        <span className="text-xs text-biav-muted ml-2">
                          {statusLabel(status)}
                          {info && info.toolCount > 0 && ` - ${info.toolCount} 工具`}
                        </span>
                      </button>

                      {/* Actions */}
                      <div className="flex gap-1.5 shrink-0">
                        {status === 'running' ? (
                          <ActionButton onClick={() => handleStop(name)} disabled={isLoading} variant="danger">
                            停止
                          </ActionButton>
                        ) : (
                          <ActionButton onClick={() => handleStart(name)} disabled={isLoading}>
                            启动
                          </ActionButton>
                        )}
                        <ActionButton onClick={() => handleEditExisting(name)} variant="ghost">
                          编辑
                        </ActionButton>
                        <ActionButton onClick={() => handleDelete(name)} variant="danger">
                          删除
                        </ActionButton>
                      </div>
                    </div>

                    {info?.error && (
                      <div className="px-4 pb-2 text-xs text-red-400">{info.error}</div>
                    )}

                    {/* Expanded tools list */}
                    {isExpanded && status === 'running' && (
                      <div className="border-t border-biav-border px-4 py-3">
                        <div className="text-xs text-biav-muted mb-2">可用工具:</div>
                        {tools.length === 0 ? (
                          <div className="text-xs text-biav-muted/60">无工具</div>
                        ) : (
                          <div className="space-y-1.5">
                            {tools.map((tool) => (
                              <div key={tool.name} className="text-xs">
                                <span className="text-biav-gold font-mono">{tool.name}</span>
                                {tool.description && (
                                  <span className="text-biav-muted ml-2">{tool.description}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        {!editingServer && (
          <div className="flex justify-end px-6 py-4 border-t border-biav-border shrink-0">
            <button
              onClick={handleAddNew}
              className="px-4 py-2 rounded-lg text-sm bg-biav-gold/20 text-biav-gold hover:bg-biav-gold/30 transition-colors"
            >
              + 添加服务器
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  onClick,
  disabled,
  variant = 'default',
  children,
}: {
  onClick: () => void
  disabled?: boolean
  variant?: 'default' | 'danger' | 'ghost'
  children: React.ReactNode
}) {
  const base = 'px-2.5 py-1 rounded-md text-xs transition-colors disabled:opacity-50'
  const variants = {
    default: 'bg-biav-gold/20 text-biav-gold hover:bg-biav-gold/30',
    danger: 'text-red-400 hover:bg-red-500/10',
    ghost: 'text-biav-muted hover:text-biav-text hover:bg-biav-border',
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  )
}

function ServerEditor({
  editing,
  onChange,
  onSave,
  onCancel,
}: {
  editing: { name: string; config: MCPServerConfig; isNew: boolean }
  onChange: (v: { name: string; config: MCPServerConfig; isNew: boolean }) => void
  onSave: () => void
  onCancel: () => void
}) {
  const [argsText, setArgsText] = useState((editing.config.args || []).join('\n'))
  const [envText, setEnvText] = useState(
    Object.entries(editing.config.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )

  function handleArgsChange(text: string) {
    setArgsText(text)
    const args = text.split('\n').map((l) => l.trim()).filter(Boolean)
    onChange({ ...editing, config: { ...editing.config, args } })
  }

  function handleEnvChange(text: string) {
    setEnvText(text)
    const env: Record<string, string> = {}
    text.split('\n').forEach((line) => {
      const idx = line.indexOf('=')
      if (idx > 0) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
    })
    onChange({ ...editing, config: { ...editing.config, env } })
  }

  const canSave = editing.name.trim() !== '' && editing.config.command.trim() !== ''

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-biav-text">
        {editing.isNew ? '添加 MCP 服务器' : `编辑: ${editing.name}`}
      </h3>

      {editing.isNew && (
        <div>
          <label className="block text-xs text-biav-muted mb-1.5">服务器名称</label>
          <input
            type="text"
            value={editing.name}
            onChange={(e) => onChange({ ...editing, name: e.target.value })}
            placeholder="my-mcp-server"
            className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder-biav-muted/50 focus:outline-none focus:border-biav-gold-dim transition-colors"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-biav-muted mb-1.5">命令 (command)</label>
        <input
          type="text"
          value={editing.config.command}
          onChange={(e) => onChange({ ...editing, config: { ...editing.config, command: e.target.value } })}
          placeholder="npx, uvx, node, python..."
          className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder-biav-muted/50 focus:outline-none focus:border-biav-gold-dim transition-colors"
        />
      </div>

      <div>
        <label className="block text-xs text-biav-muted mb-1.5">参数 (每行一个)</label>
        <textarea
          value={argsText}
          onChange={(e) => handleArgsChange(e.target.value)}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
          rows={3}
          className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder-biav-muted/50 focus:outline-none focus:border-biav-gold-dim transition-colors font-mono resize-none"
        />
      </div>

      <div>
        <label className="block text-xs text-biav-muted mb-1.5">环境变量 (每行 KEY=VALUE)</label>
        <textarea
          value={envText}
          onChange={(e) => handleEnvChange(e.target.value)}
          placeholder="API_KEY=xxx"
          rows={2}
          className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder-biav-muted/50 focus:outline-none focus:border-biav-gold-dim transition-colors font-mono resize-none"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={!canSave}
          className="px-4 py-2 rounded-lg text-sm bg-biav-gold/20 text-biav-gold hover:bg-biav-gold/30 disabled:opacity-50 transition-colors"
        >
          保存
        </button>
      </div>
    </div>
  )
}
