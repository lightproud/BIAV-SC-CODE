/**
 * i18n-zh structural guard (keeper ruling B, 2026-07-08): the built-in tool
 * descriptions are translated to Chinese in-place and shipped on the wire. This
 * replaces the English corpus-sync guard for TRANSLATED tools — there is no
 * longer an English official source to be faithful to, so instead we assert the
 * translation is well-formed: it is actually Chinese, carries no emoji
 * (CLAUDE.md §2.4), and preserves the English wire tokens a translation must NOT
 * localize (tool names + parameter names are identifiers, not prose).
 */

import { describe, expect, it } from 'vitest';

import {
  READ_DESCRIPTION,
  EDIT_DESCRIPTION,
  WRITE_DESCRIPTION,
  GREP_DESCRIPTION,
  GLOB_DESCRIPTION,
  TODOWRITE_DESCRIPTION,
  TASKCREATE_DESCRIPTION,
  TASKGET_DESCRIPTION,
  TASKUPDATE_DESCRIPTION,
  TASKLIST_DESCRIPTION,
  WEBFETCH_DESCRIPTION,
  WEBSEARCH_DESCRIPTION,
  ASKUSERQUESTION_DESCRIPTION,
  EXITPLANMODE_DESCRIPTION,
  ENTERWORKTREE_DESCRIPTION,
  MONITOR_DESCRIPTION,
  WORKFLOW_DESCRIPTION,
  BASH_DESCRIPTION,
  BASH_WIN32_NOTE,
  buildBashSandboxNote,
} from '../src/tools/descriptions.js';

// Any CJK ideograph -> the description is actually Chinese.
const CJK = /[一-鿿]/;
// Pictographic emoji / dingbats / flags / variation selector. Deliberately does
// NOT overlap CJK (4E00-9FFF) or full-width Chinese punctuation (3000-303F,
// FF00-FFEF), so legitimate Chinese text never trips it.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}]/u;

// [displayName, description, wire tokens that MUST survive translation]
const TRANSLATED: Array<[string, string, string[]]> = [
  ['Read', READ_DESCRIPTION, ['file_path', 'offset', 'limit', 'cat -n', 'PDF', '.ipynb', 'Bash']],
  ['Edit', EDIT_DESCRIPTION, ['old_string', 'new_string', 'replace_all', 'Read', 'emoji']],
  ['Write', WRITE_DESCRIPTION, ['Edit', 'Read', 'README', 'emoji']],
  [
    'Grep',
    GREP_DESCRIPTION,
    ['ripgrep', 'glob', 'type', 'multiline', 'content', 'files_with_matches', 'count'],
  ],
  ['Glob', GLOB_DESCRIPTION, ['glob', '**/*.js', 'src/**/*.ts']],
  // batch 2
  ['TodoWrite', TODOWRITE_DESCRIPTION, ['content', 'activeForm', 'pending', 'in_progress', 'completed']],
  [
    'TaskCreate',
    TASKCREATE_DESCRIPTION,
    ['subject', 'description', 'activeForm', 'in_progress', 'pending', 'TaskUpdate', 'TaskList'],
  ],
  ['TaskGet', TASKGET_DESCRIPTION, ['subject', 'description', 'status', 'blocks', 'blockedBy', 'TaskList']],
  [
    'TaskUpdate',
    TASKUPDATE_DESCRIPTION,
    ['taskId', 'status', 'in_progress', 'completed', 'deleted', 'owner', 'addBlockedBy', 'TaskGet'],
  ],
  ['TaskList', TASKLIST_DESCRIPTION, ['id', 'subject', 'status', 'owner', 'blockedBy', 'TaskGet']],
  ['WebFetch', WEBFETCH_DESCRIPTION, ['URL', 'HTTPS', 'prompt', 'MCP', 'markdown', 'WebFetch', 'gh']],
  ['WebSearch', WEBSEARCH_DESCRIPTION, ['Sources:', 'URL', 'markdown', 'API']],
  ['AskUserQuestion', ASKUSERQUESTION_DESCRIPTION, ['multiSelect', 'Other', 'Recommended', 'label']],
  [
    'ExitPlanMode',
    EXITPLANMODE_DESCRIPTION,
    ['allowedPrompts', 'Bash', 'AskUserQuestion', 'ExitPlanMode', 'OAuth', 'JWT'],
  ],
  ['EnterWorktree', ENTERWORKTREE_DESCRIPTION, ['worktree', 'name', 'path', 'git', 'HEAD', '.claude/worktrees/']],
  // batch 3
  [
    'Monitor',
    MONITOR_DESCRIPTION,
    ['BashOutput', 'taskId', 'bash_id', 'KillShell', 'run_in_background', '--line-buffered', 'persistent', 'stdout'],
  ],
  // batch 4
  [
    'Workflow',
    WORKFLOW_DESCRIPTION,
    ['agent(', 'pipeline(', 'parallel(', 'phase(', 'log(', 'meta', 'scriptPath', 'runId', 'budget.total', 'JavaScript', 'resumeFromRunId'],
  ],
  // batch 5 (safety-critical: git safety protocol + sandbox escape rules)
  [
    'Bash',
    BASH_DESCRIPTION,
    ['cd', 'ls', 'run_in_background', 'BashOutput', 'KillShell', 'Glob', 'Grep', 'git reset --hard', 'git push --force', '--no-verify', 'gh', 'TodoWrite', 'HEREDOC'],
  ],
  ['Bash win32 note', BASH_WIN32_NOTE, ['POSIX bash (Git Bash)', 'cmd.exe', 'PowerShell', 'findstr']],
];

