# 做梦 Agent 三层系统（active hub）

> 主题入口卡 / Code-memory batch 1 落档 2026-05-03
> 决策版本号：v1.1（2026-04-26 浅睡加索引重建步骤）
> 上游档案：`memory/dreaming-agent-design.md`（详细设计 86 行）+ `memory/advanced-memory-design.md`
> 实现：`scripts/dream.py` + `.github/workflows/dream.yml`

---

## 一、引文 + 摘要

> 「做梦 Agent 是银芯记忆系统的『后台维护』层——三层 cron 节奏（浅睡 / 深睡 / REM），各司其职。」（`memory/dreaming-agent-design.md` §一）

**一句话摘要**：做梦 Agent 通过三层 cron 节奏自动维护银芯记忆系统——**浅睡（每 6 小时）**做结构检查 + 哨兵扫描 + 索引重建 + 启动快照刷新；**深睡（每日 19:00 UTC）**做 Claude 趋势分析 + 知识缺口识别；**REM（每周一 01:00 UTC）**做 Claude 周报 + 经验提炼。零 API 成本（浅睡）+ AI 驱动（深睡 / REM）混合架构。

---

## 二、当前结论（2026-05-03 截）

### 三层节奏与职责

| 层 | Cron 频率 | API 成本 | 主要动作 |
|---|---|---|---|
| **浅睡 Shallow Sleep** | 每 6 小时 (`0 */6 * * *`) | 零（纯 Python）| 结构检查 + 哨兵扫描 + 索引重建（v1.1 新增）+ boot snapshot 刷新 + dream journal 落档 |
| **深睡 Deep Sleep** | 每日 19:00 UTC (`0 19 * * *`) | Claude API | Phase 2 趋势分析 + 知识缺口识别 + 失败模式提取 |
| **REM** | 每周一 01:00 UTC (`0 1 * * 1`) | Claude API | 周报生成 + 长期经验提炼 + 写入 lessons-learned |

### 浅睡 step 序列（v1.1 现状）

```
1. checkout repo (full depth)
2. setup Python 3.11
3. dream.py --report (Phase 1 structural + sentinel)
4. data collection health check
5. workflow health check
6. path-check (12 critical files)
7. memory freshness check (>14 days warns)
8. Rebuild RAG indexes (v1.1 new) — memory_search --build + knowledge_graph --build + integrity check
9. Commit dream journal + index artifacts
10. Report anomalies (open / comment Issue)
```

### 深睡 step 序列

```
1. needs: shallow-sleep
2. dream.py --deep (Phase 2 with ANTHROPIC_API_KEY)
3. Process trend signals + knowledge gaps
4. Commit deep dream journal
```

### REM step 序列

```
1. needs: shallow-sleep
2. dream.py --rem (weekly digest)
3. Generate weekly report
4. Extract lessons → memory/lessons-learned.md
```

### 自愈链路（v1.1 关键改进）

| 问题 | v1.0 | v1.1 |
|---|---|---|
| `assets/data/vectors.json.gz` 损坏（gzip EOF）| 浅睡不重建，需人工触发 | 浅睡每 6 小时自动 `memory_search --build` + 完整性自检 |
| `assets/data/knowledge-graph.json` 缺失 | 浅睡不重建 | 浅睡每 6 小时自动 `knowledge_graph --build` |
| 索引体积告警（< 1MB / > 50MB）| 无监测 | sentinel 体系延伸（建议 K，未实施）|

详见 `memory/lessons-learned.md` #31 — 索引自维护链路缺失修复。

### 哨兵层（Sentinel Layer）

浅睡内建零成本异常检测，覆盖：
- Steam 评论数突变
- Bilibili 视频活跃度突变
- Discord 消息量突变
- Workflow 失败超 48h 视为 stale
- 断裂引用（memory/* 中提到的文件实际不存在）
- 报告差异超基线 2σ

输出：`projects/news/output/alerts.json` + Issue 自动创建（标签 `dream`）

---

## 三、相关档案

### 设计与实现源头

- `memory/dreaming-agent-design.md` — 三层架构设计文档 86 行
- `memory/advanced-memory-design.md` — 9 模块完整设计（含做梦 Agent 在体系内的位置）
- `scripts/dream.py` — 主实现文件 1900+ 行（4-Phase AutoDream Memory Consolidation System）
- `.github/workflows/dream.yml` — GitHub Actions 三层 cron 调度

### 配套数据资产

- `memory/dreams/` — Dream journals（日产出）
- `memory/dreams/access-log/` — 文件访问日志（`.searchignore` 30 天阈值清扫对象）
- `assets/data/sentinel-baseline.json` — 哨兵基线（每日浅睡更新）
- `assets/data/archive-integrity.json` — 档案完整性快照（每日浅睡更新）
- `assets/data/vectors.json.gz` — TF-IDF 索引（v1.1 起每 6 小时浅睡重建）
- `assets/data/knowledge-graph.json` — 知识图谱（v1.1 起每 6 小时浅睡重建，gitignored）
- `projects/news/output/alerts.json` — 哨兵告警（每日浅睡更新）

### 关联文件 / 教训

- `memory/lessons-learned.md` #31 — 索引自维护链路缺失（v1.1 修复根因）
- `memory/lessons-learned.md` #28 — Cloudflare HTTP 413（与 dream.yml push 重试相关）
- `memory/rag-performance-baseline.md` — 2026-04-26 RAG 基线报告（dream.yml T5 审计源头）

### 相关 Workflow

- `.github/workflows/update-news.yml` — 每日聚合（浅睡监控其健康度）
- `.github/workflows/discord-archive.yml` — 每日 Discord 归档（哨兵监控）
- `.github/workflows/deploy-site.yml` — push 触发（不在做梦层管辖内）

---

## 四、新会话快速核对清单

诊断做梦系统时执行：

```bash
# 1. 看最近一次浅睡 journal
ls -lt memory/dreams/*.json | head -3

# 2. 看哨兵告警
cat projects/news/output/alerts.json | head -30

# 3. 验证索引完整性（v1.1 起每 6 小时自动跑此检查）
python -c "import gzip,json; d=json.load(gzip.open('assets/data/vectors.json.gz')); print('chunks:', d['meta']['chunks_count'])"

# 4. 看知识图谱节点数
python scripts/knowledge_graph.py --stats

# 5. 触发手动浅睡（测试）
python scripts/dream.py --report
```

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-04 | 三层节奏初版上线 | 主控台 |
| v1.1 | 2026-04-26 | 浅睡 cron 加索引重建步骤（lesson #31 修复）| Code-memory |
| v1.1-hub | 2026-05-03 | 主题入口 hub 落档（Code-memory batch 1）| Code-memory 艾瑞卡 |
