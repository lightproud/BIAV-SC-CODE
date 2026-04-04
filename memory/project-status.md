# 项目状态一览

> 最后更新：2026-04-04 by Code-主控台
>
> 战略规划详见 `memory/strategic-plan-2026.md`

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| site（主站 + 部署 + 视觉） | 已部署，维护模式 | Code-site | 无新任务 |
| news（新闻聚合 + 报告系统） | 收缩夯实中 | Code-news | 桥接 Discord → 聚合器、月度归档清理 |
| wiki（数据集 + Wiki 站点） | 数据补全中 | Code-wiki | 触发 fetch-wiki-data workflow 抓取 47 个角色技能数据 + 12 个缺失立绘 |
| game（衍生游戏） | 暂缓 | 待创建 | Stage 1 验证通过前不启动 |

## News 新闻聚合 + 报告系统

### 实时聚合器
- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **阻塞**：Twitter/NGA/TapTap 需配置密钥
- **数据落盘位置**：
  - `projects/news/output/news.json` — 所有数据源合并的原始输出（由 aggregator.py 写入）
  - `projects/news/output/` — **Chat 会话统一读取入口**，按数据源分割的 JSON 文件
    - `bilibili-latest.json`、`steam-latest.json`、`taptap-latest.json` 等
    - `all-latest.json` — 所有源合并（适合日报/分析场景）
    - 每次 workflow 运行后自动更新（由 split_output.py 生成）
- **数据源状态**：
  - [x] Bilibili — 正常运行
  - [x] Reddit — 代码就绪
  - [ ] Twitter/X — 需 TWITTER_BEARER_TOKEN
  - [ ] NGA — 需 NGA_FORUM_ID
  - [ ] TapTap — 需 TAPTAP_APP_ID
  - [x] Discord — 已实现（Bot 已配置，全量归档 + 聚合器双通道）
  - [x] YouTube — 代码就绪，需配置 API 密钥

### 报告系统（新增，来自 new-session-7Plu3）
- **已完成**：29 平台采集器、AI 分析模块、报告生成、多渠道通知（Email/Discord/Telegram/Bark/Webhook）
- **待验证**：整合到新目录结构后的 GitHub Actions 流水线
- **待配置**：各平台 API 密钥

## Wiki 数据集 + 站点

### 游戏数据集（原 database）
- **已完成**：
  - 18 个 JSON 数据文件（`projects/wiki/data/db/`）
  - 63 个唤醒体数据（59 SSR + 4 SR）
  - 63/63 角色有元数据（EN/JA 描述、获取方式翻译完成），11 个有结构化卡牌/技能数据，52 个待 Fandom 抓取补充
  - 47/59 角色立绘已下载到 `assets/images/portraits/`（12 个缺失，已配置 Bilibili Wiki 备用源）
  - 命轮数据：55 个命轮，31 个有角色归属，39 个有效果文本（EN 翻译完成），16 个缺失待抓取
  - 命轮与密契装备体系
  - 四大界域体系（Chaos、Aequor、Caro、Ultra）
  - 版本线 v1.0→v2.5（含 3 个联动记录）
  - 世界观设定（8 组织、12 关键角色、主线剧情详细摘要）
  - 卡牌数据库 cards.json
  - 关卡掉落表 stages.json
  - 多语言术语翻译 translations.json（zh/en/ja）
  - 角色语音框架 voice_lines.json（10 角色，待补充实际台词）
  - content_database.json 技能数据已整合到 characters.json
