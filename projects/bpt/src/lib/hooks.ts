/**
 * hooks.ts — React hooks for Silver Core, BPE, and token accounting.
 *
 * Why centralize: Each panel component (SilverPanel, BPEPanel, TokenMeter)
 * needs to call IPC and manage loading/error states. Extracting this into
 * hooks keeps components focused on rendering.
 */

import { useState, useCallback, useEffect } from 'react';
import { getBpt } from './ipc';
import type { SilverSearchResult, BPEChunk } from '../types';

// ── Silver Core ─────────────────────────────────────────────────

interface SilverSearchState {
  results: SilverSearchResult[];
  loading: boolean;
  error: string | null;
  search: (query: string) => Promise<void>;
}

export function useSilverSearch(): SilverSearchState {
  const [results, setResults] = useState<SilverSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const bpt = getBpt();
      const response = await bpt.silverSearch(query);
      const data = response as { results?: SilverSearchResult[]; error?: string };
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else {
        setResults(data.results ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, error, search };
}

// ── Silver Core Status ──────────────────────────────────────────

interface SilverStatus {
  mcpConnected: boolean;
  mcpTools: string[];
  directAvailable: boolean;
}

export function useSilverStatus(): SilverStatus {
  const [status, setStatus] = useState<SilverStatus>({
    mcpConnected: false,
    mcpTools: [],
    directAvailable: false,
  });

  useEffect(() => {
    const poll = async () => {
      try {
        const bpt = getBpt();
        const s = await bpt.silverStatus() as SilverStatus;
        setStatus(s);
      } catch {
        // Silent — status bar will show disconnected
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return status;
}

// ── BPE ─────────────────────────────────────────────────────────

interface BpeSearchState {
  results: BPEChunk[];
  loading: boolean;
  error: string | null;
  search: (query: string) => Promise<void>;
}

export function useBpeSearch(): BpeSearchState {
  const [results, setResults] = useState<BPEChunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const bpt = getBpt();
      const response = await bpt.bpeSearch(query);
      const data = response as { results?: BPEChunk[]; error?: string };
      if (data.error) {
        setError(data.error);
        setResults([]);
      } else {
        setResults(data.results ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, error, search };
}

// ── BPE Status ──────────────────────────────────────────────────

interface BpeStatus {
  loaded: boolean;
  hasChunks: boolean;
  hasKeywords: boolean;
  hasVectors: boolean;
}

export function useBpeStatus(): BpeStatus {
  const [status, setStatus] = useState<BpeStatus>({
    loaded: false,
    hasChunks: false,
    hasKeywords: false,
    hasVectors: false,
  });

  useEffect(() => {
    const poll = async () => {
      try {
        const bpt = getBpt();
        const s = await bpt.bpeStatus() as BpeStatus;
        setStatus(s);
      } catch {
        // Silent
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return status;
}

// ── Gear ────────────────────────────────────────────────────────

export function useGear(): {
  gear: 'chat' | 'work';
  switchGear: (g: 'chat' | 'work') => Promise<void>;
} {
  const [gear, setGear] = useState<'chat' | 'work'>('chat');

  useEffect(() => {
    getBpt().gearGet().then((g: unknown) => setGear(g as 'chat' | 'work')).catch(() => {});
  }, []);

  const switchGear = useCallback(async (g: 'chat' | 'work') => {
    await getBpt().gearSwitch(g);
    setGear(g);
  }, []);

  return { gear, switchGear };
}
