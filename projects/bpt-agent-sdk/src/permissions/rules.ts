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
 * Match a tool-name pattern from allowedTools/disallowedTools entries.
 *
 * Supported forms:
 *   - exact name (`Bash`, `mcp__srv__tool`)
 *   - `mcp__server__*` -> any tool of that MCP server
 *   - `mcp__server`    -> shorthand for the same server-wide wildcard
 */
export function matchToolName(pattern: string, toolName: string): boolean {
  if (pattern === toolName) return true;
  if (pattern.startsWith('mcp__')) {
    if (pattern.endsWith('__*')) {
      // 'mcp__srv__*' -> prefix 'mcp__srv__'
      return toolName.startsWith(pattern.slice(0, -1));
    }
    if (!pattern.slice('mcp__'.length).includes('__')) {
      // Bare server pattern 'mcp__srv' matches 'mcp__srv__anything'.
      return toolName.startsWith(`${pattern}__`);
    }
  }
  return false;
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