- **已删除**：tier 评级字段（非项目关注点）
- **自动化抓取**：7 个脚本 + GitHub Actions workflow
  - `fetch_portraits.py` — Fandom + Bilibili Wiki 立绘下载（47/59 成功，12 缺失待 Bilibili 源补充）
  - `fetch_skills.py` — 角色技能抓取（已改进：智能检测 47 个需更新角色，Fandom + Bilibili 双源，保留元数据合并）
  - `fetch_cards.py` — 卡牌详情抓取
  - `fetch_stats.py` — 角色数值抓取
  - `fetch_stages.py` — 关卡掉落抓取
  - `fetch_wheels.py` — 命轮效果抓取
  - `fetch_lore.py` — 剧情详情抓取
  - `fetch_voice_lines.py` — 语音台词抓取
  - `fetch_steam_assets.py` — Steam 公开资产下载
  - `extract_game_data.py` — Unity 客户端数据解包工具
  - `generate_pages.py` — 自动生成角色详情页（189 页）+ 命轮详情页（165 页）+ 命轮列表页
  - `generate_rss.py` — RSS/Atom 订阅源生成
  - `check_version.py` — 游戏版本更新检测
  - `fetch-wiki-data.yml` — 每周一自动运行全部抓取
  - `check-version.yml` — 每周一检测版本更新
- **数据来源**：Fandom API、Steam Store API、GameKee、Bilibili wiki

### Wiki 站点
- **已完成**：
  - VitePress 站点框架、三语言结构（ZH/EN/JA）
  - 189 个角色详情页 + 165 个命轮详情页 + 3 个命轮列表页（全部自动生成）
  - 约 580+ 页 Markdown 内容（ZH 193 + EN 198 + JA 197 页）
  - 内容完成度：系统页 100%，命轮页 71%（39/55 有效果数据），角色元数据 100%（EN/JA 描述均完成），角色技能 17%（11/63 有结构化数据）
  - 加权总完成度约 83%（系统30%×100% + 角色元数据40%×100% + 技能15%×17% + 命轮15%×71%）
  - 达到 90% 需要：fetch-wiki-data workflow 抓取 52 个角色技能 + 16 个命轮效果
  - 11 个 Vue 交互组件（全部已注册到 theme）：
    - CharacterGrid（角色筛选/排序）— 已嵌入唤醒体索引页
    - CharacterCompare（角色对比）
    - WheelList（命轮筛选列表）— 已嵌入命轮索引页
    - GachaSimulator（抽卡模拟器）
    - TeamBuilder（队伍搭配器）
    - DamageCalculator（伤害计算器）
    - FarmingPlanner（素材规划器）
    - StaminaTracker（体力追踪器）
    - UpdateTimeline（版本时间线）— 已嵌入更新记录页
    - ChangelogFeed（最近变更）— 已嵌入更新记录页
    - VoiceLines（语音台词展示）
  - SEO 优化：Schema.org JSON-LD、OG 社交分享图、sitemap、robots.txt
  - RSS/Atom 订阅源
  - 贡献指南 contributing.md
- **技术栈**：VitePress 1.6.4 + Vue 3.5.13
- **部署**：由 Code-site 统一管理（deploy-site.yml），wiki 位于 /wiki/ 子路径
- **已修复问题**（2026-03-30）：
  - `cleanUrls: false` — GitHub Pages 不支持无扩展名 URL 重写
  - 立绘路径用 `:src` 动态绑定避免 Vite import 错误
  - YAML frontmatter 含冒号自动引号转义
  - VoiceLines 组件已注册到 theme
  - deploy-site.yml smoke test 适配 zh root locale 路径

## Game 衍生游戏

- **已完成**：无
- **待决策**：游戏类型、技术选型、美术方向

## 当前阶段

**Phase 1：记忆宫殿** — ✅ 已验证通过（2026-04-04）

- Phase 0（止血）：✅ 完成
- Stage 1 验证（日报 14 天）：✅ 制作人确认通过
- 事实圣经 v1.0：✅ 63 角色 + 叙事结构 + 设计决策
- 记忆系统 9 模块：✅ 全部上线（3410 行新代码）
- 做梦 Agent 三层：✅ 全部启动（浅睡6h + 深睡每日 + REM每周）

**下一阶段**：Phase 2（内容权威，6-8月）— Wiki 数据 100% + 联动实战

详见 `memory/strategic-assessment.md`。

## Workflow 运行频率（2026-04-01 调整）

