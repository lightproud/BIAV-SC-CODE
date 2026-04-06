import { ipcMain } from 'electron'
import { getHooks, saveHooks, fireHook, type HookEvent } from '../tools/hooks'

export function registerHookHandlers() {
  ipcMain.handle('hooks:get', () => {
    return getHooks()
  })

  ipcMain.handle('hooks:save', (_event, config) => {
    saveHooks(config)
    return { ok: true }
  })

  ipcMain.handle('hooks:fire', async (_event, event: HookEvent) => {
    const output = await fireHook(event)
    return { output }
  })
}
