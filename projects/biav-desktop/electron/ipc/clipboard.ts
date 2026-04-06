import { ipcMain } from 'electron'

export interface ClipboardEntry {
  text: string
  timestamp: number
  source: 'code' | 'message'
}

const MAX_ENTRIES = 20
let clipboardHistory: ClipboardEntry[] = []

export function registerClipboardHandlers() {
  ipcMain.handle('clipboard:history', () => {
    return clipboardHistory
  })

  ipcMain.handle('clipboard:add', (_e, entry: { text: string; source: 'code' | 'message' }) => {
    const newEntry: ClipboardEntry = {
      text: entry.text,
      timestamp: Date.now(),
      source: entry.source,
    }
    // Deduplicate: remove existing entry with same text
    clipboardHistory = clipboardHistory.filter((e) => e.text !== entry.text)
    clipboardHistory.unshift(newEntry)
    // Enforce max size
    if (clipboardHistory.length > MAX_ENTRIES) {
      clipboardHistory = clipboardHistory.slice(0, MAX_ENTRIES)
    }
    return { ok: true }
  })

  ipcMain.handle('clipboard:clear', () => {
    clipboardHistory = []
    return { ok: true }
  })
}