| Workflow | 频率 | 状态 |
|----------|------|------|
| update-news.yml | 每日 2 次（06:00/16:00 UTC） | 运行中 |
| discord-archive.yml | 每日 1 次（18:00 UTC） | 运行中 |
| deploy-site.yml | push 触发 | 运行中 |
| fetch-wiki-data.yml | 每周一 | 运行中 |
| check-version.yml | 每周一 | 运行中 |
| validate-data.yml | push 触发 | 运行中 |
| dream.yml（浅睡） | 每 6 小时 | ✅ 运行中（含哨兵层） |
| dream.yml（深睡） | 每日 19:00 UTC | ✅ 运行中（2026-04-04 启用） |
| dream.yml（REM） | 每周一 01:00 UTC | ✅ 运行中（2026-04-04 启用） |
| claude.yml | Issue 触发 | ✅ 可用（API 已恢复） |
| generate-report.yml | **已暂停** | secrets 未配 |
| extract-game-data.yml | **已暂停** | Steam 认证未通 |

## 基础设施状态

| 组件 | 状态 | 备注 |
|------|------|------|
| GitHub PAT (Issues) | 已配置 | Fine-grained, brain-in-a-vat only |
| Claude GitHub App | 已安装 | 权限已更新 |
| .github/workflows/claude.yml | 已部署 | 含 id-token:write |
| ANTHROPIC_API_KEY Secret | ✅ 已配置 | 余额已恢复（2026-04-04） |
| Actions 自动化 | ✅ 全部可用 | claude.yml + dream.yml 深睡/REM 已激活 |

## 银芯记忆系统（2026-04-04 上线）

两轮架构升级，9 模块共 3410 行代码。

| 模块 | 脚本 | 行数 | 功能 |
|------|------|------|------|
| TF-IDF 向量搜索 | `scripts/memory_search.py` | 780 | 中文双字符分词、L2归一化稀疏向量、余弦相似度 |
| 4维重排序器 | `scripts/memory_search.py` | — | semantic × recency × access_freq × graph_proximity |
| 知识图谱 | `scripts/knowledge_graph.py` | 704 | 217节点 443边（角色/界域/决策/系统/概念/文件） |
| MemRL-lite | `scripts/memrl.py` | 378 | EMA效用评分（α=0.3）、归档建议、权重自校准 |
| Sleep-Time Compute | `scripts/dream.py` | — | 热门话题识别 → 预计算缓存 → TTL过期 |
| 哨兵层 | `scripts/dream.py` | 227 | Steam差评率/Discord消息量/负面关键词 异常检测 |
| MCP Server | `scripts/mcp_server.py` | 200 | 7工具（search/graph/utility/cache/context/rebuild） |
| 虚拟上下文管理 | `scripts/context_manager.py` | 180 | MemGPT式4层推荐（角色默认+语义+图谱+效用） |
| Reflexion | `scripts/reflexion.py` | 280 | 失败模式收集 → 规律分析 → 经验提取 |
| 选择性记忆 | `scripts/dream.py` | — | 膨胀检测（>400行+低效用）+ 归档建议 |

### 索引文件（运行时生成，gitignored）

| 文件 | 用途 |
|------|------|
| `assets/data/vectors.json` | TF-IDF 向量索引（~979KB） |
| `assets/data/semantic-index.json` | 关键词索引（~37KB） |
| `assets/data/knowledge-graph.json` | 知识图谱（~135KB） |
| `assets/data/memory-utility.json` | 效用评分（~6KB） |
| `assets/data/sentinel-baseline.json` | 哨兵基线数据 |
| `projects/news/output/alerts.json` | 异常告警记录 |

## 做梦 Agent 三层架构

| 层 | 频率 | 引擎 | 成本 | 产出 |
|---|------|------|------|------|
| 浅睡 | 每6小时 | 纯Python+shell | ¥0 | 结构检查 + 哨兵扫描 + 索引重建 |
| 深睡 | 每天19:00 UTC | Claude AI | ~$0.1-0.2/天 | 趋势分析 + Memory修正 + 知识缺口识别 |
| REM | 每周一01:00 UTC | Claude AI | ~$0.3-0.5/周 | 周报 + 经验提炼 + 状态同步 + 洞察整合 |

设计文档：`memory/dreaming-agent-design.md`
