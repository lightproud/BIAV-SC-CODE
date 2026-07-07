/**
 * Faithful OPEN reproductions of Claude Code's /code-review VERIFICATION-phase
 * prompts — the three-state verdict primitive (CONFIRMED / PLAUSIBLE / REFUTED)
 * and the recall-biased verification guidance. These are the adversarial-verify
 * building blocks the SDK ships as `adversarialVerify()` (index.ts): a consumer
 * building a review flow classifies each candidate finding and drops REFUTED
 * ones, mirroring the skill's "keep CONFIRMED or PLAUSIBLE" orchestration rule.
 *
 * Provenance model mirrors src/generators/prompts.ts: each verbatim fragment
 * cites its archive slug under
 * Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/ and a
 * corpus-sync guard (tests/verifier.test.ts) holds it to that source, so
 * upstream drift turns the build red. The task-framing + JSON output-contract
 * glue is adapted (not claimed faithful) and carries no archive provenance.
 */

/** Where a reproduced verifier fragment came from, and whether it is verbatim. */
export interface VerifierProvenance {
  slug: string;
  faithful: boolean;
}

/**
 * The three-state verdict DEFINITIONS — verbatim body of
 * agent-prompt-code-review-part-4-three-state-verification-phase.
 */
export const THREE_STATE_VERDICT_DEFINITIONS = `- **CONFIRMED** —— 能指明触发它的输入/状态，以及错误的输出或崩溃。引用那一行。
- **PLAUSIBLE** —— 机制真实存在，但触发不确定（时序、环境、配置）。说明什么能确认它。
- **REFUTED** —— 事实错误（代码并未如此表述）或在别处已有防护。引用能证明这一点的那一行。`;

/**
 * Recall-biased verification guidance — verbatim body of
 * agent-prompt-code-review-part-5-recall-biased-verification-phase. Treats
 * realistic uncertain findings as PLAUSIBLE unless the code refutes them.
 */
export const RECALL_BIAS_GUIDANCE = `**默认 PLAUSIBLE** —— 当状态是现实可达的时，不要因某个候选"投机"或
"依赖运行时状态"就驳回它：并发竞态、罕见但可达路径上的 nil/undefined（错误处理器、冷缓存、
缺失的可选字段）、被当作缺失的假值零、代码未排除的边界上的差一错误、重试风暴/部分失败、
丢了锚点的正则/白名单。这些都是 PLAUSIBLE。

**REFUTED** 仅当可从代码构造出来时才成立：事实错误（引用实际那一行）；可证明不可能
（类型/常量/不变量——把它展示出来）；本 diff 中已处理（引用那道防护）；或纯风格、无可观测影响。`;

/**
 * The keep rule — verbatim sentence from skill-code-review-phase-2-verify-3-state.
 * Reproduced as the shipped `keep` flag on VerificationResult (verdict !==
 * 'REFUTED'), so this constant is the corpus-sync anchor for that behaviour.
 */
export const VERIFY_KEEP_RULE = 'Keep candidates where the vote is CONFIRMED or PLAUSIBLE.';

/**
 * Assembled verifier system prompt: adapted task-framing glue + the two faithful
 * archive fragments + an adapted JSON output contract. Only the two fragments
 * claim archive provenance (VERDICT_DEFINITIONS / RECALL_BIAS); the glue does not.
 */
export const VERIFY_VERDICT_SYSTEM = [
  '你是代码评审流程中的一名对抗性核验者。你会拿到一份 diff、相关的文件、以及一个候选发现。用以下定义把该候选恰好归类为 CONFIRMED、PLAUSIBLE 或 REFUTED 之一：',
  THREE_STATE_VERDICT_DEFINITIONS,
  RECALL_BIAS_GUIDANCE,
  '只用这段 JSON 回复，不要代码围栏：\n{"verdict":"<CONFIRMED|PLAUSIBLE|REFUTED>","quote":"<你引用的代码行>","rationale":"<一行>","confirms":"<仅 PLAUSIBLE：什么能确认它；否则省略>"}',
].join('\n\n');

/** Provenance for the three-state verdict definitions fragment. */
export const VERDICT_DEFINITIONS_PROVENANCE: VerifierProvenance = {
  slug: 'agent-prompt-code-review-part-4-three-state-verification-phase',
  faithful: false, // i18n-zh Phase 2 batch B: translated (verdict enum + JSON kept English)
};

/** Provenance for the recall-biased verification guidance fragment. */
export const RECALL_BIAS_PROVENANCE: VerifierProvenance = {
  slug: 'agent-prompt-code-review-part-5-recall-biased-verification-phase',
  faithful: false, // i18n-zh Phase 2 batch B: translated (PLAUSIBLE/REFUTED tokens kept English)
};

/** Provenance for the keep-rule anchor. */
export const VERIFY_PHASE_PROVENANCE: VerifierProvenance = {
  slug: 'skill-code-review-phase-2-verify-3-state',
  faithful: true,
};

/** Every reproduced verifier fragment, keyed by a stable id. */
export const VERIFIER_PROVENANCE: Record<string, VerifierProvenance> = {
  verdictDefinitions: VERDICT_DEFINITIONS_PROVENANCE,
  recallBias: RECALL_BIAS_PROVENANCE,
  verifyPhase: VERIFY_PHASE_PROVENANCE,
};
