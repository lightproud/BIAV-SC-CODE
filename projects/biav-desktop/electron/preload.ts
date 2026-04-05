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

  // Models
  listModels: () => ipcRenderer.invoke('models:list'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, any>) => ipcRenderer.invoke('settings:set', settings),

  // Platform
  platform: process.platform,
})
