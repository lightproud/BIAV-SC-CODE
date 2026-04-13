# BPT Server -- 独立知识引擎设计

> 最后更新：2026-04-13 by 主控台
> 状态：设计文档，待实现

## 1. 定位

BPT Server 是 BPT 桌面终端自带的 MCP 服务器，提供项目记忆、知识图谱、语义搜索、
事实存储等能力。它是银芯（Silver Core）的**同构独立复刻**，专为黑池内网环境设计。

### 与银芯的关系

| 维度 | 银芯 (Silver Core) | BPT Server |
|------|--------------------|----|
| 服务对象 | brain-in-a-vat 公开仓库 | 黑池内网项目 |
| 数据源 | Markdown / JSON / Python / TS | 代码 + 配置 + 设计文档 + 会议记录 + 社区数据 |
| 文件格式 | .md / .json / .py / .ts | .md / .txt / .docx / .xlsx / .pptx / .pdf + 代码/配置 |
| 版本管理依赖 | git (2 个工具依赖 git diff/log) | **无** (文件 mtime + SVN revision 兜底) |
| 部署方式 | GitHub 仓库 scripts/ | SVN 分发 projects/bpt/server/ |
| Python 环境 | 3.11+ | 3.11+ (团队机器已有) |

### 设计原则

1. **同构 API** -- 工具名、参数、返回格式与银芯一致，Electron 侧代码不需要改适配层
2. **零 git 依赖** -- 变更检测用文件 mtime 扫描 + 可选 SVN revision
3. **多格式解析** -- 开箱支持 Office 三件套 + PDF + 纯文本 + 代码
4. **自包含** -- `pip install -r requirements.txt` 后即可运行，无外部服务
5. **索引随 SVN 分发** -- 构建好的索引文件随项目 SVN update 到团队机器

---

## 2. 目录结构

```
projects/bpt/server/
├── requirements.txt          # Python 依赖
├── mcp_server.py             # MCP 入口（FastMCP stdio 传输）
├── config.py                 # 配置（数据根目录、索引路径、模型路径）
│
├── search/
│   ├── indexer.py             # TF-IDF 索引构建器（多格式解析 + 分词 + 向量化）
│   ├── engine.py              # 搜索引擎（TF-IDF 检索 + 4 维重排）
│   └── tokenizer.py           # 中文 bigram + 英文 word 双语分词器
│
├── graph/
│   ├── builder.py             # 知识图谱构建器（从文档/代码/配置提取实体和关系）
│   └── query.py               # 图谱查询（BFS 遍历、实体匹配、相关文件查找）
│
├── memory/
│   ├── facts.py               # 事实存储（语义去重 + 合并 + CRUD）
│   ├── utility.py             # 文件效用排名（EMA 4 信号加权）
│   └── writeback.py           # 变更检测 + 知识回写（mtime 扫描替代 git diff）
│
├── context/
│   ├── recommender.py         # 上下文推荐（4 层融合：角色 + 语义 + 图谱 + 效用）
│   ├── briefing.py            # 会话 Briefing（mtime 扫描替代 git log）
│   └── cache.py               # 预计算缓存检查
│
├── parsers/
│   ├── __init__.py            # 统一解析入口 parse_file(path) -> str
│   ├── text.py                # .md / .txt
│   ├── code.py                # .cs / .lua / .py / .js / .ts
│   ├── config.py              # .csv / .json / .lua (表配置)
│   ├── docx.py                # .docx (python-docx)
│   ├── xlsx.py                # .xlsx (openpyxl)
│   ├── pptx.py                # .pptx (python-pptx)
│   └── pdf.py                 # .pdf (PyMuPDF / pymupdf)
│
├── persona/
│   └── character.py           # 角色人格（从人格数据文件加载）
│
├── indexes/                   # 构建产出（随 SVN 分发）
│   ├── vectors.json.gz        # TF-IDF 向量索引
│   ├── knowledge-graph.json   # 知识图谱
│   ├── memory-utility.json    # 文件效用排名
│   ├── precomputed-cache.json # 预计算缓存
│   └── facts.json             # 事实库
│
└── data/                      # 角色人格等静态数据
    └── character-personas/    # 角色人格 JSON 文件
```

---

## 3. 11 个工具 API 规格

