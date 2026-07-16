# BPT Desktop 内建骨架命令首批文本（B 类，batch 1）

- 成文：2026-07-11，艾瑞卡会话（销 `memory/todo.md` #T10）
- 承接：守密人 2026-07-10 裁定①「B 类骨架提示词取**结构再现 + 文本自写**为默认」
  （`memory/decisions.md` 同日条）+ 实施方案二期 M3 内建源前置件
  （`bpt-desktop-command-impl-plan-20260710.md` §3 二期）
- 性质：**银芯→黑池单向输出物**。本档为 BPT Desktop 壳层 M3「内建骨架命令源（B 类）」
  的首批三张命令卡：`/review`、`/simplify` 的结构再现版 + `/loop` 固定模式。
  黑池侧把各卡的注入文本原样接入 `SkillSource` 内建实现即可消费。

## 0. 纪律声明（写作边界）

1. **结构再现、文本自写**：编排思想（档位分级 / 相位结构 / 生命周期契约三件套）照
   行为观测台账 `cc-command-behavior-observations-20260710.md` OBS-005 / OBS-007 学；
   注入文本**逐句自写**，未复制任何官方提示词句子（自查方法见 §5）。
2. **品牌去牌**：承 2026-07-08 去牌裁定⑤⑥（全局默认），文本内品牌一律 **BPT**，
   无 Claude / Claude Code 字样。
3. **射程**：`/loop` 仅覆盖**固定间隔模式**；动态自调步模式属三期 P2 单独立项
   （账见 `memory/todo.md` #T13），本卡明文拒绝该输入而非静默降级。
4. **硬约束无涉**：三卡文本全部自写、结构依据为银芯自有观测档案，§1.1-HC 防火墙不相关。

## 1. 注册表元数据（M3 `SkillSource` 契约）

| name | kind | 档位（effort） | 参数 | 注入形态 |
|------|------|---------------|------|---------|
| review | protocol | low / medium / high（默认 medium） | 可选：目标 diff 范围 | 技能正文以用户回合送引擎；UI 气泡显示 `/review [args]` 原文，展开文可折叠 |
| simplify | protocol | low / high（默认 low） | 可选：目标路径 | 同上 |
| loop | protocol | 无档位（固定模式单文本） | `<间隔> <每轮指令>` | 同上 |

- `kind: protocol`（OBS-004 分型）：三卡皆为指令型——注入即执行，非参考资料。
- **档位闸门语义**（OBS-007 移植）：成本控制落在「注入哪份文本」上，不是运行时开关。
  壳层按用户所选档位从下表取对应文本注入，引擎侧无感知档位概念。

## 2. 命令卡一：`/review`（档位分级结构再现）

**结构依据**：OBS-007——低档 = 紧凑双回合协议（禁扩散、上限条数、空集精确输出）；
高档 = 多相编排（范围界定 → 多角度并行查找 → 逐条对抗验证 → 合成去重）。
**职责边界**：只查正确性缺陷；复用 / 简化 / 效率类清理归 `/simplify`。

### 2.1 low 档注入文本

```text
Review the pending changes for correctness defects only. Budget: one
pass, two turns maximum.

Turn 1 - gather: run `git diff` (staged plus unstaged, against the
merge base if on a branch). Read only the changed hunks plus the
minimal surrounding lines needed to understand them. Do not read whole
files, do not spawn subagents, do not run builds or tests.

Turn 2 - report: list at most 4 findings, highest confidence first.
Each finding: file path with line number, one-sentence defect
statement, and the concrete input or state that makes it fail. Skip
anything you cannot tie to a failure scenario. Style, naming, and
cleanup suggestions are out of scope.

If nothing qualifies, output exactly: (none)
```

### 2.2 medium 档注入文本

