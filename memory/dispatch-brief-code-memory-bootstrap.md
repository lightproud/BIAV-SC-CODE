# 派发 Brief — Code-memory 启动 + 索引修复 + 命题解答

> 落档日期：2026-04-26
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-memory 新会话（守密人首次启动）
> 验收方：守密人 / 主控台
>
> 上游依据：守密人 2026-04-26 命题「游戏的素材配置解包内容也上传了 是事实学习机会 但是如何让你的上下文能理解呢」
>
> 状态：待 Code-memory 会话启动后取用

---

## 一、Code-memory 角色定义（新建）

**Code-memory = 银芯记忆基础设施维护者**

CLAUDE.md 原有 6 角色（主控台 / site / news / wiki / game / 战略参谋）均未覆盖 `scripts/` 下的 9 模块记忆系统与 `assets/data/` 下的索引文件。Code-memory 填补此缺口。

### 1.1 职责范围

- **维护 `scripts/` 下记忆系统 9 模块**：`memory_search.py` / `knowledge_graph.py` / `memrl.py` / `dream.py` / `mcp_server.py` / `context_manager.py` / `reflexion.py` / `session_briefing.py` / `memory_writeback.py`
- **维护 `assets/data/` 下索引文件**：`vectors.json.gz` / `knowledge-graph.json` / `memory-utility.json` / `sentinel-baseline.json`
- **维护 `.github/workflows/dream.yml`**：浅睡 / 深睡 / REM 三层 workflow（如需调整）
- **优化 RAG 链条**：分块策略 / embedding 升级 / 知识图谱节点扩展 / 检索召回率
- **响应「让上下文理解 X 数据」类命题**：从基础设施视角给方案

### 1.2 不负责的范围

- ❌ `projects/wiki/`、`projects/news/`、`projects/site/`、`projects/game/`（仍归各 Code-* 会话）
- ❌ `memory/` 下的内容文件（决策 / 战略 / lessons-learned 等由主控台维护）
- ❌ 业务数据落盘（characters.json 等）
- ✅ 但可**只读访问**全仓库以索引/分析

### 1.3 边界硬约束（来自 lesson #27 适配）

- Code-memory 写**索引相关代码**（scripts/ 下记忆模块）算职责内
- 写**业务数据**（如修改 characters.json）算越界
- 索引重建/维护属基础设施运维，可直接执行

---

## 二、本次任务命题

守密人原话：「现在游戏的素材配置解包内容也上传了 是事实学习机会 但是如何让你的上下文能理解呢」

**命题分解**：

1. **背景事实**：仓库内已有 64M 解包数据
   - `projects/wiki/data/extracted/lua_tables/*.lua`（25 个原始游戏配置）
   - `projects/wiki/data/extracted/categorized/*.txt`（角色台词 / 技能 / 关卡中文文本）
   - `projects/wiki/data/extracted/art_assets/`（艺术资源）
   - `projects/wiki/data/processed/*.json`（已结构化的 11 个 JSON）
   - `projects/wiki/data/db/*.json`（schema 校验入口）

2. **核心矛盾**：AI 上下文窗口（Opus 200K token ≈ 800KB 文本）vs 64M 数据，差 80 倍

3. **银芯既定答案**：RAG（Retrieval-Augmented Generation）—— 不全量加载，按需检索

4. **当前阻塞**：
   - `assets/data/vectors.json.gz` **损坏**（gzip EOF before end-of-stream）
   - `assets/data/knowledge-graph.json` **不存在**
   - 即调 `memory_search.py "查询"` 也无结果

---

## 三、子任务拆解

### T1：索引修复（最高优先级，立即执行）

```bash
python scripts/memory_search.py --build      # 重建 TF-IDF
python scripts/knowledge_graph.py --rebuild  # 重建知识图谱
python scripts/dream.py --rebuild            # 触发预计算缓存重算
```

预期产物：
- `assets/data/vectors.json.gz` 完整且可读
- `assets/data/knowledge-graph.json` 存在
- 三个命令全部 exit 0

如重建过程中发现根因（如某个文件导致索引中断），记录到 `memory/lessons-learned.md`。

### T2：RAG 检索实测

修复后验证以下查询能否返回有意义结果（贴查询命令 + 头 3 条召回片段到验收报告）：

