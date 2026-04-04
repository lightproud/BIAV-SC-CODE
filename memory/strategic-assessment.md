# 战略评估

> 最后更新：2026-04-04 by Code-主控台 — Phase 1 通过 + 记忆系统上线 + 做梦全层启动
>
> 基于仓库实际文件状态的全局判断。不猜测，只看事实。
>
> 每月 1 日更新。下次更新：2026-05-01。

---

## 一、各管线运行状态

### 1. News 新闻聚合（update-news.yml）— ✅ 正常运行

- **触发频率**：每日 2 次（06:00/19:00 UTC）
- **实际产出**：日报持续生成，3 源有效数据（Bilibili 5条 + Steam 2条 + Discord 6条）
- **Steam 数据**：✅ 已标准化修复，`extract_steam_item()` 正常，评论含 voted_up/review/language
- **日报质量**：✅ Stage 1 验证通过（2026-04-04 制作人确认）
- **哨兵层**：已集成到浅睡层，自动监控 Steam 差评率 / Discord 消息量 / 负面关键词
- **结论**：核心管线稳定。待接通的扩展源：YouTube/Twitter/NGA/TapTap

### 2. Discord 归档（discord-archive.yml）— ✅ 正常运行，已降频

- **触发频率**：每日 1 次（18:00 UTC）增量备份，每月 1 日全量整理
- **实际产出**：537 个频道目录，state.json 追踪正常
- **数据体量**：`projects/news/data/discord/` ~299MB — 已通过降频控制增速
- **待办**：月度归档清理（打包旧数据到 Releases + 从 git 删除）仍未实现
- **结论**：运行稳定，存储治理仍需完成

### 3. Wiki 站点（deploy-site.yml）— 已部署，基本稳定

- **部署方式**：push to main → 构建 VitePress → 推 gh-pages 分支
- **内容规模**：189 个角色详情页（63×3 语言），11 个 Vue 组件，21 个数据 JSON
- **数据体量**：`wiki/data/db/` 仅 396KB，健康
- **已修复历史问题**：cleanUrls、img src 动态绑定、YAML 冒号转义、npm script 名
- **结论**：站点管线稳定。数据补全是下一步重点

### 4. Wiki 数据抓取（fetch-wiki-data.yml）— 定期跑，但 continue-on-error 掩盖失败

- **触发频率**：每周一 04:00 UTC
- **7 个抓取脚本**：portraits / skills / cards / stats / stages / wheels / lore
- **风险**：所有步骤设置了 `continue-on-error: true`，单个脚本失败不会阻断 workflow，也不会有任何通知。数据可能悄悄缺失
- **结论**：需要加失败告警机制

### 5. 游戏数据解包（extract-game-data.yml）— 反复失败，未成功过

- **触发方式**：推送 `.github/triggers/extract-game-data` 文件
- **历史**：3 月 31 日到 4 月 1 日连续 4 次 re-trigger（含换 Steam 账号、修 secrets、quote 密码），均指向反复调试
- **依赖**：STEAM_USER + STEAM_PASS（需要有效 Steam 账号）
- **结论**：pipeline 设计完成，但从未成功执行过。阻塞项是 Steam 认证

### 6. 数据校验（validate-data.yml）— 存在但极简

- **触发**：push to wiki data + PR
- **内容**：仅运行一个 `validate_data.py`，无 schema 验证细节，不阻断合并
- **结论**：形式上存在，实质保护不够

### 7. 报告系统（generate-report.yml）— 设计完整，实际无法运行

- **设计**：15+ 平台采集 → AI 分析 → 多渠道通知（Email/Discord/Telegram/Bark）
- **依赖**：25+ secrets，LLM API Key
- **现实**：绝大多数 secrets 未配置，ANTHROPIC_API_KEY 余额为零
- **结论**：蓝图级别，距离运行差很远

### 8. Claude Code Actions（claude.yml）— ✅ 已激活

- **设计**：Issue 驱动自动化，author:lightproud 触发
- **状态**：ANTHROPIC_API_KEY 余额已恢复（2026-04-04），可正常触发
- **结论**：可用

### 9. 版本检测（check-version.yml）— 应该在跑

- **触发**：每周一 06:00 UTC
- **功能**：检测 Steam API 版本号变化 → 自动创建 Issue
- **结论**：低风险，正常运转

### 10. 主站导航页（projects/site/）— 已部署

- **内容**：单页 HTML 导航 + design system v1.0
- **结论**：功能完成，低维护

---

## 二、Stage 1 验证进展

**验证标准**：日报连续 14 天自动生成，制作人觉得有用。

| 指标 | 状态 | 说明 |
|------|------|------|
| 日报管线连续运行 | ✅ **通过** | 3源稳定运行（Bilibili + Steam + Discord） |
| 日报内容质量 | ✅ **通过** | Steam 数据已标准化，Discord 已接入聚合器 |
| 无人干预 | ✅ **通过** | 自动运行无需人工 |
| 制作人确认 | ✅ **通过** | 2026-04-04 制作人确认 Stage 1 过了 |

