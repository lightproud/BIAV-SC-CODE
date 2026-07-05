# BPT Agent SDK 路线图（版本总览 + 可勾选清单）

> 类型：proposal ｜ 日期：2026-07-05 ｜ 作者：艾瑞卡会话
> 定位：`projects/bpt-agent-sdk/` 的**权威版本路线图**——作为 `bpt-sdk-reproduction-scope-ledger-20260704.md`（全做范围台账）的**上层总览**，按版本勾选进度。实时子项目状态仍以 `memory/project-status.md` 为唯一权威；本档只记「里程碑地图 + 每项做没做」，进度数字不复刻。
> 北极星：BPT Desktop 换 import 即摆脱被禁 `claude.exe` 子进程引擎——银芯→黑池单向输出物，与 §1.1-HC 黑池防火墙同向（银芯→黑池单向、黑池不回流）。

---

## 0. 一句话

引擎主体（v0.1–v0.5）+ 提示词装配层（Track B）已成并入 main；G 系列（引擎效率机制 + 保真收尾）收官 v0.5；v0.6+ 是更大的行为/产品件（编排 / 记忆 / 沙箱 / Desktop 接线）。贯穿纪律：**不测不宣胜负**——每项再现/机制附 before/after，vs-official 每里程碑必跑。

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
| G1 | 压缩前置廉价层（摘要前去重 + 超大 tool_result 截断成内容指针，甩字节）| 进行中 | input-token 削减 |
| G2 | 摘要/标题走 Haiku 便宜模型（`compaction.model`）| **已落（PR #435）** | 摘要成本 |
| G3 | 双 system 缓存断点（项目指令块存在时用满第 4 断点）| 进行中 | 缓存命中 |
| G4 | 子代理 Fork 模式（继承缓存共享上下文）+ sidechain 转录 | 进行中 | 缓存复用 |
| G5 | v4 补工具使用纪律片段 | **已落**（被 v5 全面涵盖）| — |
| G6 | 分类器/生成器提示词再现 | **部分落**：SDK 真用的（general-purpose / 摘要器）随 Track B 落；其余属未发货功能，**红线不做** | — |
| G7 | 定位反转全仓文档扫尾（clean-room→公开信息再现，保留硬约束）| 进行中 | — |
| G8 | `decisions.md` 两条裁定落档 | 待守密人（决策档仅守密人权限）| — |

> G1/G3/G4/G7 于 2026-07-05 经 ultracode 工作流并行推进（规划 → 隔离 worktree 实现 → 对抗审查），审查 SHIP 的由会话集成点 cherry-pick 进分支、逐个跑全量把关。本表随实际落盘更新。

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
