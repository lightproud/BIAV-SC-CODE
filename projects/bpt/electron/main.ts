/**
 * main.ts — BPT Electron main process entry point.
 *
 * This is L0 Shell. It boots in this order:
 * 1. Initialize SQLite database
 * 2. Create window
 * 3. Register IPC trunk (L1)
 * 4-6. Register Silver + BPE + Chat IPC handlers
 * 7. Set up tray + hotkey
 * 8. Load renderer URL
 *
 * Why this order matters: Database must be ready before IPC handlers.
 * IPC handlers must be registered BEFORE the renderer tries to call them.
 * Silver/BPE init is async but we register their IPC handlers synchronously
 * with pending-state callbacks, so the renderer can show "connecting...".
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createWindow, getMainWindow } from './shell/window';
import { createTray } from './shell/tray';
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './shell/hotkey';
import { registerIpcHandlers } from './core/ipc-trunk';
import { registerSilverIpc, initSilverCore } from './silver/silver-ipc';
import { registerBpeIpc, initBpe } from './bpe/bpe-ipc';
import { registerChatIpc } from './conversation/stream';
import { initConversationDb, closeConversationDb } from './conversation/store';
import { registerPluginIpc } from './plugin/plugin-ipc';
import { initPlugins } from './plugin/loader';
import { registerDreamIpc } from './dream/dream-ipc';
import { registerUpdaterIpc, initAutoUpdate } from './updater/auto-update-ipc';
import { BPT_VERSION } from '../src/version';
import { logger } from './core/logger';

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  logger.info('main', 'BPT starting', { version: BPT_VERSION });

  // 1. Initialize database
  initConversationDb();

  // 2. Create window
  const win = createWindow();

  // 3. Register core IPC handlers
  registerIpcHandlers(() => getMainWindow());

  // 4-7. Init subsystems and register their IPC handlers
  registerSilverIpc();
  registerBpeIpc();
  registerChatIpc(() => getMainWindow());
  registerPluginIpc();
  registerDreamIpc();
  registerUpdaterIpc();

  // Start async initialization (non-blocking — renderer shows "connecting...")
  initSilverCore().catch((err: Error) => {
    logger.error('main', 'Silver Core init failed', { error: err.message });
  });
  initBpe().catch((err: Error) => {
    logger.error('main', 'BPE init failed', { error: err.message });
  });
  initPlugins().catch((err: Error) => {
    logger.error('main', 'Plugin init failed', { error: err.message });
  });
  initAutoUpdate(() => getMainWindow()).catch((err: Error) => {
    logger.error('main', 'Auto-update init failed', { error: err.message });
  });

  // 7. Tray + hotkey
  createTray();
  registerGlobalHotkeys();

  // 8. Load renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  logger.info('main', 'BPT ready');
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay in dock even when all windows are closed.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked with no windows.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  unregisterGlobalHotkeys();
  closeConversationDb();
});