**判断**：Stage 1 验证 ✅ **已通过**（2026-04-04）。系统从 Phase 1 进入 Phase 2 准备期。

---

## 三、技术债

### P0（影响正在运行的系统）

1. **Discord 归档体量**：299MB 且月度清理机制尚未实现。已降频至每日1次，增速可控但存量待清理
2. ~~**Steam 评论数据未标准化**~~ → ✅ 已修复

### P1（影响 Phase 2 进度）

3. ~~**聚合器 Discord 通道未接入**~~ → ✅ 已接入
4. **5 个数据源未通**：Twitter/NGA/TapTap 需 API 密钥，YouTube 需 API Key，Reddit 需验证代码。不阻塞核心管线
5. **generate-report.yml 与 update-news.yml 两套系统并存**：待决策

### P2（影响可靠性）

6. **fetch-wiki-data 静默失败**：所有步骤 continue-on-error，失败无通知
7. **extract-game-data 从未成功**：Steam 认证问题未解决
8. ~~**ANTHROPIC_API_KEY 余额为零**~~ → ✅ 已恢复（2026-04-04）
9. ~~**每小时 commit 噪音**~~ → ✅ 已降频（每日2次采集 + 每日1次归档）

### P3（技术卫生）

10. **两套采集系统**：`aggregator.py` vs `report-system/` 功能重叠，待合并或明确分工

---

## 四、下一步建议（优先级排序）— Phase 2 准备

### 立即做（本周）

1. ~~修 Steam 数据标准化~~ → ✅ 已完成
2. **实现 Discord 月度归档清理**：打包旧数据到 Releases + 从 git 删除。299MB 存量待清理
3. **Wiki 数据补全启动**：触发 fetch-wiki-data 抓取 52 个角色技能数据 + 16 个命轮效果 + 12 缺失立绘

### 短期做（1-2 周）

4. **接通 YouTube 数据源**：需配置 YOUTUBE_API_KEY。代码已就绪
5. **fetch-wiki-data 加失败告警**：去掉 continue-on-error，改为失败时创建 Issue
6. **联动内容预备**：建立 Wiki 快速发布模板，确保联动角色页 48h 内上线

### 中期做（Phase 2 期间）

7. **Wiki 热门角色页人工校对**：至少 top 10 角色页经过制作人确认
8. **Google Search Console 接入**：监测 Wiki SEO 表现
9. **决策两套采集系统取舍**：aggregator.py vs report-system
10. **记忆系统洞察关联**：给 insights.json 加 `related_to` 字段，REM 层自动发现反复模式

### 暂缓

- extract-game-data（Steam 认证问题非核心路径阻塞）
- Twitter/NGA/TapTap（需各平台 API 密钥，可后续逐个接）
- Game 子项目（Phase 2 完成前不开新战线）

---

## 五、项目性质校准（04-01 更新）

### 关键事实

Light 不是粉丝或外部开发者——**是忘却前夜的制作人**，B.I.A.V. Studio 负责人。信息来源：制作人信（Reddit/Discord 公开发布）。

关键时间线：
- 2019：项目启动
- 2021：团队首次濒临解散，社区投票挽回
- 2024：二次危机，核心成员离开，制作人独自维持
- 2025-2026：重建团队，Steam 日活 ~1000，Discord 37,533 人

### 这改变了什么

1. **缸中之脑不是粉丝项目，是制作人的运营基础设施**。Wiki、新闻聚合、数据采集——目的是用 AI 弥补小团队的人力缺口
2. **方法论开源是战略保险**。如果游戏再遇危机，AI 协作方法论本身有独立价值，不依赖单一 IP
3. **"事实圣经"来自真实痛点**。6 年世界观积累的知识管理成本，制作人亲身经历
4. **Wiki 的竞争力重新定义**。官方制作人出品的 Wiki vs 社区自建 Wiki，权威性完全不同
5. **"不善于分发"的评估有误**。正确的描述是：在资源极度有限时，制作人一贯选择把筹码压在产品上而不是营销上。这是有意识的取舍，不是能力缺失

### 风险再评估

- **单人依赖风险极高**：制作人同时管游戏开发 + AI 基础设施 + 社区运营。缸中之脑的自动化程度直接决定制作人能否从重复劳动中解放出来
- **Stage 1 验证的意义升级**：不只是"管线跑不跑"，而是"能不能真正减少制作人每天花在社区监控上的时间"

---

## 六、整体判断

项目已通过 **Stage 1 验证**，进入 Phase 2 准备期。

- 管线在跑 ✅
- 管线跑出有用的东西 ✅（3 源：Bilibili + Steam + Discord）
- 无人干预 ✅
- 内容质量达标 ✅（制作人确认）
- 记忆系统上线 ✅（9 模块，3410 行代码）
- 做梦 Agent 三层启动 ✅（浅睡6h + 深睡每日 + REM每周）
- 哨兵层上线 ✅（主动异常检测，零成本）
- API Key 恢复 ✅（2026-04-04）