### 3.1 memory_search -- 语义搜索

```
输入: query: str, top_k: int = 5
输出: {query, results: [{file, score, preview, scores}], synthesis?}
```

**算法**: TF-IDF + 中文 bigram 分词 + 英文 word 分词。增强 TF (0.5 + 0.5 * norm)。
词表上限 15000，每向量保留 top-50 维度，L2 归一化。

**4 维重排**:
- semantic (0.40) -- TF-IDF 余弦相似度
- recency (0.25) -- 指数衰减，半衰期 7 天，基于文件 mtime
- access_frequency (0.20) -- 来自 memory_utility 的效用分
- graph_proximity (0.15) -- 查询实体在图谱中的距离

**合成**: 当结果跨 2+ 类别时，可选调 LLM API 生成 2-3 句跨文档摘要。无 API key 时跳过。

**索引文件**: `indexes/vectors.json.gz`

### 3.2 graph_query -- 知识图谱查询

```
输入: entity: str, depth: int = 1 (最大 3)
输出: {entity: {name, type, properties}, neighbors: [{name, type, edge, direction, depth}], total_neighbors}
```

**算法**: 字符串匹配（精确 > 前缀 > 包含）。BFS 遍历到指定深度。

**节点类型**: File, Function, Config, Character, Concept, Decision, Document
**边类型**: mentions, depends_on, related_to, belongs_to, contains, defines, calls

**索引文件**: `indexes/knowledge-graph.json`

### 3.3 graph_related_files -- 图谱关联文件

```
输入: entity: str, max_depth: int = 2 (最大 3)
输出: {entity, related_files: [{file, distance, via, edge_type}]}
```

找到实体节点，BFS 遍历找 File 类型邻居，按图距排序，返回 top-10。

### 3.4 store_facts -- 事实存储

```
输入: facts: str (JSON 数组字符串或纯文本)
       每项: {content: str, category?: str, source?: str}
输出: {added, merged, duplicate, details: [{action, content, similarity}]}
```

**去重算法**: TF-IDF 余弦相似度。>=0.95 判重跳过，>=0.65 合并（更新内容 + 置信度 +0.05），<0.65 新增。上限 500 条。

**类别**: decision / discovery / preference / convention / context / lesson

**索引文件**: `indexes/facts.json`

### 3.5 memory_utility -- 文件效用排名

```
输入: top_n: int = 10
输出: {rankings: [{file, utility, trend, access_count, insight_citations}], total_files}
```

**算法**: EMA (alpha=0.3) 加权 4 信号:
- engagement (0.30) -- 文件被访问/编辑/提交的频率
- insight_citations (0.25) -- 被其他文档引用次数
- recency (0.25) -- `exp(-0.05 * days)`，半衰期约 14 天
- momentum (0.20) -- 近期趋势

### 3.6 check_cache -- 预计算缓存

```
输入: query: str
输出: {hit: bool, entry?: {question_patterns, answer, sources}, message?}
```

关键词子串匹配 question_patterns，TTL 过期检查。

### 3.7 recommend_context -- 上下文推荐

```
输入: query: str, role: str = "", max_files: int = 5
输出: {query, role, recommended_files: [{file, score, reason}], context_summary}
```

**4 层融合**:
1. 角色默认文件 (score 0.8)
2. memory_search 结果
3. graph_related_files (1-hop=0.7, 2-hop=0.4)
4. memory_utility 效用调整 (+/- 0.2 * (utility - 0.5))

### 3.8 rebuild_indexes -- 重建索引

```
输入: 无
输出: {vector_index: {status, chunks, vocabulary}, knowledge_graph: {status, nodes, edges}, memory_utility: {status, files_scored}}
```

全量扫描数据目录 -> 多格式解析 -> TF-IDF 构建 -> 图谱构建 -> 效用计算。

### 3.9 memory_writeback -- 知识回写

```
输入: dry_run: bool = False
输出: {status, changes, facts_extracted, graph_nodes_added}
```

**银芯用 git diff 检测变更。BPT 替代方案**:
- 维护 `indexes/file-snapshots.json`，记录每个文件的 mtime + size
- 每次调用时扫描数据目录，对比 mtime/size 找出变更文件
- 对变更文件执行正则事实提取 -> 写入 facts.json + knowledge-graph.json
- 可选集成 SVN: `svn diff --summarize` 替代 `git diff`

