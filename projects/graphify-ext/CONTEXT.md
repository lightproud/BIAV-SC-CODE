# GRAPHIFY-EXT — 黑池索引工具原型

> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 上游：[safishamsi/graphify](https://github.com/safishamsi/graphify) v0.4.12（MIT）
> 引入时间：2026-04-14
> 定位：**黑池架构需求 3（黑池索引）的工具原型**，银芯侧 vendor 后作为母版供黑池内网部署

## 概述

Graphify 把任意目录（代码 / 文档 / 论文 / 图片 / 视频）转为**可查询的知识图谱**。技术核心：
- **Tree-sitter AST**（23 语言含 **Lua** —— 适合索引黑池游戏代码）
- **LLM 语义提取**（Claude subagent 并行处理 docs/papers/images/transcripts）
- **Leiden 社区检测**（图拓扑聚类，**不依赖向量 embedding**）
- **Whisper 本地转录**（视频/音频 → 领域感知 prompt）
- **增量 cache**（SHA256 去重，仅处理变更文件）

性能：平均查询 **1.7k token vs 朴素 123k token = 71.5× 压缩**（上游声明）。

## 技术栈

- Python 3.10+
- tree-sitter + 23 语言包
- NetworkX（图论）
- Leiden（社区检测）
- faster-whisper（本地转录，可选）
- Claude subagent（LLM 语义层）

依赖详见 `pyproject.toml`。

## 文件清单

| 路径 | 来源 | 用途 |
|------|------|------|
| `graphify/` | 上游原样 | 主 Python 包（`__main__.py` / `analyze.py` / `build.py` / `cache.py` / `cluster.py` / `extract.py` / `hooks.py` / `ingest.py` / `report.py` / `serve.py` / `skill-*.md` 等） |
| `tests/` | 上游原样 | 测试夹具与示例数据 |
| `worked/` | 上游原样 | 官方示例 corpus（karpathy-repos / httpx / mixed-corpus / example） |
| `pyproject.toml` | 上游原样 | 构建与依赖声明 |
| `ARCHITECTURE.md` | 上游原样 | 架构说明 |
| `SECURITY.md` | 上游原样 | 安全策略 |
| `CHANGELOG.md` | 上游原样 | 变更日志 |
| `README.md` / `README.zh-CN.md` / `README.ja-JP.md` / `README.ko-KR.md` | 上游原样 | 多语言说明（含中文） |
| `LICENSE` | 上游原样 | MIT |
| `NOTICE` | BIAV 新增 | 归属声明 |
| `CONTEXT.md` | BIAV 新增 | 本文件 |

**未引入**：`.git/`（完整历史）

## 启动方式

### 官方路径（PyPI）

```bash
pip install graphifyy
graphify install                 # 安装到 Claude Code / Codex / Aider 等平台
graphify .                       # 对当前目录构建图谱
```

### 本地开发路径（用 BIAV 内引入的版本）

```bash
cd projects/graphify-ext
pip install -e .                 # editable 安装
python -m graphify .
```

### 对 claw（bpt-next）的支持

graphify 原生支持 OpenClaw（即 claw-code 生态）：

```bash
graphify install --platform claw
```

## 产出物

运行 `graphify .` 后生成 `graphify-out/` 目录，包含：
- `graph.html` — 交互式图谱（点击节点、搜索、按社区过滤）
- `GRAPH_REPORT.md` — god nodes / surprising connections / suggested questions
- `graph.json` — 持久化图，可离线查询
- `cache/` — SHA256 缓存

## 与银芯现有系统的职责分工

| 系统 | 管的内容 | 维护方式 |
|------|---------|---------|
| 银芯 `scripts/knowledge_graph.py` | 游戏世界观 / 决策历史 / 角色/界域 | 人工维护 + 做梦 agent 补充 |
| **graphify-ext** | 代码仓库 / 文档 / 多模态资产 | 自动化提取 |

两者最终通过银芯 MCP 服务器（`scripts/mcp_server.py`）合流；AI 查询时不关心来源（Phase A P3 目标）。

## 职责边界（重要）

1. **不修改上游 `graphify/` 源码**，保持可 pull 上游更新的能力
2. BIAV 定制通过 **Phase A P3 新增的 `scripts/graphify_bridge.py`** 实现（银芯 MCP 桥接层）
3. **不得**向 BIAV 根目录 `pyproject.toml` 合并 graphify 依赖（保持子项目独立）
4. 如需深度改造，先在 `memory/decisions.md` 记录决策

## 当前状态

- **引入状态**：初始引入完成（2026-04-14），上游源码未修改
- **银芯 MCP 桥接**：未开始（Phase A P3）
- **BIAV 定制**：未开始
- **验证状态**：未在银芯环境运行过 `pip install graphifyy`

## 下一步候选任务

1. **Phase A P3**：写 `scripts/graphify_bridge.py` —— 把 graphify 封装为银芯 MCP 工具：
   - `graphify_index(path)` — 对指定目录构建图谱
   - `graphify_query(q)` — 查询图谱
   - `graphify_report(path)` — 获取 GRAPH_REPORT.md
2. 在本地试运行：`cd projects/graphify-ext && pip install -e . && python -m graphify worked/karpathy-repos`（验证示例 corpus 可索引）
3. 对 BIAV 自己的 `projects/wiki/data/extracted/` 构建图谱，评估索引质量
4. 对黑池（未来）的 Lua 游戏代码构建图谱试点

## 验证清单

首次使用前：
- [ ] Python 3.10+ 可用：`python --version`
- [ ] `pip install -e .` 成功（在 `projects/graphify-ext/` 下）
- [ ] `python -m graphify --help` 显示命令列表
- [ ] 对 `worked/example/` 示例跑通：`python -m graphify worked/example`
- [ ] 产物 `graphify-out/graph.html` 可浏览器打开

## 上游同步策略

若需 pull 上游更新：
```bash
cd /tmp
git clone --depth 1 https://github.com/safishamsi/graphify graphify-upstream
diff -r --brief --exclude='.git' graphify-upstream projects/graphify-ext
# 人工 review 差异，选择性 rsync 同步
```

## 相关档案

- 归属声明：`NOTICE`
- 上游架构：`ARCHITECTURE.md`
- 上游中文 README：`README.zh-CN.md`
- 银芯黑池架构：`memory/blackpool-architecture.md`（需求 3）
- 银芯记忆增强：`memory/silver-memory-enhancement-plan.md`（与 graphify 互补的银芯侧系统）
- 决策记录：`memory/decisions.md`（2026-04-14 graphify vendor 条目）

## 合规

- 许可证：MIT（上游保留）
- 官方 PyPI 包名：`graphifyy`（注意双 y，`graphify*` 的其他包并非同一项目）
- 未修改上游任何文件
- 非 Anthropic 官方项目；Claude 与 Claude Code 为 Anthropic PBC 商标
