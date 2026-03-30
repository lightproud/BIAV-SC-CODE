# 数据目录索引

> 供 Chat 会话快速了解可用数据文件。通过 GitHub API 读取对应文件即可。

## 新闻聚合数据

| 文件 | 说明 | 更新频率 |
|------|------|----------|
| `news.json` | 最新新闻列表 + 摘要 + 各源统计 | 每次 Actions 运行 |
| `news.jsonl` | 全量新闻，每行一条，便于逐条处理 | 每次 Actions 运行 |
| `feed.xml` | RSS 订阅源 | 每次 Actions 运行 |
| `run_log.json` | 聚合器运行日志（时间、耗时、各源状态） | 每次 Actions 运行 |
| `fetch_state.json` | 增量抓取游标（各源的 last_id/last_time） | 每次 Actions 运行 |
| `archive/YYYY-MM-DD_HH.json` | 按日时归档的历史新闻 | 每次 Actions 运行 |

## Discord 全量归档数据

| 文件/目录 | 说明 | 更新频率 |
|-----------|------|----------|
| `discord/guild_meta.json` | 服务器元数据（名称、频道列表、角色） | 每 6 小时 |
| `discord/channel_index.json` | 频道 ID → 名称/类型映射（Chat 查频道名用这个） | 每 6 小时 |
| `discord/members.json` | 成员快照（昵称、角色、加入时间） | 每 6 小时 |
| `discord/channels/{id}/YYYY-MM-DD.jsonl` | 各频道按日分片的消息记录 | 每 6 小时 |
| `discord/threads/{id}.jsonl` | 帖子/讨论串消息 | 每 6 小时 |
| `discord/threads/{id}_meta.json` | 帖子元数据（标题、创建者、标签） | 每 6 小时 |
| `discord/activity_daily/YYYY-MM-DD.json` | 每日活跃度统计（消息数、活跃用户） | 每 6 小时 |
| `discord/state.json` | 增量抓取状态（各频道最后消息 ID） | 每 6 小时 |
| `discord_activity.json` | 成员活跃度分析（聚合器产出） | 每次新闻 Actions 运行 |

## Chat 读取建议

1. **看最新新闻** → 读 `news.json`，其中 `summary` 字段是自动摘要
2. **看运行状态** → 读 `run_log.json`，检查各数据源是否正常
3. **查 Discord 频道名** → 读 `discord/channel_index.json`
4. **看 Discord 活跃度** → 读 `discord/activity_daily/YYYY-MM-DD.json`
5. **看历史新闻** → 读 `archive/` 下对应日期文件

> 注意：`discord/` 目录数据需要 Discord Archiver Actions 实际运行后才会生成。
