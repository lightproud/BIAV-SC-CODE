/**
 * preload.ts — Secure IPC bridge between main and renderer.
 *
 * Why contextIsolation + contextBridge: Electron security best practice.
 * The renderer cannot access Node.js APIs directly. All communication goes
 * through the typed `window.bpt` object defined here.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Every method here maps 1:1 to an IPC channel in ipc-trunk.ts.
 * The renderer calls `window.bpt.someMethod(...)` which becomes
 * `ipcRenderer.invoke('channel', ...)` under the hood.
 */
const api = {
  // ── LLM Chat ──────────────────────────────────────────────
  chatSend: (conversationId: string, message: string, gear: string) =>
    ipcRenderer.invoke('chat:send', conversationId, message, gear),
  chatAbort: () => ipcRenderer.invoke('chat:abort'),
  onChatStream: (callback: (event: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('chat:stream', handler);
    return () => ipcRenderer.removeListener('chat:stream', handler);
  },

  // ── Conversations ─────────────────────────────────────────
  convList: () => ipcRenderer.invoke('conv:list'),
  convCreate: (title: string) => ipcRenderer.invoke('conv:create', title),
  convDelete: (id: string) => ipcRenderer.invoke('conv:delete', id),

  // ── Config ────────────────────────────────────────────────
  configGet: (key: string) => ipcRenderer.invoke('config:get', key),
  configSet: (key: string, value: unknown) =>
    ipcRenderer.invoke('config:set', key, value),

  // ── Gear ──────────────────────────────────────────────────
  gearSwitch: (gear: string) => ipcRenderer.invoke('gear:switch', gear),
  gearGet: () => ipcRenderer.invoke('gear:get'),

  // ── Silver Core ───────────────────────────────────────────
  silverSearch: (query: string, topK?: number) =>
    ipcRenderer.invoke('silver:search', query, topK),
  silverGraphQuery: (entity: string, depth?: number) =>
    ipcRenderer.invoke('silver:graphQuery', entity, depth),
  silverGraphFiles: (entity: string) =>
    ipcRenderer.invoke('silver:graphFiles', entity),
  silverRecommend: (query: string) =>
    ipcRenderer.invoke('silver:recommend', query),
  silverStatus: () => ipcRenderer.invoke('silver:status'),

  // ── BPE ───────────────────────────────────────────────────
  bpeSearch: (query: string, limit?: number) =>
    ipcRenderer.invoke('bpe:search', query, limit),
  bpeLookup: (symbol: string, limit?: number) =>
    ipcRenderer.invoke('bpe:lookup', symbol, limit),
  bpeStatus: () => ipcRenderer.invoke('bpe:status'),

  // ── Token Log ─────────────────────────────────────────────
  tokenHistory: (conversationId: string) =>
    ipcRenderer.invoke('token:history', conversationId),

  // ── Shell ─────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggle: () => ipcRenderer.invoke('window:toggle'),
};

contextBridge.exposeInMainWorld('bpt', api);

export type BptApi = typeof api;
