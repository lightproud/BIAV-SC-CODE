import { app, BrowserWindow, globalShortcut, Menu, Tray, nativeImage, ipcMain, shell, screen, session, nativeTheme } from 'electron'
import path from 'path'
import Store from 'electron-store'
import { initDatabase } from './ipc/db'
import { registerChatHandlers } from './ipc/chat'
import { registerConversationHandlers } from './ipc/conversations'
import { registerModelHandlers } from './ipc/models'
import { registerSettingsHandlers } from './ipc/settings'
import { registerExportHandlers } from './ipc/export'
import { registerImportHandlers } from './ipc/import'
import { registerFileHandlers } from './ipc/files'
import { registerContextMenuHandlers } from './ipc/context-menu'
import { registerNotificationHandlers } from './ipc/notifications'
import { registerClipboardHandlers } from './ipc/clipboard'
import { registerProjectHandlers } from './ipc/projects'
import { registerMCPHandlers } from './ipc/mcp'
import { registerStyleHandlers } from './ipc/styles'
import { registerHookHandlers } from './ipc/hooks'
import { MCPManager } from './mcp/manager'
import { loadHooks } from './tools/hooks'
import { initUpdater, checkForUpdate, downloadUpdate, installUpdate } from './updater'
import { setMainWindow, getMainWindow } from './window-state'

const mcpManager = new MCPManager()

// Initialize hook engine
loadHooks()

let mainWindow: BrowserWindow | null = null

let quickEntryWindow: BrowserWindow | null = null
let tray: Tray | null = null

const store = new Store<{ windowBounds: WindowBounds }>()

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!VITE_DEV_SERVER_URL

function isPositionOnScreen(x: number, y: number, width: number, height: number): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((display) => {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds
    // Check that at least part of the window overlaps a display
    return x + width > dx && x < dx + dw && y + height > dy && y < dy + dh
  })
}

function getWindowBounds(): Partial<WindowBounds> {
  const saved = store.get('windowBounds') as WindowBounds | undefined
  if (saved && isPositionOnScreen(saved.x, saved.y, saved.width, saved.height)) {
    return saved
  }
  return { width: 1100, height: 750 }
}

function saveWindowBounds() {
  if (!mainWindow) return
  const isMaximized = mainWindow.isMaximized()
  // Save the restored (non-maximized) bounds so we can restore properly
  const bounds = isMaximized
    ? (store.get('windowBounds') as WindowBounds | undefined) ?? mainWindow.getBounds()
    : mainWindow.getBounds()
  store.set('windowBounds', {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  })
}

function createWindow() {
  const { x, y, width, height, isMaximized } = getWindowBounds() as WindowBounds

  mainWindow = new BrowserWindow({
    width,
    height,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
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
      sandbox: true,
      webSecurity: true,
    },
    show: false,
  })
  setMainWindow(mainWindow)

  if (isMaximized) {
    mainWindow.maximize()
  }

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
    saveWindowBounds()
    if (process.platform === 'darwin') {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
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
      sandbox: true,
      webSecurity: true,
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

// In dev mode, disable CSP so Vite's inline scripts/HMR work.
// In production, enforce strict CSP.
const CSP = isDev ? '' : [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://api.anthropic.com https://api.openai.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
].join('; ')

app.whenReady().then(async () => {
  // Content Security Policy — enforce via response headers (skip in dev)
  if (CSP) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [CSP],
        },
      })
    })
  }

  await initDatabase()
  registerChatHandlers(mcpManager)
  registerConversationHandlers()
  registerModelHandlers()
  registerSettingsHandlers()
  registerExportHandlers()
  registerImportHandlers()
  registerFileHandlers()
  registerProjectHandlers()
  registerContextMenuHandlers()
  registerMCPHandlers(mcpManager)
  registerNotificationHandlers()
  registerClipboardHandlers()
  registerStyleHandlers()
  registerHookHandlers()

  createWindow()
  createQuickEntry()
  createTray()
  registerQuickEntryIPC()
  registerGlobalShortcut()

  // Forward system theme changes to renderer
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors)
  })

  // Auto-update (production only)
  if (!isDev) {
    initUpdater()
  }

  ipcMain.handle('updater:check', () => checkForUpdate())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => installUpdate())

  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))

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
  mcpManager.stopAll()
})
