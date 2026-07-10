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

/** Short model aliases an AgentDefinition may use -> concrete model ids. */
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5',
};

/**
 * Resolve an AgentDefinition.model onto a concrete model id.
 *  - undefined / 'inherit' -> parentModel (subagent inherits the parent model)
 *  - a known short alias -> its concrete id
 *  - anything else -> passed through verbatim (assumed a full model id)
 */
export function resolveModelAlias(
  model: string | undefined,
  parentModel: string,
): string {
  if (model === undefined || model === 'inherit') return parentModel;
  return MODEL_ALIASES[model] ?? model;
}