| 查询 | 期望命中类型 |
|---|---|
| `"沙耶之歌"` | B 站 engagement 519 的高引战话题原文 / 相关讨论 |
| `"四大界域 Aequor"` | 界域设定 / 界域对应角色 |
| `"指令牌"` | 卡牌系统三类之一的设定 |
| `"v2.5 联动"` | 版本线 + 联动事件记录 |
| `"AwakerConfig"` | 唤醒体配置原始 lua 表 |

### T3：RAG 性能与局限报告

撰写 `memory/rag-performance-baseline.md`，包含：
- 索引规模（文件数 / 总 token 数 / 索引体积）
- 检索延迟（典型查询 P50 / P95）
- 召回率评估（T2 查询的主观评分）
- 当前局限（颗粒度 / 中文分词 / 多语言）
- 改进建议（embedding 升级路径 / 分块策略 / 知识图谱扩展节点）

### T4：建议改进路径（不立即执行）

针对游戏数据特性，提议未来扩展：
- 游戏实体（角色/技能/关卡/命轮）作为知识图谱一等节点
- lua 表配置加专门解析器（按 key 分块而非全文）
- 三语翻译双向映射（zh ↔ en ↔ ja）
- 上下文管理 4 层推荐增加「游戏事实优先」维度

把建议写入 T3 报告末尾，供主控台 + 守密人后续决策。

### T5：dream.yml 自维护性核查

确认 `.github/workflows/dream.yml` 浅睡（每 6 小时）任务是否包含索引重建。如未包含，提议补丁让索引保持新鲜。**不直接改 workflow**——发现后报告主控台。

---

## 四、不在范围内（明确边界）

- ❌ 不动 `projects/wiki/data/db/characters.json` 等业务数据
- ❌ 不动 `projects/site/`、`projects/news/`、`projects/wiki/docs/` 子项目
- ❌ 不动 `memory/` 下的内容文件（决策 / 战略文档）
- ❌ 不修 `.github/workflows/dream.yml`（发现问题报告而非自改）
- ✅ 仅修 `scripts/` 下记忆模块代码 + `assets/data/` 索引文件
- ✅ T3 报告 `memory/rag-performance-baseline.md` 是元产物，可直接落档

---

## 五、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | T1 三命令全部 exit 0 | 命令行 |
| 2 | `vectors.json.gz` 体积 > 100K 且 `python -c "import gzip,json; print(json.load(gzip.open('assets/data/vectors.json.gz')).get('docs', 'NA'))"` 不报错 | 命令行 |
| 3 | `knowledge-graph.json` 存在且节点数 > 100 | 命令行 |
| 4 | T2 五个查询全部返回非空结果 + 召回片段贴入报告 | 验收报告 |
| 5 | T3 报告 `memory/rag-performance-baseline.md` 落档 + 含 T4 建议章节 | 文件存在 |
| 6 | 不触碰 § 四列出的禁区文件 | `git diff --stat` 检查 |

---

## 六、提交规范

- 直推 main（按当前政策）
- commit message 建议结构：
  ```
  fix(memory): rebuild corrupted indexes (vectors + graph)

  - vectors.json.gz: gzip EOF root cause = [your finding]
  - knowledge-graph.json: regenerated with N nodes / M edges
  - RAG baseline measured at memory/rag-performance-baseline.md

  Code-memory bootstrap dispatch (memory/dispatch-brief-code-memory-bootstrap.md).
  ```

---

## 七、艾瑞卡角色规则提醒

Code-memory 会话仍以**艾瑞卡**自称，对守密人使用「守密人」称谓，技术操作用角色术语（修正档案 / 数据归档提交 / 同步至远端存储 / 代码扫描 / 索引重建 / 知识图谱重构）。完整规则见 `CLAUDE.md` 顶部「角色人格」章节。

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 初版 brief 落档（Code-memory 角色首次定义 + 索引修复 + RAG 实测命题） | 主控台艾瑞卡 opus4.7 |

---

> **派发完成后，主控台职责**：
> 1. 把 Code-memory 角色写入 `memory/decisions.md`（守密人确认后）
> 2. 把 Code-memory 写入 `CLAUDE.md` 会话角色表
> 3. 验收 Code-memory 报告，决策 T4 建议是否启动
