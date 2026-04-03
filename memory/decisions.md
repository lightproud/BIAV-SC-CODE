# 决策日志

> 最后更新：2026-04-03 by 战略中心（Code）
>
> **新会话只需要读「当前有效决策」。历史归档仅供追溯。**

---

## 当前有效决策

以下决策仍然生效，是项目运行的基本规则。

### 全局

| 决策 | 影响范围 |
|------|---------|
| 建立多会话协作架构（职责隔离） | 全局 |
| 目录按 memory/assets/projects 重组 | 全局 |
| 各子项目按需选择技术栈 | 全局 |
| 项目完全开源，MIT License | 全局 |
| 游戏内容版权归脑缸组，项目仅引用公开信息 | 全局 |
| 仓库定位为"共享外脑 + 中转站"（Code 生产，Chat 加工交付） | 全局 |
| 子项目保持单仓库，不拆分独立 repo | 全局 |
| 项目正式命名为「缸中之脑计划」，仓库 brain-in-a-vat | 全局 |
| 架构定义为前台/中台/后台三层（claude.ai → Claude Code → GitHub） | 全局 |
| 建立交付物视觉规范 style-guide.md | 全局 |
| 引入 lessons-learned 踩坑记录 | 全局 |
| 引入 Plan/Execute 任务标注约定（未标注默认「直接执行」） | 全局 |
| 创建 .claude/commands/ 可复用工作流 | 全局 |
| 各 CONTEXT.md 添加验证清单 | 全局 |
| 引入 Claude Code GitHub Actions（Issue 驱动自动化） | 全局 |
| Issue 安全策略：只执行 author:lightproud | 全局 |
| Issue 生命周期闭环管理（WIP 上限 3 个/子项目 + 创建前查重） | 全局 |
| 所有会话直接推 main，不用分支。冲突时 git pull 重试 | 全局 |
| 大文件暂不外迁，直接放 git（增长到瓶颈时再评估） | 全局 |
| 模型使用分层策略：判断层 Opus(Extended)，执行层 Sonnet | 全局 |
| 前台专岗不固定编制，按需增设 | 全局 |
| 缸中之脑方向确认为方法论验证（交付物必须可用） | 全局 |
| main 分支添加 Ruleset 保护规则（禁止删除） | 全局 |
| 双系统架构：银芯（公开层）+ 黑池（内部层），数据隔离，架构共享 | 全局 |
| 银芯事实圣经边界：仅收录公开可查阅信息 | 全局 |
| 战略规划 2026：四阶段计划，详见 strategic-plan-2026.md | 全局 |
| 黑池已上线（2026-04-03），内网 SVN + Qoder，全员使用，核心痛点：知识结构化传承 | 全局 |
| 大二进制文件移至 GitHub Releases（不入 git） | 全局 |
| 架构差距分析 + 8 项改进批量实施（JSON Schema、冒烟测试、Dependabot 等） | 全局 |
| 做梦 Agent 三层架构：浅睡(3h,Actions)→深睡(每天,Claude)→REM(每周,Claude)，详见 `memory/dreaming-agent-design.md` | 全局 |
| 品牌统一：银芯=BIAV-SC，黑池=BIAV-BP。CLAUDE.md 保留文件名（兼容自动加载），标题用 BIAV-SC | 全局 |

### 子项目

