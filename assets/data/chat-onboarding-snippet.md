# Chat Onboarding Snippet

> 用法：在 chat 端（claude.ai / 桌面 app / 其他 LLM）开新会话时，把下面整段文本第一句话粘贴过去，对面 AI 立刻知道如何 fetch 银芯（BIAV-SC）的全量社区数据。
>
> 维护者：艾瑞卡。结构变化时同步更新本文件 + `CLAUDE.md` §5.2 社区情报章节。
>
> 最后更新：2026-05-03

---

## 复制下面这段（含围栏）粘到 chat

````
你将分析【忘却前夜】（Morimens）的社区数据。所有原始数据托管在公开 GitHub 仓库 `lightproud/brain-in-a-vat`。请通过 raw.githubusercontent.com 直接 fetch 文件——不需要登录，无 rate limit 困扰下可自由读取。

## 数据架构（读之前必看）

数据有两层，**绝不互换**：

- **全量档案层**（真实数据）：`projects/news/data/`
  - 长窗口分析、抽样率计算、情感长尾、历史回溯 → **必须用这一层**
- **输出展示层**（过滤选样）：`projects/news/output/`
  - 仅快查 / 热度榜，是 24h 或 30 天窗口 + 热度阈值过滤后的样本

把 output 当 archive 用 = 抽样率失真（已有事故记录）。

## Raw URL 模板

```
https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/<PATH>
```

## 全量档案层目录（16 平台 + Discord）

**Discord**（最大资产，264 MB / 1946 jsonl / 468 频道目录，回溯 2026-02）：
- `projects/news/data/discord/channels/{id_suffix}/{date}.jsonl` — 全量消息（按 channel ID 后 8 位哈希分桶）
- `projects/news/data/discord/activity_daily/{date}.json` — 每日纯统计（913 文件，回溯 **2023-07-21**）
- `projects/news/data/discord/channel_index.json` — 146 个频道索引
- `projects/news/data/discord/guild_meta.json` — 163 个频道元数据

**16 平台**（按规模降序）：
- `projects/news/data/platforms/steam_review/{date}.json` — 619 文件 / 3.2 MB / 2024-08 → 当日
- `projects/news/data/platforms/appstore/{date}.json` — 166 文件 / 2023-11 → 当日（24 国评论）
- `projects/news/data/platforms/pixiv/{date}.json` — 129 文件 / 2023-12 → 当日
- `projects/news/data/platforms/weixin/{date}.json` — 93 文件 / 2016-02 → 当日
- `projects/news/data/platforms/bilibili/{date}.json` — 2026-03 → 当日
- `projects/news/data/platforms/steam/{date}.json` — Steam 公告
- `projects/news/data/platforms/google_play/{date}.json` — 22 locale 评论
- 还有：`reddit / youtube / weibo / official / telegram / stopgame / ruliweb` 等

每个 `{date}.json` 结构：`{date, archived_at, source, item_count, items: [...]}`

## 状态 / 索引文件

- `projects/news/output/source-health.json` — 23 平台健康状态（active / degraded / dormant + last_success + total_items）
- `projects/news/data/gap_report.json` — 5173 缺失日期（archive 完整性诊断）

## 高频用法示例

1. **"近 7 天 weibo 全量"** → fetch `data/platforms/weibo/2026-04-{27,28,29,30}.json` + `data/platforms/weibo/2026-05-{01,02,03}.json`
2. **"Discord 某频道 5-1 消息"** → 先 fetch `discord/channel_index.json` 找该频道的 `dir`（id 后 8 位）→ fetch `discord/channels/{dir}/2026-05-01.jsonl`
3. **"Steam 评论 2024 全年"** → 列出 `data/platforms/steam_review/2024-*.json`，逐文件 fetch
4. **"今日热点快查"** → 直接 fetch `output/all-latest.json`（不需要全量层）

## 仓库主索引

`CLAUDE.md`（仓库根目录）—— 统一入口：完整数据架构 + 知识模块索引 + 数据消费纪律。读它即可上手：
https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md

平台数据层逐源清单见 `CLAUDE.md` §5.2 社区情报 + `memory/project-status.md`（原 `data-layer-audit.md` 随多会话架构 2026-06 退役删除）。
````

---

## 这个文件本身的 raw URL（守密人可直接发链接而非粘贴文本）

```
https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/assets/data/chat-onboarding-snippet.md
```

发给 chat 时一句话即可：

> 帮我分析忘却前夜社区数据，先 fetch 这个 onboarding：
> https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/assets/data/chat-onboarding-snippet.md
