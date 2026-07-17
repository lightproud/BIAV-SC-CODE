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

import * as path from 'node:path';

import type { PermissionUpdate } from '../types.js';

export type ParsedRule = { toolName: string; specifier?: string };

/**
 * Optional context that lets rule matching reflect what a tool call will
 * ACTUALLY do, rather than the raw model-supplied strings:
 *   - `cwd`: the working directory a path-primary tool resolves its file_path
 *     against (`path.resolve(cwd, file_path)`, collapsing `.`/`..`). Passing it
 *     makes a path-scoped allow/deny compare against that resolved path, so a
 *     `..` segment can neither escape an allow nor tunnel into a deny (RP1).
 *   - `knownServers`: the set of registered MCP server names, so a
 *     `mcp__server__*` pattern resolves the tool's server EXACTLY even when the
 *     tool segment itself contains `__` (I2). Absent, matching falls back to the
 *     last-`__` heuristic (unchanged legacy behavior).
 */
export type MatchContext = {
  cwd?: string;
  knownServers?: ReadonlySet<string>;
};

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
 * Resolve the MCP server a qualified tool name belongs to.
 *
 * A `mcp__{server}__{tool}` name is ambiguous when the TOOL segment itself
 * contains `__` (e.g. `mcp__a__get__thing` could be server `a` / tool
 * `get__thing`, or server `a__get` / tool `thing`). The last-`__` heuristic in
 * splitMcpName picks `a__get`, so a server-wide rule scoped to `a`
 * (`mcp__a__*`) silently fails to match a tool of server `a` whose name
 * contains `__` — a deny fail-open (I2).
 *
 * When the registered server names are known, disambiguate exactly: the tool
 * belongs to the LONGEST registered server `S` such that the name starts with
 * `mcp__{S}__`. Longest-match settles `a` vs `a__b` deterministically (a tool
 * of `a__b` starts with both `mcp__a__` and `mcp__a__b__`; the longer, more
 * specific server wins) and, because tool names are only ever built from a
 * registered (server, tool) pair, is always correct. Absent a registry
 * (`knownServers` undefined/empty, or no registered prefix matches), fall back
 * to the last-`__` heuristic so legacy behavior is preserved.
 */
function resolveMcpServer(
  toolName: string,
  knownServers?: ReadonlySet<string>,
): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  if (knownServers !== undefined && knownServers.size > 0) {
    let best: string | undefined;
    for (const server of knownServers) {
      if (
        toolName.startsWith(`mcp__${server}__`) &&
        (best === undefined || server.length > best.length)
      ) {
        best = server;
      }
    }
    if (best !== undefined) return best;
  }
  return splitMcpName(toolName)?.server;
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
export function matchToolName(
  pattern: string,
  toolName: string,
  knownServers?: ReadonlySet<string>,
): boolean {
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

  const server = resolveMcpServer(toolName, knownServers);
  return server !== undefined && server === patternServer;
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
 * Tools whose primary argument is a FILESYSTEM PATH the tool resolves with
 * `path.resolve(cwd, arg)` before touching disk. Their specifier is a path (or
 * path prefix), so it must be compared against that resolved path — not the raw
 * model string. Glob/Grep are intentionally absent: their primary arg is a glob
 * pattern / regex, not a path to resolve.
 */
const PATH_PRIMARY_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
]);

/**
 * Resolve `p` to the absolute, `.`/`..`-collapsed form a path-primary tool will
 * actually access. With `cwd` this mirrors the tool's own `path.resolve(cwd, p)`
 * exactly; without it, an absolute path is still normalized (best effort — the
 * gate always supplies cwd in production).
 */
function resolvePath(p: string, cwd: string | undefined): string {
  return cwd !== undefined ? path.resolve(cwd, p) : path.normalize(p);
}

