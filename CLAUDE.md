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

### 知识写入（对话中主动调用）

**遇到以下情况时，主动调用 `store_facts` 工具写入事实：**

1. **决策**：做出技术/架构选择时（如"选用 X 替代 Y，因为..."）
2. **发现**：找到 bug 根因、理解了某段代码的行为
3. **偏好**：了解到用户习惯或喜好
4. **惯例**：项目中约定俗成的做法
5. **教训**：踩坑后的经验总结

写入时用 JSON 格式指定 category：`decision` / `discovery` / `preference` / `convention` / `context` / `lesson`

**不要写入**：临时调试信息、显而易见的代码结构、已在 CLAUDE.md 中明确记录的规则。

### 记忆写回（会话结束自动触发）

会话结束时，Stop hook 自动执行：
1. **记忆写回**（`memory_writeback.py`）：检测 git 变更 → 提取知识事实 → 写入图谱 → 生成会话摘要 → 增量重索引
2. **反思扫描**（`session_reflexion.py`）：扫描失败信号 → 分析模式 → 提炼经验写入 lessons-learned.md

手动触发写回：`python scripts/memory_writeback.py --verbose`

### 其他银芯工具

- 查看预计算缓存：`python scripts/dream.py --check-cache`
- 查看文件效用排名：`python scripts/memrl.py --top 10`
- 查看历史教训：`Read memory/lessons-learned.md`
- 重建全部索引：`python scripts/dream.py --rebuild`
- 手动写回记忆：`python scripts/memory_writeback.py --verbose`

### 使用场景指引

| 你想做的事 | 用这个 |
|-----------|--------|
| 搜索项目知识 | `memory_search.py` |
| 理解角色/世界观关系 | `knowledge_graph.py --query` |
| 不确定该读什么文件 | `context_manager.py --query` |
| 回答社区动态相关问题 | 先 `dream.py --check-cache`，无缓存再读 `projects/news/output/` |
| 了解项目当前状态 | `Read memory/boot-snapshot.md` |
| 避免重复犯错 | `Read memory/lessons-learned.md` |
| 手动写回会话知识 | `memory_writeback.py --verbose` |
