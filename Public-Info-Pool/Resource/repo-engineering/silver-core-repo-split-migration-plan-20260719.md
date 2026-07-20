# BIAV-SC 分仓迁移计划（BIAV-SC-CODE + BIAV-SC-DATA）

> **决策锁定**：守密人 2026-07-19 裁定分仓——**新仓 `BIAV-SC-DATA`（数据湖）+ 现仓 `brain-in-a-vat`
> 改名 `BIAV-SC-CODE`（代码/大脑）**。本档为可执行迁移计划，承 T62 门② 分仓走向定案，取代原
> 「存储后端甲/乙/丙」框架（存储后端退化为 data 仓内部子问题）。
> **性质**：计划先行，不含执行动作。仓库创建/改名/迁数据为外向且部分不可逆操作，须按本计划分阶段、
> 每不可逆步前置守密人确认。

---

## 1. 决策与命名

| 仓 | 内容 | 由来 |
|----|------|------|
| **BIAV-SC-CODE** | 代码 / 记忆 / 知识 / OKF / SDK 家族 / CI（现 brain-in-a-vat 改名）| 现仓 rename |
| **BIAV-SC-DATA** | 数据湖 `Public-Info-Pool/Record`（社区全量档案）| 新建 |

命名与 CLAUDE.md 既有系统代号一致（BIAV-SC = Brain In A Vat — Silver Core / 银芯，对偶 BIAV-BP = 黑池），
在系统层沿用银芯自身代号；SDK 家族包名（silver-core-sdk / silver-core-maestro-sdk）为 npm 发布名，不受本次改名影响。

---

## 2. 事实基线（2026-07-19 实测）

| 块 | 工作树 | git 影响 | 耦合面 |
|----|--------|----------|--------|
| 数据湖 Public-Info-Pool | 663 MB（~94%）| pack ~417M 主体 | — |
| 大脑（代码/记忆/知识）| 36 MB | — | **48 个 .py 在树直读数据湖** |
| SDK 家族 | 7.6 MB | — | 本轮不迁（留 code 仓）|
| 仓名硬引用 | — | — | **63 个跟踪档含 `brain-in-a-vat`** |

> 比喻：搬报纸（数据）出屋只是搬得动的问题；难的是屋里 48 台仪器（脚本）都插着「墙上固定插座」（在树数据路径）读报纸——搬走报纸，得先给每台仪器换成「能接远端的插头」。

---

## 3. 核心技术难点 · 代码↔数据桥接（分仓成败所在）

48 个脚本（`build_community_index` / `build_okf_bundle` / `kb_*` / news 采集与回填 / OKF 指针层 /
`report_render` 等）在树直读 `Public-Info-Pool/`。数据迁出后，BIAV-SC-CODE 侧构建/采集/知识层
**必须仍能取到数据**。三种桥接，须门②-A 定选：

| 桥接 | 机制 | 优点 | 代价 |
|------|------|------|------|
| **A. git submodule** | code 仓把 data 仓作 `Public-Info-Pool/Record` 子模块 | 路径不变、48 脚本零改；版本钉定 | clone 需 `--recursive`；CI 需 checkout submodule（又拉回 663M，**未减 CI 成本**，除非 sparse）|
| **B. 兄弟 checkout + 环境变量根** | `archive_layout` 数据根改环境变量，CI/本地并列 clone 两仓 | code 仓 clone 真变小（不带 data）；采集 CI 只在 data 仓侧跑 | 须把 48 脚本的路径统一收口到 `archive_layout` 单一根常量（部分已收口）|
| **C. restore-from-Release 按需还原** | 构建期从 data 仓 Release 临时拉数据（现 `restore_release_data.py` 模式）| code 仓最轻；消费方按需取 | 每次构建拉数据慢；已有此模式基础 |

**艾瑞卡倾向 B**：唯一真正把 code 仓 clone 减到 ~36M + 让采集/数据 CI 归 data 仓的方案；改造靶心明确
（数据根常量收口），且部分脚本已走 `archive_layout` 单一真相源。A 最省事但不减重（伪分仓）。

---

## 4. 硬前置（承门① 发现，不可跳）

**16 个非 discord 平台无任何 Release 副本**（门① 盘点）。分仓迁移前**必须先为其建 Release 备份**——
迁移中任何数据移动若误伤，这 16 平台无第二份即不可逆丢失。discord 已有 `community-data` 桶兜底。
执行件：一条 CI workflow 打包 16 平台 → data 仓（或现仓）Release，与 discord 对齐。

---

## 5. 迁移时序（每不可逆步前置守密人确认）

- **P-0 · 桥接选型定案**（门②-A）：**已定案 = 方案 B**（守密人 2026-07-19「两仓在手」设想 = 兄弟 checkout + 环境根）。
  **首批收口已落**（2026-07-19）：`archive_layout` 加 `pool_root()`/`community_root()`/`discord_root()` 环境根
  resolver（env `BIAV_SC_DATA_ROOT` 或在树默认，向后兼容），8 个采集/数据核心脚本切用之；契约测试 4 例 + 全量绿。
  **余：** 其余在树读点（kb/okf 指针字符串、Resource 侧不迁）按需续收，不阻塞。
- **P-1 · 16 平台 Release 备份**（硬前置）：**已落**（2026-07-19）——`.github/workflows/community-platform-backup.yml`
  月度 + `workflow_dispatch` 打包 16 非 discord 平台 → `community-platforms` release（滚动全量、`--clobber`）。
  **实证待跑**：守密人可 `workflow_dispatch` 手动触一次验证首份副本落地。
