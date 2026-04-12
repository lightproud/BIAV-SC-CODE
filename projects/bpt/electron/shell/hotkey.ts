/**
 * hotkey.ts — Global keyboard shortcuts.
 *
 * Why Ctrl/Cmd+Shift+B: inherited from biav-desktop convention.
 * The shortcut toggles window visibility (show/hide), which is the
 * single most-used shell action.
 */

import { globalShortcut } from 'electron';
import { getMainWindow } from './window';
import { logger } from '../core/logger';

export function registerGlobalHotkeys(): void {
  const accelerator = process.platform === 'darwin'
    ? 'CommandOrControl+Shift+B'
    : 'Ctrl+Shift+B';

  const registered = globalShortcut.register(accelerator, () => {
    const win = getMainWindow();
    if (!win) return;

    if (win.isVisible() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  if (registered) {
    logger.info('hotkey', `Global hotkey registered: ${accelerator}`);
  } else {
    logger.warn('hotkey', `Failed to register global hotkey: ${accelerator}`);
  }
}

export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll();
}
