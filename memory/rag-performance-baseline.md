# RAG 性能与局限基线 — Code-memory 首次落档

> 最后更新：2026-04-26 by Code-memory（艾瑞卡 opus4.7 自启会话）
> 上游依据：`memory/dispatch-brief-code-memory-bootstrap.md` § T3
> 关联命题：守密人 2026-04-26「游戏的素材配置解包内容也上传了 是事实学习机会 但是如何让你的上下文能理解呢」

---

## 一、索引规模

| 指标 | 数值 | 备注 |
|---|---|---|
| 索引覆盖文件数 | 3029 | `memory_search.py` 全覆盖扫描结果 |
| 文本切分块数 | 115822 chunks | 中文双字符分词 + 英文 token |
| TF-IDF 词汇表 | 15000 词 | 压缩到 15000 维稀疏向量 |
| 索引体积（压缩） | 30.27 MB | `assets/data/vectors.json.gz` |
| 知识图谱节点数 | 223 | `assets/data/knowledge-graph.json` |
| 知识图谱边数 | 565 | depends_on / mentions / contains / belongs_to / related_to |
| 图谱体积 | 169.6 KB | 未压缩 JSON |

### 文件分类分布

| 类别 | 文件数 | 占比 |
|---|---|---|
| news（新闻聚合产物）| 1647 | 54.4% |
| discord（Discord 归档）| 915 | 30.2% |
| memory（结构化记忆）| 285 | 9.4% |
| wiki-docs（VitePress 文档）| 69 | 2.3% |
| wiki-data（处理后数据）| 48 | 1.6% |
| scripts（Python 脚本）| 27 | 0.9% |
| other（其他）| 17 | 0.6% |
| ci（GitHub Actions）| 14 | 0.5% |
| assets（资产元数据）| 7 | 0.2% |

### 关键覆盖检查（守密人命题答案）

`projects/wiki/data/extracted/` 解包数据 **44.2 MB 已纳入索引**：

| 子目录 | chunk 数 |
|---|---|
| `lua_tables/*.lua` | 1741 chunks |
| `categorized/*.txt` | 8193 chunks |
| `extracted/` 全部 | 9934 chunks |
| 含 "AwakerConfig" 字串的 chunk | 294 |

**结论 #1**：64 MB 解包数据 → 30 MB 压缩 TF-IDF 索引，约 50% 体积压缩；800KB 上下文窗口可按需拉取最相关的 5-10 chunks（每 chunk ≈ 200-500 字符），**RAG 链条物理上可行**。

---

## 二、检索延迟

测试方法：用 brief 第三节 T2 的 5 个查询逐条执行 `python3 scripts/memory_search.py "<query>"`，含进程启动 + 索引加载（30 MB gzip 解压 + 15000 维 IDF 反序列化）。

| 指标 | 延迟 |
|---|---|
| P50 | 4.92 s |
| P95 | 5.03 s |
| 平均 | 4.95 s |
| 单查询最低 | 4.87 s |
| 单查询最高 | 5.03 s |

**主要开销**：每次冷启动 Python 解释器 + 解压 30 MB gzip + 加载词表。**实际 TF-IDF 余弦计算耗时不到 100 ms**。

**改进路径**：常驻进程 / MCP server 模式（`scripts/mcp_server.py` 已实现）可把 P50 降到 200-500 ms（消除冷启动）。

---

## 三、召回效果实测（T2 五查询）

### Q1：「沙耶之歌」— ✅ 优

```
[1] memory/boot-snapshot.md            final=0.724  日报含「单簧管《沙耶の唄》ED engagement: 179」
[2] projects/news/output/all-latest.json  final=0.566  bilibili 原始数据
[3] projects/news/output/bilibili-latest.json  final=0.566  同上
```

**判定**：命中权威启动快照 + 4 条 bilibili 原始数据，含 ED 改编 / 第三期视频 / 同人立绘 / fumo 周边等多元话题。语义重排序权重正确。

### Q2：「四大界域 Aequor」— ⚠ 中

```
[1] projects/news/data/platforms/steam_review/2025-06-02.json  final=0.576  「I LOVE AEQUOR RAHHHHHH」
[2-5] memory/session-digests/*  final=0.479  无关分支名 review-1AH5Z 的字面 R 命中
```

**判定**：Aequor 命中 Steam 评论但无设定文档命中。其余 4 条因 session-digest 中有「review-1AH5Z」分支名，"R" 字符相似度刷分。

**根因**：`projects/wiki/data/db/realms.json` 不存在（knowledge_graph 内 `extract_realms` 输出 `Realms: 0 nodes, 0 edges`），界域设定数据**未结构化落档**。

### Q3：「指令牌」— ❌ 差

```
[1-5] memory/session-digests/*  final=0.440-0.442  全部为「指令」字符的会话日志命中
```

