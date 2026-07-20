/**
 * Mutation-kill tests: permissions rules, batch 4 (T63 optional investment,
 * keeper ruling "可选投资" 2026-07-20). Second permissions batch, after r3
 * pinned the command-unwrap core (85.96 -> 87.37). Targets the remaining
 * security-relevant behaviour survivors: the PRIMARY_ARG_FIELD table (a
 * scoped deny must reach each builtin's real arg field — the SSRF WebFetch
 * deny especially), the specifierMatches `:*` word-boundary over-grant guard
 * (`git:*` must NOT match `git-crypt`), MCP known-server longest-prefix
 * resolution, and path-primary glob resolution. Behaviour assertions on the
 * exported surface (ruleMatches / matchToolName).
 */

import { describe, expect, it } from 'vitest';
import { matchToolName, parseRule, ruleMatches } from '../src/permissions/rules.js';

const denies = (rule: string, toolName: string, input: Record<string, unknown>, seg?: 'all' | 'any') =>
  ruleMatches(parseRule(rule), toolName, input, seg);

// ---------------------------------------------------------------------------
// PRIMARY_ARG_FIELD — a scoped rule must reach each builtin's real arg field
// ---------------------------------------------------------------------------

describe('PRIMARY_ARG_FIELD — scoped rule reaches the right field', () => {
  it('WebFetch(url) — the SSRF deny fires on the url field', () => {
    // The exact over-grant PRIMARY_ARG_FIELD was added to close.
    expect(denies('WebFetch(http://169.254.169.254*)', 'WebFetch', { url: 'http://169.254.169.254/latest/meta-data' })).toBe(true);
    expect(denies('WebFetch(http://169.254.169.254*)', 'WebFetch', { url: 'https://example.com' })).toBe(false);
  });
  it('WebSearch(query) — a query-scoped rule matches the query field', () => {
    expect(denies('WebSearch(secret*)', 'WebSearch', { query: 'secret plans' })).toBe(true);
    expect(denies('WebSearch(secret*)', 'WebSearch', { query: 'public data' })).toBe(false);
  });
  it('Glob(pattern) / Grep(pattern) — pattern field is the primary arg', () => {
    expect(denies('Glob(**/*.env*)', 'Glob', { pattern: '**/*.env' })).toBe(true);
    expect(denies('Grep(password*)', 'Grep', { pattern: 'password123' })).toBe(true);
  });
  it('NotebookEdit(notebook_path) — resolves via the notebook_path field', () => {
    // NotebookEdit is a PATH_PRIMARY tool, so the specifier compares against the
    // resolved notebook_path.
    expect(denies('NotebookEdit(//secret/**)', 'NotebookEdit', { notebook_path: '/secret/nb.ipynb' })).toBe(true);
  });
  it('a tool with NO registered primary field never matches a content specifier', () => {
    // Task has no PRIMARY_ARG_FIELD entry -> primaryArg undefined -> a non-`*`
    // specifier must NOT match (conservative), but a bare-name / `*` rule does.
    expect(denies('Task(anything*)', 'Task', { description: 'anything goes' })).toBe(false);
    expect(denies('Task(*)', 'Task', { description: 'x' })).toBe(true); // `*` still matches
  });
});

// ---------------------------------------------------------------------------
// specifierMatches — `:*` word-boundary over-grant guard
// ---------------------------------------------------------------------------

describe('specifier :* word-boundary (over-grant guard)', () => {
  const gitDeny = (command: string) => denies('Bash(git:*)', 'Bash', { command }, 'any');
  it('matches the bare base and a space-delimited subcommand', () => {
    expect(gitDeny('git')).toBe(true);
    expect(gitDeny('git push origin main')).toBe(true);
  });
  it('does NOT match a different command that merely shares the prefix (git-crypt)', () => {
    // The over-grant the boundary closes: `git:*` must not reach `git-crypt`.
    expect(gitDeny('git-crypt export /secret')).toBe(false);
    expect(gitDeny('github-cli auth')).toBe(false);
  });
  it('a plain trailing-* prefix (no colon) matches by raw prefix', () => {
    expect(denies('Bash(npm run*)', 'Bash', { command: 'npm run build' }, 'any')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchToolName — MCP known-server longest-prefix resolution
// ---------------------------------------------------------------------------

describe('matchToolName — known-server longest-prefix', () => {
  it('naive split (no known servers) takes ALL-BUT-LAST as the server (lastIndexOf __)', () => {
    // splitMcpName: mcp__a__tool -> server 'a'; mcp__a__b__tool -> server 'a__b'.
    expect(matchToolName('mcp__a', 'mcp__a__tool')).toBe(true);
    expect(matchToolName('mcp__a__b', 'mcp__a__b__tool')).toBe(true);
    expect(matchToolName('mcp__a', 'mcp__a__b__tool')).toBe(false); // server is 'a__b', not 'a'
  });
  it('known servers disambiguate to the LONGEST registered prefix (differs from naive)', () => {
    const known = new Set(['a', 'a__b']);
    // naive splitMcpName('mcp__a__b__c__tool') = server 'a__b__c'; the registry
    // resolves to the longest registered prefix 'a__b' instead.
    expect(matchToolName('mcp__a__b', 'mcp__a__b__c__tool', known)).toBe(true); // known -> 'a__b'
    expect(matchToolName('mcp__a__b', 'mcp__a__b__c__tool')).toBe(false); // naive -> 'a__b__c'
    expect(matchToolName('mcp__a', 'mcp__a__b__c__tool', known)).toBe(false); // 'a' loses to 'a__b'
  });
  it('mcp__* matches any mcp-shaped tool but not a bare non-mcp tool', () => {
    expect(matchToolName('mcp__*', 'mcp__srv__tool')).toBe(true);
    expect(matchToolName('mcp__*', 'Bash')).toBe(false);
  });
  it('a server-wildcard with an empty or *-containing server never matches', () => {
    expect(matchToolName('mcp__', 'mcp__srv__tool')).toBe(false); // empty server
    expect(matchToolName('mcp__*x__*', 'mcp__srvx__tool')).toBe(false); // '*' in server
  });
  it('the global glob * matches everything', () => {
    expect(matchToolName('*', 'Bash')).toBe(true);
    expect(matchToolName('*', 'mcp__a__b')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// path-primary glob resolution (deep ** vs single-level)
// ---------------------------------------------------------------------------

describe('path glob resolution', () => {
  it('a deep ** matches any depth; a single * does not cross directory boundaries', () => {
    // Deep-** deny under /etc.
    expect(denies('Read(//etc/**)', 'Read', { file_path: '/etc/a/b/secret' }, 'any')).toBe(true);
    // A path clearly outside is not matched.
    expect(denies('Read(//etc/**)', 'Read', { file_path: '/var/secret' }, 'any')).toBe(false);
  });
  it('a boundary prefix (trailing slash) matches only at a path boundary', () => {
    expect(denies('Read(//etc/foo/**)', 'Read', { file_path: '/etc/foo/x' }, 'any')).toBe(true);
    expect(denies('Read(//etc/foo/**)', 'Read', { file_path: '/etc/foobar/x' }, 'any')).toBe(false);
  });
});
