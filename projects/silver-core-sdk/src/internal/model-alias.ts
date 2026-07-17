/**
 * Short model aliases -> concrete model ids, and their resolution rule.
 *
 * Lives in internal/ (the shared-kernel layer) because THREE modules consume
 * it — subagents (AgentDefinition.model), engine/compaction (compaction.model)
 * and generators (utility default) — and its previous home in
 * subagents/agents.ts made engine/compaction import from subagents while
 * subagents/runtime imports from engine: a package-level dependency cycle
 * (audit 2026-07-10 F1). Pure data + one pure function; no imports.
 */

/**
 * Short model aliases an AgentDefinition may use -> concrete model ids.
 *
 * These are the CURRENT Anthropic-official ids per tier (refreshed 2026-07-17;
 * `sonnet` previously pointed at the prior-generation claude-sonnet-4-5, which
 * gateways serving only current models reject with a model-not-found 400).
 * Hosts whose gateway serves different ids (or non-Claude models) override
 * per-alias via Options.modelAliases — see resolveModelAlias below.
 */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
};

/**
 * Resolve an AgentDefinition.model onto a concrete model id.
 *  - undefined / 'inherit' -> parentModel (subagent inherits the parent model)
 *  - a key in `aliases` (host overrides, Options.modelAliases) -> its value
 *  - a known short alias -> its concrete id from the built-in table
 *  - anything else -> passed through verbatim (assumed a full model id)
 *
 * `aliases` wins over the built-in table key-by-key (a host can remap just
 * `sonnet` and keep the rest), and may introduce new keys (including remapping
 * a full id). It cannot rebind 'inherit' — inheritance resolves first.
 *
 * Lookups use Object.hasOwn, never plain `tbl[model]`: a `model` colliding with
 * an Object.prototype key ('toString' / 'constructor' / '__proto__') would
 * otherwise resolve to the INHERITED function/object instead of undefined,
 * threading a non-string into the wire `model` field and corrupting the request
 * (Agent-tool model input is not runtime-validated; audit 2026-07-17 P1).
 */
export function resolveModelAlias(
  model: string | undefined,
  parentModel: string,
  aliases?: Readonly<Record<string, string>>,
): string {
  if (model === undefined || model === 'inherit') return parentModel;
  // `as string`: Object.hasOwn guarantees the key is present, but under
  // noUncheckedIndexedAccess the index read is still typed `string | undefined`.
  if (aliases !== undefined && Object.hasOwn(aliases, model)) return aliases[model] as string;
  if (Object.hasOwn(MODEL_ALIASES, model)) return MODEL_ALIASES[model] as string;
  return model;
}
