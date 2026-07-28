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

import * as fs from 'node:fs';
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
  /** Host path flavor for path-primary rule matching. Defaults to
   *  `process.platform`; injectable so win32 semantics are testable off-Windows
   *  (the same seam style as `resolvePosixShells`). */
  platform?: NodeJS.Platform;
};

/**
 * Path dialect used to resolve and compare path-primary rules.
 *
 * Windows broke path matching in BOTH directions until 2026-07-26 (found by the
 * windows-latest platform probe, confirmed in the field as "the SDK's tool calls
 * do dumb things on Windows"):
 *
 *   - a POSIX-shaped rule silently matched NOTHING. `path.resolve` yields
 *     `C:\etc\a\b\secret`, while the rule and the glob machinery speak `/`, so a
 *     deny `Read(//etc/**)` never fired — **a deny that fails OPEN**, on the one
 *     platform the black-pool consumer ships on;
 *   - a Windows-shaped rule OVER-matched. The single-`*` class is `[^/]*`, which
 *     does not stop at a `\`, so `Read(C:\logs\*)` silently reached
 *     `C:\logs\deep\nested\secret` — `*` crossing directory boundaries;
 *   - and case was significant, so a deny on `C:/Secret/**` was bypassable by
 *     asking for `c:\secret\x` — the same file, a different string.
 *
 * All three collapse once both sides are compared in ONE canonical space:
 * `/` separators, lowercased. Applied **only under win32** — on POSIX a
 * backslash is a legal filename character (folding it into a separator would
 * open a fresh hole) and paths are case-SENSITIVE (lowercasing would make an
 * allow match files it must not).
 */
type PathFlavor = { readonly impl: path.PlatformPath; readonly win: boolean };

function pathFlavor(platform: NodeJS.Platform | undefined): PathFlavor {
  const win = (platform ?? process.platform) === 'win32';
  // On the real host this is exactly the `path` the code used before (path ===
  // path.win32 on Windows, === path.posix elsewhere), so behavior off-Windows is
  // byte-identical; naming the dialect only makes it injectable.
  return { impl: win ? path.win32 : path.posix, win };
}

/** Canonical comparison form of an already-resolved absolute path. */
function canonicalPath(p: string, flavor: PathFlavor): string {
  return flavor.win ? p.replace(/\\/g, '/').toLowerCase() : p;
}

/**
 * Identity key for a DIRECTORY path — same canonical space as rule matching.
 *
 * `add/removeDirectories` compared grants with a bare `path.resolve`, which on
 * Windows makes `C:\Work\Data` and `c:/work/data` two different strings for one
 * directory: a revocation could miss the grant it was meant to cancel, and a
 * re-grant could duplicate an entry. Same defect family as the path-scoped rule
 * matching above, one file over — the platform probe did not reach it because
 * no test varies the spelling, so it is fixed here rather than left to be
 * rediscovered in the field.
 *
 * Returns a comparison KEY only; callers keep the caller's original spelling
 * for anything they hand back out.
 */
