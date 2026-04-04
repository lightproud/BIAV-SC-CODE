# 先进记忆系统设计方案

> 最后更新：2026-04-04 by Code-主控台
> 状态：方案设计中，待制作人确认后实现

## 一、背景

银芯已实现 4-Phase AutoDream（dream.py）+ 关键词索引 + 反馈循环 + Voyager 式洞察库。
与世界最先进的 AI 记忆系统（Mem0、MemRL、Sleep-Time Compute）对比，还有 5 个差距。

本方案完整设计这 5 个模块的实现路径。

### 数据规模评估

| 数据类型 | 文件数 | 大小 | 说明 |
|---------|--------|------|------|
| memory/*.md | 17 | 188KB | 项目记忆、决策、经验 |
| wiki/data/db/*.json | 22 | 400KB | 游戏结构化数据 |
| assets/data/*.json | 3 | 27KB | 采访、叙事、设计决策 |
| BIAV-SC.md | 1 | 7KB | 插件定义 |
| **合计** | ~43 | ~622KB | 约 100 个知识块 |

**结论**：语料极小，不需要 Pinecone/Weaviate 等外部向量数据库。纯 Python + JSON 文件即可覆盖全部需求。

---

## 二、5 个模块设计

### 模块 1：向量语义检索（对标 Mem0 Vector Store）

**目标**：任意自然语言查询 → 返回最相关的知识块，替代当前的关键词匹配。

**分层设计**：

```
Layer 0 (已完成): 关键词索引 → semantic-index.json
Layer 1 (本次):   TF-IDF 向量 → 零 API 成本，纯 Python
Layer 2 (可选):   API Embedding → Voyage AI / OpenAI，更高精度
```

**Layer 1: TF-IDF 向量检索**

- 纯 Python 实现，无需 numpy/sklearn
- 每个文件切成 ~500 字符 chunk（重叠 100 字符）
- 计算 TF-IDF 向量，存入 `assets/data/vectors.json`
- 查询时计算余弦相似度，返回 top-K
- 622KB 语料约 200 个 chunk，向量文件 < 500KB

```python
# scripts/memory_search.py (新文件)

def chunk_file(path, chunk_size=500, overlap=100) -> list[dict]:
    """将文件切分为重叠块"""

def build_tfidf_vectors(chunks) -> dict:
    """构建 TF-IDF 向量（纯 Python，无外部依赖）"""

def cosine_similarity(v1, v2) -> float:
    """余弦相似度"""

def search(query: str, top_k=5) -> list[dict]:
    """语义搜索：返回 [{file, chunk, score, context}]"""

def build_index():
    """全量构建索引 → assets/data/vectors.json"""
```

**Layer 2: API Embedding（可选升级）**

- 在 Layer 1 基础上，如果检测到 VOYAGE_API_KEY 或 OPENAI_API_KEY
- 替换 TF-IDF 向量为真正的 embedding 向量
- 向量维度 1024，同样存入 `vectors.json`
- 查询精度显著提升，适合跨语言检索（中英日）

**集成点**：
- dream.py Phase 3 自动重建索引
- 新会话启动时可调用 `search()` 快速定位相关知识
- BIAV-SC.md 新增「语义检索」能力描述

**预估成本**：Layer 1 = $0 / Layer 2 ≈ $0.01/次重建

---

### 模块 2：知识图谱（对标 Mem0 Graph Memory）

**目标**：建立实体间关系网络，支持"跟 X 相关的所有决策"类查询。

**节点类型**：

| 类型 | 来源 | 示例 |
|------|------|------|
| Character | characters.json | 洛水、Herbert |
| Decision | decisions.md | "品牌统一：银芯=BIAV-SC" |
| File | 所有知识文件 | memory/decisions.md |
| Concept | 关键词提取 | 联动、黑池、做梦Agent |
| Event | 日报/采访 | THPDom视频效应、团队重组 |
| System | 架构文件 | 银芯、黑池、Wiki |

**边类型**：

| 关系 | 说明 | 示例 |
|------|------|------|
| mentions | A 提及 B | decisions.md → mentions → 黑池 |
| depends_on | A 依赖 B | Wiki → depends_on → characters.json |
| related_to | 语义关联 | 联动 → related_to → 沙耶之歌 |
| supersedes | A 取代 B | 新决策 → supersedes → 旧决策 |
| belongs_to | A 属于 B | Herbert → belongs_to → 界域·深海 |

**实现**：

```python
# scripts/knowledge_graph.py (新文件)

def extract_entities(text, file_path) -> list[dict]:
    """从文本提取实体（正则 + 已知实体词典）"""

def extract_relations(entities, text) -> list[dict]:
    """提取实体间关系（共现 + 模式匹配）"""

def build_graph() -> dict:
    """构建完整知识图谱 → assets/data/knowledge-graph.json"""

def query_graph(entity, relation_type=None, depth=1) -> list[dict]:
    """图查询：返回与 entity 相关的节点和边"""

def ai_enrich_graph(client, graph) -> dict:
    """AI 增强：发现隐含关系（Phase 2 调用）"""
```

**数据结构**：

```json
{
  "nodes": {
    "character:洛水": {"type": "Character", "properties": {"realm": "深海"}},
    "decision:品牌统一": {"type": "Decision", "properties": {"date": "2026-04-03"}},
    "file:memory/decisions.md": {"type": "File", "properties": {"lines": 200}}
  },
  "edges": [
    {"source": "file:memory/decisions.md", "target": "decision:品牌统一", "type": "contains"},
    {"source": "decision:品牌统一", "target": "system:银芯", "type": "mentions"}
  ],
  "meta": {"generated": "2026-04-04", "node_count": 150, "edge_count": 400}
}
```

**构建策略**：

1. **Phase 1（结构化数据）**：从 characters.json、decisions.md、terminology.json 自动提取，零 API 成本
2. **Phase 2（AI 增强）**：深睡时用 AI 发现隐含关系（如"THPDom 效应 → 影响 → 配音预算决策"）
3. **增量更新**：每次 dream 运行只处理自上次以来修改的文件

**预估成本**：Phase 1 = $0 / Phase 2 ≈ $0.05/次

---

### 模块 3：记忆重排序器（对标 Mem0 Reranker）

**目标**：从多个检索通道（关键词/向量/图谱）获取候选记忆后，按综合评分排序。

**四维评分模型**：

```
final_score = w1 × semantic_score    # 语义相关度（向量检索得分）
            + w2 × recency_score     # 时间新鲜度（指数衰减）
            + w3 × access_score      # 访问频率（access-log.json）
            + w4 × graph_score       # 图谱距离（知识图谱中的跳数）
```

**权重默认值**（可通过 MemRL 自动调整）：

| 维度 | 权重 | 说明 |
|------|------|------|
| semantic_score | 0.4 | 语义匹配是主要信号 |
| recency_score | 0.25 | 最近更新的文件更可能相关 |
| access_score | 0.2 | 经常被访问的文件通常更重要 |
| graph_score | 0.15 | 与查询实体图谱距离近的文件 |

**实现**：

```python
# 集成到 scripts/memory_search.py

def rerank(candidates: list[dict], query: str, context: dict = None) -> list[dict]:
    """多维重排序
    
    candidates: 来自 keyword/vector/graph 的候选列表
    query: 用户查询
    context: 可选上下文（当前会话角色、最近话题等）
    
    返回按 final_score 排序的列表
    """

def recency_score(file_path) -> float:
    """基于文件最后修改时间的指数衰减得分"""

def access_score(file_path) -> float:
    """基于 access-log.json 的访问频率得分"""

def graph_score(file_path, query_entities) -> float:
    """基于知识图谱中与查询实体距离的得分"""
```

**使用场景**：

- 新会话启动时，根据会话角色自动推荐最相关的文件
- 用户提问时，`search()` + `rerank()` 返回最优知识块
- 深睡 Phase 2 中，AI 分析时优先处理高分文件

**预估成本**：$0（纯计算）

---

### 模块 4：MemRL-lite（对标 MemRL 强化学习）

**目标**：根据记忆的实际使用效果，自动调整记忆权重和检索策略。

**核心思路**：不做真正的 RL（数据量太小），用简化版的反馈循环代替：

```
记忆被检索 → 被使用 → 产生了好结果？ → 更新该记忆的效用分数
```

**信号采集**：

| 信号 | 来源 | 含义 |
|------|------|------|
| 被读取 | access-log.json | 中性信号，说明被关注 |
| 被引用 | dream journal | 积极信号，AI 主动引用 |
| 产出洞察 | insights.json | 强积极信号，导致新发现 |
| 长期未被访问 | access-log.json | 可能过时或不相关 |
| 被标记过时 | dream Phase 1/2 | 消极信号 |

**效用分数计算**：

```python
# 指数移动平均（EMA）
utility[file] = α × new_signal + (1-α) × utility[file]
# α = 0.3，既尊重新信号，也保持历史记忆
```

**存储**：

```json
// assets/data/memory-utility.json
{
  "memory/decisions.md": {
    "utility": 0.82,
    "access_count": 15,
    "last_cited": "2026-04-03",
    "last_insight": "insight-2026-04-03-001",
    "trend": "stable"
  }
}
```

**反馈闭环**：

1. **记忆权重调整**：高 utility 文件在 reranker 中获得额外加分
2. **Reranker 权重自适应**：每周 REM 睡眠时，分析哪个维度的权重预测效果最好
3. **淘汰建议**：utility 持续低于阈值（< 0.2）超过 30 天的记忆，建议归档或合并
4. **新文件冷启动**：新文件初始 utility = 0.5（中性），通过实际使用快速校准

**实现**：

```python
# scripts/memrl.py (新文件)

def update_utility(file_path: str, signal: str, value: float = 1.0):
    """更新单个文件的效用分数"""

def compute_utility_from_logs() -> dict:
    """从 access-log + insights + dream journals 批量计算效用"""

def get_reranker_weights() -> dict:
    """根据历史效用数据，自动调整 reranker 的四维权重"""

def suggest_archival() -> list[str]:
    """建议归档的低效用文件"""

def weekly_calibration():
    """每周 REM 时调用：分析权重效果，输出调整建议"""
```

**预估成本**：$0（纯统计计算）

---

### 模块 5：Sleep-Time Compute（对标 Berkeley Sleep-Time Compute）

**目标**：在深睡时预计算高频查询的答案缓存，降低实时会话的 token 消耗和响应延迟。

**原理**：

```
深睡 → 分析最近 7 天的高频话题 → 预生成结构化回答 → 缓存
新会话 → 检查缓存 → 命中则直接引用 → 未命中再检索
```

**预计算内容**：

| 类型 | 来源 | 示例 |
|------|------|------|
| 项目状态摘要 | project-status.md + 最新日报 | "当前三条主线进展" |
| 高频问答 | 采访数据 + 社区高频关键词 | "忘却前夜有几个界域？" |
| 角色速查卡 | characters.json | "洛水的技能有哪些？" |
| 决策上下文 | decisions.md + 关联文件 | "为什么选择 SVN + Qoder？" |
| 趋势摘要 | 近 7 天日报趋势分析 | "本周社区热点" |

**缓存结构**：

```json
// assets/data/precomputed-cache.json
{
  "generated": "2026-04-04",
  "ttl_days": 1,
  "entries": [
    {
      "id": "cache-001",
      "question_patterns": ["项目状态", "当前进展", "现在情况"],
      "answer": "截至 2026-04-04...",
      "sources": ["memory/project-status.md"],
      "confidence": 0.9,
      "hit_count": 0
    }
  ]
}
```

**实现**：

```python
# 集成到 scripts/dream.py Phase 3

def identify_hot_topics() -> list[str]:
    """从 access-log + insights + 日报提取高频话题"""

def generate_cache_entries(client, topics) -> list[dict]:
    """AI 预生成常见问答（深睡时调用）"""

def check_cache(query: str) -> dict | None:
    """新会话启动时检查缓存命中"""

def update_cache_hits(cache_id: str):
    """记录缓存命中次数（反馈给 MemRL）"""
```

**集成到 BIAV-SC.md**：

```markdown
### 新会话启动流程（更新）

1. 读完本文件
2. **检查 assets/data/precomputed-cache.json 是否存在且未过期**
3. 读 memory/project-status.md
4. 读你负责的 projects/xxx/CONTEXT.md
5. 主动告诉用户你能做什么 + 建议
```

**预估成本**：≈ $0.03/次深睡（生成 5-10 个缓存条目）

---

## 三、系统集成架构

```
                    ┌─────────────────────────┐
                    │      BIAV-SC.md          │
                    │   (插件入口 + 能力声明)   │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │   新会话启动             │
                    │   1. 检查 precomputed    │
                    │   2. 加载 search()       │
                    └──────────┬──────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
    │ 关键词检索   │  │ 向量检索     │  │ 图谱检索     │
    │ (已完成)    │  │ (TF-IDF/API) │  │ (关系查询)   │
    └──────┬──────┘  └──────┬───────┘  └──────┬───────┘
           │                │                  │
           └────────────────┼──────────────────┘
                            ▼
                  ┌─────────────────┐
                  │  Reranker       │
                  │  (四维评分)      │
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │  返回 Top-K     │
                  │  知识块          │
                  └────────┬────────┘
                           │
                           ▼ (使用后)
                  ┌─────────────────┐
                  │  MemRL-lite     │
                  │  (效用反馈)      │
                  └────────┬────────┘
                           │
                           ▼ (深睡时)
                  ┌─────────────────┐
                  │  dream.py       │
                  │  Phase 3 重建   │
                  │  - 向量索引     │
                  │  - 知识图谱     │
                  │  - 预计算缓存   │
                  │  - 效用分数     │
                  └─────────────────┘
```

## 四、文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/memory_search.py` | 新建 | 向量检索 + 重排序器 |
| `scripts/knowledge_graph.py` | 新建 | 知识图谱构建与查询 |
| `scripts/memrl.py` | 新建 | MemRL-lite 效用追踪 |
| `scripts/dream.py` | 修改 | Phase 3 集成图谱/向量/缓存重建 |
| `assets/data/vectors.json` | 生成 | TF-IDF 向量索引 |
| `assets/data/knowledge-graph.json` | 生成 | 知识图谱 |
| `assets/data/memory-utility.json` | 生成 | 效用分数 |
| `assets/data/precomputed-cache.json` | 生成 | 预计算缓存 |
| `BIAV-SC.md` | 修改 | 新增语义检索能力声明 |
| `.github/workflows/dream.yml` | 修改 | 深睡集成新模块 |
| `memory/dreaming-agent-design.md` | 修改 | 更新架构说明 |

## 五、实施顺序

```
Sprint 1: 向量检索 + Reranker（独立可用，即时价值）
          ↓
Sprint 2: 知识图谱（增强检索维度）
          ↓
Sprint 3: MemRL-lite（效用反馈闭环）
          ↓
Sprint 4: Sleep-Time Compute（预计算缓存）
          ↓
Sprint 5: 集成测试 + dream.py 整合 + 文档更新
```

每个 Sprint 可独立交付、独立运行。不存在硬依赖，但 Reranker 在有更多维度时效果更好。

## 六、月成本估算

| 模块 | API 调用 | 月成本 |
|------|---------|--------|
| 向量检索 Layer 1 (TF-IDF) | 无 | $0 |
| 向量检索 Layer 2 (API Embedding) | ~100 chunks × 30 天 | ~$0.30 |
| 知识图谱 AI 增强 | 30 次/月 | ~$1.50 |
| Sleep-Time Compute | 30 次/月 × 10 条 | ~$0.90 |
| MemRL-lite | 无 | $0 |
| **合计（含 Layer 2）** | | **~$2.70/月** |
| **合计（仅 Layer 1）** | | **~$2.40/月** |

加上现有做梦系统 ~$7/月，总计 **~$10/月**。

## 七、与黑池的关系

- 银芯先验证，成功后黑池直接复用脚本
- 知识图谱节点类型需扩展（添加内部角色、未发布内容节点类型）
- 向量索引在黑池中需要包含内部文档（语料量可能 10x+）
- 效用分数两套独立运行，不跨系统共享

## 八、风险与约束

| 风险 | 影响 | 应对 |
|------|------|------|
| TF-IDF 精度不够 | 检索质量低 | Layer 2 API Embedding 兜底 |
| 知识图谱实体识别错误 | 错误关系 | 限制自动提取范围，AI 增强只追加不删除 |
| 向量文件过大 | git 仓库膨胀 | 预估 < 500KB，可控。超过 1MB 改用 .gitignore + CI 重建 |
| 预计算缓存过时 | 返回错误答案 | TTL 设为 1 天，过期自动失效 |
| access-log 数据稀疏 | MemRL 权重不准 | 前 30 天用默认权重，积累数据后再启用自适应 |