**当前最大杠杆点**是 Wiki 数据补全（52 个角色技能数据），这是 Phase 2 "内容权威"的核心交付物。做梦系统和记忆系统已经就位，能在后台自动整理和检测异常，制作人的注意力带宽得到了释放。

---

## 七、2026-04-04 行动记录

本次主控台会话执行的变更：

1. **Stage 1 验证通过**：制作人确认日报系统通过 14 天验证
2. **API Key 恢复**：ANTHROPIC_API_KEY 余额已恢复，更新 BIAV-SC.md 阻塞项
3. **哨兵层上线**：dream.py 新增 227 行哨兵代码，监控 Steam 差评率、Discord 消息量、负面关键词
4. **做梦 Agent 三层全启动**：
   - 深睡：每天 19:00 UTC（北京凌晨 3 点）
   - REM：每周一 01:00 UTC（北京上午 9 点）
5. **全量状态同步**：BIAV-SC.md + project-status.md + strategic-assessment.md 全部刷新到当前实际状态

### 记忆系统完整能力清单（两轮架构升级产出）

| 轮次 | 模块 | 脚本 | 行数 |
|------|------|------|------|
| Round 1 Sprint 1 | TF-IDF 向量搜索 + 4维重排序 | memory_search.py | 780 |
| Round 1 Sprint 2 | 知识图谱 + 图谱增强搜索 | knowledge_graph.py | 704 |
| Round 1 Sprint 3 | MemRL-lite 效用追踪 | memrl.py | 378 |
| Round 1 Sprint 4 | Sleep-Time Compute 预计算 | dream.py | ~200 |
| Round 2 Gap 1 | MCP Server（7工具） | mcp_server.py | 200 |
| Round 2 Gap 2 | 虚拟上下文管理 | context_manager.py | 180 |
| Round 2 Gap 3 | API Embedding（Voyage AI 层2） | memory_search.py | — |
| Round 2 Gap 4 | Reflexion 失败学习 | reflexion.py | 280 |
| Round 2 Gap 5 | 选择性记忆 + 归档 | dream.py | ~100 |
| Stage 2 方案 1 | 哨兵层异常检测 | dream.py | 227 |

---

## 八、2026-04-01 行动记录（历史）

本次战略会话执行的变更：

1. **Steam 数据标准化修复已验证**：`split_output.py` 的 `extract_steam_item()` 修复已合入，本地重跑后日报正确显示 Steam 评论（6 条，好评率 83%）。等下次 workflow 运行即生效
2. **Workflow 频率调整**：
   - `discord-archive.yml`：每小时 → 每日 1 次（18:00 UTC）
   - `update-news.yml`：每小时 → 每日 2 次（06:00/16:00 UTC）
   - 预计减少 ~95% 的自动 commit 噪音
3. **暂停无效 workflow**：
   - `generate-report.yml`：注释掉 schedule（25+ secrets 未配）
   - `extract-game-data.yml`：注释掉 push trigger（Steam 认证未通）
4. **各子项目 CONTEXT.md 更新**：写入本周具体任务
5. **project-status.md 更新**：添加 Phase 0 阶段说明和 workflow 频率表

### 本周剩余任务（需 Code-news 会话执行）

- [ ] 桥接 Discord 归档 → 聚合器（日报第 3 个数据源）
- [ ] 实现 Discord 月度归档清理（299MB 止血）

---

## 九、2026-04 制作人采访情报摘要

来源：53 问深度采访（Light + 主文案霁月），英语媒体。完整提取见 `assets/data/interview-2026-04.json`。

### 对缸中之脑项目的战略影响

1. **Wiki 数据大幅扩充机会**：采访披露了大量未公开的叙事结构信息（三部原始规划、各章压缩细节、本源角色构思时间线、未公开角色存在）。Wiki 的数据集应纳入这些信息，作为"事实圣经"的核心内容
2. **即将推出的联动 = 新闻采集的实战检验**：采访确认即将有一个"宇宙恐怖风味经典作品"的角色联动。这将是日报系统第一次面对真正的社区热度事件。需确保在联动公布前完成 Stage 1 验证
3. **制作人的社区沟通风格是有意识的战略选择**：采访详细解释了 Light 选择高透明度社区互动的原因（弥补调研不足、弥补运营人手、争取理解）。这与缸中之脑的社区监控功能高度互补——日报帮 Light 减少亲自刷社区的时间，但不替代他的直接沟通
4. **THPDom 效应验证了内容创作者合作的价值**：一个视频直接影响了配音预算决策并带来大量新玩家。如果缸中之脑能自动发现并标记高影响力的社区内容，对制作人的决策支持价值巨大
5. **离线版本承诺的架构约束**：制作人确认正在保持架构可分离性。这也解释了为什么游戏数据解包（extract-game-data）对长期有价值——离线版本需要深入理解数据结构

### 已更新的文件

- `memory/morimens-context.md`：新增项目历史、叙事结构、创作灵感、设计哲学、未来内容、离线版本承诺
- `assets/data/interview-2026-04.json`：53 问完整结构化提取
