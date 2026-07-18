/**
 * EngineConfig assembly (extracted from query.ts, audit 2026-07-10 P2-3C).
 *
 * Everything that turns public Options into the engine's config in one place:
 * structured-output normalization, the system-prompt shapes (segments form vs
 * the [base | appended tail | volatile cwd] split with its cache-breakpoint
 * offsets), the labeled prompt-composition breakdown, the claude_code preset
 * thinking default (E1/E7-01), and the EngineConfig literal itself. query.ts
 * consumes the result and stays orchestration-only.
 *
 * NOTE the load-bearing invariant documented at the structured-output append:
 * the instruction is appended AFTER `base`, so systemPromptBaseLen (a char
 * offset into the stable prompt) stays valid. Keep any new stable-tail
 * additions after that boundary too.
 */

import type {
  Options,
  OutputFormatConfig,
  TextBlockParam,
} from '../types.js';
import type {
  EngineConfig,
  SystemComposition,
  SystemCompositionPart,
} from '../internal/contracts.js';
import { buildCompactionConfig } from './compaction.js';
import { buildSystemPromptParts, renderVolatileTail } from './prompts.js';
import { estimateTextTokens } from './tokens.js';
import { gatherEnvironment, loadProjectInstructions } from './runtime-context.js';
import {
  buildStructuredOutputInstruction,
  normalizeOutputFormat,
} from './structured-output.js';

/** Default per-request output-token cap, BY WIRE PROTOCOL (BPT ruling
 *  2026-07-14). The Anthropic default stays conservative: that API 400s a
 *  max_tokens above the model's output ceiling (e.g. claude-sonnet-4-5 caps
 *  at 64000) and no public per-model output table is bundled, so 8192 keeps
 *  default sessions safe. The openai-chat default is 128000: agentic turns
 *  on large-output gateway models were starved at 8192, and a gateway/model
 *  with a lower ceiling rejects with a clear surfaced APIStatusError (see
 *  the transport-openai boundary tests) rather than failing silently.
 *  `provider.maxOutputTokens` overrides either default. */
const DEFAULT_MAX_OUTPUT_TOKENS_ANTHROPIC = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS_OPENAI_CHAT = 128_000;

export type BuiltEngineConfig = {
  /** Mutable engine config shared across turns (setModel etc. mutate it live). */
  engineConfig: EngineConfig;
  /** Normalized structured-output config (also embedded in engineConfig). */
  outputFormat: OutputFormatConfig | undefined;
  /** Git branch probed for the session meta line (preset/default path only). */
  sessionGitBranch: string | undefined;
  /** True when options.systemPrompt spelled the claude_code preset (drives the
   *  E1 thinking default and setMaxThinkingTokens' live re-enable semantics). */
  isClaudeCodePreset: boolean;
};

