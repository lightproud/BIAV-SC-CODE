# 过时 demo 残留扫描报告（旧 BPT 网页版 / 桌面第二版）

> 执行：艾瑞卡会话，2026-07-12。依据：守密人 2026-07-12「银芯即时进入稳态维护期 + 过时 demo
> 清理」裁定条②（见 `memory/decisions.md` 同日条）——旧 BPT 网页版与桌面第二版的一切演示性
> 残留标记过时并清理，**先扫描报告残留清单，经守密人过目后执行删除**。
> 本报告仅扫描登记，**未执行任何删除**。
> 排除项（裁定明示不清理）：bpt-pm / bpt-v2t / game 原型；历史决策 / 归档档案不追溯改写。

## 总体结论

**演示性残留（demo 构建物 / 演示视频 / 截图包 / 网页 demo 压缩包）近乎零残留。**
旧 BPT 产品线目录（bpt-web / bpt-desktop / bpt-next / graphify-ext / occ-local）已于
2026-04-19 战略转向中干净删除，`projects/` 与 git 工作树均无残件；Releases 与
Public-Info-Pool 中的演示性二进制残留为 **0**。全仓仅发现 **1 处活文档过时文字引用**
（清理候选，待守密人裁）。

小学生比喻：搬家两个多月后回旧屋查漏——大件家具早搬空了，只在门口信箱上还贴着一张
写有旧住户名字的小标签（一行注释），撕不撕由屋主说了算。

## 一、GitHub Releases（`RELEASES.md` 藏宝图核对）——零残留

现役 Release 桶仅 `unpacked-assets`（解包）与 `community-assets`（社区二创），登记内容全部为
游戏解包二进制（`morimens-*.tar.gz`）与社区同人图 / 音视频归档。**无任何 bpt-web / bpt-desktop
demo 构建物、演示视频、截图包或网页 demo 压缩包条目**。旧 37 个零散 release 已归并，退役桶
（community-data / unpacked-data / media-archive-v1）与 BPT demo 无关。

## 二、Public-Info-Pool/ 归档——零 demo 残留（命中均为现役文档或无关数据）

| 命中 | 性质判断 | 建议 |
|------|---------|------|
| `Resource/repo-engineering/bpt-desktop-ui-roadmap-20260705.md` | 现役文档（黑池侧在建 BPT Desktop 图纸） | 保留 |
| `Resource/repo-engineering/bpt-desktop-command-impl-plan-20260710.md` / `bpt-desktop-command-framework-requirements-20260710.md` / `bpt-desktop-builtin-commands-batch1-20260711.md` / `bpt-desktop-ui-reference-20260704-r2.md` | 现役文档（命令框架 / UI 设计图纸系列） | 保留 |
| `Resource/repo-engineering/claude-desktop-ui-structure-20260704-r2.md` / `claude-desktop-ui-wireframe-20260704.html` | 现役文档（Desktop 设计参考；「演示」一词指 Cowork 产出物类型，非 demo 残留） | 保留 |
| `Resource/proposal/bpt-desktop-cowork-experience-design-20260708.md` / `bpt-sdk-roadmap-20260705.md` / `bpt-stack-ontology-design-notes-20260710.md` 及 `bpt-sdk-*` 系列 | 现役文档（silver-core-sdk / Desktop 设计档，非被删产品线） | 保留 |
| `Reference/Game-Unpacked/`、`Record/Community/` 下 demo / 演示 / 第二版 命中 | 无关数据（游戏文本与社区采集数据，如 Discord 频道「未來改動計劃（第二版）」指游戏改版） | 保留 |

**bpt-web / 网页版 / 桌面第二版 在整个 Public-Info-Pool：零命中。**

## 三、文档引用（全仓 ripgrep）——1 处清理候选，其余为受保护档

| 命中 | 性质判断 | 建议 |
|------|---------|------|
| **`.github/workflows/deploy-site.yml` 第 1 行头注释**：`# Auto-deploy site + wiki + news + bpt-web to GitHub Pages`——工作流实际只部署 site / wiki / news / kb / docs，无任何 bpt-web 构建或部署步骤 | **旧 demo 残留（活配置文件中唯一过时文字引用）** | **清理候选（待守密人裁）**：订正注释、删「bpt-web」字样；仅注释、无功能影响 |
| `memory/decisions.md` / `memory/decisions-archive.md`（2026-04-19 BPT 删除裁定条目） | 历史决策记录 | 保留（不追溯改写） |
| `memory/strategic-plan-2026.md` / `memory/project-status.md`（陈述「bpt-web 已删除」事实） | 现役状态档（准确记录） | 保留 |
| `memory/bpt-architecture-snapshot-2026-04-19.md`、`memory/archive/bpt-strategic-shift-2026-04-19/`（含 blackpool-architecture / bpt-next-design / bpt-desktop-design-spec-ref 等） | 历史封存档（文首标「已封存 2026-04-19」） | 保留（不追溯改写） |
| `assets/data/archive-integrity.json` | 完整性哨兵（机器生成，登记「已删路径引用」看门数据） | 保留（改写会破坏哨兵基线） |
| `assets/data/interview-2026-04.json` L93（「demo-level test」指游戏 Train roguelike 试玩） | 无关数据 | 保留 |
| `okf/` 下 `resource-*-bpt-desktop-*.md` / `memory-archive-bpt-strategic-shift-*` / graph.json / kb_index.json 等 | 生成物（OKF 派生镜像，随源自动再生） | 保留（随源处置自动重建，不单独清理） |

## 四、杂项（根目录 / projects/ demo html / 演示脚本残件）——零残留

- `projects/` 现存 bpt-pm / bpt-v2t / game / news / silver-core-sdk / site / wiki，无 bpt-web /
  bpt-desktop 目录或 demo 残件（bpt-pm / bpt-v2t / game 属裁定排除的现役子项目）。
- 仓内全部 `*.html`（site 静态站 / news 前端 / okf visualizer / Resource 正式报告页等）均为
  银芯现役产物，无一属旧 BPT 演示页。
- 「BPT 网页版」「BPT 桌面第二版」作为具名 demo 制品：**全仓零命中**（无对应 html / 视频 /
  截图包 / zip）。

## 待守密人裁决清单

| # | 目标 | 建议动作 |
|---|------|---------|
| 1 | `.github/workflows/deploy-site.yml` 第 1 行注释中的「+ bpt-web」字样 | 订正注释（删该字样）。唯一残留项，无功能影响；守密人点头即可在任一会话一行改掉 |

其余全部条目：保留。**Releases 与 Public-Info-Pool 的演示性二进制残留：零**——清理令的主目标
（demo 构建物 / 演示媒体）在 2026-04-19 删除时已一次清净，本轮扫描为其提供实证收据。
