import { ipcMain, Notification } from 'electron'
import Store from 'electron-store'
import { getMainWindow } from '../window-state'

const store = new Store()

export function registerNotificationHandlers() {
  ipcMain.handle('notifications:show', (_event, req: { title: string; body: string }) => {
    const enabled = store.get('notifications_enabled', true) as boolean
    if (!enabled) return

    const notification = new Notification({
      title: req.title,
      body: req.body,
    })
    notification.on('click', () => {
      const mw = getMainWindow()
      if (mw) {
        mw.show()
        mw.focus()
      }
    })
    notification.show()
  })

  ipcMain.handle('notifications:setEnabled', (_event, enabled: boolean) => {
    store.set('notifications_enabled', enabled)
  })
}
