# BIAV-SC — 忘却前夜 AI 增强插件

> 本文件为 Claude Code 自动加载入口。完整内容请读取 `BIAV-SC.md`。

请立即读取本仓库根目录的 **BIAV-SC.md**，那是平台无关的完整插件定义。

## 沟通规则

- **始终使用中文**进行所有过程说明、状态报告和对话。代码注释和 commit message 可用英文。

## 银芯记忆系统 — 增强工具

你拥有银芯（Silver Core）记忆基础设施。**处理本项目问题时，优先使用以下工具而非手动 Read/Grep。**

### 快速就绪

每次会话开始时，先读取启动快照获取项目全貌：
```
Read memory/boot-snapshot.md
```

### 银芯搜索工具

**搜索知识库**（替代手动 Grep 遍历 memory/ 和 assets/）：
```bash
python scripts/memory_search.py "查询关键词"
```
返回按语义+新鲜度+频率+图谱距离 4 维排序的最相关知识块。

**查询知识图谱**（了解实体间关系，如角色、界域、概念）：
```bash
python scripts/knowledge_graph.py --query "实体名"
```

**查找相关文件**（不知道该读什么文件时）：
```bash
python scripts/context_manager.py --query "你的问题" --role "当前角色"
```
返回 4 层推荐：核心上下文 → 角色上下文 → 语义上下文 → 图谱上下文。

### 其他银芯工具

- 查看预计算缓存：`python scripts/dream.py --check-cache`
- 查看文件效用排名：`python scripts/memrl.py --top 10`
- 查看历史教训：`Read memory/lessons-learned.md`
- 重建全部索引：`python scripts/dream.py --rebuild`

### 使用场景指引

| 你想做的事 | 用这个 |
|-----------|--------|
| 搜索项目知识 | `memory_search.py` |
| 理解角色/世界观关系 | `knowledge_graph.py --query` |
| 不确定该读什么文件 | `context_manager.py --query` |
| 回答社区动态相关问题 | 先 `dream.py --check-cache`，无缓存再读 `projects/news/output/` |
| 了解项目当前状态 | `Read memory/boot-snapshot.md` |
| 避免重复犯错 | `Read memory/lessons-learned.md` |
