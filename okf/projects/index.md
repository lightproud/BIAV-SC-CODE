# 入口文档 + 子项目上下文 + 藏宝图 + 设计/工程文档 (28)

仓库最高权威入口（CLAUDE.md / README.md）+ 各子项目 CONTEXT.md（动手前必读）+ RELEASES.md 藏宝图 + silver-core-sdk/site 设计文档 + 工程文档 + 归档注册表的导航指针。

## 概念

* [CLAUDE.md（AI 统一入口 · 运行时强约束权威）](/projects/entry-claude-md.md) - 银芯是黑池的「眼睛和耳朵」：采集 + 整理外部信息往黑池送，黑池吃完不吐回。
* [README.md（人 + AI 共用主入口）](/projects/entry-readme.md) - 忘却前夜（忘卻前夜 / Morimens）的**社区知识平台 + 黑池信息入口**。本仓库由忘却前夜官方授权制作人维护，引用公开可查阅的游戏资料。
* [news 子项目上下文](/projects/project-news.md) - **news = 银芯二核心使命之 #1「黑池信息入口」核心载体**
* [wiki 子项目上下文](/projects/project-wiki.md) - **原定位：银芯使命#2「社区共建知识底座」核心载体——该使命已于 2026-07-12 取消，
* [site 子项目上下文](/projects/project-site.md) - **site = 银芯使命对外门户 / 三轴（site·news·wiki）发现入口**（非任一单一使命的载体；使命#2「社区共建知识底座」载体为 wiki，见
* [game 子项目上下文](/projects/project-game.md) - **game = 守密人个人兴趣项目（主）+ 未来扩展可能 ⓐⓒ（备）**
* [silver-core-sdk 子项目上下文](/projects/project-silver-core-sdk.md) - Silver Core SDK：独立重实现（independent reimplementation）的 TypeScript agent 框架，公开调用面
* [silver-core-sdk ARCHITECTURE](/projects/silver-core-sdk-doc-architecture.md) - Independent agent harness with a `@anthropic-ai/claude-agent-sdk`-compatible
* [silver-core-sdk COMPAT](/projects/silver-core-sdk-doc-compat.md) - Target surface: `@anthropic-ai/claude-agent-sdk` public API (npm 0.3.207; chased
* [silver-core-sdk CONCURRENCY](/projects/silver-core-sdk-doc-concurrency.md) - The SDK supports true parallelism at three levels: **many conversations** over
* [silver-core-sdk ERRORS](/projects/silver-core-sdk-doc-errors.md) - Every error class in `src/errors.ts` carries a machine-readable, stable
* [silver-core-sdk MEMORY-GOVERNANCE](/projects/silver-core-sdk-doc-memory-governance.md) - Archived requirements + implementation record for the 2026-07-11 keeper
* [silver-core-sdk MEMORY](/projects/silver-core-sdk-doc-memory.md) - Cross-session memory for agents: a `memory_20250818`-equivalent six-command
* [silver-core-sdk MIGRATION-0.3x-to-0.52](/projects/silver-core-sdk-doc-migration-0-3x-to-0-52.md) - Audience: a consumer (BPT Desktop) pinned on the **0.3x tarball line**
* [silver-core-sdk MIGRATION](/projects/silver-core-sdk-doc-migration.md) - Audience: the BPT Desktop (Electron) codebase currently importing the official
* [silver-core-sdk ONBOARDING](/projects/silver-core-sdk-doc-onboarding.md) - Goal: get a new maintainer from zero to "I can make a change safely and prove
* [silver-core-sdk OPENAI-PROTOCOL](/projects/silver-core-sdk-doc-openai-protocol.md) - The SDK can drive an **OpenAI-compatible Chat Completions endpoint** instead of
* [silver-core-sdk PERFORMANCE](/projects/silver-core-sdk-doc-performance.md) - What the SDK controls about response time, what it already does by default,
* [silver-core-sdk POSITIONING](/projects/silver-core-sdk-doc-positioning.md) - **Silver Core SDK = 一套稳定兼容的调用「表面」 + 一个我们完全掌控、比原版更简单更可靠的独立「引擎」。**
* [silver-core-sdk REPORTING](/projects/silver-core-sdk-doc-reporting.md) - The signal side of the self-improvement loop: runs leave a facts-only ledger,
* [silver-core-sdk RESILIENCE](/projects/silver-core-sdk-doc-resilience.md) - Audience: consumers running this SDK over imperfect links (corporate
* [silver-core-sdk SUBAGENTS](/projects/silver-core-sdk-doc-subagents.md) - Goal: wire a host (BPT) to the SDK's subagent surface the way Claude Code uses
* [silver-core-sdk TOOL-PARITY](/projects/silver-core-sdk-doc-tool-parity.md) - Why this file exists: the SDK reproduces the **Claude Code CLI agent** tool
* [site design · morimens-design-system-guide.html](/projects/site-design-morimens-design-system-guide.md) - site 设计系统权威（morimens-design-system-guide.html，21.2KB）：设计令牌 / 组件规范来源。
* [site design · morimens-design-tokens.css](/projects/site-design-morimens-design-tokens.md) - site 设计系统权威（morimens-design-tokens.css，6.7KB）：设计令牌 / 组件规范来源。
* [archive_sources.json（归档注册表）](/projects/news-archive-sources-registry.md) - T2 数据层归档声明式注册表：哪些来源归档到哪、如何驱逐（archive_engine 读它干活）。
* [Releases 藏宝图](/projects/releases-treasure-map.md) - 合并自 art-assets-v2 + audio-assets-v1 + audio-raw-v1 + video-assets-v1 + （2026-06
* [测试策略](/projects/doc-testing-strategy.md) - 银芯的测试不靠单一数字护城。三层护栏各管一件事，互相补盲：
