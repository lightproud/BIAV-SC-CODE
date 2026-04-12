/**
 * window.ts — Window creation and state persistence.
 *
 * Why persist window bounds: users expect the window to reappear where they
 * left it. electron-store holds { x, y, width, height } and we restore on
 * next launch.
 */

import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getConfig, setConfig } from '../core/config';

let mainWindow: BrowserWindow | null = null;

export function createWindow(): BrowserWindow {
  const saved = getConfig('windowBounds') as {
    x: number; y: number; width: number; height: number;
  } | null;

  mainWindow = new BrowserWindow({
    title: 'BPT — Black Pool Terminal',
    width: saved?.width ?? 1200,
    height: saved?.height ?? 800,
    x: saved?.x,
    y: saved?.y,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Show when ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Persist bounds on move/resize
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getBounds();
    setConfig('windowBounds', bounds);
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
