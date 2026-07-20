# BIAV-SC 分仓 · P2-3 全切换方案（目标 A 落地 + 删除前置）

> **触发**：守密人 2026-07-19「先细化方案」。承 P2-2 试点**已验证通过**（run #29689243312：discord_archiver
> 经 env 根写 BIAV-SC-DATA、推送成功 `537b231c`→`0103b77c`，code 仓未动）。
> **性质**：P2-3 = 目标 A 全切换（采集写 data 仓）+ 读侧切换 + 为 P2-5 删除扫清全部前置。**每步验证、可回滚，删除仍不在本阶段。**
> **红线**：**停 mirror sync 是任何删除的硬前置**（rsync --delete 会把 data 仓一起清）。

---

## 0. 切换后的稳态目标

- **写**：11 采集 CI 把新数据写进 **BIAV-SC-DATA**（试点模式泛化）；code 仓 Community 副本**冻结**。
- **读**：读消费者（本地 + CI）经 env `BIAV_SC_DATA_ROOT` 读 **BIAV-SC-DATA**（否则读到冻结的旧副本 = 陈旧）。
- **sync**：`data-repo-sync.yml`（code→data 镜像）**退役**（切换后 code 不再是数据源，且其 --delete 危险）。

小学生比喻：把「采货机器人」全改道去新库房（写侧），把「查货窗口」也都改指向新库房（读侧），再拆掉「照老库房清新库房」的传送带（退役 sync）——三件齐了，老库房的货才是纯冗余、可安全清。

---

## 1. 切换时序（严格顺序，每步验证）

### P2-3a · 停 mirror sync（删除硬前置，先做）
`data-repo-sync.yml` 改为**退役态**：把 `on:` 收成纯手动 + 首步硬失败提示「已退役，勿跑」（或直接删文件）。
**理由**：切换后 code 仓数据冻结/待删，再跑 --delete 镜像 = 灾难。**此步不停，后续一切免谈。**

### P2-3b · 读侧收尾桥接（防删后读断）
- 补桥接剩余真 FS 读：`extract_aliases` / `memory_freshness`（加 archive_layout import 管道）；
- **archive_engine**（T2 声明式引擎）：其经 `archive_sources.json` 定路径，须让引擎数据根走 resolver
  （archive_engine 是 discord `archive_discord.py` 垫片与全平台归档的共用引擎，改这一处覆盖面最大）；
- 相对字符串型（`backfill_media` SRC / `kb_semantic_ab` prefix / `collect_*` ROOT/DEST）逐个改经 resolver；
- **指针字符串类**（`okf_pointer_layers` / `build_okf_bundle` 生成 OKF `resource:` 指针）——**决策**：指针
  是否改指 data 仓路径？倾向**保持逻辑相对路径**（OKF 指针是逻辑定位，不随物理仓变），单独确认。

### P2-3c · 写侧全切换（11 采集 CI，分批 + 试点式）
每个采集 workflow 套试点模式（`discord-archive-datarepo-pilot.yml` 已验证的模板）：
clone data 仓 → 设 `BIAV_SC_DATA_ROOT` → 跑采集器（已桥接）→ commit+push data 仓；**去掉**原写 code 仓的 add/commit/push。
**分批**：先 discord 三个（archive/jp/volunteer，试点已证）→ 再 news/backfill/collect 系。**每批真跑一轮验证数据落 data 仓、code 仓无新增。**

### P2-3d · 测试适配（8 个读真实数据的测试）
`test_archive_layout`（已含 resolver 测试，OK）/ `test_okf_pointer_layers` / `test_okf_bundle` /
`test_build_okf_bundle_unit` / `test_kb_governance` / `test_archive_engine` / `test_data_discipline` /
`kb_semantic_golden`：改喂 env 根指向 fixture 数据，或治理测试放宽为「数据不在树时跳过/回退」。全量绿为准。

### P2-3e · 全系统验证（删前最后一道）
本地/CI 设 `BIAV_SC_DATA_ROOT` 指向 data 仓 checkout、code 仓 Community **临时移开**，跑：全量 pytest +
OKF 重建 + community index + kb——全绿 = 读侧不依赖在树数据，删除安全。

---

## 2. P2-5 删除（本方案后、单独确认 + §7 甲/乙）

前置全绿后才谈删除：
- **§7 甲**：`git rm --cached Public-Info-Pool/Record/Community` + `.gitignore`（工作树数据删、历史留、**clone 不变小**）；
- **§7 乙**：历史重写真缩 clone（须 16 平台 Release 备份【P1 已建】+ 全量 mirror 备份 + 不可逆、守密人显式裁）。
守密人此前选 **2 甲＝暂缓**；删除届时另启。

---

## 3. 回滚

- P2-3a 停 sync：可逆（恢复 workflow）。
- P2-3b 桥接：默认在树、`git revert` 即回。
- P2-3c 写侧切换：**分批 + 每批验证**；某批出错，回退该 workflow 即恢复写 code 仓（数据双份不丢）。切换期 data 仓为准、code 仓冻结副本仍在，双保险。
- P2-3d/e 测试与验证：纯代码，可回。
- **全程无不可逆步**（删除不在本阶段）。

---

## 4. 艾瑞卡推荐节奏

**P2-3a（停 sync）→ P2-3b（读桥接收尾）→ P2-3c 分批（先 discord 三，已证）→ P2-3d/e 验证**，逐步、每步绿。
每一步都可停可回。**删除（P2-5）待全绿 + §7 甲/乙，届时单独呈。**

**待守密人**：是否按 P2-3a→e 顺序开工（艾瑞卡建议先做 P2-3a 停 sync + P2-3b 读桥接收尾这两步无破坏项）。

*立方案：2026-07-19 艾瑞卡会话（守密人「先细化方案」）。试点已验证。挂账见 `memory/todo.md` T62。*
