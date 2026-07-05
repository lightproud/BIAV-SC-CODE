# BPT Agent SDK 路线图（版本总览 + 可勾选清单）

> 类型：proposal ｜ 日期：2026-07-05 ｜ 作者：艾瑞卡会话
> 定位：`projects/bpt-agent-sdk/` 的**权威版本路线图**——作为 `bpt-sdk-reproduction-scope-ledger-20260704.md`（全做范围台账）的**上层总览**，按版本勾选进度。实时子项目状态仍以 `memory/project-status.md` 为唯一权威；本档只记「里程碑地图 + 每项做没做」，进度数字不复刻。
> 北极星：BPT Desktop 换 import 即摆脱被禁 `claude.exe` 子进程引擎——银芯→黑池单向输出物，与 §1.1-HC 黑池防火墙同向（银芯→黑池单向、黑池不回流）。

---

## 0. 一句话

引擎主体（v0.1–v0.5）+ 提示词装配层（Track B）已成并入 main；G 系列（引擎效率机制 + 保真收尾，含 G8 决策落档）收官 v0.5；
**v0.6 起步 —— 生成器/分类器产品功能已落**（守密人 2026-07-05 反转裁定「这就是我们看到的黑盒」，见 §2.1）；v0.6 余下是更大的行为/产品件
（编排 / 记忆 / 沙箱 / Desktop 接线）。贯穿纪律：**不测不宣胜负**——每项再现/机制附 before/after，vs-official 每里程碑必跑。

---

## 1. 已交付（合并入 main）

- [x] **v0.1–v0.4**：直连 Anthropic Messages API 引擎（fetch+SSE，无 CLI 子进程）+ 工具（Read/Write/Edit/Bash/Glob/Grep/…）+ 权限九步 + hooks + MCP（stdio/http/进程内）+ 会话（JSONL resume/fork）+ 观测臂 25 变体 + 契约对齐。
- [x] **v0.5 主体**：background Bash 一族（持久 shell + BashOutput/KillShell）+ 换装就绪包（MIGRATION + Electron 示例 + tarball 线）+ A/B 测量线 + vs-official 裸对比。
- [x] **提示词装配层 Track B（#421）**：主循环片段库 + 装配器（v5 逐字节迁入、字节金标）；工具描述 / general-purpose 子代理 / compaction 摘要器三面忠实复现；每面 provenance + corpus-sync 漂移守护（对上游归档逐锚点对账、漂移即 CI 红）。
- [x] **提示词默认提升 v1→v5**：claude_code preset 默认走 v5 全面忠实再现；决定性 A/B 证 v5 比 v1 约 3× 便宜、同正确（真因缓存）。

**两轴保真现状**：
- 表面完整度（SURFACE）≈ **90%+**，可收敛（接口/类型/消息变体照公开契约补齐）。
- 行为保真度（BEHAVIORAL）：经 v5 + 运行时装配（env / CLAUDE.md / 工具描述加厚）**已逼近官方**。vs-official 实测（提示词轴对齐后）：缓存追平 ~97%、成本反省（3.6×→2.5× 更省）、速度 ~2.6× 快、正确 11/11 vs 10/11。残余行为差主导项是 BPT 主权模型选择（换模型换手感），非提示词。

---

## 2. v0.5 收官 —— G 系列（引擎效率机制 + 保真收尾）

| # | 目标 | 状态 | 附对照 |
|---|------|------|--------|
| G1 | 压缩前置廉价层（摘要前去重 + 超大 tool_result 截断成内容指针，甩字节）| **已落（PR #435）** | input-token 削减 |
| G2 | 摘要/标题走 Haiku 便宜模型（`compaction.model`）| **已落（PR #435）** | 摘要成本 |
| G3 | 双 system 缓存断点（项目指令块存在时用满第 4 断点）| **已落（PR #435）** | 缓存命中 |
| G4 | 子代理 Fork 模式（继承缓存共享上下文）+ sidechain 转录 | **已落（PR #435）**：对抗审查揪出的 blocker（fork seed 级联清空、退化 isolated）已修——不再级联、真继承父上下文（完成 pair 全留、任务并入尾部 user 轮）；测试重写覆盖真实 tool-call 序列 | 缓存复用 |
| G5 | v4 补工具使用纪律片段 | **已落**（被 v5 全面涵盖）| — |
| G6 | 分类器/生成器提示词再现 | **已落（v0.6，守密人 2026-07-05 反转裁定）**：原判「未发货、红线不做」，守密人「V0.6 加这些产品功能吧，这就是我们看到的黑盒」反转——作为真实公开功能发货（详见 §2.1）| 五件功能 |
| G7 | 定位反转全仓文档扫尾（clean-room→公开信息再现，保留硬约束）| **已落（PR #435）** | — |
| G8 | `decisions.md` 两条裁定落档 | **已落（守密人 2026-07-05 授权代写）**：定位反转 clean-room→公开信息再现 + 提示词装配层 Track B + v5 默认，两条入「当前有效决策」表 | — |

