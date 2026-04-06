import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('biav', {
  // Chat
  sendMessage: (req: {
    conversationId: string | null
    message: string
    provider: string
    model: string
  }) => ipcRenderer.invoke('chat:send', req),

  onChatStream: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on('chat:stream', callback)
    return () => ipcRenderer.removeListener('chat:stream', callback)
  },

  stopStreaming: () => ipcRenderer.invoke('chat:stop'),

  // Conversations
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getMessages: (conversationId: string) => ipcRenderer.invoke('conversations:messages', conversationId),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),
  exportConversation: (id: string, format: 'md' | 'json') => ipcRenderer.invoke('conversations:export', id, format),

  // Edit & Regenerate
  editMessage: (req: { conversationId: string; messageId: string; content: string }) =>
    ipcRenderer.invoke('chat:edit', req),
  regenerateMessage: (req: { conversationId: string; afterMessageId: string }) =>
    ipcRenderer.invoke('chat:regenerate', req),

  // Models
  listModels: () => ipcRenderer.invoke('models:list'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, any>) => ipcRenderer.invoke('settings:set', settings),

  // Files
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),

  // Quick Entry
  submitQuickEntry: (text: string) => ipcRenderer.invoke('quick-entry:submit', text),
  hideQuickEntry: () => ipcRenderer.invoke('quick-entry:hide'),

  onQuickEntryReceived: (callback: (event: any, text: string) => void) => {
    ipcRenderer.on('quick-entry:received', callback)
    return () => ipcRenderer.removeListener('quick-entry:received', callback)
  },

  // Platform
  platform: process.platform,

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
})
