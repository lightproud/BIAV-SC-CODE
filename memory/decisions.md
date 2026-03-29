# 决策日志

> 所有重要的架构、技术、方向决策记录在此。新会话请先阅读。

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
| 2026-03-28 | 确立分支管理策略（见下方详细说明） | main 作为稳定基线，子项目分支从 main 拉取，功能稳定后由主控台 PR 合并回 main | 全局 |
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
