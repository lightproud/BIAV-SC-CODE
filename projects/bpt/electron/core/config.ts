/**
 * config.ts — electron-store wrapper.
 *
 * Why wrap electron-store: (1) single import point for the whole app,
 * (2) typed defaults, (3) future-proofed if we ever swap the backing store.
 */

import Store from 'electron-store';

interface StoreSchema {
  endpoint: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  currentGear: 'chat' | 'work';
  conversations: Array<{
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
  }>;
  repoRoot: string;
  silverMcpPath: string;
  truncateThreshold: number;
  compressionTriggerTurns: number;
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  /** Plugin whitelist and configuration. */
  plugins: {
    enabled: Record<string, boolean>;
    extraDirs: string[];
  };
  /** Reranker toggle for BPE. */
  bpeRerankerEnabled: boolean;
  /** Whether the gear switch confirmation dialog has been shown at least once. */
  gearConfirmSeen: boolean;
  /** Auto-update server URL (generic provider). Empty = disabled. */
  updateServerUrl: string;
}

const store = new Store<StoreSchema>({
  defaults: {
    endpoint: {
      id: 'default',
      name: 'Claude (Gateway)',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      model: 'claude-sonnet-4-6',
    },
    currentGear: 'chat',
    conversations: [],
    repoRoot: '',
    silverMcpPath: '',
    truncateThreshold: 2000,
    compressionTriggerTurns: 20,
    windowBounds: null,
    plugins: {
      enabled: {},
      extraDirs: [],
    },
    bpeRerankerEnabled: false,
    gearConfirmSeen: false,
    updateServerUrl: '',
  },
});

export function getConfig(key: string): unknown {
  return store.get(key);
}

export function setConfig(key: string, value: unknown): void {
  store.set(key, value);
}

export function getAllConfig(): StoreSchema {
  return store.store;
}
