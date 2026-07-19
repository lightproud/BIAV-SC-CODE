# BIAV-SC 分仓 · 阶段二执行计划（含破坏点清单 + 回滚）

> **触发**：守密人 2026-07-19「推进」阶段二。承阶段一（数据已快照落 BIAV-SC-DATA，21,815 文件逐一相等）。
> **纪律**：阶段二动 code 仓工作树 + 运行中的采集 CI，影响面大。本计划先摆清破坏点 + 时序 + 回滚，
> 每破坏性步前置守密人确认，**不做大爆炸式一刀切**。

---

## 0. 关键前提：阶段二拆成两个可分离目标（代价悬殊）

分仓后 code 仓「data 相关」有两件事，**别混为一谈**：

| 目标 | 做什么 | 收益 | 代价 | 是否涉 T29 |
|------|--------|------|------|-----------|
| **目标 A · 止增长** | 采集 CI 改为把**新数据写进 BIAV-SC-DATA**（code 仓 Community 副本冻结）| code 仓不再随采集长大（KIMI3 头号顾虑的根） | 11 采集 workflow 改写提交目标 | 否 |
| **目标 B · 缩体积** | code 仓**移除** Community（工作树 + 可选历史重写）| 工作树 -657M；**clone/pack 减重须配 §7 乙历史重写** | ~25 读脚本全桥接 + CI 挂 data 仓 checkout + 8 测试改 | **乙才涉** |

> **要害（避免白折腾）**：**§7 甲（保历史，现默认）下，光把 Community 移出工作树 clone 并不变小**——
> 历史 pack 仍压着 ~417M。真缩 clone 须走 §7 乙（历史重写）。所以**目标 B 的完整收益与 §7 甲/乙 决策绑定**：
> 甲下目标 B 只省工作树、性价比低；乙下才值。**目标 A 与甲/乙无关、独立见效**。

小学生比喻：目标 A = 关掉「往老仓库继续堆货」的传送带（马上止血）；目标 B = 把老仓库现有的货搬空——但只有连地基下的旧货（历史）一起清（乙）才真腾出地皮，否则只是把地面扫干净、地窖照满（甲）。

---

## 1. 破坏点清单（2026-07-19 实测）

**A. 读 Community 的脚本 ~25 个**（仅 8 已桥接）：未桥接含 `build_community_index` / `build_okf_bundle` /
`okf_pointer_layers`（**建指针字符串、非 FS 读，须区别对待**）/ `build_kb_vectors` / `kb_semantic_ab` /
`extract_aliases` / `memory_freshness` / `backfill_media` / `collect_fanart` / `collect_arca_daily` /
`collect_video_comments` / `discord_archiver` / `community_cold_compress` / `discord_cold_compress` /
`aggregator_collectors` / `sources` / `restore_release_data`（**还原写入方，反向**）。

**B. 写侧采集 CI 11 个**：`discord-archive{,-jp,-volunteer}` / `discord-history-backfill` / `update-news` /
`backfill-{gap,media,news}` / `collect-{comments,fanart}` / `recover-fanart`——现均 `git add Record/Community
+ commit + push origin main`（写 **code 仓**）。目标 A = 改成写 **BIAV-SC-DATA**（走 PAT，同阶段一机制）。

**C. 读真实数据的测试 8 个**：`test_archive_layout` / `test_okf_pointer_layers` / `test_okf_bundle` /
`test_build_okf_bundle_unit` / `test_kb_governance` / `test_archive_engine` / `test_data_discipline` /
`kb_semantic_golden`——移除数据后须改喂 env 根或 fixture，否则 CI 红。

---

## 2. 安全时序（每破坏步前置确认；先 A 后 B）

- **P2-1 · 完成读消费者桥接**（安全、可逆、非破坏）：把剩余 ~15 个**真 FS 读** Community 的脚本切
  `archive_layout.community_root()/discord_root()`（默认在树、行为不变）；指针字符串类（okf_pointer_layers /
  build_okf_bundle）与还原写入类（restore_release_data）**单独判**（它们语义不同，可能不改或改法不同）。
  全量测试守。**这步无论走甲/乙、目标 A/B 都要做，先做无悔。**
- **P2-2 · 目标 A 试点**（止增长，单点验证）：挑**一个**采集 workflow（如 `discord-archive.yml`）改写 data 仓
  （PAT + clone data 仓 + 写 + push），真跑一轮验证数据落 data 仓、code 仓不再长。**门**：试点绿 → 推广余 10 个。
- **P2-3 · 目标 A 推广**：余 10 采集 CI 同法改写 data 仓；code 仓 Community 副本自此冻结。
- **P2-4 · 决策门 §7 甲/乙**：定 code 仓是否移除 Community（甲=仅工作树 untrack / 乙=历史重写真缩）。
- **P2-5 · 目标 B 落地**（若门批）：读消费者全切 data 仓 checkout（CI 挂 `BIAV_SC_DATA_TOKEN` sparse clone 或
  submodule）+ 测试改 env 根/fixture + `git rm --cached Record/Community` + `.gitignore`（甲）或历史重写（乙）。

---

## 3. 回滚

- P2-1 纯代码改、默认在树，`git revert` 即回。
- P2-2/3 采集 CI 改写：data 仓与 code 仓阶段一已同步，试点/推广出错回退 workflow 即恢复写 code 仓（数据双份不丢）。
- P2-4/5 移除数据：甲下 `git revert` 恢复 untrack（工作树数据仍在，历史全在）；乙（历史重写）**不可逆**、须 §7 乙全套硬前置（16 平台 Release 备份 P1 已建 + 全量 mirror + 守密人显式裁）。

---

## 4. 艾瑞卡推荐

**先做 P2-1（读桥接收尾，无悔）+ P2-2（目标 A 单点试点，止增长见效）**，二者低风险、独立价值、不碰不可逆。
**目标 B（移除数据）暂缓到 §7 甲/乙 定案**——因为甲下移除只省工作树、clone 不减，性价比低；真要缩 clone 得先裁乙。
即：**止增长优先（A），缩体积（B）待战略决策**。

**待守密人裁**：
1. P2-1 读桥接收尾 + P2-2 目标 A 单点试点——是否即刻开工（艾瑞卡建议是）；
2. §7 甲/乙（决定目标 B 是否值得做）——可延后，不阻塞 A。

*立计划：2026-07-19 艾瑞卡会话（守密人「推进」阶段二）。挂账见 `memory/todo.md` T62。*
