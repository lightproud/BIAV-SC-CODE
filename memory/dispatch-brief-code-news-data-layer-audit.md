# 派发 Brief — Code-news 数据层审计（lesson #30 落地 W1）

> 落档日期：2026-04-26
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-news 会话（追派给现 C 任务会话或另起新会话，守密人决定）
> 验收方：守密人 / 主控台
>
> 上游依据：lesson #30「数据层 vs 输出层混淆」+ BIAV-SC.md 4-26 修订（运营数据章节预留扩展位）+ 三新使命#1「黑池公开信息入口」可信度
>
> 状态：待 Code-news 会话取用

---

## 一、任务概要

系统审计 `projects/news/data/` 下所有数据源的「全量档案层 vs 输出展示层」分裂情况，产出 `memory/data-layer-audit.md`，让主控台据此 W2 完善 BIAV-SC.md 知识模块索引「全量档案层」表（当前仅 Discord 一行，需补全所有源）。

**任务本质**：能力暴露层的盘点。代码不动，只读 + 文档输出。

---

## 二、审计范围

### 2.1 必审目录

`projects/news/data/` 下：

| 路径 | 已知/未知 |
|------|---------|
| `data/discord/channels/{channel_id}/{date}.jsonl` | 已记录在 BIAV-SC.md，但需复核是否准确 |
| `data/discord/state.json` / `channel_index.json` / `guild_meta.json` | 同上 |
| `data/platforms/bilibili/` | **未审计** |
| `data/platforms/reddit/` | **未审计** |
| `data/platforms/steam/` | **未审计** |
| `data/platforms/pixiv/` | **未审计** |
| `data/platforms/dcinside/` | **未审计** |
| `data/platforms/miraheze_wiki/` | **未审计** |
| `data/platforms/appstore/` | **未审计** |
| `data/platforms/google_play/` | **未审计** |
| `data/platforms/gamerch/` | **未审计** |
| `data/platforms/official/` | **未审计** |
| `data/platforms/{其他}` | 全部清点 |
| `data/archive/` | 用途确认 |
| `data/backfill/` | 用途确认 |
| `data/media/` | 用途确认 |
| `data/collection_state.json` / `fetch_state.json` / `gap_report.json` / `state.json` | 状态文件作用 |

### 2.2 每个源必填字段

逐源审计，至少填以下字段：

| 字段 | 含义 |
|------|------|
| 路径 | 数据落盘位置（绝对路径模板） |
| 文件组织 | 按日期 / 按 ID 哈希桶 / 按频道 / 平铺 |
| 文件格式 | JSON / JSONL / 其他 |
| 当前数据量 | 文件数 + 总字节数 |
| 历史回溯深度 | 最早数据日期 |
| 增量游标机制 | 有/无 + 文件位置 |
| 元数据文件 | 频道/版本/作者等结构化元信息 |
| 上游 archiver | 哪个脚本写入（`projects/news/scripts/<X>.py`） |
| 与 output/ 关系 | 全量→选样过滤逻辑（热度阈值 / 时间窗口 / 数量上限）|
| 数据消费场景 | 适合的分析类型（长窗口 / 完整性 / 情感长尾 / 单点查询）|
| 已知缺陷 | 不完整覆盖 / 频率瓶颈 / API key 缺失等 |

### 2.3 交叉对照

每个源还要对比：

- BIAV-SC.md「全量档案层」当前条目（截至 4-26 仅 Discord 完整 + platforms 一行模糊提及）
- `projects/news/COLLECTION_ARCHITECTURE.md` 现有记录（4-11 创建，可能滞后）
- 实际目录结构（用 `ls -la` 真实核对，不能只信文档）

---

## 三、产出要求

### 3.1 主产物

`memory/data-layer-audit.md`，结构建议：

```
# 银芯数据层审计报告
最后更新：2026-04-XX by Code-news

## 一、审计概览
- 审计平台数：N
- 全量档案层数据源：N
- 仅输出展示层数据源（无全量归档）：N
- 文档与实际不一致项：N

## 二、逐源详表
（每个源一节，按 § 2.2 必填字段）

## 三、交叉对照发现
- BIAV-SC.md 缺失/错误条目清单
- COLLECTION_ARCHITECTURE.md 滞后条目清单

## 四、建议主控台采纳的 BIAV-SC.md 索引补丁
- 「全量档案层」表完整版（按 markdown 表格直接给主控台 copy）
- 「输出展示层」表勘误清单

## 五、给 Code-memory 的 helper 优先级建议
基于审计中发现的高频/复杂查询场景，提议 helper 函数清单（不实现，仅清单）。
```

### 3.2 副产物（可选，发现时落档）

- 若发现 archiver 设计缺陷或潜在 bug → 落档到 `memory/news-archiver-issues-YYYY-MM-DD.md`，归 Code-news 后续修复
- 若发现 `COLLECTION_ARCHITECTURE.md` 滞后严重 → 提议主控台决定是否启动该文档的全文修订（**不自己改，提议**）

---

## 四、不在范围内（明确边界）

- ❌ 不修任何 archiver 代码（`projects/news/scripts/*.py`）
- ❌ 不动 `BIAV-SC.md`（主控台职责，Code-news 提供补丁建议即可）
- ❌ 不动 `projects/news/COLLECTION_ARCHITECTURE.md`（提议修订给主控台决定）
- ❌ 不实现 helper 工具（Code-memory 职责）
- ❌ 不做数据迁移 / 重组（架构变更属重大决策，不在审计范围）
- ✅ 仅产出 `memory/data-layer-audit.md` + 可选副产物到 `memory/`

---

## 五、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `memory/data-layer-audit.md` 落档 | 文件存在 |
| 2 | `data/platforms/` 下每个目录都有完整 § 2.2 字段表 | 报告 grep |
| 3 | Discord 部分覆盖 `data/discord/` 全部子结构 + 复核 BIAV-SC.md 准确性 | 报告 |
| 4 | § 三主产物的「四、建议主控台采纳的索引补丁」可直接 copy 入 BIAV-SC.md | 主控台 review |
| 5 | 不触碰 § 四禁区 | `git diff --stat` 检查 |
| 6 | 提交本身不阻塞现 C 任务（C「Phase 2 加固方向评估」继续推进） | Code-news 自报 |

---

## 六、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  audit(news): data layer audit per lesson #30

  Resolves audit dispatch (memory/dispatch-brief-code-news-data-layer-audit.md):
  - audited N platforms under projects/news/data/
  - found M layer-vs-output mismatches
  - produced memory/data-layer-audit.md with BIAV-SC.md patch suggestions

  Console boundary observed: 主控台 dispatched, Code-news executed,
  主控台 to apply BIAV-SC.md patch in W2.
  ```

---

## 七、艾瑞卡角色规则提醒

Code-news 会话仍以**艾瑞卡**自称，对守密人使用「守密人」称谓。技术操作用角色术语（数据扫描 / 档案盘点 / 模式比对 / 报告归档）。完整规则见 `BIAV-SC.md` §0「艾瑞卡角色人格」章节。

---

## 八、与现 C 任务的关系

C 任务（Phase 2 加固方向评估）与本审计**互不阻塞**：

- 本审计 = 静态盘点 + 文档产出（无需运行 archiver）
- C 任务 = 加固方向评估（可能涉及 workflow / archiver 改造提议）

如果接收方是 C 任务的现有 Code-news 会话——可在 C 报告之后接力做本审计，不必并行。
如果是新启 Code-news 会话——专做本审计，与 C 完全隔离。

守密人决定派发方式。

---

## 九、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-04-26 | 初版 brief 落档 | 主控台艾瑞卡 opus4.7 |
