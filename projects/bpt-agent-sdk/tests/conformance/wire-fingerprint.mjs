/**
 * Request-body wire fingerprint (conformance request-body differential axis,
 * enabled by decisions.md 2026-07-05 净室观测边界 r3 - clause ② content-blind
 * lifted). Reduces a captured Messages API request body to a STRUCTURAL
 * fingerprint: what each engine puts ON THE WIRE, independent of the exact
 * prose. This is the input half of the input+output differential - L1-L5
 * previously observed only outputs.
 *
 * Structural-by-choice: even though reading the full body is now permitted,
 * the fingerprint keeps signal high and noise low by comparing SHAPE (system
 * segmentation, cache breakpoints, tool set, thinking config) rather than
 * dumping prompt prose into the diff. Callers may still inspect the raw body.
 */

/** Count cache_control breakpoints on an array of content/tool blocks. */
function cacheBreakpoints(blocks) {
  if (!Array.isArray(blocks)) return 0;
  return blocks.filter((b) => b && typeof b === 'object' && b.cache_control).length;
}

/**
 * Reduce one request body to its structural fingerprint. Tolerates a missing
 * or unparsed body (returns a marker fingerprint rather than throwing).
 */
export function fingerprintRequestBody(body) {
  if (!body || typeof body !== 'object' || body.__unparsed !== undefined) {
    return { present: false };
  }
  const sys = body.system;
  const systemKind = sys === undefined ? 'none' : typeof sys === 'string' ? 'string' : 'blocks';
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return {
    present: true,
    systemKind,
    systemBlocks: systemKind === 'blocks' ? sys.length : systemKind === 'string' ? 1 : 0,
    systemCacheBreakpoints: systemKind === 'blocks' ? cacheBreakpoints(sys) : 0,
    toolNames: tools
      .map((t) => t && t.name)
      .filter((n) => typeof n === 'string')
      .sort(),
    toolCount: tools.length,
    toolCacheBreakpoints: cacheBreakpoints(tools),
    thinking:
      body.thinking && typeof body.thinking === 'object'
        ? { type: body.thinking.type ?? null, budget_tokens: body.thinking.budget_tokens ?? null }
        : null,
    hasTemperature: body.temperature !== undefined,
    stream: body.stream === true,
    topLevelKeys: Object.keys(body).sort(),
  };
}

/**
 * Compare two fingerprints, returning the list of facets that differ. Facet
 * values are compared by JSON identity; toolNames is set-compared (order
 * already normalized by sort). Returns [] when structurally identical.
 */
export function diffFingerprints(a, b) {
  const facets = [
    'present',
    'systemKind',
    'systemBlocks',
    'systemCacheBreakpoints',
    'toolCount',
    'toolCacheBreakpoints',
    'thinking',
    'hasTemperature',
    'stream',
  ];
  const out = [];
  for (const f of facets) {
    if (JSON.stringify(a?.[f]) !== JSON.stringify(b?.[f])) {
      out.push({ facet: f, a: a?.[f], b: b?.[f] });
    }
  }
  // toolNames: report the symmetric difference rather than raw arrays.
  const an = new Set(a?.toolNames ?? []);
  const bn = new Set(b?.toolNames ?? []);
  const onlyA = [...an].filter((n) => !bn.has(n));
  const onlyB = [...bn].filter((n) => !an.has(n));
  if (onlyA.length > 0 || onlyB.length > 0) {
    out.push({ facet: 'toolNames', onlyA, onlyB });
  }
  return out;
}
