# gaps.md — 漏缝清单（一等产出）

> 施工边界文书 §2.2 / §6.6（`Public-Info-Pool/Resource/repo-engineering/bpt-hermes-charter-20260802.md`）：
> **扩展点不够、被迫想碰核心之处，一律「即停、记录、不硬闯」落此档。**
> 另收「通用化未遂」记录（文书裁 15 通用化三问不过、归黑池域代码区者，在此留档，
> 随知识保鲜复审评估升格公开）。
> Maestro 概念作废清零不进本档（文书裁 11 / 禁 2）。

## 格式

每条：日期 / 类型（扩展点缺口 | 通用化未遂）/ 场景与被迫触碰面 / 处置（停·绕行·挂账）/ 状态。

## 清单

- **2026-08-02 · 扩展点缺口 · patches/ 启用（守密人需求 #1 裁定）**：品牌换装
  （Hermes → Silver Core）无扩展点可走——身份可由 SOUL.md 原生覆盖，但 159 文件
  的运行面显示串（"Hermes Agent" / "Hermes profile" / "hermes-tui"）为硬编码。
  处置：守密人 2026-08-02 交互裁定「开 patches/ 全量抹净」，`patches/` 由「必须为空」
  转**白名单制**（守卫同 PR 修改，见 `tests/test_hermes_charter.py` ALLOWED_PATCHES）；
  补丁不手写、由 `build/rebrand.py` 规则引擎生成，三红线（LICENSE/版权 · URL/遥测 ·
  功能标识符）机械守卫。范围台账 `BRANDING.md`。状态：已落地。
- **2026-08-02 · 扩展点缺口 · 需求 #2 对话成本面板（`conversation-cost-panel.patch`）**：
  desktop 状态栏/面板无 UI 插件位，成本展示须触改核心（statusbar 项 + 面板组件 + i18n 五语种
  + 网关 `_get_usage` 补 cache/cost 四字段透传 + 事件流一行差分记账）。处置：手维护特性补丁
  482 行 / 13 文件入白名单；**上下文零品牌词**（机械可验：补丁上下文行 grep Hermes = 0），
  故对换装前后基底皆干净适用；移 pin 时 `git apply --check` 守卫响亮报冲突、人工重放。
  验证：desktop typecheck 三配置绿 + 前端 675 测试绿 + 后端网关 533 测试绿。状态：已落地。
- **2026-08-03 · 扩展点走通（正面记录）· blackpool 记忆插件**：中文记忆召回缺口
  （stock holographic 的 FTS5 unicode61 把连续汉字当单一词元，中文事实近乎不可检索）
  **全程走官方扩展面解决、零补丁零核心触碰**——MemoryProvider ABC 纯子类，兄弟插件位
  `plugins/memory/blackpool/` 自动发现，确定性 FMM+bigram 分词器修 FTS 索引/查询、
  Jaccard 双侧、CJK 引号实体四咬合点；HRR 向量维持原文保代数自洽。随 bpa-dev
  套件 plugins\ 注入面分发，激活 `memory.provider: blackpool`。守卫
  `tests/test_black_pool_memory.py` 11 例（含正负控端到端）。状态：已落地（v1；
  中文内容级 HRR 留 v2 观察）。
