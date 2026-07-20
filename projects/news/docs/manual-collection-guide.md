# 手动采集指南

最后更新：2026-03-29 by Code-news

## 概述

小红书、Discord、Arca Live 等平台没有公开 API，需要人工在浏览器中采集数据。采集完成后，将数据整理为**统一格式**存入 `projects/news/data/platforms/`，报告生成器会自动读取，与自动采集数据合并处理。

**核心原则：手动采集和自动采集走同一条管线，格式完全一致。**

---

## 输出格式

所有平台数据文件均遵循 `projects/news/schema/platform-data.schema.json` 定义的格式。

### 文件顶层结构

```json
{
  "platform": "xiaohongshu",
  "updated_at": "2026-03-29T10:00:00Z",
  "source": "manual",
  "meta": {
    "collector": "lightproud",
    "notes": "采集时间范围说明"
  },
  "items": [...]
}
```

- `platform`：平台标识符，见下表
- `updated_at`：本次采集完成时间，ISO 8601 UTC 格式
- `source`：手动采集固定填 `"manual"`
- `meta`：可选，记录采集者、备注等信息
- `items`：条目数组

### 条目字段

```json
{
  "platform": "xiaohongshu",
  "language": "zh",
  "timestamp": "2026-03-28T15:30:00Z",
  "content": "帖子或评论的正文内容",
  "sentiment": "positive",
  "source_url": "https://www.xiaohongshu.com/...",
  "title": "帖子标题（评论类留 null）",
  "author": "用户名或 UID",
  "engagement": 128,
  "tags": ["忘却前夜", "Morimens"],
  "content_type": "post",
  "metadata": {}
}
```

**必填字段**：`platform`、`timestamp`、`content`、`content_type`

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `platform` | string | 与顶层 platform 一致 |
| `language` | string\|null | ISO 639-1 语言代码，不确定填 `null` |
| `timestamp` | string | 发布时间，ISO 8601 UTC，精确到秒 |
| `content` | string | 正文内容，尽量完整，不要截断 |
| `sentiment` | string\|null | `positive` / `negative` / `neutral` / `null` |
| `source_url` | string\|null | 原始链接，能跳转到具体条目最佳 |
| `title` | string\|null | 帖子标题；评论类填 `null` |
| `author` | string\|null | 作者用户名或平台 UID |
| `engagement` | integer | 互动数：点赞/顶/转发，平台不同取最主要的一个 |
| `tags` | array | 相关标签，没有填 `[]` |
| `content_type` | string | `review` / `post` / `video` / `comment` |
| `metadata` | object | 平台特有字段，格式自由，没有填 `{}` |

---

## 文件命名与存放路径

```
projects/news/data/platforms/
├── steam.json          # 自动采集（Steam API）
├── bilibili.json       # 自动采集（Bilibili API）
├── xiaohongshu.json    # 手动采集
├── discord.json        # 手动采集
├── arca.json           # 手动采集（Arca Live 韩国社区）
└── ...
```

**命名规则**：`{platform}.json`，全小写，与 `platform` 字段值一致。

---

## 平台标识符参考

| 平台 | 标识符 | 语言 | content_type |
|------|--------|------|--------------|
| 小红书 | `xiaohongshu` | `zh` | `post` / `comment` |
| Discord | `discord` | `en` / 多语言 | `post` / `comment` |
| Arca Live | `arca` | `ko` | `post` / `comment` |
| 微博 | `weibo` | `zh` | `post` / `comment` |
| Reddit | `reddit` | `en` | `post` / `comment` |
| TapTap | `taptap` | `zh` | `review` / `comment` |

---

## 时间格式转换

所有时间必须转换为 **UTC ISO 8601** 格式：`YYYY-MM-DDTHH:MM:SSZ`

常见转换：
- 北京时间（UTC+8）：减去 8 小时。例如 `2026-03-29 18:30` → `2026-03-29T10:30:00Z`
- 韩国时间（UTC+9）：减去 9 小时。例如 `2026-03-29 19:30` → `2026-03-29T10:30:00Z`

如果只知道日期不知道具体时间，用 `T00:00:00Z`（当天 UTC 0 点）。

---

## 采集流程建议

1. 在浏览器中打开目标平台，搜索关键词：`忘却前夜`、`Morimens`、`モリメンズ`（日服）
2. 复制相关帖子/评论内容，记录发布时间和链接
3. 整理为上述 JSON 格式（可使用任何文本编辑器）
4. 保存到 `projects/news/data/platforms/{platform}.json`
   - 如果文件已存在：在 `items` 数组头部追加新条目，更新 `updated_at`
   - 如果文件不存在：创建完整文件
5. 提交并推送到 main 分支

---

## 示例：小红书采集结果

```json
{
  "platform": "xiaohongshu",
  "updated_at": "2026-03-29T10:00:00Z",
  "source": "manual",
  "meta": {
    "collector": "lightproud",
    "notes": "采集关键词：忘却前夜、Morimens，时间范围：2026-03-22 ~ 2026-03-29"
  },
  "items": [
    {
      "platform": "xiaohongshu",
      "language": "zh",
      "timestamp": "2026-03-28T08:20:00Z",
      "content": "忘却前夜真的好玩！剧情太虐了，哭了好几次……",
      "sentiment": "positive",
      "source_url": "https://www.xiaohongshu.com/explore/...",
      "title": "忘却前夜通关感想",
      "author": "user_abc123",
      "engagement": 256,
      "tags": ["忘却前夜", "Morimens", "游戏推荐"],
      "content_type": "post",
      "metadata": {
        "collected_date": "2026-03-29"
      }
    }
  ]
}
```

---

## 注意事项

- **不要采集用户隐私信息**：不记录邮箱、手机号等个人信息；用户名/UID 是公开信息，可以记录
- **内容真实完整**：不要主观筛选，正面负面都要采集，sentiment 字段如实填写
- **避免重复**：如果文件已存在，检查是否有重叠的 `source_url` 或相同内容
- **采集量建议**：每次采集最近 7 天内的高互动内容，每平台 10-50 条即可