export function directoryKey(dir: string, platform?: NodeJS.Platform): string {
  const flavor = pathFlavor(platform);
  return canonicalPath(flavor.impl.resolve(dir), flavor);
}

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
function resolvePath(p: string, cwd: string | undefined, flavor: PathFlavor): string {
  if (cwd !== undefined) return canonicalPath(flavor.impl.resolve(cwd, p), flavor);
  // No cwd — BEST EFFORT (the gate always supplies one in production; this
  // branch is reachable through the exported `ruleMatches`). Here, and only
  // here, the win32 dialect is ASYMMETRIC between the two sides of a match:
  //   normalize('git:')      -> '.\git:'   but normalize('git')        -> 'git'
  //   normalize('//etc/foo/')-> '\\etc\foo\' (UNC kept) but
  //   normalize('/etc/foo/x')-> '\etc\foo\x'
  // Spec and value therefore normalize into different shapes and a deny that
  // matches everywhere else silently stops matching — fail-open. `resolve()`
  // collapses both (it has an absolute base to anchor against); with no cwd we
  // reproduce that collapse explicitly so the two sides stay comparable.
  // Both sides go through this same function, so a genuine UNC rule still
  // matches a genuine UNC value — the shapes move together.
  return canonicalPath(flavor.impl.normalize(p), flavor).replace(/^\.\//, '');
}

/**
 * Canonical form of a raw rule SPECIFIER.
 *
 * Beyond the separator/case folding every path gets, one win32-only rewrite:
 * a leading run of slashes collapses to one. `Read(//etc/**)` is the rule
 * syntax's spelling of the ABSOLUTE path `/etc/**` (every path-scoped rule in
 * this repo's suites is written that way), but `path.win32` reads `//etc/foo`
 * as the UNC share `\\etc\foo`. Left alone, such a rule binds to a network host
 * that does not exist and therefore matches nothing — a deny that fails OPEN,
 * which is exactly the failure the windows-latest probe surfaced.
 *
 * **Accepted cost, stated plainly:** this makes a genuine UNC-scoped rule
 * (`Read(\\\\server\\share\\**)`) unexpressible on win32 — it collapses to the
 * drive-relative `/server/share/**`. UNC-scoped rules were already broken there
 * (nothing matched at all before this fix), and the absolute spelling is what
 * hosts actually write, so the common case wins and the exotic one is
 * documented rather than half-supported. See docs/COMPAT.md.
 */
function canonicalSpec(spec: string, flavor: PathFlavor): string {
  const c = canonicalPath(spec, flavor);
  return flavor.win ? c.replace(/^\/\/+/, '/') : c;
}

/**
 * Resolve an absolute path's symlinks on a BEST-EFFORT basis: realpath the
 * longest existing ancestor, then re-append the not-yet-existing tail. Returns
 * the input unchanged when it is not absolute or nothing could be resolved
 * (missing root / EACCES / …), so a failure never widens or narrows a match on
 * its own — the caller only USES the result when it DIFFERS from the lexical
 * path (audit r4 Y1-2).
 */
function realpathBestEffort(abs: string, flavor: PathFlavor): string {
  // realpath touches the REAL host fs, so it can only be meaningful when the
  // flavor matches the host; under a simulated dialect (unit tests) nothing
  // resolves and the input comes back unchanged, which is the documented
  // degrade-to-lexical path.
  if (!flavor.impl.isAbsolute(abs)) return abs;
  let current = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      const joined = tail.length > 0 ? flavor.impl.join(real, ...tail.reverse()) : real;
      return canonicalPath(joined, flavor);
    } catch {
      const parent = flavor.impl.dirname(current);
      if (parent === current) return abs; // reached the root; nothing resolved
      tail.push(flavor.impl.basename(current));
      current = parent;
    }
  }
}

/** Escape a literal character for embedding in a RegExp. */
function escapeRegExpChar(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translate a RESOLVED path glob (literal prefix already `.`/`..`-collapsed,
 * wildcards intact) into an anchored RegExp with gitignore-style semantics:
 *   - `**` matches across separators (any depth); a `**​/` run also matches ZERO
 *     directories, so `/etc/**​/secret` covers `/etc/secret` too;
 *   - a single `*` matches WITHIN one segment (never a separator).
 * Used only for specs with an INTERIOR wildcard - path structure AFTER the first
 * `*` - which the trailing-prefix shortcut cannot express (RP2 honored only a
 * TRAILING `**`, collapsing a mid-pattern `**`/`*` to a dead single `*` so a
 * deny `Read(/etc/**​/secret)` never fired on `/etc/foo/secret` - audit r4 Y1-3).
 */
function globToRegExp(pattern: string): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++; // consume the second '*'
        if (pattern[i + 1] === '/') {
          i++; // consume the separator: `**/` also matches zero directories
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else {
      re += escapeRegExpChar(c);
    }
  }
  return new RegExp(re + '$');
}

