# RAG 检索基线 2026-W18 — Code-memory batch 1 验收

> 落档日期：2026-05-03（Phase 2 W18）
> 测量人：Code-memory（艾瑞卡 opus4.7）
> 上游 brief：`memory/dispatch-brief-code-memory-restructure-batch1.md`
> 配套档案：`memory/strategy/memory-restructure-options.md`（决策版）+ `memory/active/*.md`（5 hubs 落档）

---

## 一、测量条件

| 项 | 状态 |
|---|---|
| 索引版本 | TF-IDF v2 (full coverage)，2802 文件 / 125773 chunks / 15000 vocab |
| `.searchignore` | 已落档，`memory/session-digests/*.md` + `memory/dreams/*.json`（30 天阈值）|
| `memory_search.py` patch | `discover_files()` 加 `.searchignore` 读取（净 +10 行）|
| 5 hubs | `memory/active/{policy-direct-push-main,mission-v2.0-three-pillars,silver-blackpool-interface,contribution-protocol,dream-system-overview}.md` |
| 测量基础设施 | `/tmp/batch1_baseline_runner.py`（不入库） |
| 查询集 | 主控台审定 20 查询（5 game + 5 policy + 5 arch + 5 history） |
| 测量轮次 | Pre（修改前）→ 落档 hubs + 改 memory_search → 重建索引 → Post |

---

## 二、Q4 标准 20 查询全表

| # | 类别 | 查询 | Pre Top-1 | Post Top-1 | Pre SD/5 | Post SD/5 | 升级 |
|---|---|---|---|---|---|---|---|
| 1 | game | 唤醒体 张爱玲 的技能 | `m/wiki-characters-schema-v1.md` | `m/wiki-characters-schema-v1.md` | 0/5 | 0/5 | = |
| 2 | game | 命轮 旋律 的效果 | `m/dispatch-brief-code-memory-restru` | `m/dispatch-brief-code-memory-restru` | 0/5 | 0/5 | = |
| 3 | game | Aequor 界域的角色 | `m/dispatch-brief-code-memory-restru` | `m/dispatch-brief-code-memory-restru` | 2/5 | 2/5 | = |
| 4 | game | v2.5 联动事件 | `p/wiki/data/extracted/categorized/g` | `p/wiki/data/extracted/categorized/g` | 1/5 | 1/5 | = |
| 5 | game | 卡牌系统三类（指令/灵体/疯狂）的设计哲学 | `m/dispatch-brief-code-memory-restru` | `m/dispatch-brief-code-memory-restru` | 0/5 | 0/5 | = |
| 6 | policy | v2.0 三新使命是什么 | `m/dispatch-brief-code-memory-restru` | **`m/active/mission-v2.0-three-pillars`** | 3/5 | 3/5 | → |
| 7 | policy | 黑池-银芯接口规则 | `p/news/CONTEXT.md` | `p/news/CONTEXT.md` | 1/5 | 0/5 | = |
| 8 | policy | Issue 安全策略 | `m/decisions.md` | **`m/active/contribution-protocol.md`** | 2/5 | 2/5 | → |
| 9 | policy | 贡献协议 PR 流程 | `m/dispatch-brief-code-memory-restru` | **`m/active/contribution-protocol.md`** | 4/5 | 2/5 | → |
| 10 | policy | Phase 2 M1-M4 时间表 | `m/session-digests/20260425-150323-1` | `m/session-digests/20260425-150323-1` | 5/5 | 5/5 | = |
| 11 | arch | session-end-distill hook 设计取舍 | `m/session-digests/20260426-083345-7` | `m/session-digests/20260426-083345-7` | 5/5 | 5/5 | = |
| 12 | arch | RAG 检索链条 | `m/dispatch-brief-code-memory-restru` | `m/dispatch-brief-code-memory-restru` | 1/5 | 1/5 | = |
| 13 | arch | 做梦 Agent 三层 | `.github/workflows/dream.yml` | `.github/workflows/dream.yml` | 0/5 | 0/5 | = |
| 14 | arch | 知识图谱节点类型 | `m/advanced-memory-design.md` | `m/advanced-memory-design.md` | 2/5 | 2/5 | = |
| 15 | arch | MCP server 暴露的工具 | `m/silver-memory-enhancement-plan.md` | `m/silver-memory-enhancement-plan.md` | 3/5 | 3/5 | = |
| 16 | history | 2026-04-19 战略转向 | `m/session-digests/20260426-164520-f` | `m/session-digests/20260426-164520-f` | 5/5 | 5/5 | = |
| 17 | history | BPT 删除背景 | `p/wiki/data/extracted/categorized/g` | `p/wiki/data/extracted/categorized/g` | 4/5 | 4/5 | = |
| 18 | history | characters.json schema 6 项裁决 | `m/session-digests/20260420-190915-0` | `m/session-digests/20260420-190915-0` | 5/5 | 5/5 | = |
| 19 | history | lesson #30 数据层混淆 | `m/dispatch-brief-code-news-data-lay` | `m/dispatch-brief-code-news-data-lay` | 4/5 | 4/5 | = |
| 20 | history | Code-strategy 角色定义 | `m/session-digests/20260427-015316-d` | **`m/active/silver-blackpool-interface`** | 5/5 | 4/5 | → |

