import { ipcMain } from 'electron'
import Store from 'electron-store'

const store = new Store()

interface ProviderStatus {
  provider: string
  available: boolean
  models: { id: string; name: string }[]
}

export function registerModelHandlers() {
  ipcMain.handle('models:list', (): ProviderStatus[] => {
    const claudeKey = store.get('anthropic_api_key', '') as string
    const openaiKey = store.get('openai_api_key', '') as string

    const providers: ProviderStatus[] = [
      {
        provider: 'claude',
        available: !!claudeKey,
        models: [
          { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          { id: 'claude-haiku-4-20250506', name: 'Claude Haiku 4' },
        ],
      },
      {
        provider: 'openai',
        available: !!openaiKey,
        models: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
          { id: 'o3-mini', name: 'o3-mini' },
        ],
      },
    ]

    return providers
  })
}
