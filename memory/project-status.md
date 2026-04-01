# 项目状态一览

> 最后更新：2026-04-01 by 战略中心
>
> 战略规划详见 `memory/strategic-plan-2026.md`

## 子项目状态

| 子项目 | 状态 | 负责会话 | 下一步 |
|--------|------|---------|--------|
| site（主站 + 部署 + 视觉） | 已部署，维护模式 | Code-site | 无新任务 |
| news（新闻聚合 + 报告系统） | 收缩夯实中 | Code-news | 桥接 Discord → 聚合器、月度归档清理 |
| wiki（数据集 + Wiki 站点） | 已部署，维护模式 | Code-wiki | 数据质量基线抽查 |
| game（衍生游戏） | 暂缓 | 待创建 | Stage 1 验证通过前不启动 |

## News 新闻聚合 + 报告系统

### 实时聚合器
- **已完成**：前端页面、B站抓取、GitHub Actions 自动化
- **阻塞**：Twitter/NGA/TapTap 需配置密钥
- **数据落盘位置**：
  - `assets/data/news.json` — 所有数据源合并的原始输出（由 aggregator.py 写入）
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
  - 59/59 角色有技能数据（11 个有完整结构化卡牌数据，48 个有描述性数据待结构化）
  - 47/59 角色立绘已下载到 `assets/images/portraits/`
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
  - `fetch_portraits.py` — Fandom 立绘下载（47/59 成功）
  - `fetch_skills.py` — 角色技能抓取
  - `fetch_cards.py` — 卡牌详情抓取
  - `fetch_stats.py` — 角色数值抓取
  - `fetch_stages.py` — 关卡掉落抓取
  - `fetch_wheels.py` — 命轮效果抓取
  - `fetch_lore.py` — 剧情详情抓取
  - `fetch_voice_lines.py` — 语音台词抓取
  - `fetch_steam_assets.py` — Steam 公开资产下载
  - `extract_game_data.py` — Unity 客户端数据解包工具
  - `generate_pages.py` — 从 JSON 自动生成角色详情页
  - `generate_rss.py` — RSS/Atom 订阅源生成
  - `check_version.py` — 游戏版本更新检测
  - `fetch-wiki-data.yml` — 每周一自动运行全部抓取
  - `check-version.yml` — 每周一检测版本更新
- **数据来源**：Fandom API、Steam Store API、GameKee、Bilibili wiki

### Wiki 站点
- **已完成**：
  - VitePress 站点框架、三语言结构（ZH/EN/JA）
  - 189 个角色详情页（63 角色 × 3 语言，自动生成）
  - 约 250+ 页 Markdown 内容
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

**Phase 0：收缩与夯实**（2026-04-01 起）

目标：砍到只剩能验证的最小集，让日报覆盖 3 个有效数据源（Bilibili + Steam + Discord），制作人实际在用。

验证门：制作人连续 14 天主动看日报并觉得有用。

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
| claude.yml | Issue 触发 | 阻塞（API 无余额） |
| generate-report.yml | **已暂停** | secrets 未配 |
| extract-game-data.yml | **已暂停** | Steam 认证未通 |

## 基础设施状态

| 组件 | 状态 | 备注 |
|------|------|------|
| GitHub PAT (Issues) | 已配置 | Fine-grained, brain-in-a-vat only |
| Claude GitHub App | 已安装 | 权限已更新 |
| .github/workflows/claude.yml | 已部署 | 含 id-token:write |
| ANTHROPIC_API_KEY Secret | 已配置 | 余额为零，待充值 |
| Actions 自动化 | 触发链通，执行失败 | 原因：API 无余额。充值后即可激活 |
