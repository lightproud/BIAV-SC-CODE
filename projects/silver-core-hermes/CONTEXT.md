# Silver Core Hermes — 会话上下文

> **定位（守密人 2026-08-02 裁定，使命#2 载体换轨）**：本子项目是使命#2「通用 AI 底层能力
> 开发基地」的**现行核心载体**——基于 **Hermes Agent**（[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)，
> MIT 许可）的**改造扩展层**。守密人裁定放弃「BPT 100% 自研 + 模仿闭源 Claude Code」路线
> （原载体 silver-core-sdk 家族转维护态过渡后冻结，见 `memory/todo.md` #T78），
> 改为在成熟开源底座上做银芯自有扩展。
>
> 决策全文见 `memory/decisions.md` 2026-08-02「BPT 技术路线换轨」条。

## 三条工程铁律（立项裁定即定）

1. **上游跟随 + 扩展层 = 修改克制，非零修改**（守密人 2026-08-02 裁定 + 同日精化，
   否决硬 fork 魔改）：扩展优先走上游原生机制（skills / tools / transports / gateway
   插件位），定期合并上游——上游迭代极快（v0.13.0 单版 864 commits / 295 贡献者），
   深改核心必然脱轨。**允许的触改**：扩展位结构上给不了的薄改动（守密人点名合法例：
   用户层品牌名感知 / rebrand），收敛为显式登记的薄补丁面——每条具名理由与触点，
   随上游合并逐条重放核对；首条偏离出现时建本目录 `DEVIATIONS.md` 台账
   （同 SDK 家族 COMPAT「刻意偏离入册」纪律同款）。
2. **银芯→黑池单向输出**：与 §1.1-HC 防火墙同向——改造层在银芯公开开发，黑池（BPT）
   单向消费，黑池数据与需求原始材料不回流（归因回流 = 需求非数据，经守密人过滤）。
3. **MIT 合规**：上游 MIT 许可与银芯公开信息层定位相容；再分发 / 衍生须保留上游版权与
   许可声明。

## 上游档案（2026-08-02 立项核实）

- 仓库：`NousResearch/hermes-agent`（MIT）
- 形态：长驻代理运行时——终端 TUI（TypeScript/React-Ink）+ 核心 Python（~88%）
- 关键机制：供应商无关传输层（`agent/transports/` ProviderTransport ABC：Anthropic /
  ChatCompletions / ResponsesApi / Bedrock）· 持久记忆 · 技能自我改进 · 定时任务 ·
  沙箱执行（Unix socket RPC）· 浏览器自动化 · 多消息平台接入（Telegram / Slack / Discord 等）

## 当前 milestone

**M0 立项（本期）**：决策落档 + 脚手架。已完成。

**M1 上游深读评估（待守密人点火，挂账 `memory/todo.md` #T79）**：
- 上游架构深读：扩展点覆盖度测绘（skills / tools / transports / gateway 各插件位能承载什么）
- BPT 需求缺口对照：BPT 已依赖的 silver-core-sdk 能力面 vs Hermes 原生能力面差集
- 改造层工程形态设计：上游消费方式（pin / submodule / 依赖）、银芯→黑池输出物形态
- 品牌感知面盘点：上游 Hermes 品牌名在用户层的露出点清单（TUI / CLI 名 / 提示词 / 文案），
  即未来薄补丁面的第一张地图（铁律 1 的「允许触改」范围实测）
- 产出：评估报告入 `Public-Info-Pool/Resource/repo-engineering/`，呈裁后开工

## 验证清单

- 本子项目暂无代码，无构建 / 测试步骤（M1 评估轮后随工程形态设计补充）
- 改档后跑 `pytest tests/test_claude_md*.py -v`（CLAUDE.md 对账三卫）确认指针一致