```text
Review the pending changes for correctness defects. Budget: single
agent, verification required before reporting.

Phase 1 - scope: run `git diff` against the merge base. For each
changed file, read the changed hunks plus enough surrounding code
(callers, type definitions, error paths) to judge behavior. Note
candidate defects as you go; do not report them yet.

Phase 2 - verify: for each candidate, re-open the relevant code and
check the failure actually occurs - trace the concrete input or state
through the code path. Drop candidates that turn out to be guarded
elsewhere, unreachable, or intended behavior per nearby comments,
tests, or project docs.

Phase 3 - report: surviving findings only, ranked by severity. Each
finding: file path with line number, defect statement, failure
scenario (inputs/state leading to wrong output or crash). Do not pad
the list; an empty result is a valid result.

If nothing survives verification, output exactly: (none)
```

### 2.3 high 档注入文本

```text
Run an exhaustive correctness review of the pending changes. Budget:
subagents allowed, adversarial verification mandatory.

Phase 0 - scope: run `git diff` against the merge base. Map the
changed surface: files, public entry points touched, and which
subsystems consume them.

Phase 1 - find (parallel angles): examine the diff from each angle
independently, as separate passes or subagents:
  a. logic and boundary errors (off-by-one, null/empty, error paths);
  b. contract breaks (changed signatures, return shapes, invariants
     that callers or tests still rely on);
  c. state and concurrency (ordering, reentrancy, shared mutation,
     resource cleanup);
  d. regressions (behavior the old code had that the new code silently
     drops - check git history and tests for the previous contract).
Each angle reports candidates with file:line and a failure hypothesis.

Phase 2 - refutation pass: for every candidate, attempt to REFUTE
it against the actual code. A candidate survives only if the refuter
concedes a concrete failing input or state exists. Kill anything
speculative, guarded elsewhere, or dependent on inputs the codebase
cannot produce.

Phase 3 - synthesize: merge results across angles, dedupe by file and
root cause, rank by severity. Each confirmed finding: file path with
line number, defect statement, failure scenario, and which angle plus
verification round confirmed it.

If nothing survives, output exactly: (none)
```

## 3. 命令卡二：`/simplify`（档位分级结构再现）

**结构依据**：OBS-007 同款档位思想；两档即够（本命令天然比 review 轻）。
**职责边界**：只做质量清理（复用 / 简化 / 效率 / 抽象层级），**不猎缺陷**——
正确性问题即使顺路看见也只提一句转交 `/review`，不展开。落地动作：本命令**直接应用**
修改（与 review 只报告不同），故每档都带行为保持自查。

### 3.1 low 档注入文本

```text
Clean up the pending changes for quality. Budget: one inline pass,
apply at most 3 safe edits.

Sweep the changed hunks (git diff against the merge base) for:
duplicated logic that an existing helper already covers, code that can
be expressed in fewer moving parts, obvious wasted work (repeated
lookups, needless copies), and mismatched abstraction level (low-level
detail leaking into high-level flow).

Apply only edits that are behavior-preserving on inspection - same
inputs, same outputs, same side effects. If an edit needs reasoning
about distant code to prove safe, skip it and note it instead.

This is not a bug hunt. If you spot a correctness defect, mention it
in one line and move on - /review owns that.

Finish with a short list of edits applied and edits skipped with
reasons. If nothing qualified, say so and change nothing.
```

### 3.2 high 档注入文本

```text
Run a thorough quality cleanup of the pending changes. Budget: phased,
verification after applying.

Phase 1 - inventory: read the full changed files (not just hunks) and
their immediate neighbors. List cleanup candidates across four axes:
reuse (existing helpers, utilities, or patterns this code reinvents),
simplification (fewer branches, flatter control flow, dead code),
efficiency (algorithmic waste, redundant I/O, allocations in hot
paths), and altitude (code sitting at the wrong abstraction level for
its surroundings).

Phase 2 - risk-check: for each candidate, state why the rewrite
preserves behavior - cite the call sites, tests, or types that pin the
contract. Drop candidates whose safety you cannot argue from code.

Phase 3 - apply: make the surviving edits, matching the surrounding
code's naming and idiom. Keep each edit independently revertable.

Phase 4 - verify: run the project's tests or build for the touched
area. If anything fails, revert the offending edit rather than
patching forward, and record it as skipped.

This is not a bug hunt - correctness findings get one line and a
pointer to /review, nothing more.

Finish with: edits applied (grouped by axis), edits skipped with
reasons, and the verification result.
```

