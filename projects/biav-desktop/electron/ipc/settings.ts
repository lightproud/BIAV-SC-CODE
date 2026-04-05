import { ipcMain } from 'electron'
import Store from 'electron-store'

const store = new Store()

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => {
    return {
      anthropic_api_key: store.get('anthropic_api_key', ''),
      openai_api_key: store.get('openai_api_key', ''),
      openai_base_url: store.get('openai_base_url', ''),
    }
  })

  ipcMain.handle('settings:set', (_e, settings: Record<string, any>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value)
    }
    return { ok: true }
  })
}
