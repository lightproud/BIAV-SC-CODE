import { ipcMain } from 'electron'
import Store from 'electron-store'

const store = new Store()

interface ProviderStatus {
  provider: string
  available: boolean
  models: { id: string; name: string }[]
}

// Generate a human-friendly name from a model ID
function modelIdToName(id: string): string {
  // Try common patterns: "claude-sonnet-4-20250514" -> "Claude Sonnet 4"
  const cleaned = id
    .replace(/-\d{8}$/, '')    // remove date suffix
    .replace(/-/g, ' ')        // dashes to spaces
    .replace(/\b\w/g, (c) => c.toUpperCase()) // capitalize words
  return cleaned
}

export function registerModelHandlers() {
  ipcMain.handle('models:list', (): ProviderStatus[] => {
    const apiKey = store.get('api_key', '') as string
    const modelListRaw = store.get('model_list', 'claude-sonnet-4-20250514,claude-opus-4-20250514,claude-haiku-4-20250506') as string

    const modelIds = modelListRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const models = modelIds.map((id) => ({
      id,
      name: modelIdToName(id),
    }))

    return [
      {
        provider: 'claude',
        available: !!apiKey,
        models,
      },
    ]
  })
}
