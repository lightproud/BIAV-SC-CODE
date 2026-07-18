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
 * Per-tool input_schema fingerprint: { toolName: { params:sorted, required:sorted,
 * hasDescription } }. STRUCTURAL - captures whether each tool advertises the same
 * parameter surface, not the prose description (kept out of the diff for
 * signal/noise; descriptions are compared elsewhere by the corpus-sync guard).
 */
function toolSchemaFingerprints(tools) {
  const out = {};
  for (const t of tools) {
    if (!t || typeof t.name !== 'string') continue;
    const schema = t.input_schema ?? {};
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    // WX3-3 (audit r3): capture per-param declared TYPE (and a nested-shape
    // marker), not just the param NAME. Two arms that agree on parameter names
    // but disagree on a type (string vs number) or on nesting (a param that is
    // a bare value vs an object/array) previously fingerprinted identical.
    const paramTypes = {};
    for (const [name, spec] of Object.entries(props)) {
      const s = spec && typeof spec === 'object' ? spec : {};
      const type = Array.isArray(s.type) ? [...s.type].sort().join('|') : (s.type ?? null);
      const nested =
        (s.properties && typeof s.properties === 'object' && Object.keys(s.properties).length > 0) ||
        (s.items && typeof s.items === 'object');
      paramTypes[name] = { type, nested: !!nested };
    }
    out[t.name] = {
      params: Object.keys(props).sort(),
      paramTypes,
      required: Array.isArray(schema.required) ? [...schema.required].sort() : [],
      hasDescription: typeof t.description === 'string' && t.description.length > 0,
    };
  }
  return out;
}

/**
 * Compare per-tool schemas for tools BOTH arms ship (shared set). Returns one
 * entry per shared tool whose param/required surface differs - the "each
 * interface" reference-target check. Tools unique to one arm are NOT reported
 * here (that is the toolNames facet's job / expected-surface).
 */
export function diffToolSchemas(aFp, bFp) {
  const a = aFp?.toolSchemas ?? {};
  const b = bFp?.toolSchemas ?? {};
  const shared = Object.keys(a).filter((n) => n in b);
  const out = [];
  for (const name of shared.sort()) {
    const diffs = [];
    if (JSON.stringify(a[name].params) !== JSON.stringify(b[name].params)) {
      diffs.push({ facet: 'params', a: a[name].params, b: b[name].params });
    }
    if (JSON.stringify(a[name].required) !== JSON.stringify(b[name].required)) {
      diffs.push({ facet: 'required', a: a[name].required, b: b[name].required });
    }
    // WX3-3: per-param type/nesting divergence (names may match while types do
    // not). Skip when EITHER side lacks the facet — an older reference snapshot
    // that predates paramTypes is unrecorded, not divergent (twin of the
    // undefined-facet rule in diffFingerprints).
    if (
      a[name].paramTypes !== undefined &&
      b[name].paramTypes !== undefined &&
      JSON.stringify(a[name].paramTypes) !== JSON.stringify(b[name].paramTypes)
    ) {
      diffs.push({ facet: 'paramTypes', a: a[name].paramTypes, b: b[name].paramTypes });
    }
    if (diffs.length > 0) out.push({ tool: name, diffs });
  }
  return out;
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
    // A1: per-block cache_control PRESENCE (position-aware) - captures the
    // cache-breakpoint PLACEMENT (which block carries it), a cache-economics
    // signal size/count alone misses. Text prose is deliberately excluded.
    systemSegments: systemKind === 'blocks' ? sys.map((b) => ({ cc: !!(b && b.cache_control) })) : [],
    toolNames: tools
      .map((t) => t && t.name)
      .filter((n) => typeof n === 'string')
      .sort(),
    toolCount: tools.length,
    toolCacheBreakpoints: cacheBreakpoints(tools),
    toolSchemas: toolSchemaFingerprints(tools),
    thinking:
      body.thinking && typeof body.thinking === 'object'
        ? { type: body.thinking.type ?? null, budget_tokens: body.thinking.budget_tokens ?? null }
        : null,
    hasTemperature: body.temperature !== undefined,
    stream: body.stream === true,
    // WX3-2 (audit r3): capture the requested model VALUE so two arms asking
    // for different models are detectable (topLevelKeys only shows the KEY).
    model: typeof body.model === 'string' ? body.model : null,
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
    'systemSegments',
    'toolCount',
    'toolCacheBreakpoints',
    'thinking',
    'hasTemperature',
    'stream',
    // WX3-2 (model value) + WX3-1 (topLevelKeys set): both were computed but
    // never diffed, so max_tokens/tool_choice/metadata/stop_sequences/top_p/
    // service_tier presence and a model mismatch were structurally invisible.
    'model',
    'topLevelKeys',
  ];
  const out = [];
  for (const f of facets) {
    // A facet that is UNDEFINED on either side is unrecorded, not divergent —
    // this keeps a newly-added facet (model, WX3-2) backward-compatible with an
    // older committed reference snapshot that predates it (`undefined` vs a
    // value is not a real difference; `null` vs a value still is).
    if (a?.[f] === undefined || b?.[f] === undefined) continue;
    if (JSON.stringify(a[f]) !== JSON.stringify(b[f])) {
      out.push({ facet: f, a: a[f], b: b[f] });
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
