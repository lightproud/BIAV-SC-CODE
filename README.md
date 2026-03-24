# 忘却前夜 Morimens - 全球社区热点聚合

> 实时聚合忘却前夜（忘卻前夜 / Morimens）全球社区 24 小时内的热点话题与每日总结。

---

## 项目概览

本项目是一个轻量级的社区热点聚合页面，自动从多个平台抓取忘却前夜相关的热门讨论，并以统一的界面呈现给玩家。

### 核心功能

- **多平台聚合** — 覆盖 Reddit、Twitter/X、B站、TapTap、NGA、Discord、YouTube、官方公告
- **24 小时热点** — 只展示最近 24 小时内的内容，保持信息时效性
- **每日 AI 总结** — 可选接入 Claude API，自动生成当日社区动态摘要
- **按平台筛选** — 一键切换查看不同平台的内容
- **热门标记** — 高互动量内容自动标记为热门
- **自动更新** — GitHub Actions 每小时抓取，前端每 5 分钟刷新
- **响应式设计** — 适配桌面和移动端

---

## 页面效果预览

### 页面结构

```
┌─────────────────────────────────────────────┐
│          忘却前夜 社区热点聚合                  │
│    忘卻前夜 / Morimens - Global Community     │
│              🟢 最后更新：xx:xx               │
├─────────────────────────────────────────────┤
│    12 热点话题  │  7 数据源  │  15.8w 总互动   │
├─────────────────────────────────────────────┤
│ [全部] [官方] [Reddit] [Twitter] [B站] ...   │
├─────────────────────────────────────────────┤
│                                             │
│  📋 今日总结                                 │
│  今日社区热点：2.0版本「永夜序章」正式公告       │
│  引爆全平台讨论；新角色「赫尔墨斯」立绘与        │
│  技能曝光...                                 │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ 【官方公告】2.0版本前瞻直播      🔥热门 │    │
│  │ 官方确认前瞻直播时间，届时将公布      │    │
│  │ 新章节剧情、新角色、新玩法...         │    │
│  │ [官方] 🕐 2小时前 💬 5.3w           │    │
│  │ [版本更新] [前瞻直播] [2.0]          │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ New character Hermes leaked      🔥热门 │    │
│  │ Datamined info on upcoming 5-star     │    │
│  │ character reveals a unique time...     │    │
│  │ [Reddit] 🕐 3小时前 💬 3.4k          │    │
│  │ [新角色] [赫尔墨斯] [数据挖掘]        │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Morimens x EVA collaboration!    🔥热门 │    │
│  │ Official Twitter revealed an EVA      │    │
│  │ collaboration event coming in 2.0...  │    │
│  │ [Twitter/X] 🕐 6小时前 💬 2.9w       │    │
│  │ [联动] [EVA] [官方]                   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│          ... 更多热点卡片 ...                │
│                                             │
├─────────────────────────────────────────────┤
│  数据来源：Reddit · Twitter/X · Bilibili     │
│  · TapTap · NGA · Discord · YouTube         │
└─────────────────────────────────────────────┘
```

### 设计风格

- **深色主题** — 深蓝紫色系背景 (`#0a0a1a`)，护眼且有游戏氛围
- **渐变头部** — 紫蓝渐变 Banner，带微妙纹理
- **卡片布局** — 每条热点为一张卡片，悬停时微微上浮并高亮边框
- **彩色标签** — 不同平台使用专属配色：
  - Reddit → 橙色
  - Twitter/X → 蓝色
  - B站 → 天蓝色
  - TapTap → 绿色
  - NGA → 琥珀色
  - Discord → 靛蓝色
  - YouTube → 红色
  - 官方 → 紫色

---

## 项目结构

```
.
├── index.html                    # 前端页面（纯静态 HTML/CSS/JS）
├── data/
│   └── news.json                 # 聚合数据文件
├── scripts/
│   └── aggregator.py             # Python 数据聚合脚本
├── .github/
│   └── workflows/
│       └── update-news.yml       # GitHub Actions 定时任务
├── .env.example                  # 环境变量配置模板
├── .gitignore
├── requirements.txt              # Python 依赖
└── README.md                     # 本文件
```

