/**
 * ipc-trunk.ts — IPC main-trunk dispatcher.
 *
 * Why a single registration point: biav-desktop had 16 scattered IPC modules
 * registered in main.ts, making it impossible to audit which channels existed.
 * This file is the ONE place where all ipcMain.handle() calls are registered.
 * Each domain handler is a plain function, not a class — keeps it simple.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getConfig, setConfig } from './config';
import { logTokenUsage, getTokenHistory } from './logger';

/**
 * Register all IPC handlers. Call once from main.ts after window creation.
 *
 * Why pass `getWindow` as a getter: the BrowserWindow reference may change
 * (e.g., after recreation). A getter ensures handlers always talk to the
 * current window.
 */
export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // ── Config ────────────────────────────────────────────────
  ipcMain.handle('config:get', (_event, key: string) => {
    return getConfig(key);
  });

  ipcMain.handle('config:set', (_event, key: string, value: unknown) => {
    setConfig(key, value);
    return true;
  });

  // ── Gear ──────────────────────────────────────────────────
  // Gear state lives in config store. Switching gear is just a config write
  // plus notifying the renderer that the tool set changed.
  ipcMain.handle('gear:switch', (_event, gear: string) => {
    if (gear !== 'chat' && gear !== 'work') {
      throw new Error(`Invalid gear: ${gear}. Must be "chat" or "work".`);
    }
    setConfig('currentGear', gear);
    return gear;
  });

  ipcMain.handle('gear:get', () => {
    return getConfig('currentGear') ?? 'chat';
  });

  // ── Token Log ─────────────────────────────────────────────
  ipcMain.handle('token:log', (_event, entry: unknown) => {
    logTokenUsage(entry as Record<string, unknown>);
    return true;
  });

  ipcMain.handle('token:history', (_event, conversationId: string) => {
    return getTokenHistory(conversationId);
  });

  // ── Conversations (in-memory for Phase 0) ─────────────────
  // Why in-memory: Phase 0 skips SQLite conversation persistence.
  // electron-store keeps the conversation list across restarts (just titles + IDs).
  // Full message history lives in renderer state during the session.
  ipcMain.handle('conv:list', () => {
    return getConfig('conversations') ?? [];
  });

  ipcMain.handle('conv:create', (_event, title: string) => {
    const conversations = (getConfig('conversations') ?? []) as Array<Record<string, unknown>>;
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = { id, title, createdAt: Date.now(), updatedAt: Date.now() };
    conversations.unshift(entry);
    setConfig('conversations', conversations);
    return entry;
  });

  ipcMain.handle('conv:delete', (_event, id: string) => {
    const conversations = (getConfig('conversations') ?? []) as Array<Record<string, string>>;
    setConfig('conversations', conversations.filter((c) => c.id !== id));
    return true;
  });

  // ── Window ────────────────────────────────────────────────
  ipcMain.handle('window:minimize', () => {
    getWindow()?.minimize();
    return true;
  });

  ipcMain.handle('window:toggle', () => {
    const win = getWindow();
    if (!win) return false;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
    return true;
  });

  // ── Silver Core & BPE & Chat ──────────────────────────────
  // These are registered by their respective modules after initialization.
  // See: silver/silver-ipc.ts, bpe/bpe-ipc.ts, conversation/stream.ts
  // This comment exists so future readers know those channels are NOT missing
  // from this file — they are intentionally registered elsewhere because they
  // depend on runtime state (MCP client, BPE index, LLM provider).
}
