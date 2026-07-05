# 入口文档 + 子项目上下文 + 藏宝图 + 设计/工程文档 (18)

仓库最高权威入口（CLAUDE.md / README.md）+ 各子项目 CONTEXT.md（动手前必读）+ RELEASES.md 藏宝图 + bpt-agent-sdk/site 设计文档 + 工程文档 + 归档注册表的导航指针。

## 概念

* [CLAUDE.md（AI 统一入口 · 运行时强约束权威）](/projects/entry-claude-md.md) - 银芯是黑池的「眼睛和耳朵」：采集 + 整理外部信息往黑池送，黑池吃完不吐回。
* [README.md（人 + AI 共用主入口）](/projects/entry-readme.md) - 忘却前夜（忘卻前夜 / Morimens）的**社区知识平台 + 黑池信息入口**。本仓库由忘却前夜官方授权制作人维护，引用公开可查阅的游戏资料。
* [news 子项目上下文](/projects/project-news.md) - **news = 银芯二核心使命之 #1「黑池信息入口」核心载体**
* [wiki 子项目上下文](/projects/project-wiki.md) - **wiki = 银芯二核心使命之 #2「社区共建知识底座」核心载体**（CLAUDE.md §1.2）。
* [site 子项目上下文](/projects/project-site.md) - **site = 银芯使命对外门户 / 三轴（site·news·wiki）发现入口**（非任一单一使命的载体；使命#2「社区共建知识底座」载体为 wiki，见
* [game 子项目上下文](/projects/project-game.md) - **game = 守密人个人兴趣项目（主）+ 未来扩展可能 ⓐⓒ（备）**
* [bpt-agent-sdk 子项目上下文](/projects/project-bpt-agent-sdk.md) - BPT Agent SDK：独立重实现（independent reimplementation）的 TypeScript agent 框架，公开调用面
* [bpt-agent-sdk ARCHITECTURE](/projects/bpt-sdk-doc-architecture.md) - Independent agent harness with a `@anthropic-ai/claude-agent-sdk`-compatible
* [bpt-agent-sdk COMPAT](/projects/bpt-sdk-doc-compat.md) - Target surface: `@anthropic-ai/claude-agent-sdk` public API (npm 0.3.201; chased
* [bpt-agent-sdk MIGRATION](/projects/bpt-sdk-doc-migration.md) - Audience: the BPT Desktop (Electron) codebase currently importing the official
* [bpt-agent-sdk POSITIONING](/projects/bpt-sdk-doc-positioning.md) - **BPT Agent SDK = 一套稳定兼容的调用「表面」 + 一个我们完全掌控、比原版更简单更可靠的独立「引擎」。**
* [site design · morimens-design-system-guide.html](/projects/site-design-morimens-design-system-guide.md) - site 设计系统权威（morimens-design-system-guide.html，21.2KB）：设计令牌 / 组件规范来源。
* [site design · morimens-design-tokens.css](/projects/site-design-morimens-design-tokens.md) - site 设计系统权威（morimens-design-tokens.css，6.7KB）：设计令牌 / 组件规范来源。
* [archive_sources.json（归档注册表）](/projects/news-archive-sources-registry.md) - T2 数据层归档声明式注册表：哪些来源归档到哪、如何驱逐（archive_engine 读它干活）。
* [Releases 藏宝图](/projects/releases-treasure-map.md) - 合并自 art-assets-v2 + audio-assets-v1 + audio-raw-v1 + video-assets-v1 + （2026-06
* [测试策略](/projects/doc-testing-strategy.md) - 银芯的测试不靠单一数字护城。三层护栏各管一件事，互相补盲：
* [解包提取说明](/projects/extracted-lua-readme.md) - **不能保证 639 份 archive 脚本全部覆盖。** 原因：
* [解包 lua 清单](/projects/extracted-lua-inventory.md) - 逐条列 .luac 本体位置的清单（1608 条），字节码本体在 Releases「解包」桶。