---

## 数据源与覆盖范围

| 平台 | 数据获取方式 | 需要 API Key | 备注 |
|------|------------|:----------:|------|
| Reddit | 公开 JSON API | 否 | r/Morimens 等子版块 |
| Twitter/X | API v2 | 是 | 搜索关键词相关推文 |
| Bilibili | 搜索 API | 否 | 搜索忘却前夜相关视频 |
| TapTap | 社区 API | 否 | 需配置 APP_ID |
| NGA | 论坛 API | 否 | 需配置版块 FID |
| Discord | - | - | 计划支持（需 Bot） |
| YouTube | - | - | 计划支持 |

---

## 快速开始

### 1. 本地预览

直接用浏览器打开 `index.html`，将使用 `data/news.json` 中的示例数据渲染页面。

### 2. 部署到 GitHub Pages

1. 在 GitHub 仓库 Settings → Pages 中启用 GitHub Pages
2. 选择 `main` 分支，根目录 (`/`)
3. 页面将自动部署

### 3. 配置数据源

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 说明 | 必填 |
|-------------|------|:----:|
| `TWITTER_BEARER_TOKEN` | Twitter API v2 Bearer Token | 可选 |
| `NGA_FORUM_ID` | NGA 忘却前夜版块 ID | 可选 |
| `TAPTAP_APP_ID` | TapTap 忘却前夜应用 ID | 可选 |
| `LLM_API_KEY` | Anthropic API Key（用于 AI 总结） | 可选 |

### 4. 手动运行聚合

```bash
pip install -r requirements.txt
python scripts/aggregator.py
```

---

## 示例数据

当前 `data/news.json` 包含 12 条示例热点，涵盖：

| 标题 | 平台 | 互动量 |
|------|------|--------|
| 2.0版本「永夜序章」前瞻直播定档 | 官方 | 5.3w |
| Morimens OST 官方 MV | YouTube | 4.2w |
| Morimens x EVA 联动公告 | Twitter | 2.9w |
| 赫尔墨斯技能翻译+机制解析 | B站 | 1.9w |
| 全角色节奏榜更新 (1.8版本) | NGA | 1.6w |
| 同人创作大赛获奖作品 | B站 | 1.2w |
| TapTap 评分突破 9.2 | TapTap | 8.9k |
| Discord 开发者问答摘要 | Discord | 6.1k |
| 2.0 深渊配队讨论 | NGA | 4.2k |
| New character Hermes leaked | Reddit | 3.4k |
| 周年登录奖励提醒 | Discord | 2.3k |
| Athena banner 抽卡建议 | Reddit | 1.9k |

---

## 自动更新机制

```
GitHub Actions (每小时)
        │
        ▼
  aggregator.py 运行
        │
        ├── 抓取 Reddit
        ├── 抓取 Bilibili
        ├── 抓取 Twitter (如已配置)
        ├── 抓取 NGA (如已配置)
        └── 抓取 TapTap (如已配置)
        │
        ▼
  去重 + 排序 + AI 总结
        │
        ▼
  写入 data/news.json
        │
        ▼
  git commit & push
        │
        ▼
  GitHub Pages 自动部署
        │
        ▼
  前端每 5 分钟刷新数据
```

---

## 技术栈

- **前端**: 纯 HTML + CSS + JavaScript（无框架依赖）
- **后端**: Python 3.11+
- **部署**: GitHub Pages + GitHub Actions
- **AI 总结**: Claude API (Haiku, 可选)

---

## 后续计划

- [ ] 接入 Discord Bot 获取官方服务器讨论
- [ ] 接入 YouTube Data API 获取热门视频
- [ ] 添加搜索功能
- [ ] 添加话题趋势图表
- [ ] 支持多语言切换（中/英/日）
- [ ] 添加 RSS 订阅输出
- [ ] PWA 支持（离线访问、推送通知）
