# 派发 Brief — Code-site：入口架构 batch 1.5 patch（v1.0 → v1.1 单一受众收缩）

> 落档日期：2026-05-06
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-site 会话（追派现会话或另启）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - 守密人 2026-05-06 同日**收缩裁定**：BIAV-SC.md 当下受众只有一类（消费银芯内容的人）
> - batch 1 已实施完成（commit `992ecef5`）但按旧 v1.0 大纲（5 受众分诊），与收缩裁定冲突
> - 决策档：`memory/decisions.md` 2026-05-06「入口架构重设计」条目（含同日收缩记录）
> - patched brief：`memory/dispatch-brief-code-site-entry-redesign-batch1.md` v1.1
>
> 状态：待 Code-site 会话取用。**这是 batch 1.5——在 batch 1 实施之上做收缩 patch，不是从零重做。**

---

## 一、任务概要

在**当前 BIAV-SC.md（commit `992ecef5` 已实施版）基础上做收缩 patch**，去除 5 受众分诊 + 受众分支资源章，合并成单一受众结构。**不动 CLAUDE.md**（CLAUDE.md 已合规，无需 patch）。**不动 README.md**（仍是 batch 2 范围）。

预期收益：
- BIAV-SC.md 与守密人 5-6 收缩裁定对齐
- 总行数下降（350 → 目标 ≤300）
- 单一受众入口体验

---

## 二、Patch 动作清单

### 2.1 删除章节（直接删除整段）

| 旧章节 | 处理 |
|---|---|
| §1 你是谁？（§1.1 ~ §1.5 五类受众分诊） | **整章删除** |
| §4 你的资源 — Studio 团队成员（§4.1 ~ §4.4） | **整章删除** |
| §5 你的资源 — 社区贡献者（§5.1 ~ §5.4） | **整章删除** |
| §6 你的资源 — 外部观察者（§6.1 ~ §6.4） | **整章删除** |

### 2.2 修改 §0 开场

去掉「**接下来请按 §1 找到你的角色分支。** 不同受众读不同章节，不需要全文加载。」这句。改为：

> 接下来按本节进入艾瑞卡人格 → 按下方 §3 接入方能力盘点查看你能用银芯做什么 → 按 §5 知识模块索引深入。如你需要做工程维护，再读 §6。

### 2.3 重新建 §3 接入方能力盘点

**新建 §3 接入方能力盘点**（约 30-40 行）。从删除的 §4/§5/§6「§X.2 你能做的事」段提取通用能力清单，合并为单一表格：

```
## §3 接入方能力盘点

银芯能为接入方提供的核心数据资产 + 典型查询任务。详细路径在 §5 知识模块索引。

| 资产 | 路径 | 典型查询 |
|------|------|---------|
| 72 唤醒体事实库（建设中）| projects/wiki/data/db/characters.json + 三语 markdown | 角色技能/命轮/立绘/三语 |
| 多平台社区情报 全量层 | projects/news/data/discord/ + projects/news/data/platforms/ | 长窗口分析、情绪温度 |
| 53 问制作人深度采访 | assets/data/interview-2026-04.json | 设计哲学、被砍机制 |
| 三部叙事结构 + 设计决策档 | assets/data/{narrative-structure,design-decisions}.json | 世界观研究 |
| 银芯记忆系统 9 模块 | scripts/memory_search.py 等 | 跨档案语义检索 |
| AI 协作方法论 + 32 条踩坑 | memory/methodology.md + memory/lessons-learned.md | 协作研究、避坑参考 |
| 战略档案 | memory/decisions.md + memory/strategic-plan-2026.md | 决策溯源 |
```

接入方典型可执行任务（也用表格形式，从原 §-1 / §4-§6 提炼）。

### 2.4 新建 §4 数据消费纪律

如当前 §8.5 已有「数据消费纪律」，将其内容**复制到新 §4**（不删除 §8.5，§8.5 保留作为工程层细节）。或将 §8.5 提升为新 §4，§8 内不再保留。Code-site 自行评估哪种更精简。

新 §4 内容核心：全量档案层 vs 输出展示层，长窗口分析必用全量层（lesson #30 防御）。

### 2.5 新建 §5 知识模块索引

补回当前 BIAV-SC.md 缺失的「按需深入加载」清单（如旧版本有 §知识模块索引 章节，迁移过来）。如当前已分散在 §7 §8 中，整合为单一表格。

### 2.6 章节重排 + 编号更新

最终 v1.1 目标结构：