export function buildEngineConfig(args: {
  options: Options;
  cwd: string;
  initialModel: string;
  /** Names of the FINAL builtin tool map (post tool-filtering). */
  builtinToolNames: string[];
  debug: (msg: string) => void;
}): BuiltEngineConfig {
  const { options, cwd, initialModel, debug } = args;

  // Structured-output: normalize the schema option and append the instruction
  // to the STABLE system segment so the requirement survives tool turns and
  // stays inside the cached prefix (it is static, not per-run).
  const outputFormat = normalizeOutputFormat(options.outputFormat, debug);

  // System prompt has two shapes:
  //  - segments form (host-layered): the CALLER composed ordered blocks and
  //    marked which to cache. We forward them verbatim (respecting their
  //    breakpoints, adding none) — the generic seam for host prompt layering.
  //  - string/preset/undefined: this SDK builds the [stable, cwd] split.
  let systemBlocks: TextBlockParam[] | undefined;
  let systemPromptStable = '';
  let systemPromptVolatile = '';
  // audit r4 Z8-2/Rdt-4: per-turn rebuild of the volatile <env> tail for the
  // live model + current date (set on the runtime-assembly path when an <env>
  // block exists; undefined otherwise). The loop calls it each turn.
  let rebuildVolatileSuffix: ((liveModel: string) => string) | undefined;
  // Git branch of cwd at query construction, reused from the runtime-context
  // probe below (no second git call) and persisted into the session meta line
  // so listSessions/getSessionInfo report SDKSessionInfo.gitBranch. Absent on
  // the segments path / when includeEnvironmentContext is false (no probe ran).
  let sessionGitBranch: string | undefined;
  // Char offset splitting the stable prefix into [base harness | appended tail]
  // for the 2nd system cache breakpoint. Only set on the string/preset path.
  let systemPromptBaseLen: number | undefined;
  // Labeled per-part system breakdown for the prompt-composition message
  // (BPT-EXTENSION); built here where the parts are still separate strings.
  let systemComposition: SystemComposition | undefined;
  const sp = options.systemPrompt;
  if (sp !== null && typeof sp === 'object' && 'type' in sp && sp.type === 'segments') {
    // E2 (audit 2026-07-17): segment breakpoints are baked at config-build
    // time, and the runtime cache shaper runs in 'preserve' mode for this
    // path — so the provider knobs must be honored HERE. promptCaching:false
    // means NO breakpoints at all (a baked marker would still buy cache-write
    // premium), and cacheTtl:'1h' must stamp the segment markers too (a bare
    // marker next to 1h tools/messages markers silently downgraded the TTL).
    const segmentCachingEnabled = options.provider?.promptCaching !== false;
    const segmentMarker: TextBlockParam['cache_control'] =
      options.provider?.cacheTtl === '1h'
        ? { type: 'ephemeral', ttl: '1h' }
        : { type: 'ephemeral' };
    // 4 API breakpoints total; reserve 1 for the tool schemas -> up to 3 here.
    let budget = 3;
    systemBlocks = (Array.isArray(sp.segments) ? sp.segments : [])
      .filter((s) => s !== null && typeof s.text === 'string' && s.text.length > 0)
      .map((s) => {
        const block: TextBlockParam = { type: 'text', text: s.text };
        if (s.cache === true && segmentCachingEnabled) {
          if (budget > 0) {
            block.cache_control = { ...segmentMarker };
            budget -= 1;
          } else {
            debug(
              'systemPrompt segments: cache-breakpoint budget (3) exhausted; ' +
                'this segment is sent uncached (order segments most-shared first)',
            );
          }
        }
        return block;
      });
    // Structured-output requirement rides as a trailing (uncached) block.
    // E3 (audit 2026-07-17): pushed even when every caller segment filtered
    // to empty — otherwise the wire carried system:[] and the model was never
    // told the required JSON shape (first attempt blind, only the correction
    // round carried the schema).
    if (outputFormat !== undefined) {
      systemBlocks.push({
        type: 'text',
        text: buildStructuredOutputInstruction(outputFormat.schema),
      });
    }
    // Labeled composition for the prompt-composition message: each host segment
    // is its own append part (segments form has no engine-owned base), plus the
    // trailing structured-output block when present.
    const segParts: SystemCompositionPart[] = (Array.isArray(sp.segments) ? sp.segments : [])
      .filter((s) => s !== null && typeof s.text === 'string' && s.text.length > 0)
      .map((s) => ({
        role: 'segment' as const,
        label: s.label,
        estTokens: estimateTextTokens(s.text),
      }));
    // Mirrors the E3 fix above: the composition breakdown reports the block
    // whenever it is actually sent, segments or none.
    if (outputFormat !== undefined) {
      segParts.push({
        role: 'structured-output',
        label: 'structured-output',
        estTokens: estimateTextTokens(buildStructuredOutputInstruction(outputFormat.schema)),
      });
    }
    systemComposition = { parts: segParts };
  } else {
    // Runtime-assembly context (open reproduction of the official runtime
    // prompt): the <env> block (default-on for the preset) and CLAUDE.md /
    // AGENTS.md codebase instructions (opt-in via settingSources). Gathered
    // here because it needs I/O the pure prompt module avoids; both degrade to
    // empty on any failure and never block query construction.
    const includeEnv = options.includeEnvironmentContext !== false;
    // E6 (audit r2): "Today's date" must be the HOST'S calendar day, not the
    // UTC one — toISOString() told a UTC+8 host yesterday's date every day
    // from 00:00 to 08:00 local. audit r4 Rdt-4: recomputed per rebuild so a
    // session spanning local midnight refreshes the date, not just at build.
    const localCalendarDay = (): string => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const environment = includeEnv
      ? gatherEnvironment(cwd, initialModel, localCalendarDay())
      : undefined;
    sessionGitBranch = environment?.gitBranch;
    const projectInstructions = loadProjectInstructions(cwd, options.settingSources);
    // There is one harness prompt: buildSystemPromptParts resolves both an unset
    // systemPrompt and the claude_code preset to the same comprehensive default.
    // Automation-continuation fragment (keeper memo 2026-07-18 §3):
    // protocol-gated default — armed on openai-chat (mainline non-Anthropic
    // models stall mid-run on agentic tasks), off on anthropic; an explicit
    // options.continuationPrompt wins either way.
    const continuation =
      options.continuationPrompt ?? options.provider?.protocol === 'openai-chat';
    const promptParts = buildSystemPromptParts(sp, {
      cwd,
      toolNames: [...args.builtinToolNames],
      environment,
      projectInstructions,
      ...(continuation ? { continuation: true } : {}),
    });
    systemPromptStable = promptParts.stable;
    // Boundary between the shared base harness and the appended stable tail
    // (project instructions / append). The structured-output instruction is
    // appended AFTER `base`, so it lands in the slice(baseLen) tail and the
    // offset stays valid.
    systemPromptBaseLen = promptParts.base.length;
    // Prompt-composition breakdown: the stable parts (base + codebase-instructions
    // + append segments), then the structured-output instruction, then the
    // volatile (cwd/env) tail — in wire order.
    const compositionParts: SystemCompositionPart[] = [...promptParts.parts];
    if (outputFormat !== undefined) {
      const instr = buildStructuredOutputInstruction(outputFormat.schema);
      systemPromptStable += `\n\n${instr}`;
      compositionParts.push({
        role: 'structured-output',
        label: 'structured-output',
        estTokens: estimateTextTokens(instr),
      });
    }
    systemPromptVolatile = promptParts.volatile;
    if (systemPromptVolatile.length > 0) {
      compositionParts.push({
        role: 'environment',
        label: 'environment',
        estTokens: estimateTextTokens(systemPromptVolatile),
      });
    }
    // audit r4 Z8-2/Rdt-4: capture the base <env> facts so the loop can rebuild
    // the tail per turn with the live model and a freshly-computed calendar day.
    // Only when an <env> block is actually present (otherwise the tail is the
    // bare working-directory line — nothing per-run to refresh). Byte-identical
    // to the baked tail for equal inputs (renderVolatileTail is the same code
    // buildSystemPromptParts used above).
    if (environment !== undefined && systemPromptVolatile.length > 0) {
      rebuildVolatileSuffix = (liveModel: string): string =>
        renderVolatileTail(cwd, { ...environment, model: liveModel, date: localCalendarDay() });
    }
    systemComposition = { parts: compositionParts };
  }

  // Default-on extended thinking, claude_code preset path ONLY (E1 + E7-01).
  // The official CLI enables thinking by default and (per the r3 wire
  // differential) sends `thinking: {type:"adaptive"}` on 4.6+ models. E7-01
  // aligned our preset default to that. Injection rules (INTENT only — the
  // engine normalizes the wire form per LIVE model in computeThinking):
  //  - an explicit options.thinking always wins (passed through verbatim);
  //  - maxThinkingTokens: 0 is the explicit opt-out (no thinking param);
  //  - maxThinkingTokens > 0 enables FIXED thinking with that budget;
  //  - both unset -> adaptive thinking intent.
  // The `adaptive` intent below is NOT the final wire shape: computeThinking
  // (loop.ts + thinking-model.ts) emits `{type:'adaptive'}` on 4.6+ models but
  // downgrades to `{type:'enabled', budget_tokens}` on pre-4.6 models (haiku
  // 4.5, sonnet 4.5, etc.), which 400 on adaptive. This fork is why the v0.7
  // "always adaptive" default 400'd the whole haiku conformance arm.
  // Non-preset paths (bare string / segments / no systemPrompt) are unchanged:
  // the drop-in default remains "no thinking param".
  const isClaudeCodePreset =
    sp !== null &&
    typeof sp === 'object' &&
    'type' in sp &&
    sp.type === 'preset' &&
    sp.preset === 'claude_code';
  let thinkingConfig = options.thinking;
  let maxThinkingTokensConfig = options.maxThinkingTokens;
  if (isClaudeCodePreset && thinkingConfig === undefined) {
    if (maxThinkingTokensConfig === undefined) {
      thinkingConfig = { type: 'adaptive' };
    } else if (maxThinkingTokensConfig > 0) {
      thinkingConfig = { type: 'enabled' };
    }
    // maxThinkingTokens <= 0: explicit opt-out, inject nothing.
  }

  // Mutable engine config shared across turns; setModel/setMaxThinkingTokens
  // mutate it live (takes effect from the next assistant turn).
  const engineConfig: EngineConfig = {
    model: initialModel,
    fallbackModel: options.fallbackModel,
    // Provider label for normalized errors: map the wire protocol to a stable
    // backend name a host can branch on ('openai-chat' -> 'openai').
    providerLabel: options.provider?.protocol === 'openai-chat' ? 'openai' : 'anthropic',
    maxOutputTokens:
      options.provider?.maxOutputTokens ??
      (options.provider?.protocol === 'openai-chat'
        ? DEFAULT_MAX_OUTPUT_TOKENS_OPENAI_CHAT
        : DEFAULT_MAX_OUTPUT_TOKENS_ANTHROPIC),
    systemPrompt: systemPromptStable,
    // Volatile (cwd) tail rides after the cache breakpoint; absent -> the
    // stable prompt is sent as a single string (e.g. a user-string prompt).
    ...(systemPromptVolatile.length > 0
      ? { systemPromptSuffix: systemPromptVolatile }
      : {}),
    // audit r4 Z8-2/Rdt-4: per-turn <env> tail refresh (live model + date).
    ...(rebuildVolatileSuffix !== undefined ? { rebuildVolatileSuffix } : {}),
    // Base/tail split offset for the 2nd system cache breakpoint (string/preset
    // path only; the loop guards 0 < baseLen < systemPrompt.length so it
    // degrades to a single breakpoint when there is no appended tail).
    ...(systemPromptBaseLen !== undefined ? { systemPromptBaseLen } : {}),
    // Caller-composed segments (host layering) take precedence over the
    // string/preset path when present.
    ...(systemBlocks !== undefined ? { systemBlocks } : {}),
    maxTurns: options.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd,
    budgetThresholdRatio: options.budgetThresholdRatio,
    // R2 one-shot latches live on the CONFIG (one per query) so multi-turn
    // streaming — which re-enters runAgentLoop per turn — keeps the budget
    // events once-per-session, not once-per-turn (audit 2026-07-17 M18).
    budgetEventState: { thresholdFired: false, exhaustedFired: false },
    thinking: thinkingConfig,
    maxThinkingTokens: maxThinkingTokensConfig,
    // tool_choice steer/constraint; forwarded to each request when tools are
    // present (loop guards the empty-tools case). Absent -> API default (auto).
    toolChoice: options.toolChoice,
    compaction: buildCompactionConfig(options.compaction),
    // E3 salvage mode (BPT-EXTENSION, resilience): 'continue' re-drives a
    // mid-stream truncation to a complete answer instead of accepting the
    // partial. Default (undefined) keeps the official salvage-accept path.
    ...(options.resilience?.salvageMode !== undefined
      ? { salvageMode: options.resilience.salvageMode }
      : {}),
    outputFormat,
    // Prompt caching is ON by default (matches the official SDK and saves the
    // static system+tools prefix on every turn of a multi-turn session). Set
    // provider.promptCaching = false to disable (e.g. for very short sessions
    // where the cache-write premium is not amortized).
    promptCaching: options.provider?.promptCaching !== false,
    // Cache TTL: undefined/'5m' -> 5-minute default; '1h' -> 1-hour cache
    // (BPT-EXTENSION; the official SDK has no such knob).
    cacheTtl: options.provider?.cacheTtl,
    // Custom price entries (BPT-EXTENSION, audit 2026-07-10): make cost
    // metrics + maxBudgetUsd work for non-Claude models (openai protocol).
    pricing: options.provider?.pricing,
    // Host alias overrides (BPT-EXTENSION, model-alias mapping 2026-07-17):
    // remap `opus`/`sonnet`/`haiku`/`fable` (or any id) to the gateway's ids
    // for subagent spawn and the compaction summarizer.
    ...(options.modelAliases !== undefined
      ? { modelAliases: options.modelAliases }
      : {}),
    includePartialMessages: options.includePartialMessages === true,
    // Prompt-composition observability (BPT-EXTENSION): emit a per-request
    // system/prompt_composition message; off by default (zero cost, wire
    // request unaffected). The labeled system breakdown feeds its 需求 A split.
    ...(options.includePromptComposition === true
      ? { includePromptComposition: true }
      : {}),
    ...(systemComposition !== undefined ? { systemComposition } : {}),
    sessionId: '', // resolved when the run starts
    cwd,
  };

  return { engineConfig, outputFormat, sessionGitBranch, isClaudeCodePreset };
}

