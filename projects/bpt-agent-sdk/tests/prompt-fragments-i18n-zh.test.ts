/**
 * i18n-zh structural guard for the main-loop system prompt (Phase 2 batch A,
 * keeper ruling B 2026-07-08): the agent's core behavioral contract is
 * translated to Chinese in-place and shipped on the wire. This replaces the
 * English corpus-sync guard for the (now translated) fragments — there is no
 * longer an English source to be faithful to, so instead we assert the
 * translation is well-formed: every fragment is actually Chinese, carries no
 * emoji (CLAUDE.md §2.4), and the fragments that carry identifiers preserve the
 * English wire tokens a translation must NOT localize (tool names, parameter
 * names, and command/code tokens).
 */

import { describe, expect, it } from 'vitest';

import { MAIN_LOOP_INTRO, MAIN_LOOP_BODY } from '../src/engine/prompt-fragments.js';
import { assembleMainLoop } from '../src/engine/prompt-assembler.js';

const CJK = /[一-鿿]/;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

const ALL = [MAIN_LOOP_INTRO, ...MAIN_LOOP_BODY];

// Per-fragment wire tokens that MUST survive translation (identifiers, not prose).
const TOKENS: Record<string, string[]> = {
  'censoring-assistance': ['CTF', 'DoS', 'C2'],
  'doing-tasks-header+focus': ['methodName', 'method_name'],
  'doing-tasks-no-compatibility-hacks': ['_vars', '// removed'],
  'doing-tasks-security': ['XSS', 'SQL', 'OWASP'],
  'prefer-dedicated-tools': ['Bash', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'cat/head/tail'],
  'read-before-edit': ['Write', 'Edit', 'old_string', 'replace_all', 'token'],
  'task-tools': ['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'subject', 'activeForm', 'in_progress', 'completed', 'addBlocks/addBlockedBy'],
  todowrite: ['TodoWrite', 'content', 'activeForm', 'in_progress', 'completed'],
  agent: ['Agent'],
  askuserquestion: ['AskUserQuestion'],
  'webfetch-websearch': ['WebFetch', 'WebSearch', 'URL', 'HTTPS', 'markdown', 'Sources:'],
  'executing-actions-header+reversibility': ['git push', 'CLAUDE.md'],
  'risky-actions-examples': ['rm -rf', 'git reset --hard', 'CI/CD', 'PR', 'pastebin', 'gist'],
  'obstacle-root-cause+git-status': ['--no-verify', 'git status', 'git checkout/restore/reset/clean', 'rm -rf', '`-u`', 'stash'],
  'readable-over-concise': ['A -> B -> fails'],
  'file-path-line-number': ['file_path:line_number'],
  'emoji-avoidance': ['emoji'],
};

describe('main-loop system prompt i18n-zh (Phase 2 batch A)', () => {
  it.each(ALL.map((f) => [f.id, f.text] as [string, string]))(
    'fragment %s is non-empty Chinese and emoji-free',
    (id, text) => {
      expect(text.length, id).toBeGreaterThan(0);
      expect(CJK.test(text), `${id} must be Chinese`).toBe(true);
      expect(EMOJI.test(text), `${id} must carry no emoji`).toBe(false);
      // No fragment is a faithful English reproduction any longer.
      const f = ALL.find((x) => x.id === id)!;
      expect(f.faithful, `${id} must be marked faithful:false once translated`).toBe(false);
    },
  );

  it('every identifier-bearing fragment preserves its English wire tokens', () => {
    const missing: string[] = [];
    for (const f of ALL) {
      for (const t of TOKENS[f.id] ?? []) {
        if (!f.text.includes(t)) missing.push(`${f.id}: "${t}"`);
      }
    }
    expect(missing, `dropped wire tokens:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the assembled full prompt is Chinese, emoji-free, and keeps the tools label', () => {
    const full = assembleMainLoop({
      toolNames: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'WebFetch', 'WebSearch', 'AskUserQuestion', 'Agent'],
    });
    expect(CJK.test(full)).toBe(true);
    expect(EMOJI.test(full)).toBe(false);
    expect(full).toContain('可用工具：');
    // gated clauses present when their tool is in the set
    expect(full).toContain('TaskCreate');
    expect(full).toContain('Agent 工具');
    // English tool names in the tools list survive verbatim
    expect(full).toContain('Read, Write, Edit');
  });
});