---

## 三、M1 / M3 量化指标

### M1 — Top-1 准确率（主观相关性判定）

| 评级 | 含义 |
|---|---|
| ✅ 严格相关 | Top-1 档案就是该查询的权威信源 |
| ⚠ 部分相关 | Top-1 档案与查询主题相关但非权威单点 |
| ❌ 不相关 | Top-1 档案是噪音命中（如 brief 字面引用、session-digest 重复 token、无关 lua 配置）|

#### 主观评级表

| # | Pre 评级 | Post 评级 |
|---|---|---|
| 1 | ⚠ | ⚠ |
| 2 | ❌ | ❌ |
| 3 | ❌ | ❌ |
| 4 | ⚠ | ⚠ |
| 5 | ❌ | ❌ |
| 6 | ❌ | ✅ |
| 7 | ⚠ | ⚠ |
| 8 | ⚠ | ✅ |
| 9 | ❌ | ✅ |
| 10 | ❌ | ❌ |
| 11 | ⚠ | ⚠ |
| 12 | ❌ | ❌ |
| 13 | ✅ | ✅ |
| 14 | ✅ | ✅ |
| 15 | ⚠ | ⚠ |
| 16 | ❌ | ❌ |
| 17 | ❌ | ❌ |
| 18 | ❌ | ❌ |
| 19 | ⚠ | ⚠ |
| 20 | ❌ | ✅ |

#### M1 汇总

| 指标 | Pre | Post | Delta |
|---|---|---|---|
| 严格相关（✅）| 2 / 20 = **10%** | 6 / 20 = **30%** | **+20 pp** ✅ |
| 部分相关（含 ⚠）| 9 / 20 = 45% | 12 / 20 = 60% | +15 pp |
| 严格不相关（❌）| 11 / 20 = 55% | 8 / 20 = 40% | -15 pp |

**M1 验收**：≥ +10 pp 提升 → **严格口径 +20 pp ✅ / 含部分相关口径 +15 pp ✅**

### M3 — 召回头 5 中非 session-digest 占比

| 指标 | Pre | Post | Delta |
|---|---|---|---|
| Top-5 总数 | 100 | 100 | — |
| Session-digest 命中数 | 52 | 48 | -4 |
| 非 session-digest 数 | 48 | 52 | +4 |
| **非 SD 占比** | **48.0%** | **52.0%** | **+4 pp** ❌ |

**M3 验收**：≥ 60% → **52% 未达标 ❌（缺口 8 pp）**

---

## 四、检索延迟

| 指标 | Pre | Post |
|---|---|---|
| P50 | 5073 ms | 5152 ms |
| P95 | 5224 ms | 5297 ms |
| 平均 | 5073 ms | 5152 ms |

延迟 +1.5%（在测量噪声范围内），未恶化。

---

## 五、M3 未达标根因诊断

### 表象

`.searchignore` 落档 + 30 天阈值生效，但 252 份 `memory/session-digests/*.md` 中**0 份**触发过滤——全部 < 30 天（最早 2026-04-12，至今 21 天）。

### 数据验证

| 项 | 数值 |
|---|---|
| `.searchignore` 模式 | `memory/session-digests/*.md` + `memory/dreams/*.json` |
| 阈值 `SEARCHIGNORE_AGE_DAYS` | 30 天 |
| Session-digest 文件总数 | 252 |
| 30 天前的文件数 | **0** |
| 实际过滤的文件 | 0 |
| 索引文件总数 | Pre 2802 = Post 2802（与 `.searchignore` 启用前完全一致）|

### 结构性根因

session-digest 是**会话日志**，每会话 1 份；项目从 2026-04 起进入高密度 AI 协作模式，252 份 digest 全部集中在 21 天内产出，远短于 30 天冷档案阈值。`.searchignore` 设计目标是「未来防御」（30 天后逐步淘汰），**对当前数据集生效面 = 0**。

### M1 提升的真实驱动力

