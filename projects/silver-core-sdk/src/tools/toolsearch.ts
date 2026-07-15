/**
 * Deferred MCP tool loading ("tool search").
 *
 * DeferredMcpRegistry decorates a real McpRegistry. While ACTIVE it withholds
 * the schemas of MCP tools the model has not yet "loaded", so the per-turn
 * request omits their input_schema and saves context. A ToolSearch builtin
 * lets the model discover + load tools on demand; once loaded, the loop's
 * per-attempt tool-def rebuild surfaces their full schemas.
 *
 * has() stays true for ALL real tools even while inactive-in-schema, so a
 * lucky/hallucinated call still executes (this is context-saving, not access
 * control).
 */

import type {
  BuiltinTool,
  McpRegistry,
  McpToolEntry,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import type {
  JSONSchema,
  McpResource,
  McpResourceContent,
  McpServerConfig,
  McpServerStatus,
  CallToolResult,
} from '../types.js';

export const TOOL_SEARCH_NAME = 'ToolSearch';
export const DEFERRED_THRESHOLD = 50;

/** Whether deferred loading should be active for a given tool count. */
export function shouldActivate(opt: boolean | undefined, count: number): boolean {
  if (opt === true) return true;
  if (opt === false) return false;
  return count > DEFERRED_THRESHOLD;
}

/**
 * A cold (deferrable) built-in tool's wire metadata, registered on the deferred
 * registry so the ONE ToolSearch builtin can search + load it exactly like a
 * deferred MCP tool. `name` shares the single `loaded` namespace with MCP
 * qualified names (built-in names never start with `mcp__`, so no collision).
 */
export type DeferredBuiltinEntry = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
};

export class DeferredMcpRegistry implements McpRegistry {
  private active = false;
  /** ONE loaded namespace shared by deferred MCP tools (qualified names) and
   *  deferred cold built-ins (bare names) — the unification seam. */
  private readonly loaded = new Set<string>();
  /** Cold (deferrable) built-ins, by bare name. Empty -> this registry defers
   *  MCP only (the exact pre-unification behavior). Attached by query.ts when
   *  the caller opts into unified tool-search (options.toolSearch === true). */
  private readonly coldBuiltins = new Map<string, DeferredBuiltinEntry>();
  private readonly debug: (msg: string) => void;

  constructor(
    private readonly inner: McpRegistry,
    opts: { debug?: (msg: string) => void } = {},
  ) {
    this.debug = opts.debug ?? (() => undefined);
  }

  /** Register cold built-ins whose schemas defer behind ToolSearch while
   *  active. Idempotent-additive; call after the final built-in set is known
   *  (post disallowedTools removal, so a denied tool is never offered here). */
  attachColdBuiltins(entries: readonly DeferredBuiltinEntry[]): void {
    for (const e of entries) this.coldBuiltins.set(e.name, e);
  }

  /** True when a built-in's schema is currently WITHHELD from the request:
   *  deferral is active, the tool is cold, and it has not been loaded yet.
   *  buildToolDefs() consults this to skip the tool's schema. */
  isBuiltinDeferred(name: string): boolean {
    return this.active && this.coldBuiltins.has(name) && !this.loaded.has(name);
  }

  /** The cold-built-in catalog ToolSearch searches (union'd with the MCP
   *  catalog). Every cold built-in stays searchable regardless of load state. */
  coldBuiltinCatalog(): DeferredBuiltinEntry[] {
    return [...this.coldBuiltins.values()];
  }

  /** True when this registry has anything to defer at all (MCP tools or cold
   *  built-ins) — lets query.ts decide whether ToolSearch is worth wiring even
   *  with zero MCP servers. */
  hasDeferrableTools(): boolean {
    return this.inner.allTools().length > 0 || this.coldBuiltins.size > 0;
  }

  // -- pass-through delegation -----------------------------------------------

  connectAll(): Promise<void> {
    return this.inner.connectAll();
  }

  statuses(): McpServerStatus[] {
    return this.inner.statuses();
  }

  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    return this.inner.call(qualifiedName, args, signal);
  }

  listResources(server: string | undefined, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.listResources(server, signal);
  }

  readResource(server: string, uri: string, signal: AbortSignal): Promise<McpResourceContent[]> {
    return this.inner.readResource(server, uri, signal);
  }
  readResourceDir(server: string, uri: string, signal: AbortSignal): Promise<McpResource[]> {
    return this.inner.readResourceDir(server, uri, signal);
  }

  reconnect(serverName: string): Promise<void> {
    return this.inner.reconnect(serverName);
  }

  setEnabled(serverName: string, enabled: boolean): void {
    this.inner.setEnabled(serverName, enabled);
  }

  setServers(servers: Record<string, McpServerConfig>): Promise<void> {
    return this.inner.setServers(servers);
  }

  closeAll(): Promise<void> {
    return this.inner.closeAll();
  }

  /** has() is intentionally NOT gated on `loaded` - all real tools stay callable. */
  has(qualifiedName: string): boolean {
    return this.inner.has(qualifiedName);
  }

  /** When active, only tools the model has loaded expose their schemas. */
  allTools(): McpToolEntry[] {
    const all = this.inner.allTools();
    if (!this.active) return all;
    return all.filter((t) => this.loaded.has(t.qualifiedName));
  }

  // -- deferred-loading surface ----------------------------------------------

  /** Every real tool, regardless of the loaded set (ToolSearch searches this). */
  catalog(): McpToolEntry[] {
    return this.inner.allTools();
  }

  markLoaded(names: string[]): void {
    for (const n of names) this.loaded.add(n);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Decide activation from the option and the live real-tool count. Cold
   *  built-ins never lower the bar on their own (they are attached only when
   *  the caller passed toolSearch:true, which shouldActivate already forces
   *  active), so the MCP-count threshold governs the undefined-option case
   *  exactly as before. */
  activateIfNeeded(opt: boolean | undefined): void {
    this.active = shouldActivate(opt, this.inner.allTools().length);
    if (this.active) {
      this.debug(
        `[toolsearch] active (${this.inner.allTools().length} MCP tools, ` +
          `${this.coldBuiltins.size} cold built-ins deferred)`,
      );
    }
  }
}

