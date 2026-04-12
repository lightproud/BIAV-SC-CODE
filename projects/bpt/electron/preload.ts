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
  convRename: (id: string, title: string) => ipcRenderer.invoke('conv:rename', id, title),
  convLoadMessages: (id: string) => ipcRenderer.invoke('conv:loadMessages', id),
  convClearHistory: (id: string) => ipcRenderer.invoke('conv:clearHistory', id),

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

  // ── Cite ───────────────────────────────────────────────────
  citeInject: (conversationId: string, chunk: unknown) =>
    ipcRenderer.invoke('cite:inject', conversationId, chunk),

  // ── Plugins ───────────────────────────────────────────────
  pluginList: () => ipcRenderer.invoke('plugin:list'),
  pluginEnable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
  pluginDisable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
  pluginReload: () => ipcRenderer.invoke('plugin:reload'),

  // ── Artifacts ─────────────────────────────────────────────
  artifactList: (conversationId?: string) =>
    ipcRenderer.invoke('artifact:list', conversationId),
  artifactGet: (id: string) =>
    ipcRenderer.invoke('artifact:get', id),
  artifactDelete: (id: string) =>
    ipcRenderer.invoke('artifact:delete', id),

  // ── Token Log ─────────────────────────────────────────────
  tokenHistory: (conversationId: string) =>
    ipcRenderer.invoke('token:history', conversationId),

  // ── Dream / Sentinel ─────────────────────────────────────
  dreamList: () => ipcRenderer.invoke('dream:list'),
  dreamGet: (date: string) => ipcRenderer.invoke('dream:get', date),
  dreamLatest: () => ipcRenderer.invoke('dream:latest'),
  dreamInsights: () => ipcRenderer.invoke('dream:insights'),
  sentinelAlerts: () => ipcRenderer.invoke('sentinel:alerts'),

  // ── Updater ──────────────────────────────────────────────
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  onUpdaterEvent: (callback: (event: unknown) => void) => {
    const handler = (_: unknown, data: unknown) => callback(data);
    ipcRenderer.on('updater:event', handler);
    return () => ipcRenderer.removeListener('updater:event', handler);
  },

  // ── Shell ─────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggle: () => ipcRenderer.invoke('window:toggle'),
};

contextBridge.exposeInMainWorld('bpt', api);

export type BptApi = typeof api;