/**
 * Match a RESOLVED tool value against a path specifier, closing the fail-open
 * holes of the naive string-prefix matcher:
 *   - RP1: `..` was already folded on both sides by resolvePath, so a `..`
 *     segment can neither slip past an allow (`/workspace/*` never matches
 *     `/workspace/../../etc/shadow`) nor dodge a deny (`/etc/*` matches
 *     `/tmp/../etc/passwd`).
 *   - RP2: a TRAILING `**` (everything-under) is honored via the literal prefix.
 *   - Y1-3: an INTERIOR wildcard (a separator AFTER the first `*`) is matched by
 *     a true glob regex - the trailing-prefix shortcut can only express a single
 *     trailing `*`/`**`, so it silently under-matched a mid-pattern `**`/`*`.
 * Exact / trailing-`*` prefix / `:*`-base semantics stay the SDK's historical
 * "trailing wildcard = deep path prefix".
 */
function matchResolvedValue(
  rawSpec: string,
  nvalue: string,
  cwd: string | undefined,
  flavor: PathFlavor,
): boolean {
  // Canonicalize the SPEC the same way as the value, so a rule written with
  // Windows separators (`Read(C:\etc\**)`) and one written POSIX-style
  // (`Read(//etc/**)`) both land in the `/` space the glob machinery speaks.
  // Without this the wildcard tail keeps `\` and `**`/`*` lose their meaning.
  const spec = canonicalSpec(rawSpec, flavor);
  const starIdx = spec.indexOf('*');
  if (starIdx === -1) {
    return specifierMatches(resolvePath(spec, cwd, flavor), nvalue);
  }
  // Normalize the literal prefix (collapse '.'/'..'), preserving a trailing
  // separator so `dir/*` stays segment-anchored.
  const rawPrefix = spec.slice(0, starIdx);
  const boundary = rawPrefix.endsWith('/');
  let prefix = rawPrefix === '' ? '' : resolvePath(rawPrefix, cwd, flavor);
  // '/' not path.sep: both sides live in canonical space now, where the
  // separator is '/' on every host (path.sep would re-introduce '\' on Windows
  // and the boundary anchor would never match).
  if (boundary && !prefix.endsWith('/')) prefix += '/';
  const tail = spec.slice(starIdx);
  if (!/^\*+$/.test(tail)) {
    // Wildcard with structure after it — a later separator (`/etc/**/secret`)
    // OR a literal tail (`/etc/*.conf`): full glob match on the reassembled
    // resolved spec. The trailing-prefix shortcut below can only express a bare
    // trailing `*`/`**`, so a literal tail used to match NOTHING (a deny that
    // failed OPEN — `Read(/etc/*.conf)` never fired on `/etc/foo.conf`).
    return globToRegExp(prefix + tail).test(nvalue);
  }
  // Trailing-only wildcard: collapse the '*'/'**' run to a single '*' and hand
  // the reassembled spec to the shared matcher (RP2).
  return specifierMatches(prefix + '*', nvalue);
}

/**
 * Specifier match for a path-primary tool. The tool's value is compared against
 * the specifier BOTH lexically and after resolving symlinks:
 *
 * resolvePath is LEXICAL (it mirrors the tool's own `path.resolve(cwd, p)`), but
 * the kernel's `open()` FOLLOWS symlinks - so a value `/workspace/link/x`, where
 * `/workspace/link -> /secret`, slips a deny scoped to `/secret/*` past the gate
 * while the tool still reads `/secret/x` (audit r4 Y1-2). The symlink-resolved
 * re-test is PURELY ADDITIVE: it only ADDS a match on a lexical MISS (a deny
 * fires on a tunnel; an allow recognizes the real in-scope target), never
 * removes one, and degrades to the lexical result when realpath cannot resolve.
 */
