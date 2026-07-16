/**
 * Harness system-prompt construction: stable/volatile split + the single
 * default harness prompt (the v1-v4 variant ladder was collapsed, 2026-07-08).
 */

import { describe, expect, it } from 'vitest';
import { buildSystemPromptParts, buildSystemPrompt } from '../src/engine/prompts.js';

const ctx = () => ({
  cwd: '/tmp/run-xyz',
  toolNames: ['Read', 'Write', 'Bash'],
});
const preset = { type: 'preset' as const, preset: 'claude_code' as const };

describe('system prompt split', () => {
  it('keeps the cwd out of the stable segment and in the volatile tail', () => {
    const { stable, volatile } = buildSystemPromptParts(preset, ctx());
    expect(stable).not.toContain('/tmp/run-xyz');
    expect(volatile).toContain('/tmp/run-xyz');
  });

  it('a string systemPrompt is entirely stable with no volatile tail', () => {
    const { stable, volatile } = buildSystemPromptParts('custom prompt', ctx());
    expect(stable).toBe('custom prompt');
    expect(volatile).toBe('');
  });

  it('buildSystemPrompt joins stable + volatile', () => {
    const flat = buildSystemPrompt(preset, ctx());
    expect(flat).toContain('/tmp/run-xyz');
  });
});

describe('the default harness prompt', () => {
  it('undefined and the claude_code preset resolve to the SAME single default', () => {
    // The v1-v4 variant ladder was collapsed (keeper ruling 2026-07-08): both an
    // unset systemPrompt and the preset produce ONE comprehensive harness prompt.
    const fromUndefined = buildSystemPromptParts(undefined, ctx()).base;
    const fromPreset = buildSystemPromptParts(preset, ctx()).base;
    expect(fromUndefined).toBe(fromPreset);
    expect(fromPreset).toContain('Doing tasks:');
    expect(fromPreset).not.toContain('/tmp/run-xyz');
  });

  it('is the comprehensive faithful reproduction of the official main loop', () => {
    const stable = buildSystemPromptParts(preset, ctx()).stable;
    // fuller official main-loop sections
    expect(stable).toContain('Doing tasks:');
    expect(stable).toContain('Tool use:');
    expect(stable).toContain('Executing actions with care:');
    expect(stable).toContain('Communicating with the user:');
    // faithful official clauses
    expect(stable).toContain('You are an interactive agent that helps users with software engineering tasks.');
    expect(stable).toContain('Measure twice, cut once.');
    expect(stable).toContain('When you have enough information to act, act.');
    expect(stable).toContain('Assist with authorized security testing');
    expect(stable).toContain('file_path:line_number');
    // tool references adapted to THIS SDK (dedicated-tools-over-bash redirects)
    expect(stable).toContain('Use Grep (NOT grep or rg)');
    // does not reference tools this SDK does not ship
    expect(stable).not.toContain('Workflow');
    expect(stable).not.toContain('computer-use');
    // cwd stays out of the cached stable segment
    expect(stable).not.toContain('/tmp/run-xyz');
  });

  it('an environment context renders the <env> block in the volatile tail', () => {
    const { stable, volatile } = buildSystemPromptParts(preset, {
      cwd: '/tmp/run-xyz',
      toolNames: ['Read'],
      environment: {
        platform: 'linux',
        osVersion: 'linux 6.1',
        date: '2026-07-05',
        model: 'claude-haiku-4-5-20251001',
        isGitRepo: true,
        gitBranch: 'main',
      },
    });
    // env facts live in the volatile tail, never the cached stable prefix
    expect(volatile).toContain('<env>');
    expect(volatile).toContain('Working directory: /tmp/run-xyz');
    expect(volatile).toContain('Is directory a git repo: Yes');
    expect(volatile).toContain('Git branch: main');
    expect(volatile).toContain("Today's date: 2026-07-05");
    expect(volatile).toContain('You are powered by the model named claude-haiku-4-5-20251001.');
    expect(stable).not.toContain('<env>');
    expect(stable).not.toContain('2026-07-05');
  });

  it('a non-git cwd renders "Is directory a git repo: No" and no branch line', () => {
    const { volatile } = buildSystemPromptParts(preset, {
      cwd: '/tmp/x',
      toolNames: ['Read'],
      environment: { isGitRepo: false, gitBranch: 'ignored' },
    });
    expect(volatile).toContain('Is directory a git repo: No');
    expect(volatile).not.toContain('Git branch:');
  });

  it('projectInstructions inject a system-reminder into the cached stable prefix', () => {
    const { stable, volatile } = buildSystemPromptParts(preset, {
      cwd: '/tmp/x',
      toolNames: ['Read'],
      projectInstructions: '# CLAUDE.md\n\nAlways use tabs.',
    });
    expect(stable).toContain('<system-reminder>');
    expect(stable).toContain('Always use tabs.');
    // instructions are cacheable (stable), not in the volatile tail
    expect(volatile).not.toContain('Always use tabs.');
  });

  it('RED LINE: never names the Agent tool when it is not in the tool set', () => {
    // query.ts registers the Agent tool only when subagents are configured, so
    // the default prompt must not instruct the model to use it.
    const noAgent = { cwd: '/tmp/x', toolNames: ['Read', 'Write', 'Bash', 'TodoWrite'] };
    const stable = buildSystemPromptParts(preset, noAgent).stable;
    expect(stable).not.toContain('Agent tool');
    expect(stable).not.toContain('via the Agent tool');
    expect(stable).not.toContain('specialized agents');
  });

  it('includes the Agent guidance when the Agent tool IS in the set', () => {
    const withAgent = { cwd: '/tmp/x', toolNames: ['Read', 'Bash', 'Agent'] };
    expect(buildSystemPromptParts(preset, withAgent).stable).toContain('Agent tool');
  });

  it('gates each tool-specific clause on that tool being present', () => {
    // A restricted tool set drops the clauses naming absent tools.
    const minimal = { cwd: '/tmp/x', toolNames: ['Read', 'Bash'] };
    const stable = buildSystemPromptParts(preset, minimal).stable;
    expect(stable).not.toContain('TodoWrite tool');
    expect(stable).not.toContain('AskUserQuestion tool');
    expect(stable).not.toContain('WebFetch fetches');
    // core prose (not tool-gated) stays
    expect(stable).toContain('Doing tasks:');
  });

  it('append text lands in the stable segment', () => {
    const withAppend = { ...preset, append: 'EXTRA_INSTRUCTION' };
    expect(buildSystemPromptParts(withAppend, ctx()).stable).toContain('EXTRA_INSTRUCTION');
  });
});

