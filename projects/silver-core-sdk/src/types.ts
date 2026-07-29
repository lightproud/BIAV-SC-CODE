/**
 * Silver Core SDK - public type surface (barrel).
 *
 * Clean-room reimplementation of the @anthropic-ai/claude-agent-sdk public
 * API surface, grounded exclusively in the public documentation
 * (code.claude.com/docs/en/agent-sdk/typescript, /hooks, /mcp) and the
 * public Anthropic Messages API documentation. No proprietary code was
 * consulted. The engine drives the Messages API directly - there is no
 * bundled CLI executable.
 *
 * Compatibility tiers per field/feature are documented in docs/COMPAT.md.
 *
 * STRUCTURE (repo structure review P7, 2026-07-27): this file was 3760 lines —
 * the largest source file in the SDK and the front door every other module
 * imports from. It is now a barrel over src/types/, split along the section
 * comments the file already carried, so the boundaries are the ones the authors
 * drew rather than ones invented after the fact. Every existing
 * `from '../types.js'` import is untouched; nothing outside this file needed to
 * change.
 */

export type { NormalizedProviderError } from './error-normalize.js';

export * from './types/wire.js';
export * from './types/permissions.js';
export * from './types/hooks.js';
export * from './types/mcp.js';
export * from './types/provider.js';
export * from './types/options.js';
export * from './types/messages.js';
export * from './types/prompt.js';
export * from './types/subsystems.js';
export * from './types/query.js';
// 官方工具输入/输出类型面（原 src/tool-types.ts，P7 归位；零名字冲突，实测 47 vs 219）
export * from './types/tools.js';

// 结构化工具结果（2026-07-27 偏离普查后新增；形状与理由见该档头注）
export type {
  ReadOutput,
  ReadTextOutputWithCap,
  // 导出理由：AskUserQuestion 的四种失败结局是消费方（BPT 宿主）要分流的东西，
  // 不导出就等于逼它继续字符串匹配那句英文文案——正是本形状要消灭的依赖。
  AskUserQuestionStructuredOutput,
  BashStructuredOutput,
  GrepStructuredOutput,
  WebFetchStructuredOutput,
  ToolUseResults,
} from './types/tool-outputs.js';
