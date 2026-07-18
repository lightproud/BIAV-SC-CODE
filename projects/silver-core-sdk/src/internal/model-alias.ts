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
  // audit r4 U5-3: resolve aliases transitively. A single pass returned the
  // literal value of a host override even when that value is itself an alias —
  // `{sonnet:'opus'}` yielded the bare string 'opus' (still an alias, not a
  // concrete id), which the wire rejects with a 400. Walk override-then-built-in
  // until the current token is no longer a known alias key. A visited-set guards
  // against a cyclic config (`{a:'b',b:'a'}`) looping forever — on a repeat it
  // stops and returns the token rather than hanging.
  // `as string`: Object.hasOwn guarantees the key is present, but under
  // noUncheckedIndexedAccess the index read is still typed `string | undefined`.
  const seen = new Set<string>();
  let current = model;
  for (;;) {
    if (seen.has(current)) return current;
    seen.add(current);
    let next: string | undefined;
    if (aliases !== undefined && Object.hasOwn(aliases, current)) {
      next = aliases[current] as string;
    } else if (Object.hasOwn(MODEL_ALIASES, current)) {
      next = MODEL_ALIASES[current] as string;
    }
    if (next === undefined || next === current) return current;
    current = next;
  }
}