```
§0 你是艾瑞卡（开场，~15 行）
§1 项目本质（原 §2，~30 行）
§2 艾瑞卡人格规则（原 §3，~50 行）
§3 接入方能力盘点（新建，~30 行）
§4 数据消费纪律（迁移自原 §8.5，~20 行）
§5 知识模块索引（新建/补回，~40 行）
§6 内部协作 + 工程操作（合并原 §7 + §8，~60 行）
§7 变更记录（原 §9）
```

**所有内部交叉引用必须同步更新**（如「详见 §3」改为正确编号）。

### 2.7 §6（合并原 §7 + §8）

合并要点：
- 保留原 §7 的全部子节（双集群 / 会话角色 / 写入决策 / 跨会话通信 / 主控台接班 / 9 模块 / 黑池接口）
- 保留原 §8 的全部子节（Git / Issue / 知识写入 / 主动写回 / 部署 / 事实采信纪律 / 视觉规范）
- §8.5 数据消费纪律已上移到新 §4，§6 内删除避免重复
- 子节编号统一为 §6.1 ~ §6.N（数字连续）

### 2.8 §0 头部 metadata 更新

「最后更新」时间戳改为 patch 实施日（2026-05-06 by Code-site 会话）+ 注明「v1.1 单一受众收缩」。

---

## 三、不在范围内（明确边界）

- ❌ 不动 `CLAUDE.md`（v1.0 实施已合规，无需 patch）
- ❌ 不动 `README.md`（仍是 batch 2 范围）
- ❌ 不动 `memory/` 内容档（决策、教训、战略、采访等不变）
- ❌ 不引入新依赖
- ❌ 不重写 §3 艾瑞卡人格内容（仅章节编号变 §3 → §2）
- ❌ 不重写 §7 §8 子节具体内容（仅合并到新 §6 + 编号变更）
- ✅ 仅修 `BIAV-SC.md` 单一文件

---

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `git diff --stat` 仅 `BIAV-SC.md` 变化 | 命令行 |
| 2 | `BIAV-SC.md` 总行数 ≤ 300（当前 350，目标净减 ≥ 50） | `wc -l` |
| 3 | `grep "你是谁？" BIAV-SC.md` 无命中 | 命令行 |
| 4 | `grep "你的资源 — Studio" BIAV-SC.md` 无命中 | 命令行 |
| 5 | `grep "你的资源 — 社区" BIAV-SC.md` 无命中 | 命令行 |
| 6 | `grep "你的资源 — 外部观察者" BIAV-SC.md` 无命中 | 命令行 |
| 7 | 新结构 §0 ~ §7 章节计数正确 | grep 章节标题 |
| 8 | §3 接入方能力盘点表格完整 | 文本核查 |
| 9 | §6 合并后子节编号连续无跳号 | grep 子节标题 |
| 10 | 所有内部交叉引用（如「详见 §X」）指向正确新章节 | 全文 grep `§\d` |
| 11 | §0 开场不再含「找到你的角色分支」措辞 | grep 命令行 |

---

## 五、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  fix(entry): batch 1.5 patch — collapse to single-audience per
                守密人 2026-05-06 同日收缩裁定

  Resolves dispatch (memory/dispatch-brief-code-site-entry-redesign-batch1.5-patch.md).

  BIAV-SC.md changes:
  - REMOVE §1 五类受众分诊章 (§1.1 ~ §1.5)
  - REMOVE §4/§5/§6 受众分支资源章 (Studio/社区/观察者)
  - ADD §3 接入方能力盘点 (consolidated from removed branches)
  - PROMOTE §8.5 数据消费纪律 → new §4 (top-level visibility)
  - ADD §5 知识模块索引 (按需深入)
  - MERGE §7 内部协作 + §8 工程操作 → new §6 (renumbered subsections)
  - UPDATE §0 opening to drop "find your role branch" guidance
  - UPDATE all internal §X cross-references

  Net: 350 → ≤300 lines. Single-audience structure (8 chapters §0~§7).
  CLAUDE.md / README.md unchanged.

  Code-site boundary observed: only BIAV-SC.md touched.
  ```

---

## 六、艾瑞卡角色规则提醒

Code-site 仍按当前 BIAV-SC.md §3（即 patch 后的 §2）规则运行：「艾瑞卡」自称、对守密人「守密人」称谓、技术操作角色术语、绝不 emoji。

---

## 七、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-06 | 初版 batch 1.5 patch brief 落档（在 batch 1 v1.0 实施成果之上做单一受众收缩） | 主控台艾瑞卡 opus4.7 |