function pathSpecifierMatches(
  spec: string,
  value: string,
  cwd: string | undefined,
  flavor: PathFlavor,
  segmentMode?: 'all' | 'any',
): boolean {
  const nvalue = resolvePath(value, cwd, flavor);
  if (matchResolvedValue(spec, nvalue, cwd, flavor)) return true;
  const real = realpathBestEffort(nvalue, flavor);
  if (real !== nvalue && matchResolvedValue(spec, real, cwd, flavor)) return true;
  // Deny/ask position only (see isInertBasenameSpec).
  if (segmentMode !== 'any') return false;
  const cspec = canonicalSpec(spec, flavor);
  if (!isInertBasenameSpec(cspec)) return false;
  const re = globToRegExp(cspec);
  return re.test(basenameOf(nvalue)) || (real !== nvalue && re.test(basenameOf(real)));
}

/** Last `/`-delimited segment of a path already in canonical (`/`) space. */
function basenameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/**
 * A path specifier that can match NOTHING, on ANY input: no separator, and a
 * LEADING wildcard so there is no literal prefix to anchor against cwd —
 * `Read(*.env)`, `Read(*secret*)`. Tool values always resolve to an ABSOLUTE
 * path and a single `*` never crosses `/`, so the compiled `^[^/]*\.env$` can
 * never match `/w/secret.env`: the rule is INERT, and a deny written that way
 * silently never fires on any file. (`Read(*)` / `Read(**)` are excluded — a
 * pure wildcard run already matches everything through the prefix branch, and
 * `Read(**​/*.env)` / `Read(secret*)` carry a separator or a literal prefix and
 * match today.)
 *
 * Such a spec is a BASENAME pattern — gitignore reads a separator-less pattern
 * against the basename at any depth — so pathSpecifierMatches re-tests it that
 * way in DENY/ASK position ONLY. Purely additive, exactly like the deny-side
 * command unwrapping: a deny that could never fire now fires, while an allow
 * still requires the explicit `**​/` form and can never be widened by this.
 */
function isInertBasenameSpec(spec: string): boolean {
  return spec.startsWith('*') && !spec.includes('/') && !/^\*+$/.test(spec);
}

/**
 * Leading `NAME=value ` shell environment assignments (`FOO=1 BAR=2 cmd`). A
 * command run with such a prefix is still that command, so a deny/ask rule
 * scoped to it must see the real command, not the assignment (M2-2), and a
 * suggestion built from it must key off the command, not `FOO=1` (M2-4).
 * Requires trailing whitespace so a bare `FOO=1` (no command) is left intact.
 * The value is a run of quoted chunks and plain characters — quotes can appear
 * MID-value (`A=a"b c" rm …` assigns `ab c`), which the previous single
 * `"…"`-or-bare alternation mis-lexed: it stripped only `A=a"b `, so the
 * candidate never started with the real command and a deny failed OPEN.
 */
const ENV_ASSIGN_PREFIX = /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s"'])*\s+/;

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
 * Command WRAPPERS that prefix a real command without changing what ultimately
 * runs (`sudo rm` is still `rm`, `timeout 5 rm` is still `rm`, `eval "rm …"`
 * still runs `rm`). A deny/ask rule scoped to the inner command must see
 * through them (audit r4 V4-2). Allow rules deliberately do NOT unwrap - an
 * allow must match the literal command form so an obfuscated/wrapped command
 * falls through to prompting, never to a wider allow.
 */
const COMMAND_WRAPPERS: ReadonlySet<string> = new Set([
  'sudo', 'doas', 'env', 'eval', 'exec', 'command', 'builtin', 'nohup',
  'setsid', 'stdbuf', 'nice', 'ionice', 'time', 'timeout', 'xargs', 'bash', 'sh',
]);