### 3.10 session_briefing -- 会话 Briefing

```
输入: role: str = ""
输出: {briefing_markdown, sections, generated_at}
```

**银芯用 git log 查最近变更。BPT 替代方案**:
- 扫描数据目录，找 mtime 在上次会话之后的文件
- 从 `indexes/session-continuity.json` 读上次会话摘要
- 合成 Briefing: 上次回顾 + 期间文件变更 + 效用趋势 + 推荐上下文

### 3.11 character_persona -- 角色人格

```
输入: character: str = "erica", context: str = "", action: str = "prompt" (prompt/greeting/list)
输出: {character, name, system_prompt/greeting/available_personas}
```

从 `data/character-personas/*.json` 加载角色数据，生成系统提示词。

---

## 4. 多格式文档解析器

### 统一接口

```python
def parse_file(file_path: str) -> ParseResult:
    """
    返回:
      ParseResult(
        text: str,          # 提取的纯文本
        metadata: dict,     # 文件元数据 (pages, sheets, slides 等)
        chunks: list[str],  # 预切片 (按段落/页/sheet)
      )
    """
```

### 解析策略

| 格式 | 库 | 切片方式 | 说明 |
|------|-----|---------|------|
| .md / .txt | 内置 | 按 ## 标题分段 | 无依赖 |
| .cs | 内置 (正则) | 按 class / method | tree-sitter 可选增强 |
| .lua | 内置 (正则) | 按 function / 顶层 table | |
| .py / .js / .ts | 内置 (正则) | 按 function / class | |
| .csv | 内置 csv | 按 N 行一组 (默认 50) | |
| .json | 内置 json | 按顶层 key | |
| .docx | python-docx | 按段落 | `pip install python-docx` |
| .xlsx | openpyxl | 按 sheet，每 sheet 按行组 | `pip install openpyxl` |
| .pptx | python-pptx | 按 slide | `pip install python-pptx` |
| .pdf | PyMuPDF | 按页 | `pip install pymupdf` |

### Python 依赖

```
# requirements.txt
mcp>=1.0.0
python-docx>=1.1.0
openpyxl>=3.1.0
python-pptx>=0.6.23
pymupdf>=1.24.0
```

可选（增强）：
```
anthropic>=0.39.0      # LLM 合成摘要
voyageai>=0.3.0        # 稠密向量嵌入 (Layer 2)
```

---

## 5. 索引构建与分发

### 构建流程

```
[数据目录] → parsers/ 多格式解析 → 纯文本切片
                                      ↓
                              search/indexer.py
                              (TF-IDF 构建 + 向量化)
                                      ↓
                              indexes/vectors.json.gz
                                      
[数据目录] → graph/builder.py → indexes/knowledge-graph.json
             (实体/关系提取)
                              
[使用数据] → memory/utility.py → indexes/memory-utility.json
             (EMA 效用计算)
```

### 触发方式

| 触发 | 命令 | 谁执行 |
|------|------|--------|
| 手动全量 | `python server/mcp_server.py --rebuild` | Dev / CI |
| 增量 | BPT 内 "重建索引" 按钮 → `rebuild_indexes` 工具 | 用户 |
| 自动 | 索引文件 >24h 未更新时 memory_search 自动重建 | 系统 |

### 分发

索引文件在 `projects/bpt/server/indexes/` 下，由 Dev 构建后 SVN commit，
团队 `svn update` 获取成品索引。普通用户不需要本地构建。

---

## 6. 变更检测（替代 git diff）

银芯的 `memory_writeback` 和 `session_briefing` 依赖 `git diff` / `git log`。
BPT 用文件系统快照替代：

### file-snapshots.json

```json
{
  "scanned_at": "2026-04-13T10:00:00Z",
  "files": {
    "path/to/file.md": {"mtime": 1712000000, "size": 4096},
    "path/to/doc.docx": {"mtime": 1712000100, "size": 102400}
  }
}
```

### 变更检测算法

