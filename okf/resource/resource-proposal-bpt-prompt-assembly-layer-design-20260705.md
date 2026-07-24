---
type: "documentation"
title: "bpt-prompt-assembly-layer-design-20260705"
description: "bpt-agent-sdk 是官方 Claude Code / Claude Agent SDK 的干净重实现（clean-room reimplementation）。它的 agent-loop 要向模型发系统提示词。官方的系统提示词**不是一根字符串**——上游 README 明确写「Claude Code doesn't just have one single string」。它是一个**片段库（fragment store）**：553 个带 HTML 注释头的 m（格式：md）"
resource: "/Public-Info-Pool/Resource/proposal/bpt-prompt-assembly-layer-design-20260705.md"
tags: ["data_layer:curated", "deliverable", "topic:proposal"]
timestamp: "2026-07-24"
---

# 指针概念

> 放指针不放本体：本体权威在 `Public-Info-Pool/Resource/proposal/bpt-prompt-assembly-layer-design-20260705.md`，本 concept 仅描述与定位、不复刻正文。

- 本体路径：`Public-Info-Pool/Resource/proposal/bpt-prompt-assembly-layer-design-20260705.md`
- 摘要：bpt-agent-sdk 是官方 Claude Code / Claude Agent SDK 的干净重实现（clean-room reimplementation）。它的 agent-loop 要向模型发系统提示词。官方的系统提示词**不是一根字符串**——上游 README 明确写「Claude Code doesn't just have one single string」。它是一个**片段库（fragment store）**：553 个带 HTML 注释头的 m（格式：md）
- 标签：data_layer:curated · deliverable · topic:proposal