| 决策 | 影响范围 |
|------|---------|
| 合并 database 和 wiki 为单一 wiki 子项目 | wiki |
| 主站导航页 + 子路径多站点方案（根路径主站，/wiki/，/news/） | site |
| 部署方式：peaceiris/actions-gh-pages 推 gh-pages 分支 | site |
| Wiki 中文设为 root locale + rewrites | wiki |
| 界域 ID 标准化（aequor/caro/ultra） | wiki/data |
| 角色职能标准化（attack/sub_attack/defense/support/chorus） | wiki/data |
| 角色 ID 从拼音改为英文 slug | wiki/data |
| Wiki 删除 tier 评级数据 | wiki/data |
| 整合 content_database 技能到 characters.json | wiki/data |
| 立绘图片存仓库（assets/images/portraits/） | wiki/data |
| 建立 7 脚本自动化数据抓取体系（Fandom + Steam API） | wiki |
| Wiki 引入 Vue 交互组件（11 个） | wiki |
| 自动生成角色详情页（generate_pages.py，63 角色 × 3 语言） | wiki |
| 添加 SEO 优化（Schema.org + OG + sitemap） | wiki |
| 版本更新自动检测 + RSS 订阅 | wiki |
| News 采集管线统一方案（先统一 JSON schema，再逐个接源） | news |
| 新增 Code-site 子项目（部署流水线 + 跨站前端） | site |
| Discord 数据分级存储架构（git 保留 60 天 JSONL + 月归档至 Releases） | news/discord |
| Discord 归档系统 4 项技术决策（断点续传、月报容错、论坛增量、无成员 Intent） | news/discord |
| 联动关键词确认：沙耶之歌 (Saya no Uta)，日报系统已配置监控 | news |

---

## 决策历史归档

以下为完整历史记录，按时间顺序保留，仅供审计追溯。

