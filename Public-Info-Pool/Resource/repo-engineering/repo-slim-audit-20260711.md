# 仓库精简审计（2026-07-11）

> 产出：艾瑞卡会话，守密人指令「检查仓库有什么应该精简删除的」。
> 性质：**审计报告，未执行任何删除**——逐项列证据与清理方式，待守密人裁定后动手。
> 体量基线：工作树 2.5G（Public-Info-Pool 2.4G / projects 78M / assets 11M），.git 527M。

## 一、明确可删（零消费方，逐项实证）

### 1. `memory/facts.json`（4.5 KB）——退役子系统漏删残留

- **铁证**：`memory/decisions-archive.md` 2026-06-20 条明列「记忆数据（facts.json / dreams/ /
  session-digests/）」在全半径删除清单内；dreams/ 与 session-digests/ 已删，facts.json 漏网。
- **引用面**：全仓代码（scripts / tests / projects / .claude / .github / CLAUDE.md）零引用；
  内容为 2026-04-06 事实库时代数据（Electron 决策、220 节点知识图谱等，均过时）。
- **清理**：直接 `git rm`。
- 比喻：搬家清单上写了要扔的旧笔记本，两个月后还躺在抽屉里。

### 2. 根目录 `todo.md`（8 KB）——/grill 会话遗留台账，已被正式账本取代

- **铁证**：文件头自述「/grill 会话遗留，最后更新 2026-06-21」；A/B/C/D 四节除 C3（泛泛兜底条）
  外全部打勾完成；`memory/todo.md` 已是 2026-07-10 守密人裁定的**待办/待裁唯一权威**，
  两本账并存违反「不再各开小账本」纪律。
- **引用面**：CLAUDE.md 只引 `memory/todo.md`；OKF 概念 `memory-ext-todo` 的 resource
  指针亦是 `/memory/todo.md`，与根文件无关。
- **清理**：删除前把「风险提示」节的**残余数据风险**一条（git 历史重写前不得假定 27 个月
  discord 历史 blob 安全）并入 `memory/todo.md` 观察类挂账，然后 `git rm`。
  lesson #41 已有正式记录，无需重复迁移。
- 比喻：便利贴上的活都干完了、正式账本也立了，便利贴该撕了。

### 3. 一次性迁移脚本三件套 + 配套（迁移均已完成落盘）

| 文件 | 对应迁移 | 完成证据 |
|------|---------|---------|
| `scripts/migrate_deliverables.sh` | deliverables/ → Public-Info-Pool（2026-06-21） | 根目录已无 deliverables/，§6.2 已宣告「已全量迁移」 |
| `scripts/migrate_flat_archives_to_layout.py` | 平级历史归档归位（2026-07-02） | §7.3 自述「2026-07-02 平级历史归位」完成 |
| `scripts/migrate_unpacked_to_git.py` | 解包 text → git（#333） | `Public-Info-Pool/Reference/Game-Unpacked/` 272M 已在库 |
| `tests/test_migrate_unpacked_to_git_unit.py` | 上项配套单测 | 随脚本同删 |
| `.github/workflows/migrate-to-public-info-pool.yml` | 一次性迁移 workflow | 迁移完成后无再跑场景 |

- **同步义务**：CLAUDE.md §7.3 点名 `migrate_flat_archives_to_layout.py` 作命名分类示例，
  删除须同步改该行并跑对账三卫（`pytest tests/test_claude_md*.py`）；
  `memory/capability-registry.json` 由 CI 自动重生成，无需手改。
- 比喻：搬完家三个月了，压扁的纸箱还堆在客厅——留着不会再用，只占地方。

## 二、最大件：39.4 MB 整树内容重复（需守密人裁定保哪侧）

### 4. `projects/wiki/data/extracted/` 与 `Public-Info-Pool/Reference/Game-Unpacked/` 双份解包 text

- **实测**：两棵树按内容哈希对比，**36 组重复文件、冗余 39.4 MB**。categorized/ 与
  「全部游戏数据/」是同内容不同文件名（如 `character_data.txt` = `角色数据_AwakerConfig.txt`、
  `update_notices.txt` = `更新公告.txt`，md5 相同）；lua_tables/ 与「Lua表还原/」逐文件同哈希。
