/**
 * Harness system-prompt construction: stable/volatile split + v1/v2/v3 variant.
 */

import { describe, expect, it } from 'vitest';
import { buildSystemPromptParts, buildSystemPrompt } from '../src/engine/prompts.js';

const ctx = (variant?: 'v1' | 'v2' | 'v3' | 'v4' | 'v5') => ({
  cwd: '/tmp/run-xyz',
  toolNames: ['Read', 'Write', 'Bash'],
  variant,
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

describe('harness prompt v1/v2 variant', () => {
  it('defaults to v5 (faithful official reproduction) when no variant is given', () => {
    // The claude_code preset with no explicit variant emulates the official
    // harness: a measured A/B showed v5 is ~3x cheaper in multi-turn at equal
    // correctness (95% vs 0% cache hit), so it is the default.
    const def = buildSystemPromptParts(preset, ctx()).stable;
    const explicitV5 = buildSystemPromptParts(preset, ctx('v5')).stable;
    expect(def).toBe(explicitV5);
    // v5 main-loop is Chinese (i18n-zh Phase 2 batch A): "执行任务：" == "Doing tasks:".
    expect(def).toContain('执行任务：');
    expect(def).not.toContain('/tmp/run-xyz');
  });

  it('v1 is still available as an explicit terse opt-in', () => {
    const v1 = buildSystemPromptParts(preset, ctx('v1')).stable;
    // v1-v4 harness variants are Chinese (i18n-zh Phase 2 batch E).
    expect(v1).toContain('工具指引：'); // Tool guidance:
    // and it is meaningfully smaller than the v5 default
    const v5 = buildSystemPromptParts(preset, ctx('v5')).stable;
    expect(v1.length).toBeLessThan(v5.length);
  });

  it('v2 is the richer self-authored prompt and is larger than v1', () => {
    const v1 = buildSystemPromptParts(preset, ctx('v1')).stable;
    const v2 = buildSystemPromptParts(preset, ctx('v2')).stable;
    expect(v2).not.toBe(v1);
    expect(v2.length).toBeGreaterThan(v1.length);
    // v2 encodes real behavioral discipline, not padding (Chinese, i18n-zh batch E).
    expect(v2).toContain('方法：'); // Approach:
    expect(v2).toContain('基于事实与诚实：'); // Grounding and honesty:
    expect(v2).toContain('收尾：'); // Finishing:
    // both keep the cwd out of the cached (stable) segment
    expect(v2).not.toContain('/tmp/run-xyz');
  });

  it('v3 adds the four flagged disciplines on top of v2 and is larger still', () => {
    const v2 = buildSystemPromptParts(preset, ctx('v2')).stable;
    const v3 = buildSystemPromptParts(preset, ctx('v3')).stable;
    expect(v3).not.toBe(v2);
    expect(v3.length).toBeGreaterThan(v2.length);
    // the four techniques the public best-practices comparison flagged as missing
    // (Chinese, i18n-zh batch E)
    expect(v3).toContain('核实你的工作'); // verify-before-finishing
    expect(v3).toContain('硬编码'); // solve the general problem (Do not hard-code)
    expect(v3).toContain('例如：'); // one concrete style example (for example:)
    // when-to-delegate guidance is present ONLY when the Agent tool is shipped
    const v3Agent = buildSystemPromptParts(preset, {
      cwd: '/tmp/run-xyz',
      toolNames: ['Read', 'Write', 'Bash', 'Agent'],
      variant: 'v3',
    }).stable;
    expect(v3Agent).toContain('委派：'); // Delegation:
    // still keeps the cwd out of the cached (stable) segment
    expect(v3).not.toContain('/tmp/run-xyz');
  });

  it('v4 faithfully reproduces official main-loop clauses, tool refs adapted, cwd out', () => {
    const v4 = buildSystemPromptParts(preset, ctx('v4')).stable;
    // faithful official clauses, translated (Chinese, i18n-zh batch E)
    expect(v4).toContain('你是一个交互式代理，帮助用户完成软件工程任务。');
    expect(v4).toContain('以结果开头。'); // Lead with the outcome.
    expect(v4).toContain('file_path:line_number'); // wire token, verbatim
    // tool references adapted to THIS SDK's tools (names verbatim, Chinese comma join)
    expect(v4).toContain('Read、Write、Edit、Glob、Grep');
    // cwd stays out of the cached (stable) segment
    expect(v4).not.toContain('/tmp/run-xyz');
    // and it does not reference tools this SDK does not ship
    expect(v4).not.toContain('Workflow');
  });

  it('v5 is a comprehensive faithful reproduction, more sections than v4, tool-adapted, cwd out', () => {
    const v4 = buildSystemPromptParts(preset, ctx('v4')).stable;
    const v5 = buildSystemPromptParts(preset, ctx('v5')).stable;
    // v5 is now Chinese (i18n-zh Phase 2 batch A) and v4 is still English, so a
    // raw char-length comparison is meaningless (Chinese is denser). Comprehensive-
    // ness is instead shown structurally: v5 carries executing-actions-with-care /
    // act-when-ready sections that v4 does not.
    expect(v5).toContain('谨慎地执行操作：'); // executing actions with care
    expect(v4).not.toContain('Executing actions with care:');
    expect(v5).toContain('当你有足够信息去行动时，就行动。'); // act-when-ready
    // fuller official main-loop sections present in v5 (Chinese headers)
    expect(v5).toContain('执行任务：'); // Doing tasks:
    expect(v5).toContain('工具使用：'); // Tool use:
    expect(v5).toContain('与用户沟通：'); // Communicating with the user:
    // faithful official clauses (translated)
    expect(v5).toContain('量两次，剪一次。'); // Measure twice, cut once.
    expect(v5).toContain('file_path:line_number'); // wire token, verbatim
    // security-assistance clause reproduced (translated)
    expect(v5).toContain('为经授权的安全测试'); // Assist with authorized security testing
    // tool references adapted to THIS SDK (dedicated-tools-over-bash redirects)
    expect(v5).toContain('用 Grep（而非 grep 或 rg）'); // Use Grep (NOT grep or rg)
    // does not reference tools this SDK does not ship (tokens stay absent)
    expect(v5).not.toContain('Workflow');
    expect(v5).not.toContain('computer-use');
    // cwd stays out of the cached stable segment
    expect(v5).not.toContain('/tmp/run-xyz');
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

  it('RED LINE: never names the Agent tool when it is not in the tool set (v5 + v3)', () => {
    // query.ts registers the Agent tool only when subagents are configured, so
    // the default prompt must not instruct the model to use it. Both v3 and v5
    // are Chinese now (i18n-zh) — check the Agent clause is absent in each.
    const noAgent = { cwd: '/tmp/x', toolNames: ['Read', 'Write', 'Bash', 'TodoWrite'] };
    const v3 = buildSystemPromptParts(preset, { ...noAgent, variant: 'v3' }).stable;
    expect(v3).not.toContain('Agent 工具'); // "via the Agent tool" (translated)
    expect(v3).not.toContain('委派：'); // Delegation:
    const v5 = buildSystemPromptParts(preset, { ...noAgent, variant: 'v5' }).stable;
    expect(v5).not.toContain('Agent 工具');
    expect(v5).not.toContain('专门代理'); // specialized agents
  });

  it('includes the Agent guidance when the Agent tool IS in the set (v5 + v3)', () => {
    const withAgent = { cwd: '/tmp/x', toolNames: ['Read', 'Bash', 'Agent'] };
    // both v5 and v3 clauses are Chinese now ("Agent 工具"); i18n-zh batch A/E.
    expect(buildSystemPromptParts(preset, { ...withAgent, variant: 'v5' }).stable).toContain('Agent 工具');
    expect(buildSystemPromptParts(preset, { ...withAgent, variant: 'v3' }).stable).toContain('Agent 工具');
  });

  it('gates each tool-specific clause on that tool being present (v5)', () => {
    // A restricted tool set drops the clauses naming absent tools (v5 is Chinese).
    const minimal = { cwd: '/tmp/x', toolNames: ['Read', 'Bash'], variant: 'v5' as const };
    const stable = buildSystemPromptParts(preset, minimal).stable;
    expect(stable).not.toContain('TodoWrite 工具');
    expect(stable).not.toContain('AskUserQuestion 工具');
    expect(stable).not.toContain('WebFetch 抓取');
    // core prose (not tool-gated) stays
    expect(stable).toContain('执行任务：');
  });

  it('append text lands in the stable segment for all variants', () => {
    const withAppend = { ...preset, append: 'EXTRA_INSTRUCTION' };
    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5'] as const) {
      expect(buildSystemPromptParts(withAppend, ctx(v)).stable).toContain('EXTRA_INSTRUCTION');
    }
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
    // base is the shared harness only — no per-project tail bytes (v5 Chinese)
    expect(parts.base).toContain('执行任务：');
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