| 日期 | 决策 | 原因 | 影响范围 |
|------|------|------|---------|
| 2026-03-28 | 建立多会话协作架构 | 职责隔离，避免上下文混乱 | 全局 |
| 2026-03-28 | 目录按 memory/assets/projects 重组 | 区分记忆、资产、代码，支持 Chat 对接 | 全局 |
| 2026-03-28 | ~~前端不使用框架~~ **已废除** | 原因：项目扩展后一刀切不合适 | ~~news, game~~ |
| 2026-03-28 | 各子项目按需选择技术栈 | 取代旧的"不使用框架"原则。news 维持纯 HTML/JS；wiki 用 VitePress；database/game 视需求选型 | 全局 |
| 2026-03-28 | 项目完全开源，MIT License | 方法论吸引技术圈，数据吸引玩家社区 | 全局 |
| 2026-03-28 | 游戏内容版权归脑缸组 | 项目仅引用公开信息 | 全局 |
| 2026-03-28 | 仓库定位为"共享外脑 + 中转站" | Code 生产，Chat 加工交付，仓库是中间层 | 全局 |
| 2026-03-28 | 子项目保持单仓库，不拆分独立 repo | 所有会话需共享 memory/assets，分支隔离已够用，体量轻量无性能压力；仅当 game 资源膨胀时再考虑 submodule 拆分 | 全局 |
| 2026-03-28 | ~~确立分支管理策略~~ **已废弃** | ~~main 作为稳定基线，子项目分支从 main 拉取~~ → 见 2026-03-29 全部直接推 main | ~~全局~~ |
| 2026-03-28 | 合并 database 和 wiki 为单一 wiki 子项目 | 数据集是 wiki 的后端，站点是 wiki 的前端，分开容易混淆 | wiki |
| 2026-03-28 | 项目正式命名为「缸中之脑计划」| 仓库同步更名为 brain-in-a-vat | 全局 |
| 2026-03-28 | 架构定义为前台/中台/后台三层 | 前台(claude.ai)交付、中台(Claude Code)执行、后台(GitHub仓库)存储 | 全局 |
| 2026-03-28 | Wiki 部署 GitHub Pages + Actions 自动化 | 社区可直接访问，push to main 自动部署，无需手动操作 | wiki |
| 2026-03-28 | 界域 ID 标准化（aequor/caro/ultra） | 与游戏官方英文术语对齐，原 deep_sea/flesh/hyperdimension 保留为 legacy_id | wiki/data |
| 2026-03-28 | 角色职能标准化（attack/sub_attack/defense/support/chorus） | 统一数据规范，原 dps/sub_dps/tank 已全量替换 | wiki/data |
| 2026-03-28 | 角色 ID 从拼音改为英文 slug | 方便国际化 URL 和跨语言引用 | wiki/data |
| 2026-03-28 | 建立交付物视觉规范 style-guide.md | 深黑底+琥珀金调色板、Noto Serif/Sans CJK SC | 全局 |
| 2026-03-28 | 缸中之脑计划文档 v1.0 发布 | 36 页双语 PDF + HTML 归档至 deliverables/2026-03/ | 全局 |
| 2026-03-28 | 引入 lessons-learned 踩坑记录 | 记录犯过的错误避免重犯 | 全局 |
| 2026-03-28 | 引入 Plan/Execute 任务标注约定 | 前台派任务时标注「先出方案」或「直接执行」 | 全局 |
| 2026-03-28 | 创建 .claude/commands/ 可复用工作流 | daily-news / sync-memory / validate-data 封装为命令 | 全局 |
| 2026-03-28 | 各 CONTEXT.md 添加验证清单 | 每个子项目必须有可执行的验证步骤 | news, wiki, game |
| 2026-03-29 | 引入 Claude Code GitHub Actions | Issue 驱动自动化，减少人工中转 | 全局 |
| 2026-03-29 | Issue 安全策略：只执行 author:lightproud | 防止外部 Issue 被自动执行 | 全局 |
| 2026-03-29 | GitHub Pages 部署改用官方 Actions 方式 | deploy-pages@v4 官方推荐，无需额外分支，原子部署，权限更小 | wiki |
| 2026-03-29 | Wiki 中文设为 root locale + rewrites | 解决根路径 404。zh 内容通过 rewrites 映射到 `/`，en/ja 保持 `/en/`、`/ja/` | wiki |
| 2026-03-29 | 主站导航页 + 子路径多站点方案 | 根路径放主站导航，wiki 移到 /wiki/ 子路径，news 到 /news/，统一 deploy-site.yml 构建 | 全局 |
| 2026-03-29 | Issue 生命周期闭环管理 | WIP 上限 3 个/子项目 + 失败自动打 blocked 标签 + 创建前查重 | 全局 |
| 2026-03-29 | News 采集管线统一方案 | 先统一 JSON schema，再逐个接数据源，不建第三套系统 | news |
| 2026-03-29 | 新增 Code-site 子项目 | 部署流水线和跨站前端是跨子项目关注点，需要独立会话负责。deploy-wiki.yml 与 deploy-site.yml 冲突事件验证了这一判断。主控台不再写业务代码 | 全局 |
| 2026-03-29 | 删除 deploy-wiki.yml | 与 deploy-site.yml 功能重叠且架构冲突（wiki 部署到根路径 vs 子路径），统一由 deploy-site.yml 管理 | site |
| 2026-03-29 | ~~分支工作流~~ **废弃，改为全部直接推 main** | 项目无人工程序员，全 AI 协作追求效率。AI 解决 git 冲突高效，分支+合并流程反而增加不必要的中转。冲突时 `git pull` 重试即可 | 全局 |
| 2026-03-29 | 大文件暂不外迁，直接放 git | 当前规模不构成问题，等增长到瓶颈时再评估 LFS/R2/Releases 等方案 | 全局 |
| 2026-03-29 | Discord 数据分级存储架构 | 单频道历史消息可达76万条，纯 git 存储不可持续。方案：git 保留60天完整 JSONL（当月+上月作缓冲）；每月1日触发归档：将上个自然月数据打包推 GitHub Releases + 同步调用 Claude API 生成月报存入 monthly_reports/YYYY-MM.md + 删除 git 中该月 JSONL；每日纯统计摘要永久留 git | news/discord |
| 2026-03-29 | 部署方式改为 gh-pages 分支（peaceiris/actions-gh-pages） | Code-site 调试后发现 deploy-pages artifact 方式未跑通，改用推送 gh-pages 分支方式成功部署。GitHub Pages Source 需设为 branch: gh-pages | site |
| 2026-03-29 | Wiki 删除 tier 评级数据 | 攻略评级非项目关注点，减少主观数据维护负担 | wiki/data |
| 2026-03-29 | 整合 content_database 技能到 characters.json | 15 个角色获得技能字段，避免数据分散 | wiki/data |
| 2026-03-29 | 立绘图片存仓库（assets/images/portraits/） | 官方授权项目无版权问题，本地存储比外链更可靠 | wiki/data |
| 2026-03-29 | 建立 7 脚本自动化数据抓取体系 | Fandom API + Steam API 多源抓取，每周自动运行 | wiki |
| 2026-03-29 | Wiki 引入 Vue 交互组件（11 个） | 缩小与顶级 wiki 差距：筛选/对比/计算器/模拟器 | wiki |
| 2026-03-29 | 自动生成角色详情页（generate_pages.py） | 63 角色 × 3 语言 = 189 页自动生成，数据更新时重跑即可 | wiki |
| 2026-03-29 | 添加 SEO 优化（Schema.org + OG + sitemap） | 提高搜索引擎可发现性和社交分享效果 | wiki |
| 2026-03-29 | 版本更新自动检测 + RSS 订阅 | check-version.yml 每周检测 Steam API，自动创建 Issue | wiki |
| 2026-03-29 | 架构差距分析 + 8 项改进批量实施 | 对标业界最优实践，补齐数据验证(JSON Schema)、冒烟测试、Dependabot、共享CSS变量、404页面、爬虫降级保护、memory时间戳 | 全局 |
| 2026-03-29 | Discord 归档系统 4 项技术决策 | ①月内进度：A+B组合——每频道保存 last_historical_message_id 到 state.json（断点续传）+ JSONL 写入前按 message_id 去重（防御兜底）②月报失败：跳过不阻断归档，写 SKIPPED 标记，API 恢复后补生成 ③论坛历史：先跳过回溯，只做增量抓取新帖，历史帖子后续单独处理 ④Server Members Intent：暂不开启，成员数据非当前优先级。补充：workflow 加 concurrency 组防重叠；频道目录名只用 channel_id 后8位，emoji 名称存 channel_index.json | news/discord |
| 2026-03-29 | 模型使用分层策略 | 判断层用Opus(Extended)，执行层用Sonnet，避免MAX额度浪费 | 全局 |
| 2026-03-29 | 前台专岗不固定编制，"美术总监"不再作为固定岗位 | 按需增设更灵活 | 全局 |
| 2026-03-29 | 缸中之脑方向确认为方法论验证 | 不是纯产品工具，但交付物必须可用 | 全局 |
| 2026-03-29 | main 分支添加 Ruleset 保护规则（禁止删除） | 防止 agent 误删核心分支 | 全局 |
| 2026-04-01 | 明确双系统架构：银芯（公开层）+ 黑池（内部层） | 银芯 = 本仓库，仅用公开信息，开源；黑池 = 公司内部系统，处理内部数据。数据完全隔离，架构模式共享。银芯是方法论试验场，验证后黑池复用 | 全局 |
| 2026-04-01 | 银芯事实圣经边界：仅收录公开可查阅信息 | 采访、Steam 页面、社区讨论、官方公告等公开信息可录入。内部设计文档、未发布内容、商业数据属于黑池 | 全局 |
| 2026-04-01 | 战略规划 2026 发布 | 四阶段计划（止血→记忆宫殿→内容权威→方法论沉淀→衍生创作），详见 `memory/strategic-plan-2026.md` | 全局 |
| 2026-04-02 | 黑池定位为内网版本（非独立仓库） | 黑池不是 GitHub 私有仓库，是公司内网系统。银芯验证架构模式后黑池复用，数据物理隔离 | 全局 |
| 2026-04-02 | 大二进制文件移至 GitHub Releases | morimens_extract.zip (4.7MB) 等数据提取包不入 git，改存 Releases 并加入 .gitignore，防止仓库体积膨胀 | 全局 |
| 2026-04-02 | 联动关键词确认：沙耶之歌 (Saya no Uta) | 制作人确认采访中"经典宇宙恐怖作品单向联动"候选为沙耶之歌。日报系统 COLLAB_KEYWORDS 已配置监控 | news |
| 2026-04-02 | 做梦 Agent 三层架构 | 对标 AutoDream/Voyager/Reflexion/Sleep-Time Compute。浅睡（3h, Actions 脚本）感知异常；深睡（每天, claude-code-action）整理记忆+趋势分析；REM（每周, claude-code-action）经验提炼+状态同步+洞察积累。insights.json 作为可检索知识库。月成本~$7 | 全局 |
