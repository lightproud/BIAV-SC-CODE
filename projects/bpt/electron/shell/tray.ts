/**
 * tray.ts — System tray icon with context menu.
 *
 * Why a tray: users expect to minimize-to-tray and quick-access via icon.
 * Keeps BPT running without taking up taskbar space.
 */

import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'node:path';
import { getMainWindow } from './window';

let tray: Tray | null = null;

export function createTray(): Tray {
  // Use a simple 16x16 tray icon. In production this would be a proper .ico/.png.
  // For Phase 0, we create a minimal nativeImage from the SVG icon or use a placeholder.
  const iconPath = path.join(__dirname, '..', 'build', 'icon.svg');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    // Fallback: create a tiny transparent icon so the tray still works
    icon = nativeImage.createEmpty();
  }

  // Ensure the icon is properly sized for tray
  if (!icon.isEmpty()) {
    icon = icon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(icon);
  tray.setToolTip('BPT — Black Pool Terminal');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 BPT',
      click: () => {
        const win = getMainWindow();
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    const win = getMainWindow();
    if (win) {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    }
  });

  return tray;
}
