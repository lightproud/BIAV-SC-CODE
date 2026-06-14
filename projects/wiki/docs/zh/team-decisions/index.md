---
title: 团队决策事实
layout: page
---

# 团队决策事实

> 档案编号：BIAV-SC / team-decisions
>
> 数据来源：`memory/decisions.md`（艾瑞卡自动归档）
>
> 当前收录：**66 条**（全局 41 / 子项目 25）

艾瑞卡状态报告：本索引由银芯记忆系统周期扫描 `memory/decisions.md` 自动生成，每条档案含「决策编号 / 标题 / 影响范围 / 日期 / 决策内容」五个字段。维护原则——**只追加，不改写**；历史决策作废时以新编号记录反向决策（如 027 作废 026），便于守密人回溯决策演化轨迹。

## 全局决策

> 影响所有子项目的架构/流程/方针决策。

| 编号 | 标题 | 日期 |
| ---: | :--- | :--- |
| 001 | [建立多会话协作架构（职责隔离）](./001-multi-session-architecture.md) | 2026-04-14 |
| 002 | [目录按 memory/assets/projects 重组](./002-directory-reorg.md) | 2026-04-14 |
| 003 | [各子项目按需选择技术栈](./003-subproject-tech-stack.md) | 2026-04-14 |
| 004 | [项目完全开源](./004-mit-license.md) | 2026-04-14 |
| 005 | [游戏内容版权归脑缸组](./005-game-content-copyright.md) | 2026-04-14 |
| 006 | [仓库定位为\"共享外脑 + 中转站\"（Code 生产](./006-shared-external-brain.md) | 2026-04-14 |
| 007 | [子项目保持单仓库](./007-single-repo.md) | 2026-04-14 |
| 008 | [项目正式命名为「缸中之脑计划」](./008-project-naming.md) | 2026-04-14 |
| 009 | [架构定义为前台/中台/后台三层（claude.ai → Claude Code → GitHub）](./009-three-layer-architecture.md) | 2026-04-14 |
| 010 | [建立交付物视觉规范 style-guide.md](./010-style-guide.md) | 2026-04-14 |
| 011 | [引入 lessons-learned 踩坑记录](./011-lessons-learned.md) | 2026-04-14 |
| 012 | [引入 Plan/Execute 任务标注约定（未标注默认「直接执行」）](./012-plan-execute-convention.md) | 2026-04-14 |
| 013 | [创建 .claude/commands/ 可复用工作流](./013-claude-commands.md) | 2026-04-14 |
| 014 | [各 CONTEXT.md 添加验证清单](./014-context-md-checklist.md) | 2026-04-14 |
| 015 | [引入 Claude Code GitHub Actions（Issue 驱动自动化）](./015-claude-code-github-actions.md) | 2026-04-14 |
| 016 | [Issue 安全策略：只执行 author:lightproud](./016-issue-security.md) | 2026-04-14 |
| 017 | [Issue 生命周期闭环管理（WIP 上限 3 个/子项目 + 创建前查重）](./017-issue-lifecycle.md) | 2026-04-14 |
| 018 | [所有会话直接推 main，不用分支](./018-push-main-directly.md) | 2026-04-14 |
| 019 | [大文件暂不外迁](./019-large-file-in-git.md) | 2026-04-14 |
| 020 | [模型使用分层策略：判断层 Opus(Extended)](./020-model-tier-strategy.md) | 2026-04-14 |
| 021 | [前台专岗不固定编制](./021-flex-front-posts.md) | 2026-04-14 |
| 022 | [缸中之脑方向确认为方法论验证（交付物必须可用）](./022-methodology-direction.md) | 2026-04-14 |
| 023 | [main 分支添加 Ruleset 保护规则（禁止删除）](./023-main-branch-ruleset.md) | 2026-04-14 |
| 024 | [双系统架构：银芯（受限层）+ 黑池（内部层）](./024-dual-system-architecture.md) | 2026-04-14 |
| 025 | [引入 occ-local 子项目：基于 ruvnet/open-claude-code (MIT) 的本地 Claude Code CLI](./025-occ-local-intro.md) | 2026-04-14 |
| 026 | [BPT 新一代基于 occ-local 重建：采用路径 B（平行新建 projects/bpt-next/）+ Electron + React UI（继承 bpt/bpt-desktop）+ 最终收敛为单一 BPT（bpt / bpt-web / bpt-desktop 归档 archive/）](./026-bpt-next-on-occ-local.md) | 2026-04-14 |
| 027 | [**改道决策**（2026-04-14 当日作废上一条）：深入核实 claw-code（instructkr/claw-code）后发现其本地模型 + 多 provider 能力超 occ-local（Ollama 开箱即用 / 5 层配置链 / 模型前缀路由 / proxy 原生 / xAI+DashScope+OpenRouter），故 bpt-next 改基于 claw-code 打造（Rust 48K 行）](./027-bpt-next-reroute-to-claw-code.md) | 2026-04-14 |
| 028 | [**许可证评估修正**（2026-04-14 当日修正上一条的\"无 LICENSE\"假设）：构建验证时核查发现 rust/Cargo.toml `[workspace.package] license = \"MIT\"`，9 crate 全部 `license.workspace = true` 继承，rust/README 有 License 节](./028-license-assessment-correction.md) | 2026-04-14 |
| 029 | [**构建与诊断验证**（2026-04-14）：`cargo build --workspace` 成功，耗时 51.71 秒，产物 claw CLI 148M](./029-build-and-diagnostic-verification.md) | 2026-04-14 |
| 030 | [**occ-local 降级为研究归档**（2026-04-14）：守密人原话\"occ 这件事就忘了吧，我们现在基于 claw-codes\"](./030-occ-local-downgrade-to-archive.md) | 2026-04-14 |
| 031 | [**Phase B 4 答案锁死**（2026-04-14）：(1) 无账号用户识别 = 与 SVN 账号名一致](./031-phase-b-four-answers.md) | 2026-04-14 |
| 032 | [**双系统亚哈格分**（2026-04-14）：银芯 = 孵化器 + 开源子项目 + 公开资料；黑池（内网 SVN）= 五大需求的数据与代码主体](./032-dual-system-yahag-split.md) | 2026-04-14 |
| 033 | [**黑池记忆走银芯自建+母版迁移**（2026-04-14）：守密人原话\"完善银芯自建，使其拥有 claude-mem 的能力，然后作为母版迁移到黑池\"](./033-blackpool-memory-via-silver.md) | 2026-04-14 |
| 034 | [**外部工具方针锁定**（2026-04-14）：graphify（MIT）Phase A vendor 到 projects/graphify-ext/ 作黑池索引工具原型；claude-mem（AGPL-3.0）完全不引入](./034-external-tools-policy.md) | 2026-04-14 |
| 035 | [银芯事实圣经边界：仅收录公开可查阅信息](./035-silver-fact-bible-scope.md) | 2026-04-14 |
| 036 | [战略规划 2026：四阶段计划](./036-strategic-plan-2026.md) | 2026-04-14 |
| 037 | [黑池已上线（2026-04-03）](./037-blackpool-online.md) | 2026-04-14 |
| 038 | [大二进制文件移至 GitHub Releases（不入 git）](./038-large-binary-to-releases.md) | 2026-04-14 |
| 039 | [架构差距分析 + 8 项改进批量实施（JSON Schema、冒烟测试、Dependabot 等）](./039-architecture-gap-improvements.md) | 2026-04-14 |
| 040 | [做梦 Agent 三层架构：浅睡(3h,Actions)→深睡(每天,Claude)→REM(每周,Claude)](./040-dreaming-agent-three-layer.md) | 2026-04-14 |
| 041 | [品牌统一：银芯=BIAV-SC，黑池=BIAV-BP](./041-brand-unified-biav-sc-bp.md) | 2026-04-14 |

## 子项目决策

> 仅影响单一子项目（Wiki / News / Site / BPT 等）的技术与数据决策。

| 编号 | 标题 | 日期 |
| ---: | :--- | :--- |
| 042 | [合并 database 和 wiki 为单一 wiki 子项目](./042-merge-database-wiki.md) | 2026-04-14 |
| 043 | [主站导航页 + 子路径多站点方案（根路径主站](./043-site-subpath-architecture.md) | 2026-04-14 |
| 044 | [部署方式：peaceiris/actions-gh-pages 推 gh-pages 分支](./044-gh-pages-deploy.md) | 2026-04-14 |
| 045 | [Wiki 中文设为 root locale + rewrites](./045-wiki-zh-root-locale.md) | 2026-04-14 |
| 046 | [界域 ID 标准化（aequor/caro/ultra）](./046-realm-id-standard.md) | 2026-04-14 |
| 047 | [角色职能标准化（attack/sub_attack/defense/support/chorus）](./047-role-function-standard.md) | 2026-04-14 |
| 048 | [角色 ID 从拼音改为英文 slug](./048-character-id-english-slug.md) | 2026-04-14 |
| 049 | [Wiki 删除 tier 评级数据](./049-wiki-remove-tier.md) | 2026-04-14 |
| 050 | [整合 content_database 技能到 characters.json](./050-integrate-content-database-skills.md) | 2026-04-14 |
| 051 | [立绘图片存仓库（assets/images/portraits/）](./051-portraits-in-repo.md) | 2026-04-14 |
| 052 | [建立 7 脚本自动化数据抓取体系（Fandom + Steam API）](./052-wiki-fandom-steam-scraper.md) | 2026-04-14 |
| 053 | [Wiki 引入 Vue 交互组件（11 个）](./053-wiki-vue-components.md) | 2026-04-14 |
| 054 | [自动生成角色详情页（generate_pages.py](./054-wiki-auto-generate-pages.md) | 2026-04-14 |
| 055 | [添加 SEO 优化（Schema.org + OG + sitemap）](./055-wiki-seo-optimization.md) | 2026-04-14 |
| 056 | [版本更新自动检测 + RSS 订阅](./056-wiki-version-check-rss.md) | 2026-04-14 |
| 057 | [News 采集管线统一方案（先统一 JSON schema](./057-news-unified-schema.md) | 2026-04-14 |
| 058 | [新增 Code-site 子项目（部署流水线 + 跨站前端）](./058-new-code-site.md) | 2026-04-14 |
| 059 | [Discord 数据分级存储架构（git 保留 60 天 JSONL + 月归档至 Releases）](./059-discord-tiered-storage.md) | 2026-04-14 |
| 060 | [Discord 归档系统 4 项技术决策（断点续传、月报容错、论坛增量、无成员 Intent）](./060-discord-archive-4-decisions.md) | 2026-04-14 |
| 061 | [联动关键词确认：沙耶之歌 (Saya no Uta)](./061-news-collab-keyword-saya.md) | 2026-04-14 |
| 062 | [BPT 用 sql.js 替代 better-sqlite3（消除 Windows C++ 编译依赖）](./062-bpt-sql-js-replace-better-sqlite3.md) | 2026-04-14 |
| 063 | [BPT 自带独立 MCP Server（同构复刻银芯 11 工具](./063-bpt-independent-mcp-server.md) | 2026-04-14 |
| 064 | [BPT Server 变更检测用文件 mtime 扫描替代 git diff/log](./064-bpt-server-mtime-scan.md) | 2026-04-14 |
| 065 | [BPT 不依赖 brain-in-a-vat 仓库](./065-bpt-independent-svn-deploy.md) | 2026-04-14 |
| 066 | [银芯社区数据单向同步到 BPT（银芯 -> 脱敏 -> BPT）](./066-silver-to-bpt-one-way-sync.md) | 2026-04-14 |