/**
 * Append labeled system-prompt parts to an ALREADY-BUILT engine config
 * (memory system R5/R6: the protocol fragment is static but the resident
 * memory index needs an async store read, so both are appended by the query
 * layer at run start, before the first request). Placement invariants:
 *  - string/preset path: appended to the STABLE prompt after the existing
 *    tail, so systemPromptBaseLen (a char offset into the base) stays valid
 *    and the [tools | system-base | system-tail | last-message] cache-
 *    breakpoint structure is unchanged — the parts land inside the existing
 *    tail breakpoint;
 *  - segments path: appended as trailing UNCACHED blocks (same treatment as
 *    the structured-output instruction), adding no breakpoints.
 * Each part is also pushed onto the labeled composition breakdown so
 * prompt-composition observability attributes it by name.
 */
export function appendSystemInjection(
  engineConfig: EngineConfig,
  parts: Array<{ label: string; text: string }>,
): void {
  for (const part of parts) {
    if (part.text.length === 0) continue;
    if (engineConfig.systemBlocks !== undefined) {
      engineConfig.systemBlocks.push({ type: 'text', text: part.text });
    } else {
      engineConfig.systemPrompt =
        engineConfig.systemPrompt.length > 0
          ? `${engineConfig.systemPrompt}\n\n${part.text}`
          : part.text;
    }
    const composition = engineConfig.systemComposition;
    if (composition !== undefined) {
      const appended = {
        role: 'append' as const,
        label: part.label,
        estTokens: estimateTextTokens(part.text),
      };
      // E5 (audit r2): on the string/preset path the injected TEXT lands in
      // the stable prompt, i.e. BEFORE the volatile env tail
      // (systemPromptSuffix) on the wire — so the labeled breakdown must
      // place it before the trailing 'environment' part too, or the
      // composition violates its wire-order invariant. The segments path has
      // no 'environment' part and keeps plain push semantics.
      const envIdx =
        engineConfig.systemBlocks === undefined
          ? composition.parts.findIndex((p) => p.role === 'environment')
          : -1;
      if (envIdx >= 0) composition.parts.splice(envIdx, 0, appended);
      else composition.parts.push(appended);
    }
  }
}
