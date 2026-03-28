# 忘却前夜 Morimens - 全球情报报告系统

> 自动收集、分析、生成忘却前夜（Morimens）全球社区情报日报。

---

## 项目概览

本子项目是独立的全球信息收集与报告生成系统，与主项目的社区热点聚合互补。重点在于**多区域数据采集、结构化分析、报告自动化**。

### 与主项目的区别

| 特性 | 主项目 (社区热点聚合) | 本项目 (全球情报报告) |
|------|---------------------|---------------------|
| 定位 | 实时热点展示 | 结构化情报分析报告 |
| 更新频率 | 每小时 | 每日 2 次 |
| 输出格式 | 单一 JSON | JSON + HTML 报告 + RSS |
| 分析深度 | 热点排序 | 话题分类 + 区域分析 + 平台活跃度 |
| 数据源 | 5 个 | 6 个 (含 YouTube) |

### 核心功能

- **多平台采集** — Reddit / Twitter / Bilibili / TapTap / NGA / YouTube
- **多区域覆盖** — 中文社区 (cn) / 全球社区 (global)
- **结构化报告** — 含总览、Top 10、平台分析、话题分类、区域对比
- **AI 摘要** — Claude API 自动生成每日情报总结
- **多格式输出** — JSON 数据 + HTML 报告 + RSS Feed
- **交互式仪表盘** — 带 Tab 切换、搜索、响应式设计
- **GitHub Actions** — 每日自动运行，生成并提交报告

---

## 项目结构

```
report-system/
├── index.html                          # 交互式报告仪表盘
├── data/
│   ├── collected_raw.json              # 原始采集数据
│   ├── report.json                     # 结构化报告 (JSON)
│   ├── report.html                     # 独立 HTML 报告
│   └── feed.xml                        # RSS/Atom Feed
├── scripts/
│   ├── collector.py                    # 全球信息收集器
│   ├── reporter.py                     # 报告生成器
│   └── run_all.py                      # 一键运行
├── .github/
│   └── workflows/
│       └── generate-report.yml         # GitHub Actions 自动化
├── .env.example                        # 环境变量模板
├── requirements.txt                    # Python 依赖
└── README.md                           # 本文件
```

---

## 快速开始

### 1. 安装依赖

```bash
cd report-system
pip install -r requirements.txt
```

### 2. 一键运行

```bash
python scripts/run_all.py
```

### 3. 查看报告

- 打开 `index.html` — 交互式仪表盘
- 打开 `data/report.html` — 独立 HTML 报告
- 查看 `data/report.json` — 结构化 JSON 数据
- 订阅 `data/feed.xml` — RSS Feed

### 4. 配置数据源 (可选)

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|------|------|
| `TWITTER_BEARER_TOKEN` | Twitter API v2 Token |
| `YOUTUBE_API_KEY` | YouTube Data API v3 Key |
| `NGA_FORUM_ID` | NGA 忘却前夜版块 ID |
| `TAPTAP_APP_ID` | TapTap 应用 ID |
| `LLM_API_KEY` | Anthropic API Key (AI 摘要) |

> 不配置也可运行，会自动跳过对应数据源。

---

## 报告数据结构

```json
{
  "report_id": "RPT-20260328-0700",
  "generated_at": "2026-03-28T07:00:00+00:00",
  "period": { "hours": 24, "from": "...", "to": "..." },
  "overview": {
    "total_items": 15,
    "total_engagement": 52840,
    "active_sources": 4,
    "hot_items_count": 6
  },
  "summary": "...",
  "top_items": [...],
  "analysis": {
    "topics": { "strategy": {...}, "character": {...}, ... },
    "platforms": { "bilibili": {...}, "reddit": {...}, ... },
    "regions": { "cn": {...}, "global": {...} }
  },
  "all_items": [...]
}
```

---

## 自动化流程

```
GitHub Actions (每日 00:00 / 12:00 UTC)
        │
        ▼
  collector.py → 采集全球数据
        │
        ▼
  reporter.py → 生成报告 (JSON + HTML + RSS)
        │
        ▼
  git commit & push
        │
        ▼
  GitHub Pages 部署
```

---

## 技术栈

- **前端**: HTML + CSS + JavaScript (无框架)
- **后端**: Python 3.11+
- **AI**: Claude API (Haiku, 可选)
- **部署**: GitHub Pages + GitHub Actions
- **Feed**: feedgen (Atom/RSS)
