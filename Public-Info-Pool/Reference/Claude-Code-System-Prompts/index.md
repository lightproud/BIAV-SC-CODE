# Claude Code System Prompts — 外部参照归档

BPT 4R `Reference` 层子目录。**外部公开参照材料**（非银芯原创、非可执行源码），
供 AI 协作层（§1.4 记忆层 / 人格与编排）研习提示词工程之用。

> 本文件由 `scripts/refresh_claude_code_prompts.py` 自动生成 / 更新（勿手改版本表；
> 定时刷新见 `.github/workflows/refresh-claude-code-prompts.yml`）。

## 来源（provenance）

| 项 | 值 |
|----|----|
| 上游仓库 | [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) |
| 维护方 | Piebald AI（**非 Anthropic 官方**；由脚本从 `@anthropic-ai/claude-code` npm 编译产物提取） |
| 采集版本 | Claude Code v2.1.201 |
| 上游 commit | `8879268967dda843de616ebcb25470012556c2c1` |
| 上游 commit 日期 | 2026-07-03 |
| 许可证 | MIT（Copyright (c) 2025 Piebald LLC）——见同目录 `LICENSE`，再分发须随附 |

## 内容清单

- `system-prompts/`：**553** 份 markdown，每份含 YAML frontmatter（标注 Claude Code 版本 + 模板变量）。
  覆盖主循环系统提示、各子代理（explore / general-purpose / plan / code-review 多段 / security-review 等）、
  工具描述、会话摘要 / 标题生成 / 记忆挑选等编排环节的提示词。
- `README.md`：上游目录 + 逐提示词 token 计数总表。
- `CHANGELOG.md`：多版本（自 v2.0.14 起）的提示词变更史。
- `UPSTREAM-CLAUDE.md`：上游自带的 CLAUDE.md（**已改名**，原名 `CLAUDE.md`——为防被银芯指令层
  误当项目指令自动加载而重命名，内容未改，供审阅上游对本材料的定性说明）。
- `LICENSE`：MIT 全文。

## 为何归档进银芯

- **学习标的**：Claude Code 的提示词分层（主循环 / 子代理 / 工具描述 / 编排环节）是成熟的
  「神经符号白盒编排」样本，与银芯知识层北极星（`memory/knowledge-layer-design.md`）的
  提示词 / 人格 / 动态编排投资方向同域，可作对照参照。
- **公开信息**：整份材料来源为公开 GitHub 仓库 + MIT 许可，符合银芯公开信息层定位（§0）。

## 硬约束对齐

- **仅参照、不引为运行时约束**：本目录是「资料体」，银芯自身的运行时强约束仍以根 `CLAUDE.md`
  自动加载层 + 工具层为准（§5.3）。此处任何 markdown 都是弱约束参照，不改变艾瑞卡人格或银芯行为。
- **单向、无黑池**：本材料自公开渠道单向采入银芯（使命#1 采集层同向），与黑池防火墙（§1.1-HC）无涉，
  未触碰任何内部 / 黑池数据。

## 刷新方式（定期更新）

定时 CI（每周一次）自动执行 `scripts/refresh_claude_code_prompts.py`：浅克隆上游 →
同步进本目录（剥离 `.git`、保护本 `index.md`）→ 改名 `UPSTREAM-CLAUDE.md` →
重生成本 provenance 表 → 有变化才 `[skip ci]` 提交。手动刷新亦可直接跑该脚本。