/**
 * Specifier match for a path-primary tool. Both the specifier and the tool's
 * value are resolved to their real on-disk paths before comparison, closing two
 * fail-open holes in the naive string-prefix matcher:
 *   - RP1: a `..` segment can no longer slip a call past an allow scope
 *     (`/workspace/*` no longer matches `/workspace/../../etc/shadow`) nor dodge
 *     a deny scope (`/etc/*` now matches `/tmp/../etc/passwd`), because both
 *     sides fold `..` the same way the tool does.
 *   - RP2: a trailing `**` (gitignore-style "everything under") is honored — the
 *     literal directory prefix before the FIRST `*` anchors the match — instead
 *     of the old `slice(-1)` leaving a dead literal `*` that matched nothing.
 *
 * Wildcard semantics stay the SDK's historical "trailing wildcard = path
 * prefix": the literal text before the first `*` is the prefix, re-anchored to a
 * directory boundary when the pattern ended the prefix with a separator so
 * `/workspace/*` never matches `/workspace-secret/...`.
 */
function pathSpecifierMatches(spec: string, value: string, cwd: string | undefined): boolean {
  const nvalue = resolvePath(value, cwd);
  const starIdx = spec.indexOf('*');
  if (starIdx === -1) {
    // No wildcard: compare the resolved paths directly (still delegating below
    // would also work, but exact resolved-path equality is the clearest form).
    return specifierMatches(resolvePath(spec, cwd), nvalue);
  }
  // Split at the first '*': normalize the literal prefix (collapse '.'/'..'),
  // preserving a trailing separator so `dir/*` stays segment-anchored, then hand
  // the reassembled spec to the shared matcher so exact / trailing-'*' prefix /
  // `:*`-base semantics all still apply — now on the real on-disk paths.
  const rawPrefix = spec.slice(0, starIdx);
  const boundary = rawPrefix.endsWith('/');
  let prefix = rawPrefix === '' ? '' : resolvePath(rawPrefix, cwd);
  if (boundary && !prefix.endsWith(path.sep)) prefix += path.sep;
  // Collapse a leading '**' run in the suffix to a single '*' so a gitignore
  // style `dir/**` is honored as a prefix instead of leaving a dead literal '*'
  // that matches nothing (RP2).
  const suffix = spec.slice(starIdx).replace(/^\*+/, '*');
  return specifierMatches(prefix + suffix, nvalue);
}

/**
 * Leading `NAME=value ` shell environment assignments (`FOO=1 BAR=2 cmd`). A
 * command run with such a prefix is still that command, so a deny/ask rule
 * scoped to it must see the real command, not the assignment (M2-2), and a
 * suggestion built from it must key off the command, not `FOO=1` (M2-4).
 * Requires trailing whitespace so a bare `FOO=1` (no command) is left intact.
 */
const ENV_ASSIGN_PREFIX = /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+/;

/** Strip a run of leading environment assignments from a shell command. */
function stripEnvAssignments(command: string): string {
  let s = command;
  for (;;) {
    const next = s.replace(ENV_ASSIGN_PREFIX, '');
    if (next === s) return s;
    s = next;
  }
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
  ctx?: MatchContext,
): boolean {
  if (!matchToolName(rule.toolName, toolName, ctx?.knownServers)) return false;
  const spec = rule.specifier;
  if (spec === undefined) return true;
  const value = primaryArg(toolName, input);
  if (value === undefined) return false;
  if (toolName === 'Bash' && segmentMode !== undefined) {
    const { segments, hasInjection } = decomposeBashCommand(value);
    if (segmentMode === 'all') {
      // Allow position: fail-closed. A leading env prefix is NOT stripped here —
      // it must not let `GIT_SSH_COMMAND=evil git ...` ride an allow scoped to
      // `git:*`; the unstripped segment fails to match and the call falls
      // through to prompting.
      if (hasInjection) return false;
      return segments.every((seg) => specifierMatches(spec, seg));
    }
    // Deny/ask position: fail-closed the other way. Match on the raw segment OR
    // its env-stripped form, so `Bash(rm:*)` denies `FOO=1 rm -rf /` (M2-2).
    return segments.some(
      (seg) =>
        specifierMatches(spec, seg) || specifierMatches(spec, stripEnvAssignments(seg)),
    );
  }
  if (PATH_PRIMARY_TOOLS.has(toolName)) {
    return pathSpecifierMatches(spec, value, ctx?.cwd);
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
      // For Bash, skip leading `NAME=value ` env assignments so a `VAR=x npm run
      // build` command suggests `Bash(npm:*)`, not the absurd `Bash(VAR=x:*)`
      // (M2-4).
      const ruleContent =
        toolName === 'Bash' ? `${firstToken(stripEnvAssignments(value))}:*` : value;
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
