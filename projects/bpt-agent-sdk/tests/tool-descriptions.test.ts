/**
 * Faithful tool-description reproductions: fidelity markers + the red line that
 * no description may reference a tool/capability this SDK does not ship.
 */

import { describe, expect, it } from 'vitest';
import * as D from '../src/tools/descriptions.js';
import { createBuiltinTools } from '../src/tools/index.js';

const ALL = [
  D.BASH_DESCRIPTION,
  D.READ_DESCRIPTION,
  D.EDIT_DESCRIPTION,
  D.WRITE_DESCRIPTION,
  D.GREP_DESCRIPTION,
  D.GLOB_DESCRIPTION,
  D.TODOWRITE_DESCRIPTION,
  D.WEBFETCH_DESCRIPTION,
  D.WEBSEARCH_DESCRIPTION,
  D.ASKUSERQUESTION_DESCRIPTION,
];

describe('faithful tool descriptions', () => {
  it('reproduce official signature phrasing', () => {
    expect(D.BASH_DESCRIPTION).toContain('Executes a given bash command');
    // dedicated-tools-over-bash redirects reference only shipped tools
    expect(D.BASH_DESCRIPTION).toMatch(/BashOutput/);
    expect(D.BASH_DESCRIPTION).toMatch(/KillShell/);
    expect(D.TODOWRITE_DESCRIPTION.length).toBeGreaterThan(1500);
    expect(D.EDIT_DESCRIPTION).toContain('old_string');
  });

  it('are substantially richer than a terse stub (fidelity implies size)', () => {
    // Bash is the largest official description; ours reproduces it faithfully.
    expect(D.BASH_DESCRIPTION.length).toBeGreaterThan(4000);
  });

  it('RED LINE: never reference a tool or capability this SDK does not ship', () => {
    const forbidden = [
      'NotebookEdit',
      'MultiEdit',
      'Workflow',
      'ExitPlanMode',
      'PowerShell',
      'SlashCommand',
      'computer use',
      'sandbox',
    ];
    for (const desc of ALL) {
      for (const bad of forbidden) {
        expect(desc).not.toContain(bad);
      }
      // "Task tool" / "Agent tool" must not appear (subagents aren't a shipped tool)
      expect(desc).not.toMatch(/\bTask tool\b/);
      expect(desc).not.toMatch(/\bAgent tool\b/);
    }
  });

  it('are actually wired onto the built-in tools', () => {
    const tools = createBuiltinTools();
    expect(tools.get('Bash')?.description).toBe(D.BASH_DESCRIPTION);
    expect(tools.get('Grep')?.description).toBe(D.GREP_DESCRIPTION);
    expect(tools.get('TodoWrite')?.description).toBe(D.TODOWRITE_DESCRIPTION);
  });
});