```python
def detect_changes(data_root: str, snapshot_path: str) -> ChangeSet:
    old_snapshot = load_json(snapshot_path)
    current_files = scan_directory(data_root)
    
    added = current_files.keys() - old_snapshot.keys()
    removed = old_snapshot.keys() - current_files.keys()
    modified = {
        f for f in current_files.keys() & old_snapshot.keys()
        if current_files[f].mtime != old_snapshot[f].mtime
        or current_files[f].size != old_snapshot[f].size
    }
    
    return ChangeSet(added, modified, removed)
```

### 可选 SVN 集成

如果环境有 SVN，可用更精确的变更检测：

```python
def detect_changes_svn(data_root: str) -> ChangeSet:
    result = subprocess.run(
        ['svn', 'diff', '--summarize'],
        cwd=data_root, capture_output=True, text=True
    )
    # 解析 SVN diff 输出
```

---

## 7. BPT Electron 对接

### MCP 客户端无需修改

BPT 已有 `electron/silver/mcp-client.ts`，通过 MCP stdio 协议与 Python 子进程通信。
只需把 spawn 路径从 `scripts/mcp_server.py` 改为 `server/mcp_server.py`：

```typescript
// silver-ipc.ts 中
const serverScript = path.join(app.getAppPath(), 'server', 'mcp_server.py');
mcpClient = new McpClient(pythonPath, serverScript, appRoot);
```

### Direct 客户端简化

银芯的 5 个 direct-only 工具（rebuild_indexes / memory_writeback / check_cache /
memory_utility / recommend_context）在 BPT 中改为通过 MCP 统一暴露，
因为 BPT Server 已经是本地进程，不存在"LLM 不该碰管理操作"的顾虑。

简化方案：
- MCP 暴露全部 11 个工具
- LLM 的 active tool set 仍按档位控制（对话档 4 个 / 工作档 10 个）
- UI 面板的管理操作（重建索引等）也走 MCP callTool，不再单独 spawn Python

这消除了 `direct-client.ts` 的必要性，减少一个模块。

---

## 8. 与银芯数据同步

银芯产出的社区数据（新闻聚合、趋势分析等）需要同步到黑池：

### 同步内容

| 数据 | 银芯位置 | 同步方式 |
|------|----------|----------|
| 社区新闻 | `projects/news/output/` | 定期拉取到 BPT 数据目录 |
| 趋势分析 | `memory/dreams/` | 定期拉取 |
| 角色人格 | `assets/data/character-personas/` | 随 BPT 分发 |
| 事实圣经 | `assets/data/*.json` | 脱敏后拉取 |

### 同步机制

BPT 设置中配置银芯数据拉取源（内网文件服务器 / 共享目录），
定期或手动同步。**数据单向流动：银芯 -> 脱敏 -> BPT**。

---

## 9. 实施计划

| 阶段 | 内容 | 预估文件数 |
|------|------|-----------|
| Phase A | 骨架：mcp_server.py + config.py + requirements.txt + 纯文本解析器 | 5 |
| Phase B | 搜索引擎：tokenizer + indexer + engine + memory_search 工具 | 4 |
| Phase C | 知识图谱：builder + query + graph_query + graph_related_files | 3 |
| Phase D | 记忆系统：facts + utility + writeback + briefing + cache | 5 |
| Phase E | Office 解析器：docx + xlsx + pptx + pdf | 4 |
| Phase F | 角色人格 + recommend_context + 集成测试 | 3 |

**总计约 24 个 Python 文件。**

---

## 10. 验证

| # | 测试 | 通过标准 |
|---|------|----------|
| S1 | `pip install -r requirements.txt` | 零错误，无原生编译 |
| S2 | `python server/mcp_server.py --list-tools` | 列出 11 个工具 |
| S3 | `python server/mcp_server.py --rebuild` | 构建索引，输出 chunks/vocabulary/nodes 计数 |
| S4 | BPT Electron spawn server | 状态栏显示 connected，列出工具 |
| S5 | memory_search "测试查询" | 返回 top-5 结果，含 score 和 preview |
| S6 | store_facts + memory_search | 存入事实后可搜索到 |
| S7 | graph_query "实体名" | 返回节点和邻居 |
| S8 | Office 文件解析 | .docx/.xlsx/.pptx/.pdf 各一个样本，解析出文本 |
| S9 | memory_writeback (mtime) | 修改一个文件后检测到变更 |
| S10 | 完整对话流 | BPT 对话中 LLM 自主调用 memory_search，结果融入回答 |
