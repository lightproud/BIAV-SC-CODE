---
title: "**改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）"
category: "全局"
date: "2026-04-14"
---

# **改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）

**影响范围**：全局 / bpt-next

## 决策内容

**改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）。**守密人明示接受版权风险**：上游无 LICENSE 文件，默认 All Rights Reserved；仅限 BIAV 内部使用，禁止外部推广。occ-local 保留作为 MIT 合规备选。旧设计文档 memory/bpt-next-design.md 已加封存头注。引入实施见 projects/bpt-next/NOTICE 与 CONTEXT.md

---

*本文件由 Code-主控台 subagent 从 `memory/decisions.md` 自动拆分，未经艾瑞卡定稿。*
