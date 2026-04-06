import { app, BrowserWindow, globalShortcut, Menu, Tray, nativeImage, ipcMain, shell, screen } from 'electron'
import path from 'path'
import { initDatabase } from './ipc/db'
import { registerChatHandlers } from './ipc/chat'
import { registerConversationHandlers } from './ipc/conversations'
import { registerModelHandlers } from './ipc/models'
import { registerSettingsHandlers } from './ipc/settings'
import { registerExportHandlers } from './ipc/export'
import { registerFileHandlers } from './ipc/files'
import { registerContextMenuHandlers } from './ipc/context-menu'
import { initUpdater, checkForUpdate, downloadUpdate, installUpdate } from './updater'

let mainWindow: BrowserWindow | null = null
let quickEntryWindow: BrowserWindow | null = null
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

function createQuickEntry() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize

  quickEntryWindow = new BrowserWindow({
    width: 600,
    height: 80,
    x: Math.round((screenWidth - 600) / 2),
    y: Math.round((screenHeight - 80) / 3),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    quickEntryWindow.loadURL(`${VITE_DEV_SERVER_URL}quick-entry.html`)
  } else {
    quickEntryWindow.loadFile(path.join(__dirname, '../dist/quick-entry.html'))
  }

  quickEntryWindow.on('blur', () => {
    quickEntryWindow?.hide()
  })

  quickEntryWindow.on('closed', () => {
    quickEntryWindow = null
  })
}

function registerQuickEntryIPC() {
  ipcMain.handle('quick-entry:submit', (_event, text: string) => {
    if (mainWindow) {
      mainWindow.webContents.send('quick-entry:received', text)
      mainWindow.show()
      mainWindow.focus()
    }
    quickEntryWindow?.hide()
  })

  ipcMain.handle('quick-entry:hide', () => {
    quickEntryWindow?.hide()
  })
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

  globalShortcut.register('Alt+Space', () => {
    if (quickEntryWindow?.isVisible()) {
      quickEntryWindow.hide()
    } else {
      quickEntryWindow?.show()
      quickEntryWindow?.focus()
    }
  })
}

app.whenReady().then(() => {
  initDatabase()
  registerChatHandlers()
  registerConversationHandlers()
  registerModelHandlers()
  registerSettingsHandlers()
  registerExportHandlers()
  registerFileHandlers()
  registerContextMenuHandlers()

  createWindow()
  createQuickEntry()
  createTray()
  registerQuickEntryIPC()
  registerGlobalShortcut()

  // Auto-update (production only)
  if (!isDev) {
    initUpdater()
  }

  ipcMain.handle('updater:check', () => checkForUpdate())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => installUpdate())

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