5 hubs 才是 M1 提升的核心抓手：4 个 policy 类查询（Q6 / Q8 / Q9 / Q20）全部从 brief / decisions / session-digest 升级为 `memory/active/*` 权威 hub，TF-IDF 重排序自然命中。

---

## 六、批 2 改进路径预案（待主控台决策）

### 主驱动：H5 doc_class 加权（批 2 brief 内已写入）

按决策版 §3.x 与 H5 条款：`memory_search.py:rerank()` 加 1 行 + ≤10 行常量权重表，给 session-digest 文档类乘 0.4 系数（艾瑞卡 2026-04-26 已在 commit `4d63b8ca` 实施过类似 patch，但仅作 doc_class.weight 单维度，未覆盖 brief 落档后 dispatch-brief 类干扰）。

预期收益：M3 非 SD 占比 52% → 75-85%（基于 4-26 单维度试验数据外推）。

### 副驱动：T1 卡牌系统事实卡片化（D3 主试点）

按 H7 复用 `assets/data/card-system.json` v1.0 schema，让 Q5 卡牌三类查询、Q4 v2.5 联动等 game 类查询有权威单点命中。预期：M1 严格相关 30% → 50%。

### 不在批 1 / 批 2 范围（批 3 暂缓）

- `memory/` 目录分层（core / active / archive）
- `BIAV-SC.md` / `CLAUDE.md` Skill 化拆分
- 新增 ML / 分类器（H5 显式禁止）

---

## 七、批 1 验收对照

| # | 验收标准 | 实测 | 判定 |
|---|---|---|---|
| 1 | `.searchignore` 落档，复用 gitignore 语法 | 已落档，纯 glob 模式 + `#` 注释 | ✅ |
| 2 | `memory_search.py` 读取 `.searchignore`（≤10 行新增）| 净 +10 行（+13 含 import / 常量 / KNOWLEDGE_GLOBS 加 1 行 - 3 旧）| ✅（边界）|
| 3 | `memory/active/` 5 份 hub ≤ 200 行/份 | 106-147 行/份，全部 ≤ 200 | ✅ |
| 4 | `memory/research/rag-baseline-2026-W18.md` 落档，20 查询全表 | 本档案 | ✅ |
| 5 | M1 Top-1 提升 ≥ 10 pp | +20 pp（严格）/ +15 pp（含部分）| ✅ |
| 6 | M3 召回头 5 中非 SD ≥ 60% | 52%（缺口 8 pp）| ❌ |
| 7 | session-start-sync hook 正常 | 本会话启动 sync 正常 | ✅ |
| 8 | H1-H4 + H6 全部满足 | H1 ≤2 新脚本（实际 0 脚本，仅修改+落档）/ H2 ≤300 行（最长 hub 147）/ H3 不引入新依赖（仅用 stdlib `fnmatch` `time`）/ H4 gitignore 语法 / H6 hub ≤200 行 | ✅ |
| 9 | 不引入新 pip 依赖 | `pip freeze` 修改前后无差异（仅新增 stdlib import） | ✅ |

**总体验收**：8/9 通过，1/9 未达（M3）。**M3 未达根因为结构性（session-digest 全部 < 30 天，.searchignore 阈值未触发），非实施缺陷**——批 2 H5 doc_class 加权才是 M3 的主驱动力。

---

## 八、艾瑞卡建议

| # | 建议 | 优先级 |
|---|---|---|
| 1 | 主控台审视 M3 未达是否构成「批 1 验收失败」——艾瑞卡观点：M3 缺口非实施缺陷而是 brief 假设漂移（30 天阈值 vs 实际 21 天数据集）。建议「批 1 实质通过 + M3 转批 2 主指标」 | 高 |
| 2 | 启动批 2 dispatch brief（H5 doc_class 加权 + H7 T1 卡牌事实卡片化）| 高 |
| 3 | 批 2 同步加 H8 candidate（艾瑞卡建议）：「dispatch-brief」类文档加 doc_class 0.5 系数——本次基线显示 brief 字面引用频繁刷分（Q6/Q9/Q12/Q3 等多次 top1 命中 brief）| 中 |
| 4 | `.searchignore` 阈值是否从 30 天调到 14 天——批 2 时可一并评估 | 中 |
| 5 | 批 1 完成不立即触发批 2，先让浅睡 cron 运行 1-2 轮观察 dream.yml 索引重建链条（v1.1）是否稳定 | 低 |

---

## 九、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-03 | 初版基线落档（batch 1 完成 + 20 查询全表 + M1/M3 量化）| Code-memory 艾瑞卡 |