**判定**：5 条全是不同 session-digest 中提到「指令」字符的代码片段（如「执行指令」「指令牌」），**无任何卡牌系统设定文档命中**。

**根因**：忘却前夜的卡牌系统三类（指令牌 / 命运牌 / 灵魂牌）**没有任何专项设定文档**进入仓库。`assets/data/design-decisions.json` 与 `memory/morimens-context.md` 也未覆盖。Code-wiki 应在 Phase 2 补齐。

### Q4：「v2.5 联动」— ✅ 优

```
[1] memory/collab-event-playbook.md       final=0.692  联动剧本完整
[2] memory/strategic-plan-2026.md         final=0.681  联动战略章节
[3-5] projects/news/data/discord/activity_daily/*  final=0.374-0.388  历史活跃度
```

**判定**：命中 collab-event-playbook + strategic-plan-2026 联动战略章节，主题精准。3 条 Discord 活跃度数据为历史背景，可接受。

### Q5：「AwakerConfig」— ⚠ 中

```
[1-5] memory/session-digests/*  final=0.544-0.553  全部是「grep -c "^AwakerConfig_15560_..."」会话历史命令片段
```

**判定**：lua 表原始数据已有 1741 chunks 入索引，`projects/wiki/data/extracted/lua_tables/AwakerConfig.lua` 真实存在且 294 chunks 含 "AwakerConfig" 字串，但 TF-IDF 排序把 session-digest 中的「重复 grep 命令」拍到前列——**lua 原文反而落到第 6 位之后**。

**根因**：session-digest 文档短而 query token 重复多次（高 TF），lua 原始文件长而每个 chunk 中 token 出现一次（中 TF），余弦得分被压低。

### 主观召回率综合评分

| 查询 | 头 5 条相关性 | 评级 |
|---|---|---|
| Q1 沙耶之歌 | 5/5 高度相关 | 优 |
| Q2 四大界域 Aequor | 1/5 高度相关，4/5 巧合命中 | 中 |
| Q3 指令牌 | 0/5 实质命中 | 差（数据缺失）|
| Q4 v2.5 联动 | 2/5 高度相关，3/5 历史背景 | 优 |
| Q5 AwakerConfig | 0/5 命中 lua 原文 | 中（排序偏差）|

**Top-1 准确率**：3/5 = 60%
**Top-5 召回完备率**：2/5（Q1 / Q4）能完整覆盖主题

---

## 四、当前局限

### 1. 排序偏差 — session-digest 噪音

会话摘要文件每日生成 1-N 份，其中常包含完整的 grep 命令、JSON 片段、错误回溯——这些短文本中的 token 重复率高，TF-IDF 评分容易压过原始数据文件。Q5 完美呈现此问题。

### 2. 设定文档缺失 — 卡牌系统 / 界域

Q2 / Q3 召回失败的根因不是检索算法，而是**仓库内根本没有这些设定的结构化文档**。RAG 只能找到已有文档里的内容。

### 3. 中文分词颗粒度

当前实现是双字符滑窗 + 英文 token。「指令牌」会被切成「指令」「令牌」「牌」三个 bigram，与「执行指令」「权限令牌」等无关上下文产生伪命中。

### 4. 多语言映射缺失

英日中三语 token 不互通。「Aequor」（拉丁）→「埃克沃」（中）→「アエクオル」（日）目前各算各的索引，无法跨语言召回。

### 5. 索引自维护断链（T5 关键发现）

`.github/workflows/dream.yml` 浅睡 cron（每 6 小时）**不调用** `memory_search.py --build` 也不调用 `knowledge_graph.py --build`，仅跑 `dream.py --report`（结构检查 + 哨兵）。

**后果**：本次启动前 `vectors.json.gz` 处于 gzip EOF 损坏状态（805K，2026-04-26 09:15 mtime），`knowledge-graph.json` 完全不存在。索引一旦损坏，cron 无自愈能力。

### 6. 知识图谱节点失衡

| 节点类型 | 数量 |
|---|---|
| Decision | 141（63%）|
| File | 32（14%）|
| Character | 24（11%）|
| Concept | 19（9%）|
| System | 7（3%）|
| Realm | 0 |

「决策档案」节点数远超角色节点。游戏实体（界域 / 技能 / 命轮 / 关卡）**未作为一等节点**纳入图谱。

---

## 五、改进建议（T4 — 不立即执行，供主控台 + 守密人裁定）

### 5.1 索引质量改进

| # | 建议 | 工作量 | 优先级 |
|---|---|---|---|
| A | session-digest 加权降权（meta 增加 doc_class 字段，TF-IDF 排序时乘 0.3-0.5 系数）| 中 | 高 |
| B | 「数据原文优先」标记 — 给 `projects/wiki/data/extracted/` 文件加权重 1.5x | 小 | 高 |
| C | 升级到 sentence-transformers / BGE 中文 embedding（替代 TF-IDF）| 大 | 中（远期）|
| D | 加常驻 MCP server 进程消除冷启动 4.5s 开销 | 小 | 中 |

