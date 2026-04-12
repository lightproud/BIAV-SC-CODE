/**
 * plugin-ipc.ts -- IPC handlers for plugin management.
 *
 * Why separate: Plugin management (list/enable/disable) is renderer-driven.
 * These handlers bridge the renderer PluginsPanel to the plugin loader.
 */

import { ipcMain } from 'electron';
import { initPlugins, listPlugins, enablePlugin, disablePlugin } from './loader';
import { logger } from '../core/logger';

/**
 * Register plugin management IPC handlers.
 * Called once from main.ts.
 */
export function registerPluginIpc(): void {
  ipcMain.handle('plugin:list', () => {
    return listPlugins();
  });

  ipcMain.handle('plugin:enable', async (_event, name: string) => {
    const result = await enablePlugin(name);
    return { success: result };
  });

  ipcMain.handle('plugin:disable', (_event, name: string) => {
    const result = disablePlugin(name);
    return { success: result };
  });

  ipcMain.handle('plugin:reload', async () => {
    logger.info('plugin-ipc', 'Reloading all plugins');
    await initPlugins();
    return { success: true };
  });
}
