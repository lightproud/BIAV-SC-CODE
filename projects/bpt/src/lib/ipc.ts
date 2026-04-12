/**
 * ipc.ts — Typed wrapper around window.bpt.* IPC bridge.
 *
 * Why: The renderer shouldn't call window.bpt directly because TypeScript
 * can't type-check it without this declaration. This file provides the
 * type and a safe accessor.
 *
 * Why not import from electron/preload.ts: That file lives outside the
 * src/ tsconfig scope and uses Node.js APIs. We re-declare the shape here
 * for the renderer's type safety.
 */

/** The shape of the window.bpt object exposed by preload.ts. */
export interface BptApi {
  chatSend: (conversationId: string, message: string, gear: string) => Promise<unknown>;
  chatAbort: () => Promise<unknown>;
  onChatStream: (callback: (event: unknown) => void) => () => void;

  convList: () => Promise<unknown>;
  convCreate: (title: string) => Promise<unknown>;
  convDelete: (id: string) => Promise<unknown>;
  convRename: (id: string, title: string) => Promise<unknown>;
  convLoadMessages: (id: string) => Promise<unknown>;
  convClearHistory: (id: string) => Promise<unknown>;

  configGet: (key: string) => Promise<unknown>;
  configSet: (key: string, value: unknown) => Promise<unknown>;

  gearSwitch: (gear: string) => Promise<unknown>;
  gearGet: () => Promise<unknown>;

  silverSearch: (query: string, topK?: number) => Promise<unknown>;
  silverGraphQuery: (entity: string, depth?: number) => Promise<unknown>;
  silverGraphFiles: (entity: string) => Promise<unknown>;
  silverRecommend: (query: string) => Promise<unknown>;
  silverStatus: () => Promise<unknown>;

  bpeSearch: (query: string, limit?: number) => Promise<unknown>;
  bpeLookup: (symbol: string, limit?: number) => Promise<unknown>;
  bpeStatus: () => Promise<unknown>;

  citeInject: (conversationId: string, chunk: unknown) => Promise<unknown>;

  artifactList: (conversationId?: string) => Promise<unknown>;
  artifactGet: (id: string) => Promise<unknown>;
  artifactDelete: (id: string) => Promise<unknown>;

  tokenHistory: (conversationId: string) => Promise<unknown>;

  windowMinimize: () => Promise<unknown>;
  windowToggle: () => Promise<unknown>;
}

declare global {
  interface Window {
    bpt: BptApi;
  }
}

/**
 * Access the BPT IPC bridge. Throws if called outside Electron context.
 */
export function getBpt(): BptApi {
  if (!window.bpt) {
    throw new Error('BPT IPC bridge not available. Are you running inside Electron?');
  }
  return window.bpt;
}