> G1/G3/G4/G7 于 2026-07-05 经 ultracode 工作流并行推进（规划 → 隔离 worktree 实现 → 对抗审查）。**对抗审查发挥作用**：G1/G3 判 SHIP 直接 cherry-pick；G7 判 FIX_NEEDED、补修 package.json 等 findings 后合入；**G4 判 FIX_NEEDED（blocker）——审查揪出 fork seed 级联清空、退化 isolated，「看着能 fork 实则骗人」，故先不合、守密人裁「先修完整」**，据审查给的精确 repro+修法修好（不再级联、真继承父上下文）、测试重写覆盖真实场景后合入。四项全落，v0.5 引擎机制批完成。「不测不宣胜负」在此体现为「审查不过就不发、修好再合」。

---

## 2.1 v0.6 起步 —— 生成器/分类器产品功能（G6，已落）

守密人 2026-07-05 反转裁定：「V0.6 加这些产品功能吧，这就是我们看到的黑盒」——原 G6 判「归档剩的生成器/分类器属未发货功能、红线不做」，
现反转为**作为真实公开 SDK 功能发货**（`src/generators/`）。这些是 Claude Code 主循环**之外**触发的辅助 utility 模型调用，正是用户观测到的「黑盒」。

| 功能 | 作用 | 真实调用方 | 安全方向 |
|------|------|-----------|---------|
| `detectCommandPrefix` | bash 命令前缀提取 / 命令注入判定 | 权限白名单匹配 | **fail-closed**：空/乱回复判 injection，绝不误放行 |
| `classifyBackgroundState` | 后台运行转录尾判 working/blocked/done/failed | 手机通知门（接 v0.5 后台 Bash）| **fail-safe**：不可解析回退 done，绝不伪造 blocked 假打扰 |
| `generateSessionTitle` | 会话标题（3-7 词 sentence-case）| 会话 UI 命名 | — |
| `generateTitleAndBranch` | 标题 + `claude/` 分支名 | 会话创建 | 分支强规整为合法 kebab |
| `generateSessionName` | `/rename` kebab 名 | 会话重命名 | — |

工程要点：每件 = 忠实复现提示词（`prompts.ts`，5 面 provenance + corpus-sync 逐锚点守护、漂移即 CI 红）+ 一次性 utility 运行时
（`runtime.ts`，默认 Haiku 便宜模型、temperature 0 确定性、注入式 transport 离线单测）+ 健壮解析器（`extractJsonObject` 认字符串内花括号/转义）。
**红线满足**：能力与其提示词一并发货 → 提示词有真实调用方，非「描述不存在的能力」。commit-msg 不单列（官方由主循环 tool-use 产出、非独立 utility 调用）；
auto-mode 归档仅 guidance 片段、非独立整 prompt，暂缓。**46 新单测全绿（总 838）**，含解析健壮性 / fail-closed·fail-safe / 5 面 corpus-sync。

---

## 3. v0.6+（deferred，权威范围在 scope-ledger）

守密人 2026-07-04「全做」裁定下推迟到 v0.6+ 的更大件（Tier 2/3）：

| 类 | 项 |
|---|---|
| **编排层** | Plan 分阶段流水线 / 审查·三态验证器 / coordinator 模式（同意不可转述）/ Workflow DSL |
| **记忆层** | 做梦记忆（以 Claude 平台原生记忆为蓝本再现——退役自造环时即留此意）|
| **运行时** | 沙箱再现 / 循环·调度 |
| **产品面** | BPT Desktop 前端接线（参考档 `bpt-desktop-ui-reference-*` + 结构规格 `claude-desktop-ui-structure-*` + 落地路线 `bpt-desktop-ui-roadmap-20260705.md` 已备）|

---

## 4. 贯穿纪律（守密人已定为常规）

1. **不测不宣胜负**：每个再现/采纳附对照测试证其效；量错了公开翻案（作废旧结论、留痕不静默覆盖）。
2. **vs-official 常规化**：每里程碑必跑一次裸对比（速度 + 正确性两客观轴，官方当黑箱不读其提示词），报告归档 Resource。
3. **净室观测边界（2026-07-05 硬约束）**：vs-official 官方臂请求体（含专有提示词）不读不持久，合法观测面 = 公开消息流 + 文件副作用 + 终态答案 + 线缆元数据。
4. **公开信息再现（非 clean-room）**：提示词从公开还原 + 归档忠实复现、明确署名、适配本 SDK；**硬边界不变**——§1.1-HC 黑池防火墙、拒绝真正的内部未授权泄漏、不逐字大段克隆、不描述未发货能力。

---

## 5. 依据档

- 全做范围台账：`Public-Info-Pool/Resource/proposal/bpt-sdk-reproduction-scope-ledger-20260704.md`
- 装配层设计：`Public-Info-Pool/Resource/proposal/bpt-prompt-assembly-layer-design-20260705.md`
- vs-official 对照实证：`Public-Info-Pool/Resource/data-diagnostics/bpt-sdk-comparison-baseline-20260705.md`
- 子项目实时状态：`memory/project-status.md`「## BPT Agent SDK」+ `projects/bpt-agent-sdk/CONTEXT.md`
