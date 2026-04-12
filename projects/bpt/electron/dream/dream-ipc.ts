/**
 * dream-ipc.ts -- IPC handlers for dream agent and sentinel data.
 *
 * Why separate from ipc-trunk: Dream data is read-only filesystem access
 * that doesn't depend on runtime state (unlike Silver/BPE which need
 * async initialization). Registered synchronously at boot.
 */

import { ipcMain } from 'electron';
import {
  listDreamReports,
  getDreamReport,
  getLatestDreamReport,
  getDreamInsights,
  getLatestSentinelAlerts,
} from './dream-reader';

export function registerDreamIpc(): void {
  ipcMain.handle('dream:list', () => listDreamReports());

  ipcMain.handle('dream:get', (_event, date: string) => getDreamReport(date));

  ipcMain.handle('dream:latest', () => getLatestDreamReport());

  ipcMain.handle('dream:insights', () => getDreamInsights());

  ipcMain.handle('sentinel:alerts', () => getLatestSentinelAlerts());
}