/**
 * Compound-command KEYWORDS that sit immediately before a command the shell
 * still runs (`if rm …`, `then rm …`, `while rm …`, `do rm …`). A `;`/newline
 * split leaves a segment like `then rm -rf /` whose FIRST token is the keyword,
 * not `rm`, so a `Bash(rm:*)` deny never matched it (a deny fail-open on
 * `if true; then rm -rf /; fi`, `for x in a; do rm -rf /; done`, …). Peeled only
 * in DENY/ASK position (denyMatchCandidates), like COMMAND_WRAPPERS — purely
 * additive, so it can only ever make a deny fire, never widen an allow (allow
 * still matches the literal segment and falls through to prompting). Loop-header
 * keywords (`for`/`case`/`select`/`in`) precede a NAME, not a command, so the
 * executed body is reached via its own `do`/`then` segment and they need no
 * entry here. */
const SHELL_KEYWORD_PREFIXES: ReadonlySet<string> = new Set([
  'if', 'then', 'elif', 'else', 'while', 'until', 'do',
]);

/** Bound on wrapper/flag/arg tokens peeled from one segment; a real command
 *  reaches its command word well within this. */
const MAX_COMMAND_UNWRAP = 8;

/** Strip shell quoting/escaping from a single command WORD so an obfuscated
 *  command word matches its plain form: `\rm` / `"rm"` / `'rm'` -> `rm`
 *  (audit r4 V4-1). The leading `$` of ANSI-C / locale quoting (`$'rm'`,
 *  `$"rm"`) is dropped too: `$'rm'` is the literal string `rm` the shell then
 *  executes, so without this a `Bash(rm:*)` deny failed OPEN on `$'rm' -rf /`.
 *  A `$` NOT immediately followed by a quote (a real `$VAR` expansion) is
 *  untouched. */
