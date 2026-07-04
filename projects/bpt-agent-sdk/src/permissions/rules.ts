/**
 * Permission rule parsing and matching.
 *
 * Rules come in two textual forms:
 *   - `Tool`        -> matches the tool by name alone
 *   - `Tool(spec)`  -> matches the tool by name AND its primary string
 *                      argument against `spec`
 *
 * Tool-name patterns additionally support the MCP wildcard forms
 * `mcp__server__*` and bare `mcp__server` (both match every tool exposed by
 * that server).
 */

import type { PermissionUpdate } from '../types.js';

export type ParsedRule = { toolName: string; specifier?: string };

/**
 * Parse a raw rule string (`Tool` or `Tool(spec)`).
 *
 * The specifier is everything between the first `(` and the trailing `)`,
 * kept verbatim (inner whitespace can be significant, e.g. shell commands).
 * Strings that do not look like `Tool(spec)` are treated as a bare tool name.
 */
export function parseRule(raw: string): ParsedRule {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('(');
  if (open > 0 && trimmed.endsWith(')')) {
    return {
      toolName: trimmed.slice(0, open).trim(),
      specifier: trimmed.slice(open + 1, -1),
    };
  }
  return { toolName: trimmed };
}

/**
 * Split an MCP qualified tool name `mcp__{server}__{tool}` into its server and
 * tool segments. The tool is the LAST `__`-delimited segment; the server is
 * everything between `mcp__` and that final `__`. Returns undefined for names
 * that are not `mcp__X__Y`-shaped (a non-empty server AND a non-empty tool are
 * both required).
 *
 * Anchoring the tool as the final segment lets us match the server EXACTLY,
 * even when the server name itself contains `__`. A naive split-on-first-`__`
 * (the previous implementation) both over-allowed - a rule scoped to server
 * `a` matched every tool of server `a__b` - and left servers whose name
 * contains `__` untargetable.
 */
function splitMcpName(qualified: string): { server: string; tool: string } | undefined {
  if (!qualified.startsWith('mcp__')) return undefined;
  const rest = qualified.slice('mcp__'.length);
  const sep = rest.lastIndexOf('__');
  if (sep <= 0) return undefined; // need a non-empty server before the final '__'
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (server.length === 0 || tool.length === 0) return undefined;
  return { server, tool };
}

/**
 * Match a tool-name pattern from allowedTools/disallowedTools entries.
 *
 * Supported forms:
 *   - exact name (`Bash`, `mcp__srv__tool`)
 *   - `mcp__server__*` -> any tool of that MCP server
 *   - `mcp__server`    -> shorthand for the same server-wide wildcard
 *
 * MCP wildcard forms match the tool's server segment EXACTLY (see
 * splitMcpName): `mcp__a` / `mcp__a__*` match tools of server `a` only, never
 * tools of a distinct server `a__b`, and a server whose name contains `__`
 * (e.g. `a__b`) is reachable via `mcp__a__b` / `mcp__a__b__*`.
 */
export function matchToolName(pattern: string, toolName: string): boolean {
  if (pattern === toolName) return true;
  if (!pattern.startsWith('mcp__')) return false;

  // Resolve the server this pattern scopes to (server-wide wildcard forms).
  const patternServer = pattern.endsWith('__*')
    ? pattern.slice('mcp__'.length, -'__*'.length) // 'mcp__server__*'
    : pattern.slice('mcp__'.length); // bare 'mcp__server'
  if (patternServer.length === 0 || patternServer.includes('*')) return false;

  const parsed = splitMcpName(toolName);
  return parsed !== undefined && parsed.server === patternServer;
}

/**
 * The tool input field a rule specifier is compared against. Tools not in
 * this table fall back to the JSON serialization of the whole input.
 */
const PRIMARY_ARG_FIELD: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  Glob: 'pattern',
  Grep: 'pattern',
};

/**
 * Extract the primary string argument of a tool call for specifier matching.
 * Returns undefined when a known tool's primary field is missing or not a
 * string (a specifier can then never match - the conservative outcome).
 */
function primaryArg(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const field = PRIMARY_ARG_FIELD[toolName];
  if (field !== undefined) {
    const value = input[field];
    return typeof value === 'string' ? value : undefined;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return undefined; // circular input can never match a specifier
  }
}

/**
 * Compare a rule specifier against a tool's primary argument value.
 *
 * Semantics: exact match, or prefix match when the specifier ends with `*`
 * (strip the `*`, compare prefix). A `:*` suffix is a boundary marker in the
 * `Bash(npm run:*)` style: the `:` is not part of the command text, so the
 * prefix is also tried without it.
 */
function specifierMatches(spec: string, value: string): boolean {
  if (spec === value) return true;
  if (spec.endsWith('*')) {
    const stem = spec.slice(0, -1);
    if (value.startsWith(stem)) return true;
    if (stem.endsWith(':')) {
      return value.startsWith(stem.slice(0, -1));
    }
  }
  return false;
}

/**
 * Full rule match for one tool call: tool name (with MCP wildcards) plus,
 * when the rule carries a specifier, the tool's primary string argument.
 */
export function ruleMatches(
  rule: ParsedRule,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (!matchToolName(rule.toolName, toolName)) return false;
  if (rule.specifier === undefined) return true;
  const value = primaryArg(toolName, input);
  if (value === undefined) return false;
  return specifierMatches(rule.specifier, value);
}

/** The first whitespace-delimited token of a shell command (`npm run x` -> `npm`). */
function firstToken(command: string): string {
  const trimmed = command.trim();
  const match = trimmed.match(/^\S+/);
  return match ? match[0] : trimmed;
}

/**
 * Build the `suggestions` array offered to a canUseTool callback at step 6 -
 * "approve and remember" rule candidates the app can echo back via
 * updatedPermissions.
 *
 * Always offers a bare tool-name allow rule. When the tool has a known string
 * primary argument, a second, tighter session rule is added: for Bash the
 * `${firstToken}:*` command-prefix style (e.g. `npm:*`), for the file/pattern
 * tools the exact primary argument. Tools with no known primary field (unknown
 * or MCP tools) get only the bare-name suggestion.
 */
export function buildPermissionSuggestions(
  toolName: string,
  input: Record<string, unknown>,
): PermissionUpdate[] {
  const suggestions: PermissionUpdate[] = [
    { type: 'addRules', rules: [{ toolName }], behavior: 'allow', destination: 'session' },
  ];
  const field = PRIMARY_ARG_FIELD[toolName];
  if (field !== undefined) {
    const value = input[field];
    if (typeof value === 'string' && value.length > 0) {
      const ruleContent = toolName === 'Bash' ? `${firstToken(value)}:*` : value;
      suggestions.push({
        type: 'addRules',
        rules: [{ toolName, ruleContent }],
        behavior: 'allow',
        destination: 'session',
      });
    }
  }
  return suggestions;
}

/**
 * Whether a tool must always route to interactive approval (canUseTool),
 * bypassing auto-allow outcomes. `AskUserQuestion` is inherently interactive;
 * this is also the extension seam for the MCP `requiresUserInteraction`
 * annotation.
 */
export function requiresUserInteraction(toolName: string): boolean {
  return toolName === 'AskUserQuestion';
}
