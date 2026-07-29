---
name: last30days
description: >-
  查任意话题近 30 天的社区真实讨论（舆情横切）。Use when the keeper asks
  「/last30days X」「X 最近 30 天什么情况」「最近大家怎么说 X」or wants a
  recency-windowed community pulse on any topic. 银芯原生轻量实现：AnySearch
  时间窗检索 + 免费公开 API（HN Algolia / Polymarket），零 cookie 零抓取零 key。
---

# last30days（银芯原生）

任意话题近 30 天社区舆情横切。设计参照 mvanhorn/last30days-skill 的研究结论
（报告：`Public-Info-Pool/Resource/repo-engineering/last30days-skill-research-20260729.md`），
但**不引入其 cookie / 抓取通道**。

## 合规红线（守密人 2026-07-29 裁定，硬边界）

只走公开搜索 API 与银芯既有 anysearch 通道。**绝不**引入浏览器 cookie、平台
抓取（scraping）通道或任何需要向第三方平台伪装身份的采集方式——银芯公开定位
不解除第三方平台 ToS 约束（CLAUDE.md §0）。

## 步骤 0：查询计划（你就是 Planner）

不外接任何规划服务。自行完成：

1. 判话题类型：人物 / 产品 / 事件 / 对比（含 vs）/ Morimens 域内。
2. 拆 2–4 条检索式：话题本名 + 常用别名 + 英文名（或中文名）+ 一条争议点/
   动态角度式（如 "X controversy" / "X 更新"）。对比题按实体各拆一组。
3. 算窗口：今日往前 30 天，起止日期记下来（写进输出首行锚）。

## 步骤 1：并行采集

按适用性选源，能并行的并行：

- **AnySearch（主通道，多语区）**：每条检索式一跑
  `python3 .claude/skills/anysearch/scripts/search.py "<query>" --max-results 8 --freshness month`
- **Hacker News（技术话题）**，免 key，注意 URL 编码与 30 天数值过滤：
  `curl -sS -G "https://hn.algolia.com/api/v1/search_by_date" --data-urlencode "query=<q>" --data-urlencode "numericFilters=created_at_i>$(($(date +%s)-2592000))" --data-urlencode "hitsPerPage=10"`
  评论条目无 `title` 字段，用 `story_title` 回落；`points`/`num_comments` 即参与度信号。
- **Polymarket（重大事件 / 政经 / 加密，真金赔率）**，免 key：
  `curl -sS "https://gamma-api.polymarket.com/events?closed=false&limit=20"` 后按关键词过滤，
  或加 `--data-urlencode` 走其检索参数。
- **Morimens 域内话题（银芯独有优势）**：先查自有全量档案层——
  `projects/news/index/community_index.json` 看月度聚合，需钻取则经
  `BIAV_SC_DATA_ROOT` 指向的数据仓 ripgrep 原文（读法见 CLAUDE.md §5.2）。
- **WebSearch（兜底）**：AnySearch 失败时以同 query 回落。

## 步骤 2：综合与输出契约

- **首行锚（防漂移）**：`last30days(银芯) · {话题} · 窗口 {YYYY-MM-DD}–{YYYY-MM-DD}`
- 结论先行，其后证据按源分组；每条证据附**日期 + 参与度数字**（points /
  评论数 / 播放量 / 赔率），链接与比喻照 CLAUDE.md §2.2 硬规则。
- **30 天窗口纪律**：窗口外材料默认丢弃；确需背景时单列并明标「窗外背景」。
- **诚实空结果**：采不到就写明「本窗口无扎实结论」+ 各源覆盖状态
  （成功 / 零命中 / 失败要分开说），禁止用旧料或臆测凑数。

## 发射前自检（发出前过三问）

1. 每条引证的日期都在窗口内吗（或已明标「窗外背景」）？
2. 每条链接都取自检索结果原文吗（**禁止**凭记忆重构 URL）？
3. 有没有把「某源采集失败」写成了「该平台无人讨论」？（失败 ≠ 沉默）

## 降级规则（绝不空手而归）

- AnySearch 非零退出 / 零结果 → WebSearch 同 query 重试；
- 单个免费 API 失败 → 点名跳过该源，并在覆盖状态中如实披露；
- 全部通道失败 → 报告采集失败与原因，不臆造任何「研究结果」。