- **P-2 · 建 BIAV-SC-DATA 仓**（守密人 GitHub 侧）：新建仓，导入数据湖（带或不带历史，见 §7）。
- **P-3 · code 仓拆数据**：现仓停止跟踪 `Public-Info-Pool/Record`，改桥接引用；48 脚本切远端根。
- **P-4 · 现仓改名 BIAV-SC-CODE**（守密人 GitHub 侧）：GitHub rename（旧 URL 自动重定向）；同步改 63 处硬引用中的活引用（README/RELEASES/CLAUDE.md/workflows/package.json 等，数据档内历史引用不追溯改）。
- **P-5 · CI/凭据重挂**：两仓各自 workflow；deploy key（BOT_DEPLOY_KEY）、Ruleset required 检查、Release 通道分仓重配。

---

## 6. 会断/需改清单（迁移必须扫平）

- **CI**：39 workflow 按归属分仓（采集/数据类 → data 仓；测试/SDK/OKF/知识 → code 仓）；
- **deploy key / Ruleset**：T31 的 BOT_DEPLOY_KEY 直推链、T61 的五 required 检查须两仓各自重建；
- **Release URL**：`community-data` 等桶随数据归 data 仓，RELEASES.md「藏宝图」+ `restore_release_data.py` URL 改址；
- **blob 超链接**：CLAUDE.md §2.2.2 硬规则的 GitHub blob 链接域名随改名变（旧链重定向但应更新活档）；
- **OKF 指针层**：community/news-output 层指针路径经 `archive_layout` 单一源，随桥接根改而正确（`test_okf_pointer_layers` 守护）；
- **package.json / npm**：SDK 家族 `repository` 字段（若指 brain-in-a-vat）随改名更新。

---

## 7. 遗留决策 · BIAV-SC-CODE 历史体量（唯一仍涉 T29 的点）

现仓改名保留历史 → **pack 仍压着 ~417M 历史数据 blob**。两条路：
- **甲（推荐，绕 T29）**：BIAV-SC-CODE **保留全历史**（冻结的数据 blob 留在 pack），仅**停止新增**数据跟踪。
  clone 仍带历史重量，但**零历史重写、零不可逆风险**；随时间新数据全在 data 仓、code 仓相对变轻。
- **乙（触 T29）**：对 BIAV-SC-CODE 做历史重写剥离数据 blob → pack 真减到 ~code 体量。**须满 §4 硬前置 +
  全量 mirror 备份 + 守密人显式裁**（门③ 语义）。

> 分仓本身（拓扑 A + rename）**不要求**历史重写；乙是可选的「再瘦一层」，独立裁。先分仓、後议是否鞭历史。

---

## 8. 守密人侧 GitHub 管理动作（银芯无权，须守密人执行）

> **实测坐实（2026-07-19）**：`create_repository` 建 `BIAV-SC-DATA` → **403「Resource not accessible
> by integration」**——本会话 GitHub 集成无仓库管理权限。建仓 + 改名两件确须守密人 GitHub 侧亲为。

1. ~~新建 `lightproud/BIAV-SC-DATA` 仓~~ **已建**（2026-07-19，空仓）；定可见性：随现状 public / 改 private 分级；
2. 现仓 `brain-in-a-vat` → rename `BIAV-SC-CODE`（Settings）；
3. **data 仓填充 · 细粒度 PAT（乙方案，阶段一；守密人无本地环境，纯网页操作）**：会话代理对
   BIAV-SC-DATA 只读（写 403），故走 PAT + CI 推送——(a) 建 fine-grained PAT（github.com/settings/tokens
   → Fine-grained → Only select repositories: BIAV-SC-DATA → Repository permissions → Contents: Read and write）；
   (b) 令牌存 code 仓 secret `BIAV_SC_DATA_TOKEN`（GitHub 令牌页直接贴进 secret 框，不经聊天，lesson #3）。
   配好后 Actions → `data-repo-sync.yml` → Run（输 `MIGRATE`）即把 Record/Community 快照推进 data 仓。
4. 两仓各配 Ruleset required 检查 + Release 权限；会话 repo scope 随之更新（现钉 brain-in-a-vat）。

银芯侧可自动化的准备（现仓内、可逆）：桥接改造（P-0）、16 平台备份 workflow（P-1）、活引用改址脚本、
CI 分仓草案、RELEASES/restore URL 参数化。

---

## 9. 回滚

- P-0～P-1 纯可逆（现仓内改造 + 只增备份）；
- P-2～P-3 半可逆（data 仓在、现仓数据可从 data 仓/Release 还原）；
- P-4 rename 由 GitHub 自动重定向兜底，可再改回；
- 未做 §7 乙（历史重写）前，**全程无不可逆步**——这是分仓相对门③ 的根本安全优势。

---

## 10. 待裁点

- ~~门②-A 桥接选型~~ **已定 B + 首批收口落地**（见 §5 P-0）；
- ~~P-1 16 平台备份 workflow~~ **已落**（见 §5 P-1），守密人可 `workflow_dispatch` 验证首份副本；
- **仍待守密人**：① §8 建 `BIAV-SC-DATA` + 改名（GitHub 侧，403 无权）+ 定 data 仓可见性；
  ② **§7 历史体量**：BIAV-SC-CODE 走甲（保历史、绕 T29）还是乙（历史重写、须门③ 前置）——**可延后，分仓不阻塞**。

*立计划：2026-07-19 艾瑞卡会话（守密人分仓裁定 + 命名）。挂账见 `memory/todo.md` T62。仓库管理动作在守密人侧，
银芯侧只做可逆准备工作。*
