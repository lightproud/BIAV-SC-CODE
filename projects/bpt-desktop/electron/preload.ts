import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bpt', {
  // Chat
  sendMessage: (req: {
    conversationId: string | null
    message: string
    provider: string
    model: string
    systemPrompt?: string
    temperature?: number
    maxTokens?: number
    enableThinking?: boolean
  }) => ipcRenderer.invoke('chat:send', req),

  onChatStream: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('chat:stream', callback)
    return () => ipcRenderer.removeListener('chat:stream', callback)
  },

  stopStreaming: (conversationId?: string) => ipcRenderer.invoke('chat:stop', conversationId),
  getTasks: () => ipcRenderer.invoke('chat:tasks'),
  getToolHistory: (conversationId: string) => ipcRenderer.invoke('chat:tool-history', conversationId),

  // Conversations
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getMessages: (conversationId: string) => ipcRenderer.invoke('conversations:messages', conversationId),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke('conversations:rename', id, title),
  pinConversation: (id: string, pinned: boolean) => ipcRenderer.invoke('conversations:pin', id, pinned),
  forkConversation: (conversationId: string, messageId: string) => ipcRenderer.invoke('conversations:fork', conversationId, messageId),
  searchConversations: (query: string) => ipcRenderer.invoke('conversations:search', query),
  exportConversation: (id: string, format: 'md' | 'json') => ipcRenderer.invoke('conversations:export', id, format),
  importConversation: () => ipcRenderer.invoke('conversations:import'),

  // Edit & Regenerate
  editMessage: (req: { conversationId: string; messageId: string; content: string }) =>
    ipcRenderer.invoke('chat:edit', req),
  regenerateMessage: (req: { conversationId: string; afterMessageId: string }) =>
    ipcRenderer.invoke('chat:regenerate', req),

  // System Prompt
  getSystemPrompt: (conversationId: string) => ipcRenderer.invoke('conversations:getSystemPrompt', conversationId),
  setSystemPrompt: (conversationId: string, prompt: string) => ipcRenderer.invoke('conversations:setSystemPrompt', conversationId, prompt),

  // Models
  listModels: () => ipcRenderer.invoke('models:list'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, any>) => ipcRenderer.invoke('settings:set', settings),

  // Files
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  parsePdf: (base64Data: string, fileName: string) => ipcRenderer.invoke('file:parse-pdf', base64Data, fileName),

  // Quick Entry
  submitQuickEntry: (text: string) => ipcRenderer.invoke('quick-entry:submit', text),
  hideQuickEntry: () => ipcRenderer.invoke('quick-entry:hide'),

  onQuickEntryReceived: (callback: (event: any, text: string) => void) => {
    ipcRenderer.on('quick-entry:received', callback)
    return () => ipcRenderer.removeListener('quick-entry:received', callback)
  },

  // Usage
  getSessionUsage: (conversationId: string) => ipcRenderer.invoke('usage:session', conversationId),

  // Context Menu
  showContextMenu: (type: string, data?: any) => ipcRenderer.invoke('context-menu:show', type, data),

  onContextMenuAction: (callback: (event: any, payload: { action: string; data?: any }) => void) => {
    ipcRenderer.on('context-menu:action', callback)
    return () => ipcRenderer.removeListener('context-menu:action', callback)
  },

  // Projects
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (data: { name: string; description?: string; system_prompt?: string }) =>
    ipcRenderer.invoke('projects:create', data),
  updateProject: (id: string, data: { name?: string; description?: string; system_prompt?: string }) =>
    ipcRenderer.invoke('projects:update', id, data),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  listProjectConversations: (projectId: string) => ipcRenderer.invoke('projects:conversations', projectId),
  moveConversationToProject: (conversationId: string, projectId: string | null) =>
    ipcRenderer.invoke('projects:move', conversationId, projectId),

  // Notifications
  showNotification: (title: string, body: string) => ipcRenderer.invoke('notifications:show', { title, body }),
  setNotificationsEnabled: (enabled: boolean) => ipcRenderer.invoke('notifications:setEnabled', enabled),

  // Theme
  onSystemThemeChange: (callback: (isDark: boolean) => void) => {
    const handler = (_event: any, isDark: boolean) => callback(isDark)
    ipcRenderer.on('theme:system-changed', handler)
    return () => ipcRenderer.removeListener('theme:system-changed', handler)
  },

  // Platform
  platform: process.platform,

  // Process versions (Electron, Chrome, Node)
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },

  // Shell
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Updater
  checkForUpdate: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => {
    const handler = (_event: any, info: any) => callback(info)
    ipcRenderer.on('updater:update-available', handler)
    return () => ipcRenderer.removeListener('updater:update-available', handler)
  },

  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: any, info: any) => callback(info)
    ipcRenderer.on('updater:update-downloaded', handler)
    return () => ipcRenderer.removeListener('updater:update-downloaded', handler)
  },

  // Clipboard
  clipboardHistory: () => ipcRenderer.invoke('clipboard:history'),
  clipboardAdd: (entry: { text: string; source: 'code' | 'message' }) =>
    ipcRenderer.invoke('clipboard:add', entry),
  clipboardClear: () => ipcRenderer.invoke('clipboard:clear'),

  // Tool approval
  approveToolUse: (toolUseId: string, approved: boolean, alwaysAllow?: boolean) =>
    ipcRenderer.invoke('chat:tool-approve', toolUseId, approved, alwaysAllow),

  // MCP
  mcpListServers: () => ipcRenderer.invoke('mcp:list-servers'),
  mcpStartServer: (name: string) => ipcRenderer.invoke('mcp:start', name),
  mcpStopServer: (name: string) => ipcRenderer.invoke('mcp:stop', name),
  mcpListTools: (serverName: string) => ipcRenderer.invoke('mcp:list-tools', serverName),
  mcpCallTool: (serverName: string, toolName: string, args: Record<string, unknown>) =>
    ipcRenderer.invoke('mcp:call-tool', serverName, toolName, args),
  mcpGetConfig: () => ipcRenderer.invoke('mcp:get-config'),
  mcpSaveConfig: (config: any) => ipcRenderer.invoke('mcp:save-config', config),

  // Styles
  listStyles: () => ipcRenderer.invoke('styles:list'),
  saveStyle: (style: any) => ipcRenderer.invoke('styles:save', style),
  deleteStyle: (id: string) => ipcRenderer.invoke('styles:delete', id),

  // Hooks
  getHooks: () => ipcRenderer.invoke('hooks:get'),
  saveHooks: (config: any) => ipcRenderer.invoke('hooks:save', config),
  fireHook: (event: string) => ipcRenderer.invoke('hooks:fire', event),
})