function deobfuscateWord(word: string): string {
  return word.replace(/\$(?=['"])/g, '').replace(/['"\\]/g, '');
}

/** First whitespace-delimited token and the trimmed remainder of a command. */
function splitFirstToken(command: string): { first: string; rest: string } {
  const s = command.replace(/^\s+/, '');
  const idx = s.search(/\s/);
  if (idx === -1) return { first: s, rest: '' };
  return { first: s.slice(0, idx), rest: s.slice(idx).trim() };
}

/** A leading REDIRECTION token (`</dev/null`, `2>err`, `>>log`, `&>log`) —
 *  possibly a bare operator with a detached target word (`> file cmd`) —
 *  placed before the command word. The shell still runs the command that
 *  follows, so a deny/ask must peel it: `</dev/null rm -rf x` was a deny
 *  fail-open (the segment's first token was `</dev/null`, never `rm`). */
const REDIRECTION_PREFIX = /^(?:\d*(?:>>?|<)|&>>?)/;

/** A wrapper's own leading arg (flag / `VAR=val` / bare number-or-duration)
 *  that sits before the real command, peeled only once already inside a
 *  wrapper: `timeout 5 rm`, `nice -n 10 rm`, `env FOO=1 rm`. */
function isWrapperArgToken(token: string): boolean {
  return (
    token.startsWith('-') ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) ||
    /^\d+(?:\.\d+)?[a-z]*$/.test(token)
  );
}

/**
 * An option token that may carry its value as a SEPARATE following token
 * (`sudo -u root rm …`, `timeout -s KILL 5 rm …`, `env -u FOO rm …`,
 * `xargs -I {} rm …`). Peeling the FLAG alone left the walk staring at the
 * flag's VALUE (`root`, `KILL`, `FOO`, `{}`) — a non-wrapper, non-flag token —
 * so the unwrap stopped one token short of the real command and a `Bash(rm:*)`
 * deny FAILED OPEN on ordinary, unobfuscated commands. An option carrying its
 * value inline (`--signal=KILL`, `-n10`) needs no extra token, and the `=` form
 * is excluded by the charset. Used only in DENY/ASK position, and only to offer
 * MORE candidates, so it can make a deny fire but never widen an allow.
 */
function takesSeparateValue(token: string): boolean {
  return /^--?[A-Za-z][A-Za-z0-9-]*$/.test(token);
}

/**
 * Strip shell GROUP wrappers so a deny/ask scoped to the inner command sees
 * through a bare subshell / brace group (audit r3 W10-1 — `(rm -rf x)` and
 * `{ rm -rf x; }` were deny fail-open: the segment starts with `(`/`{`, so a
 * `Bash(rm:*)` deny never matched and a bare `Bash` allow auto-ran it).
 * Leading run of `(` / `{` / `!` (pipeline negation — `! rm -rf x` still runs
 * rm, only the exit status flips) / whitespace, trailing run of `)` / `}` /
 * `;` / whitespace — nested groups (`((rm))`) collapse in one pass. Deny/ask
 * position only (candidates below): an allow must keep matching the literal
 * form, so a grouped command still falls through to prompting.
 */
function stripGroupWrappers(segment: string): string {
  return segment.replace(/^[\s({!]+/, '').replace(/[\s)};]+$/, '');
}

/**
 * Candidate command strings a DENY/ASK specifier is tested against so an
 * obfuscated (V4-1), wrapped (V4-2) or grouped (r3 W10-1) command still
 * matches a rule scoped to the real command. Always includes the raw segment
 * and its env-stripped form (the prior behavior); additionally de-obfuscates
 * the command word, peels leading wrappers (plus a wrapper's own
 * flag/assignment/duration args) and leading redirections, and sees through
 * subshell / brace grouping, so `sudo \rm -rf /`, `timeout 5 rm …`,
 * `eval "rm -rf /"`, `</dev/null rm …` and `(rm -rf /)` all reach `rm`. Purely additive - it only ever offers MORE candidates, so a
 * deny/ask can fire but an existing match is never lost.
 */
function denyMatchCandidates(segment: string): string[] {
  const out = new Set<string>([segment]);
  // Seed the unwrap walk from the raw segment AND its group-stripped form
  // (r3 W10-1) — the stripped seed lets wrapper peeling work inside a group
  // too (`(sudo rm …)`).
  const seeds = new Set<string>([segment]);
  const ungrouped = stripGroupWrappers(segment);
  if (ungrouped !== '' && ungrouped !== segment) seeds.add(ungrouped);
  for (const seed of seeds) {
    out.add(seed);
    out.add(stripEnvAssignments(seed));
    let cur = stripEnvAssignments(seed);
    // Set when the token just peeled was an option that may take its value as a
    // separate token; the NEXT token is then that value, not the command word.
    let flagValuePending = false;
    for (let i = 0; i < MAX_COMMAND_UNWRAP; i++) {
      const { first, rest } = splitFirstToken(cur);
      if (first === '') break;
      // A redirection before the command word does not change which command
      // runs; peel it (and a detached target word) so the deny still fires.
      const redir = REDIRECTION_PREFIX.exec(first);
      if (redir !== null) {
        const next = redir[0] === first ? splitFirstToken(rest).rest : rest;
        if (next === '') break;
        out.add(next);
        cur = next;
        continue;
      }
      const word = deobfuscateWord(first);
      out.add(rest === '' ? word : `${word} ${rest}`);
      // Peel a leading wrapper, or - once already inside a wrapper (i > 0) - a
      // wrapper's own arg token. A non-wrapper head token is the real command.
      const peelable =
        COMMAND_WRAPPERS.has(word) ||
        SHELL_KEYWORD_PREFIXES.has(word) ||
        (i > 0 && (isWrapperArgToken(first) || flagValuePending));
      if (!peelable || rest === '') break;
      flagValuePending = i > 0 && takesSeparateValue(first);
      cur = rest;
      out.add(rest);
    }
  }
  return [...out];
}

/**
 * Command-injection constructs that let a shell run an embedded command a
 * prefix rule never inspects (command / process substitution, unbraced/braced
 * expansions). Their presence must BLOCK an allow-rule match: `Bash(git:*)`
 * must not auto-allow `git log $(rm -rf /)`. They do not block deny/ask.
 * Command substitution `$(` is handled separately (see hasInjectionConstruct)
 * so arithmetic expansion `$((…))`, which runs NO command, is not misflagged
 * (audit r4 V4-3).
 */
const INJECTION_MARKERS: readonly string[] = ['`', '${', '<(', '>('];

/**
 * Whether `command` carries a command-injection construct. The unambiguous
 * INJECTION_MARKERS are a substring check; command substitution `$(` is scanned
 * separately so arithmetic expansion `$((…))` - which starts with `$(` but runs
 * no command - is NOT treated as injection (audit r4 V4-3). A `$(` that begins
 * command substitution (its next char is not another `(`) still counts, and a
 * command substitution nested inside arithmetic is still caught.
 */
function hasInjectionConstruct(command: string): boolean {
  if (INJECTION_MARKERS.some((m) => command.includes(m))) return true;
  for (let i = command.indexOf('$('); i !== -1; i = command.indexOf('$(', i + 1)) {
    if (command[i + 2] !== '(') return true;
  }
  return false;
}

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
 *
 * The single-`&` separator carries a `(?<![<>])` guard so an fd-DUPLICATION
 * redirection's `&` (`>&`, `<&`, `2>&1`) is NOT treated as a chain operator.
 * Splitting there orphaned the fd digit into the next segment (`2>&1 rm -rf /`
 * -> `2>` + `1 rm -rf /`), which no longer starts with a recognizable leading
 * redirection, so the deny-position redirection peel never reached `rm` and a
 * `Bash(rm:*)` deny FAILED OPEN on a valid leading-redirect command. Kept whole
 * (`2>&1 rm -rf /`), the first token is a redirection the peel strips, so the
 * deny fires. Background `&`, `|&`, `&&`/`||` and a trailing/detached `&` are
 * unaffected (their `&` is not preceded by `<`/`>`).
 */
export function decomposeBashCommand(command: string): {
  segments: string[];
  hasInjection: boolean;
} {
  const hasInjection = hasInjectionConstruct(command);
  const segments = command
    .split(/(?:&&|\|\||[;\n|]|(?<![<>])&)/)
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
  if (value === undefined) {
    // audit r4 Rg-1: the primary arg is unresolvable (a non-tabled tool - MCP /
    // Task / …). A `*` specifier constrains nothing, so `Tool(*)` is equivalent
    // to the bare-name rule and MUST still match; otherwise a specifier'd deny
    // like `mcp__github__delete_file(*)` silently no-ops (a deny-position
    // fail-open — the tool runs). Any OTHER specifier stays unresolvable
    // (keeper 2026-07-16: never guess a non-tabled tool's primary field), so it
    // does not match - a bare-name rule is the supported way to scope it.
    return spec === '*';
  }
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
    // Deny/ask position: fail-closed the other way. Match on the raw segment,
    // its env-stripped form (M2-2), or a de-obfuscated / wrapper-unwrapped form,
    // so `Bash(rm:*)` also denies `\rm`, `"rm"`, `sudo rm`, `timeout 5 rm` and
    // `eval "rm -rf /"` (audit r4 V4-1/V4-2). The allow branch above stays
    // strict (no unwrap) so an obfuscated command never rides an allow.
    return segments.some((seg) =>
      denyMatchCandidates(seg).some((cand) => specifierMatches(spec, cand)),
    );
  }
  if (PATH_PRIMARY_TOOLS.has(toolName)) {
    return pathSpecifierMatches(spec, value, ctx?.cwd, pathFlavor(ctx?.platform), segmentMode);
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