## 4. 命令卡三：`/loop`（固定模式）

**结构依据**：OBS-005——解析规则前置、创建回执三件套（人话节奏 + 生存期声明 +
取消句柄）、抖动纪律、仅空闲触发、瞬态失败重试一次。调度落点为方案 M4 的
**会话级平面**（渲染进程内存定时器，随会话灭）。

### 4.1 注入文本

```text
Set up a recurring task on a fixed interval using the BPT session
scheduler.

Parse the input by three rules:
1. The first token that reads as a duration (30s, 5m, 1h, ...) is the
   interval. If no duration is present, use 10m and say so in the
   receipt. Sub-minute intervals round up to 1m.
2. Everything after the interval is the instruction to run on each
   firing. It may be plain text or a slash command; a slash command is
   re-dispatched through the command layer each time, so its expansion
   stays current.
3. If the instruction part is empty, ask what should run on each tick
   instead of guessing. Do not create a schedule without a task.

Create the schedule via the session scheduler. Offset the start minute
away from :00 and :30 so jobs do not pile up on round marks. The
scheduler fires only while the session is idle - a firing never
interrupts a turn in progress.

Then reply with a receipt containing exactly three things:
1. the cadence in plain words (e.g. "every hour at :07");
2. the lifetime: this schedule lives in session memory, dies with the
   session, and expires on its own after 7 days at the latest;
3. the cancel handle: the job id and the exact command to remove it.

On each firing, run the stored instruction as a normal turn. If a
firing fails on something transient (network, busy resource), retry
once before reporting the failure; report it once, not on every
subsequent tick.

If the user asks for adaptive pacing (no interval, "decide the rhythm
yourself"), state that this build only supports fixed intervals and
adaptive pacing is a separate planned feature - do not emulate it with
a fixed interval silently.
```

## 5. 零官方句子自查

- **方法**:文本先按观测档案的结构要点起草提纲，再脱离快照独立成文；成文后取各卡
  特征句片段对官方提示词快照全库
  （`Public-Info-Pool/Reference/Claude-Code-System-Prompts/`，553 份）ripgrep 反查。
- **结果**（2026-07-11 实跑，快照 559 文件）:抽查片段 10 句中 9 句全库 0 命中
  （`highest confidence first` / `attempt to REFUTE` / `behavior-preserving on
  inspection` / `reads as a duration` / `dies with the session` 等）;1 处撞词
  ——初稿相位标题 `adversarial verify` 与官方 Workflow 工具描述的模式名同形
  （`tool-description-workflow.md` 2 处），已改写为 `refutation pass` 并复查
  0 命中。结构性同形仅存在于「档位分级 / 相位编号 / 回执三件套」这类
  **编排思想**层（裁定①明许照学）。
- **G8 射程确认**:承裁定①「G8『公开信息再现』裁定射程不外延至 B 类文本」——本批
  文本不走再现线,无需逐字对账,漂移跑步机不适用。

## 6. 消费与后续

- **接入**（黑池侧）：M3 内建源 `SkillSource.list()` 返回 §1 元数据表，
  `load(name)` 按档位返回 §2–§4 对应文本块；验收随方案二期 V4/V5/V8。
- **后续批次**：B 类 8 命令中其余（security-review 等重型件）按逐命令例外通道
  评估，重型件可单独过裁定后再产文本；`/loop` 动态自调步文本待 #T13 立项后补。
- **修订约定**：本档按 `Public-Info-Pool` 修订规则走 `-rN`；文本修订须重跑 §5 自查。

---

> 关联档案：裁定 `memory/decisions.md` 2026-07-10「B 类官方骨架提示词姿态」条 ·
> 方案 `bpt-desktop-command-impl-plan-20260710.md` · 观测
> `cc-command-behavior-observations-20260710.md`（OBS-004/005/007）· 需求
> `bpt-desktop-command-framework-requirements-20260710.md`（v1.1）