describe('tool descriptions i18n-zh (batches 1-5)', () => {
  it.each(TRANSLATED)(
    '%s description is non-empty Chinese, emoji-free, and keeps its wire tokens',
    (name, desc, tokens) => {
      expect(desc.length).toBeGreaterThan(0);
      expect(CJK.test(desc), `${name} description must be Chinese`).toBe(true);
      expect(EMOJI.test(desc), `${name} description must carry no emoji`).toBe(false);
      for (const t of tokens) {
        expect(desc.includes(t), `${name} description must preserve wire token "${t}"`).toBe(
          true,
        );
      }
    },
  );
});

// The Bash sandbox note is assembled (not a single constant) — assert both the
// default (escape-hatch) and mandatory (policy-refused) forms are translated and
// still carry the safety-critical wire tokens verbatim. These control when the
// model may disable the sandbox, so mistranslation here is the highest-risk case.
describe('Bash sandbox note i18n-zh (batch 5, safety-critical)', () => {
  // Tokens common to every assembled form (framing + policy + tmpdir + paths).
  const COMMON = ['dangerouslyDisableSandbox', '$TMPDIR', '/tmp', '~/.ssh/*'];
  // Evidence-list tokens ship only in the default (escape-hatch) form.
  const EVIDENCE = ['Operation not permitted', 'Unix socket'];
  const NOTES: Array<[string, string, string[]]> = [
    ['default/net-off', buildBashSandboxNote('default', false), [...COMMON, ...EVIDENCE]],
    ['default/net-on', buildBashSandboxNote('default', true), [...COMMON, ...EVIDENCE]],
    ['mandatory/net-off', buildBashSandboxNote('mandatory', false), COMMON],
  ];
  it.each(NOTES)('sandbox note (%s) is Chinese, emoji-free, keeps safety tokens', (label, note, tokens) => {
    expect(note.length).toBeGreaterThan(0);
    expect(CJK.test(note), `${label} note must be Chinese`).toBe(true);
    expect(EMOJI.test(note), `${label} note must carry no emoji`).toBe(false);
    for (const t of tokens) {
      expect(note.includes(t), `${label} note must preserve safety token "${t}"`).toBe(true);
    }
  });
  it('the default note keeps the dangerouslyDisableSandbox: true escape token; mandatory refuses by policy', () => {
    expect(buildBashSandboxNote('default', false)).toContain('`dangerouslyDisableSandbox: true`');
    expect(buildBashSandboxNote('mandatory', false)).toContain('已按策略禁用');
  });
});