describe('base/project split (2nd system cache breakpoint)', () => {
  it('base + project === stable, with the reminder/append in project only', () => {
    const parts = buildSystemPromptParts(
      { ...preset, append: 'EXTRA_INSTRUCTION' },
      {
        cwd: '/tmp/x',
        toolNames: ['Read', 'Write', 'Bash'],
        projectInstructions: '# CLAUDE.md\n\nAlways use tabs.',
      },
    );
    // invariant: the split reconstructs the full stable byte-for-byte
    expect(parts.base + parts.project).toBe(parts.stable);
    // base is the shared harness only — no per-project tail bytes
    expect(parts.base).toContain('Doing tasks:');
    expect(parts.base).not.toContain('<system-reminder>');
    expect(parts.base).not.toContain('EXTRA_INSTRUCTION');
    // project carries the reminder + append WITH its leading separators
    expect(parts.project.startsWith('\n\n')).toBe(true);
    expect(parts.project).toContain('<system-reminder>');
    expect(parts.project).toContain('Always use tabs.');
    expect(parts.project).toContain('EXTRA_INSTRUCTION');
  });

  it('projectInstructions alone populate project; append alone populate project', () => {
    const onlyReminder = buildSystemPromptParts(preset, {
      cwd: '/tmp/x',
      toolNames: ['Read'],
      projectInstructions: 'PROJECT_RULES',
    });
    expect(onlyReminder.base + onlyReminder.project).toBe(onlyReminder.stable);
    expect(onlyReminder.project).toContain('PROJECT_RULES');
    expect(onlyReminder.base).not.toContain('PROJECT_RULES');

    const onlyAppend = buildSystemPromptParts(
      { ...preset, append: 'JUST_APPEND' },
      { cwd: '/tmp/x', toolNames: ['Read'] },
    );
    expect(onlyAppend.base + onlyAppend.project).toBe(onlyAppend.stable);
    expect(onlyAppend.project).toBe('\n\nJUST_APPEND');
  });

  it("project === '' for a bare preset, a string prompt, and undefined", () => {
    const barePreset = buildSystemPromptParts(preset, ctx());
    expect(barePreset.project).toBe('');
    expect(barePreset.base).toBe(barePreset.stable);

    const stringPrompt = buildSystemPromptParts('custom prompt', ctx());
    expect(stringPrompt.project).toBe('');
    expect(stringPrompt.base).toBe('custom prompt');

    const undef = buildSystemPromptParts(undefined, ctx());
    expect(undef.project).toBe('');
    expect(undef.base).toBe(undef.stable);
  });
});
