/**
 * auto-update-ipc.ts -- IPC handlers for the auto-update system.
 *
 * Why separate from auto-update.ts: The IPC registration is synchronous
 * (called at boot), while the actual updater init is async (checks for
 * electron-updater availability and config).
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  initAutoUpdate as initUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
} from './auto-update';

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:check', () => {
    checkForUpdates();
    return true;
  });

  ipcMain.handle('updater:download', () => {
    downloadUpdate();
    return true;
  });

  ipcMain.handle('updater:install', () => {
    installUpdate();
    return true;
  });
}

export async function initAutoUpdate(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  return initUpdater(getWindow);
}
