/**
 * models.ts — Single source of truth for all supported LLM model metadata.
 *
 * Why one file: Previously model IDs, pricing, context windows, and UI labels
 * were scattered across claude.ts, token-accounting.ts, and SettingsPanel.tsx.
 * Adding a new model required editing three files — miss one and you get
 * wrong cost estimates or silent compression failures. One table, one edit.
 */

// ── Model specification ────────────────────────────────────────

export interface ModelPricing {
  /** Price per million input tokens (USD). */
  input: number;
  /** Price per million output tokens (USD). */
  output: number;
  /** Price per million cached-hit input tokens (USD). Typically 0.1x base input. */
  cacheHit: number;
  /** Price per million cache-write input tokens (USD). Typically 1.25x base input. */
  cacheWrite: number;
}

export interface ModelSpec {
  /** Human-readable label for UI display. */
  label: string;
  /** Provider type — determines which LLM adapter to use. */
  provider: 'claude' | 'openai';
  /** Maximum input context window in tokens. */
  contextWindow: number;
  /** Maximum output tokens the model can generate. */
  maxOutput: number;
  /** Per-million-token pricing. */
  pricing: ModelPricing;
  /** Whether to show this model in the Settings dropdown. */
  showInSelector: boolean;
}

// ── Registry ───────────────────────────────────────────────────
//
// To add a new model: add ONE entry here. Everything else
// (cost estimation, compression threshold, UI dropdown) picks it up
// automatically. Set showInSelector: false for dated aliases that
// shouldn't clutter the dropdown.

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // ── Claude 4.6 ──
  'claude-sonnet-4-6': {
    label: 'Claude Sonnet 4.6',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
    showInSelector: true,
  },
  'claude-opus-4-6': {
    label: 'Claude Opus 4.6',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 5, output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
    showInSelector: true,
  },

  // ── Claude 4.5 ──
  'claude-sonnet-4-5': {
    label: 'Claude Sonnet 4.5',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
    showInSelector: false,
  },
  'claude-sonnet-4-5-20250929': {
    label: 'Claude Sonnet 4.5',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
    showInSelector: false,
  },
  'claude-opus-4-5': {
    label: 'Claude Opus 4.5',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 5, output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
    showInSelector: false,
  },
  'claude-opus-4-5-20251101': {
    label: 'Claude Opus 4.5',
    provider: 'claude',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 5, output: 25, cacheHit: 0.50, cacheWrite: 6.25 },
    showInSelector: false,
  },

  // ── Claude 4 ──
  'claude-sonnet-4-20250514': {
    label: 'Claude Sonnet 4',
    provider: 'claude',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
    showInSelector: false,
  },

  // ── Claude Haiku ──
  'claude-haiku-4-5-20251001': {
    label: 'Claude Haiku 4.5',
    provider: 'claude',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 1, output: 5, cacheHit: 0.10, cacheWrite: 1.25 },
    showInSelector: true,
  },
  'claude-haiku-4-5': {
    label: 'Claude Haiku 4.5',
    provider: 'claude',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 1, output: 5, cacheHit: 0.10, cacheWrite: 1.25 },
    showInSelector: false,
  },
  'claude-3-5-haiku-20241022': {
    label: 'Claude 3.5 Haiku',
    provider: 'claude',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: { input: 0.8, output: 4, cacheHit: 0.08, cacheWrite: 1.00 },
    showInSelector: false,
  },

  // ── OpenAI ──
  'gpt-4o': {
    label: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutput: 16_384,
    pricing: { input: 2.5, output: 10, cacheHit: 1.25, cacheWrite: 2.5 },
    showInSelector: true,
  },
  'gpt-4o-mini': {
    label: 'GPT-4o-mini',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutput: 16_384,
    pricing: { input: 0.15, output: 0.6, cacheHit: 0.075, cacheWrite: 0.15 },
    showInSelector: true,
  },

  // ── DeepSeek ──
  'deepseek-chat': {
    label: 'DeepSeek V3',
    provider: 'openai',
    contextWindow: 64_000,
    maxOutput: 8_192,
    pricing: { input: 0.27, output: 1.10, cacheHit: 0.07, cacheWrite: 0.27 },
    showInSelector: true,
  },
};

// ── Defaults for unknown models ────────────────────────────────

const DEFAULT_SPEC: ModelSpec = {
  label: 'Unknown',
  provider: 'claude',
  contextWindow: 200_000,
  maxOutput: 64_000,
  pricing: { input: 3, output: 15, cacheHit: 0.30, cacheWrite: 3.75 },
  showInSelector: false,
};

// ── Accessor functions ─────────────────────────────────────────

/** Get full spec for a model. Returns sensible defaults for unknown models. */
export function getModelSpec(modelId: string): ModelSpec {
  return MODEL_REGISTRY[modelId] ?? DEFAULT_SPEC;
}

/** Get context window size for a model. */
export function getContextWindow(modelId: string): number {
  return getModelSpec(modelId).contextWindow;
}

/** Get pricing for a model. */
export function getModelPricing(modelId: string): ModelPricing {
  return getModelSpec(modelId).pricing;
}

/** Get models to show in the Settings UI dropdown. */
export function getSelectorModels(): Array<{ label: string; value: string; provider: string }> {
  const models: Array<{ label: string; value: string; provider: string }> = Object.entries(MODEL_REGISTRY)
    .filter(([, spec]) => spec.showInSelector)
    .map(([id, spec]) => ({ label: spec.label, value: id, provider: spec.provider }));

  // Append "Custom" entry for user-defined model IDs
  models.push({ label: 'Custom', value: '', provider: '' });
  return models;
}