/** A ToolSearch-searchable entry, normalized across the two deferred kinds
 *  (MCP tools and cold built-ins) so ONE search path covers both — the
 *  unification. */
type UnifiedEntry = {
  /** Key marked loaded + the exact name the model then calls: an MCP qualified
   *  name or a bare built-in name. */
  loadKey: string;
  description?: string;
  schema: JSONSchema;
  /** Grouping label for the no-match guidance: the MCP server, or 'built-in'. */
  group: string;
};

/** Union of the deferred MCP catalog and the cold-built-in catalog. */
function unifiedCatalog(reg: DeferredMcpRegistry): UnifiedEntry[] {
  const entries: UnifiedEntry[] = reg.catalog().map((t) => ({
    loadKey: t.qualifiedName,
    description: t.description,
    schema: t.inputSchema,
    group: t.serverName,
  }));
  for (const b of reg.coldBuiltinCatalog()) {
    entries.push({
      loadKey: b.name,
      description: b.description,
      schema: b.inputSchema,
      group: 'built-in',
    });
  }
  return entries;
}

function describeCatalog(catalog: UnifiedEntry[]): string {
  if (catalog.length === 0) return 'No additional tools are available to load.';
  const byGroup = new Map<string, string[]>();
  for (const t of catalog) {
    let list = byGroup.get(t.group);
    if (list === undefined) {
      list = [];
      byGroup.set(t.group, list);
    }
    list.push(t.loadKey);
  }
  const lines: string[] = ['No tools matched. Available tools to load:'];
  for (const [group, names] of byGroup) {
    lines.push(`- ${group}: ${names.join(', ')}`);
  }
  return lines.join('\n');
}

function renderMatch(t: UnifiedEntry): string {
  return (
    `## ${t.loadKey}\n` +
    `${t.description ?? '(no description)'}\n` +
    `input_schema: ${JSON.stringify(t.schema)}`
  );
}

/**
 * Build the ONE ToolSearch builtin. execute({query?,names?}) filters the
 * unified catalog — deferred MCP tools AND cold built-ins — by substring
 * (name/description) or an exact names[] match, marks the matches loaded (one
 * shared namespace), and returns their schemas so the model can call them on
 * the next turn. A built-in and an MCP tool are loaded through the exact same
 * path; the caller need not know which kind a name is.
 */
export function makeToolSearchTool(reg: DeferredMcpRegistry): BuiltinTool {
  return {
    name: TOOL_SEARCH_NAME,
    description:
      'Search for and load additional tools whose schemas are not yet in ' +
      'context. Pass a `query` substring (matched against tool name and ' +
      'description) or an exact `names` array. Matching tools are loaded and ' +
      'their input schemas returned so you can call them on the next turn.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Substring matched against tool name and description.',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exact tool names to load (MCP qualified names or built-in names).',
        },
      },
    },
    async execute(
      input: Record<string, unknown>,
      _ctx: ToolContext,
    ): Promise<ToolResultPayload> {
      const catalog = unifiedCatalog(reg);
      const names = Array.isArray(input.names)
        ? input.names.filter((n): n is string => typeof n === 'string')
        : undefined;
      const query = typeof input.query === 'string' ? input.query.trim() : '';

      let matched: UnifiedEntry[];
      if (names !== undefined && names.length > 0) {
        const set = new Set(names);
        matched = catalog.filter((t) => set.has(t.loadKey));
      } else if (query.length > 0) {
        const q = query.toLowerCase();
        matched = catalog.filter(
          (t) =>
            t.loadKey.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q),
        );
      } else {
        // No filter -> return guidance listing what is available.
        return { content: describeCatalog(catalog) };
      }

      if (matched.length === 0) {
        return { content: describeCatalog(catalog) };
      }

      reg.markLoaded(matched.map((t) => t.loadKey));
      const body = matched.map(renderMatch).join('\n\n');
      return {
        content:
          `Loaded ${matched.length} tool(s); you can now call them directly.\n\n${body}`,
      };
    },
  };
}
