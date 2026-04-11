import { ipcMain, Menu, BrowserWindow, BaseWindow } from 'electron'

type MenuAction = { action: string; data?: any }

function send(win: BaseWindow | undefined, payload: MenuAction) {
  if (win && 'webContents' in win) {
    (win as BrowserWindow).webContents.send('context-menu:action', payload)
  }
}

function buildMessageMenu(role: 'user' | 'assistant', data: any): Electron.MenuItemConstructorOptions[] {
  if (role === 'user') {
    return [
      { label: '编辑', click: (_, win) => send(win, { action: 'edit-message', data }) },
      { label: '复制', click: (_, win) => send(win, { action: 'copy-message', data }) },
      { type: 'separator' },
      { label: '删除', click: (_, win) => send(win, { action: 'delete-message', data }) },
    ]
  }

  return [
    { label: '复制', click: (_, win) => send(win, { action: 'copy-message', data }) },
    { label: '复制为 Markdown', click: (_, win) => send(win, { action: 'copy-message-markdown', data }) },
    { type: 'separator' },
    { label: '重新生成', click: (_, win) => send(win, { action: 'regenerate-message', data }) },
  ]
}

function buildConversationMenu(data: any): Electron.MenuItemConstructorOptions[] {
  return [
    { label: '重命名', click: (_, win) => send(win, { action: 'rename-conversation', data }) },
    { label: '导出', click: (_, win) => send(win, { action: 'export-conversation', data }) },
    { type: 'separator' },
    { label: '删除', click: (_, win) => send(win, { action: 'delete-conversation', data }) },
  ]
}

export function registerContextMenuHandlers() {
  ipcMain.handle('context-menu:show', (event, type: string, data?: any) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined

    let template: Electron.MenuItemConstructorOptions[]

    switch (type) {
      case 'user-message':
        template = buildMessageMenu('user', data)
        break
      case 'assistant-message':
        template = buildMessageMenu('assistant', data)
        break
      case 'conversation':
        template = buildConversationMenu(data)
        break
      default:
        return
    }

    const menu = Menu.buildFromTemplate(template)
    menu.popup({ window: win as BrowserWindow })
  })
}
