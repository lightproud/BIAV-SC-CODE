# 银芯启动快照 / BIAV-SC Boot Snapshot

> 最后更新：2026-04-13 by boot_snapshot.py (auto-generated)
> 新会话读完此文件即可就绪，无需逐个加载 memory 文件。
> 完整定义见 `BIAV-SC.md`，本文件是压缩启动包。

---

## 身份

你是 **BIAV-SC（银芯）** 系统的 AI，服务于 B.I.A.V. Studio 的忘却前夜（Morimens）项目。
制作人：Light。始终使用中文。

## 当前阶段

**Phase 1（记忆宫殿）✅ 已验证 → Phase 2（内容权威）准备中**

三条主线：
1. 事实圣经 — 63 角色 + 叙事结构 + 设计决策 ✅
2. 自动情报循环 — 日报 3 源 + 哨兵 + 做梦三层 ✅
3. 权威知识站点 — Wiki 83% 完成，52 角色技能待补

阻塞项：YouTube/Twitter/NGA/TapTap API 未配（不阻塞核心）

## 管线健康

OK: news aggregator
OK: daily report
OK: discord archive
OK: dream journals
OK: wiki data

## 最新社区情报

# 忘却前夜 社区日报 2026-04-12
> 采集时间：2026-04-12 19:50 UTC+8
1. [Bilibili] 【卡雨虹】大师局 24-2回声拿下沙耶之歌 — engagement: 216
| 平台 | 数据条数 |
|------|----------|
| Bilibili | 22 |
| Discord | 16 |
| Steam | 4 |
| Steam 论坛 | 0（沉默）|
1. [DC] willsalvador@🔸morimens-game-chat: https://x.com/i/statu — engagement: 37
1. [正面] 很不错的游戏
1. [StopGame] Morimens — 3.9/10 (0 оценок) — engagement: 0
1. [微信] 制作人长文复盘:数次濒临解散,二游《忘却前夜》如何艰难续命的? — engagement: 0

## 做梦系统

Latest dream: 2026-W15-weekly

## 记忆系统 9 模块

| 模块 | 状态 |
|------|------|
| TF-IDF 搜索 | `scripts/memory_search.py` — 780 行 |
| 知识图谱 | `scripts/knowledge_graph.py` — 217 节点 443 边 |
| MemRL-lite | `scripts/memrl.py` — EMA 效用评分 |
| Sleep-Time Compute | `scripts/dream.py` — 预计算缓存 |
| 哨兵层 | `scripts/dream.py` — 异常检测（零成本） |
| MCP Server | `scripts/mcp_server.py` — 7 工具 |
| 上下文管理 | `scripts/context_manager.py` — 4 层推荐 |
| Reflexion | `scripts/reflexion.py` — 失败模式学习 |
| 选择性记忆 | `scripts/dream.py` — 膨胀检测 |

## Workflow 频率

| Workflow | 频率 | 状态 |
|----------|------|------|
| update-news | 每日 2 次 | Running |
| discord-archive | 每日 1 次 | Running |
| dream 浅睡 | 每 6 小时 | Running |
| dream 深睡 | 每日 19:00 UTC | Running |
| dream REM | 每周一 01:00 UTC | Running |
| deploy-site | push 触发 | Running |
| claude.yml | Issue 触发 | Available |

## 子项目速查

| 子项目 | 位置 | 状态 |
|--------|------|------|
| 主站 | `projects/site/` | 维护模式 |
| 新闻聚合 | `projects/news/` | 运行中 |
| Wiki | `projects/wiki/` | 数据补全中 |
| BPT-WEB | `projects/bpt-web/` | v0.1.0 已部署 |
| BPT-DESKTOP | `projects/bpt-desktop/` | v0.1.0 开发中 |
| BPT 母版 | `projects/bpt/` | 重建计划制定中 |
| 衍生游戏 | `projects/game/` | 暂缓 |

## 按需加载索引

需要更多细节时再读以下文件：
- 项目详细状态 → `memory/project-status.md`
- 战略评估 → `memory/strategic-assessment.md`
- 游戏世界观 → `memory/morimens-context.md`
- 角色数据库 → `projects/wiki/data/db/characters.json`
- 最新日报 → `projects/news/output/daily-latest.md`
- 全平台数据 → `projects/news/output/all-latest.json`
- 设计决策 → `assets/data/design-decisions.json`
- 制作人采访 → `assets/data/interview-2026-04.json`

## 协作规则（精简）

- 所有会话直接推 main
- 修改 memory/ 文件时更新头部时间戳
- 凭据绝不写入仓库
- 架构决策先向制作人提出选项
- 只响应 author:lightproud 的 Issue
