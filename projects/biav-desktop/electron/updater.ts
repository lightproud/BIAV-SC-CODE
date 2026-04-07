import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

export function initUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('updater:update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('updater:update-downloaded', {
        version: info.version,
      })
    }
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
  })

  // Check for updates on startup
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] Check failed:', err.message)
  })
}

export function checkForUpdate() {
  return autoUpdater.checkForUpdates()
}

export function downloadUpdate() {
  return autoUpdater.downloadUpdate()
}

export function installUpdate() {
  autoUpdater.quitAndInstall(false, true)
}
