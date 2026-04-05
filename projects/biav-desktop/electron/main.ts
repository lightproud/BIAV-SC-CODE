import { app, BrowserWindow, globalShortcut, Menu, Tray, nativeImage, ipcMain, shell } from 'electron'
import path from 'path'
import { initDatabase } from './ipc/db'
import { registerChatHandlers } from './ipc/chat'
import { registerConversationHandlers } from './ipc/conversations'
import { registerModelHandlers } from './ipc/models'
import { registerSettingsHandlers } from './ipc/settings'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    title: 'Brain in a Vat',
    backgroundColor: '#0a0b10',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Brain in a Vat')

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => mainWindow?.show() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        mainWindow?.destroy()
        app.quit()
      },
    },
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => mainWindow?.show())
}

function registerGlobalShortcut() {
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

app.whenReady().then(() => {
  initDatabase()
  registerChatHandlers()
  registerConversationHandlers()
  registerModelHandlers()
  registerSettingsHandlers()

  createWindow()
  createTray()
  registerGlobalShortcut()

  app.on('activate', () => {
    if (!mainWindow) createWindow()
    else mainWindow.show()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