### 5.2 知识图谱扩展

| # | 建议 | 工作量 | 优先级 |
|---|---|---|---|
| E | 游戏实体（**界域 Realm / 技能 Skill / 命轮 Commune / 关卡 Stage**）作为一等节点 | 中 | 高 |
| F | 三语翻译表 (`character.zh ↔ character.name_en ↔ character.name_ja`) 入图谱节点属性 | 小 | 中 |
| G | lua 表配置专项解析器（按 key 分块，例如 `AwakerConfig_15560_*` 作单独节点而非全文）| 中 | 中 |
| H | 卡牌系统三类（指令牌 / 命运牌 / 灵魂牌）补 `assets/data/card-system.json` 设定文档 | 小 | 高（守密人 / Code-wiki 决策）|

### 5.3 自维护性修复（T5）

| # | 建议 | 工作量 | 优先级 |
|---|---|---|---|
| I | 在 `dream.yml` 浅睡 cron 末尾追加 `python scripts/memory_search.py --build` + `python scripts/knowledge_graph.py --build` 步骤 | 小 | 高 |
| J | 索引断裂自检：浅睡时 `python -c "import gzip,json; json.load(gzip.open('assets/data/vectors.json.gz'))"`，捕获异常自动触发 rebuild | 小 | 高 |
| K | 索引体积阈值告警（< 1 MB 视为损坏，> 50 MB 视为膨胀）写入 sentinel 体系 | 小 | 中 |

> 按 brief § T5 约束：本次会话**不修改** `.github/workflows/dream.yml`。建议 I-K 由主控台决策后派 Code-memory 单独任务执行。

### 5.4 上下文管理 4 层推荐增维

`scripts/context_manager.py` 当前 4 层（pinned / hot / warm / cold）按通用知识相关度推荐。建议增加「**游戏事实优先**」维度：

- 守密人命题涉及游戏内容（角色 / 界域 / 卡牌 / lua 配置）→ 自动提升 `projects/wiki/data/` 类文件权重
- 命题涉及工程操作（git / workflow / 部署）→ 自动提升 `memory/decisions.md` + `memory/lessons-learned.md` 权重
- 命题涉及历史会话回顾 → 自动提升 session-digest 权重

实现方式：`context_manager.py` 加一层 query 分类器（关键词正则即可）。工作量小，收益大。

---

## 六、本次会话发现的 lesson 候选（待 lessons-learned.md 录入）

### Lesson 候选 #30：知识图谱 schema 假设漂移

- **Context**：`scripts/knowledge_graph.py` 在 4 处假设 `characters.json` 顶层是 `{"characters": [...]}` dict 结构（用 `.get("characters", [])` 访问），但实际 Phase 2 W1 自举产物是直接顶层 list（`[{...}, {...}, ...]`），导致 `--build` 抛 AttributeError。
- **Fix**：4 处均改为 `data.get("characters", []) if isinstance(data, dict) else data`，兼容两种 schema。
- **Lesson**：Schema 演进时**单点防御性写法不够**，需全文件搜索同型代码统一防御。`extract_realms` line 98 已有此模式但未传播到 `extract_characters` line 53 / line 276 / line 553 / line 640。

### Lesson 候选 #31：索引自维护链路缺失

- **Context**：`assets/data/vectors.json.gz` 长期处于 gzip EOF 损坏（805K，mtime 2026-04-26 09:15），`assets/data/knowledge-graph.json` 长期不存在。
- **Root cause**：dream.yml 浅睡只跑结构检查，**不重建索引**。索引损坏后无 cron 自愈。
- **Lesson**：「自动化定期重建」与「自动化结构检查」不是同一回事——前者必须显式声明在 cron 步骤中，否则任何中断都需要人工触发。

---

## 七、报告小结

**回答守密人命题**：「64 MB 解包数据 vs 800 KB 上下文窗口」可通过 RAG 解决，但需三步落地：

1. **当下**：索引已修复（30 MB vectors / 170 KB graph），5 查询全部返回非空，Q1 / Q4 头条命中精准。
2. **短期（建议 A / B / I / J）**：消除 session-digest 噪音 + 给 dream.yml 浅睡补索引重建步骤，召回 Top-1 准确率 60% → 80%+。
3. **中期（建议 E / G / H）**：补全卡牌系统设定 + lua 表 key 级图谱节点 + 界域结构化数据，让游戏事实成为图谱一等公民。

**待守密人裁定**：建议 H（补卡牌系统设定文档）+ 建议 I（dream.yml 索引重建步骤）是否启动专项任务。
