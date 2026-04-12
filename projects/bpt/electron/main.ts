/**
 * main.ts — BPT Electron main process entry point.
 *
 * This is L0 Shell. It boots in this order:
 * 1. Create window
 * 2. Register IPC trunk (L1)
 * 3. Start Silver Core MCP client (L2)
 * 4. Load BPE index (L2)
 * 5. Register Silver + BPE + Chat IPC handlers
 * 6. Set up tray + hotkey
 * 7. Load renderer URL
 *
 * Why this order matters: IPC handlers must be registered BEFORE the renderer
 * tries to call them. Silver/BPE init is async but we register their IPC
 * handlers synchronously with pending-state callbacks, so the renderer can
 * show "connecting..." immediately.
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
import { logger } from './core/logger';
import { getConfig } from './core/config';

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
  logger.info('main', 'BPT starting', { version: '0.1.0' });

  // 1. Create window
  const win = createWindow();

  // 2. Register core IPC handlers
  registerIpcHandlers(() => getMainWindow());

  // 3-5. Init subsystems and register their IPC handlers
  registerSilverIpc();
  registerBpeIpc();
  registerChatIpc(() => getMainWindow());

  // Start async initialization (non-blocking — renderer shows "connecting...")
  initSilverCore().catch((err: Error) => {
    logger.error('main', 'Silver Core init failed', { error: err.message });
  });
  initBpe().catch((err: Error) => {
    logger.error('main', 'BPE init failed', { error: err.message });
  });

  // 6. Tray + hotkey
  createTray();
  registerGlobalHotkeys();

  // 7. Load renderer
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
});
