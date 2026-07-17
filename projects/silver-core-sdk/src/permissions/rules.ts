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
 *   - `*`              -> every tool (v0.4; official deny-position glob)
 *   - `mcp__*`         -> every MCP tool of every server (v0.4)
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
  // Global glob: matches every tool. Primarily a deny-position form
  // (disallowedTools: ['*']); matchToolName is shared, so it works in allow
  // position too, mirroring the official rule surface.
  if (pattern === '*') return true;
  if (!pattern.startsWith('mcp__')) return false;
  // All-MCP glob: any tool that is mcp__X__Y-shaped, regardless of server.
  if (pattern === 'mcp__*') return splitMcpName(toolName) !== undefined;

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
  // Without these, a scoped rule (e.g. the SSRF deny `WebFetch(http://169.254.169.254*)`)
  // falls to the JSON fallback and compares the specifier against `{"url":...}`,
  // which starts with `{` and never prefix-matches the URL — the deny silently
  // never fires. Map each builtin to the field its specifier rules target.
  WebFetch: 'url',
  WebSearch: 'query',
  NotebookEdit: 'notebook_path',
};

/**
 * Extract the primary string argument of a tool call for specifier matching.
 * Returns undefined — so the specifier never matches (the conservative outcome)
 * — when the tool has no registered primary field, or its field is missing or
 * not a string.
 *
 * A content specifier is only meaningful for tools with a KNOWN primary arg
 * (PRIMARY_ARG_FIELD). A non-tabled tool — an MCP `mcp__server__tool`, Task, … —
 * has a server-defined input schema with no universal primary arg, so a
 * specifier cannot be resolved to a field and MUST NOT be guessed (待裁③ —
 * keeper 2026-07-16). The former `JSON.stringify(input)` fallback compared the
 * specifier against `{...}` and silently never matched anyway; returning
 * undefined makes that explicit and consistent. Bare-name rules
 * (`mcp__server__tool` with no specifier) are the supported way to allow/deny
 * MCP tools and are unaffected (ruleMatches short-circuits before this).
 */
function primaryArg(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  const field = PRIMARY_ARG_FIELD[toolName];
  if (field === undefined) return undefined;
  const value = input[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Compare a rule specifier against a tool's primary argument value.
 *
 * Semantics: exact match, or prefix match when the specifier ends with `*`
 * (strip the `*`, compare prefix). A `:*` suffix is a boundary marker in the
 * `Bash(npm run:*)` style: the `:` is not part of the command text, so the
 * command base is also tried — but ONLY at a WORD boundary. Matching the base
 * as a bare prefix let `Bash(git:*)` allow `git-crypt export /secret` and
 * `github-cli` (a real over-grant) and, symmetrically, weakened deny rules;
 * the base must be the whole value or be followed by a space so `git` never
 * matches `git-crypt`.
 */
function specifierMatches(spec: string, value: string): boolean {
  if (spec === value) return true;
  if (spec.endsWith('*')) {
    const stem = spec.slice(0, -1);
    if (value.startsWith(stem)) return true;
    if (stem.endsWith(':')) {
      const base = stem.slice(0, -1);
      return value === base || value.startsWith(base + ' ');
    }
  }
  return false;
}

/**
 * Command-injection constructs that let a shell run an embedded command a
 * prefix rule never inspects (command / process substitution, unbraced/braced
 * expansions). Their presence must BLOCK an allow-rule match: `Bash(git:*)`
 * must not auto-allow `git log $(rm -rf /)`. They do not block deny/ask.
 */
const INJECTION_MARKERS: readonly string[] = ['$(', '`', '${', '<(', '>('];

/**
 * Decompose a shell command into the independent sub-commands a permission
 * rule must each be checked against, and flag command-injection constructs.
 *
 * Splits on the top-level chaining operators `&&`, `||`, `;`, `|`, `&` and
 * newlines. NOT fully quote-aware — but the bias is safe for allow-matching:
 * over-splitting (e.g. an operator inside a quoted string) only makes an allow
 * rule LESS likely to match every segment, so it falls through to prompting,
 * never to a wider allow. This is what stops `allowed && dangerous` from riding
 * in on a prefix rule scoped to `allowed`.
 */
export function decomposeBashCommand(command: string): {
  segments: string[];
  hasInjection: boolean;
} {
  const hasInjection = INJECTION_MARKERS.some((m) => command.includes(m));
  const segments = command
    .split(/(?:&&|\|\||[;\n|&])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { segments: segments.length > 0 ? segments : [command.trim()], hasInjection };
}

/**
 * Full rule match for one tool call: tool name (with MCP wildcards) plus,
 * when the rule carries a specifier, the tool's primary string argument.
 *
 * `segmentMode` opts a Bash specifier into command decomposition (see
 * decomposeBashCommand). The gate passes it so a chained command is judged by
 * its parts, not by its leading token:
 *   - `'all'` (allow position): EVERY sub-command must match the specifier AND
 *     no injection construct may be present — otherwise the allow does not fire
 *     and the call falls through to prompting. Closes the `git status && rm -rf /`
 *     hole where a `Bash(git:*)` allow would match the whole string.
 *   - `'any'` (deny / ask position): a match on ANY sub-command applies, so a
 *     denied sub-command anywhere in a chain still denies.
 * Omitting `segmentMode` keeps the legacy whole-string match (non-Bash tools,
 * and any caller that has not opted in).
 */
export function ruleMatches(
  rule: ParsedRule,
  toolName: string,
  input: Record<string, unknown>,
  segmentMode?: 'all' | 'any',
): boolean {
  if (!matchToolName(rule.toolName, toolName)) return false;
  const spec = rule.specifier;
  if (spec === undefined) return true;
  const value = primaryArg(toolName, input);
  if (value === undefined) return false;
  if (toolName === 'Bash' && segmentMode !== undefined) {
    const { segments, hasInjection } = decomposeBashCommand(value);
    if (segmentMode === 'all') {
      if (hasInjection) return false;
      return segments.every((seg) => specifierMatches(spec, seg));
    }
    return segments.some((seg) => specifierMatches(spec, seg));
  }
  return specifierMatches(spec, value);
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