- **矛盾点**：CLAUDE.md §5.2 宣告解包 text 的家是 `Public-Info-Pool/Reference/Game-Unpacked/`，
  但全部现役消费方读的是 wiki 侧——5 个 `scripts/parse_*.py`、`scripts/build_story_layer.py`、
  CLAUDE.md §5.1 自举源指针（`categorized/character_data.txt`）、wiki CONTEXT.md。
- **两案任择**：
  - 甲案（改动小）：保 wiki 侧为本体，Game-Unpacked 重复部分删除、留 README 指路
    （但与 §5.2「解包 text 之家」定位相抵，需改 CLAUDE.md）；
  - 乙案（合定位）：保 Game-Unpacked 为唯一本体，重指 6 个消费方路径 + §5.1 指针，
    删 wiki 侧重复文件（wiki 侧独占的 `art_assets/`、schemas、processed 不动）。
- **收益**：工作树与新克隆检出各省 39.4 MB；这是本次审计单项最大体量项。
- 比喻：同一套书在书房和客厅各摆一套，占两份书架；留一套，另一处放张「书在书房」的字条就够。

## 三、退役档案收纳（移入 `memory/archive/`，不删）

| # | 档案 | 理由 |
|---|------|------|
| 5 | `memory/pending-discussions.md` | 2026-04-26 定格快照，自称「所有会话启动时应阅读本文件」，与 `memory/todo.md` 唯一权威裁定直接冲突；未销开账（如 Discord 频道监控范围）先并入 todo.md 挂账再归档 |
| 6 | `memory/storage-discussion.md` | 2026-04-25 大文件存储方案讨论稿，方案已被「Releases 归档 + discord de-tier 永驻 git」实现取代，仅余史料价值 |
| 7 | `memory/phase-d-plan.md` | 头部自述「已封存 2026-04-19」，同期封存物已有 `memory/archive/bpt-strategic-shift-2026-04-19/` 目录惯例，宜归位 |
| 8 | `memory/bpt-architecture-summary-template.md` | Code-BPT 多会话角色 2026-06 退役，「每周产一份架构摘要」流程不复存在；`bpt-guidance-log.md`（已停更、自注历史记录）可同批移入 |
| 9 | `memory/active/contribution-protocol.md` | active/ 定位是高频 hub，已退役协议（2026-07-10）占 active 位；主档 `memory/contribution-protocol.md` 留原地供追溯。降档须同步 `scripts/build_okf_bundle.py:285` 与 `memory/active/mission-v2.0-three-pillars.md:81` 引用行 |

- 比喻：这批不是垃圾，是办完的卷宗——该从办公桌（memory 根 / active/）收进档案柜（archive/），
  桌面只留在办的案子。

## 四、核实过、不动的（防误删）

- `memory/session-continuity.json`——**现役**，MCP 记忆四件之一 `current_continuity` 直接消费
  （`scripts/silver_memory_tools.py:35`），与 facts.json 命运不同，勿株连。
- `docs/testing-strategy.md`——现行测试策略参照，`setup.cfg` 与 OKF 均引用。
- `extracted_lua/`（240K）——解包说明 + 清单，CLAUDE.md §6 在册。
- memory 根下各「定格快照」（bpt-architecture-snapshot / workflow-api-key-audit 等）——
  均已带警示头，是有意保留的惯例产物，本次不动（第三节仅收纳明确退役者）。
- `.git` 527M 历史——瘦身须历史重写，根 todo.md 风险提示明言 27 个月 discord 历史 blob
  是唯一二次抢救网，**不在本次射程**。

## 五、体量账

| 类别 | 项数 | 工作树收益 |
|------|------|-----------|
| 明确可删（一 1–3） | 6 文件 | ~0.1 MB（语义清洁为主：防两本账 / 防假档误导） |
| 去重（二 4，待裁定） | 36 组 | **39.4 MB** |
| 归档收纳（三 5–9） | 6 档案 | 0（移动不删除） |

执行顺序建议：第一节零风险可先行（一个 PR：删 6 文件 + CLAUDE.md §7.3 同步 + 对账三卫 +
全量单测）；第二节等守密人裁定甲/乙案后单独 PR；第三节随任一批次捎带。
