import { ipcMain } from 'electron'
import Store from 'electron-store'

const store = new Store()

// Migrate old settings to new format
function migrateSettings() {
  const oldKey = store.get('anthropic_api_key', '') as string
  if (oldKey && !store.get('api_key')) {
    store.set('api_key', oldKey)
    store.delete('anthropic_api_key')
  }
  // Clean up old OpenAI settings
  store.delete('openai_api_key')
  store.delete('openai_base_url')
}

export function registerSettingsHandlers() {
  migrateSettings()

  ipcMain.handle('settings:get', () => {
    return {
      api_key: store.get('api_key', ''),
      api_base_url: store.get('api_base_url', ''),
      model_list: store.get('model_list', 'claude-sonnet-4-20250514,claude-opus-4-20250514,claude-haiku-4-20250506'),
    }
  })

  ipcMain.handle('settings:set', (_e, settings: Record<string, any>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value)
    }
    return { ok: true }
  })
}
