# Releases 索引

> 用途：让人与 AI 定位 GitHub Releases 中的档案。银芯采集/瘦身把大二进制与全量历史
> 移出 git、存入 Releases（决策 178/179/199），本索引是仓内的「藏宝图」。
>
> **四分类整理（2026-06-21 完成）**：原 37 个零散 release 归并为**四个** release——
> **解包数据 `unpacked-data` / 解包资产 `unpacked-assets` / 社区归档数据 `community-data` /
> 社区归档资产 `community-assets`**。两个社区桶由归档引擎滚动写入（不再每周期一 tag）：
> discord 文本 → `community-data`，fanart 同人图 → `community-assets`。
>
> **维护约束**：云容器（含艾瑞卡会话）**无 Releases 直接写权限**（gh/hub 不存在，mcp__github__
> 仅 list/get 只读）。增删改 Release 经 GitHub Actions workflow（`consolidate-releases.yml` /
> `delete-release.yml`，会话可触发）或守密人手动；本索引（普通文件）由会话维护。最后核对：2026-06-21。

## 一、快速定位（我要找 X → 哪个 tag）

| 我要找…… | 去哪个 tag | 具体资产 |
|----------|-----------|----------|
| 角色立绘 / 头像 / mini | `unpacked-assets` | `morimens-portraits-full.tar.gz` |
| CG 插画（各章动/静态）| `unpacked-assets` | `morimens-cg-full.tar.gz` |
| 场景背景 | `unpacked-assets` | `morimens-scenes.tar.gz` |
| 技能 / UI 特效贴图 | `unpacked-assets` | `morimens-effects.tar.gz` |
| UI 资源 / 图标 | `unpacked-assets` | `morimens-uiresources.tar.gz` / `morimens-icons-full.tar.gz` |
| 战斗单位图（bunit/munit）| `unpacked-assets` | `morimens-units.tar.gz` |
| 语音 / BGM / 音效（可直接听）| `unpacked-assets` | `morimens-audio-ogg-part1/part2.tar.gz`（2,325 OGG）|
| 音频重转码的原始源 | `unpacked-assets` | `morimens-audio-raw-bnk/wem.tar.gz` + `SoundbanksInfo.xml` |
| 过场 / CG / 战斗特效视频 | `unpacked-assets` | `morimens-video.tar.gz`（201 视频在内）|
| 游戏脚本 / 数值配置 / 文本 / SDK | `unpacked-data` | `morimens-gamescript/config/text-data/sdk-scripts.tar.gz` |
| Lua 字节码（逆向源）| `unpacked-data` | `morimens-lua-bytecode.tar.gz` |
| 某月 Discord 历史全量 | `community-data` | `discord-archive-{YYYY-MM}.tar.gz`（30 月，单 release 内）|
| 同人图月归档 | `community-assets` | `fanart-archive-{YYYY-MM}.tar.gz` |
| 回填的社区媒体 | `community-assets` | `media/backfill_manifest.json` 索引的媒体 |

## 二、四分类总览

### 2.1 解包数据（unpacked-data，合并自 game-data-v1 + lua-bytecode-v1）

| 资产 | 内容 | 典型用途 |
|------|------|----------|
| `morimens-gamescript.tar.gz` | 2,295 游戏逻辑脚本 | 解包脚本溯源 |
| `morimens-config.tar.gz` | 149 配置表 + binary/debug | 数值配置 |
| `morimens-text-data.tar.gz` | 文本/本地化/数据 dump | 文本溯源 |
| `morimens-sdk-scripts.tar.gz` | ejoysdk/foundation/launcher 等 | SDK 逆向 |
| `morimens-lua-bytecode.tar.gz` | 1,592 luac（Frida 运行时解密）| Lua 字节码逆向源 |

### 2.2 解包资产（unpacked-assets，合并自 art-assets-v2 + audio-assets-v1 + audio-raw-v1 + video-assets-v1）

单个 release，**15 个资产、约 10.7 GB**：

| 资产 | 体量 | 内容 |
|------|------|------|
| `morimens-portraits-full.tar.gz` | 1.2G | 4,485 角色立绘（full/middle/head/mini）|
| `morimens-cg-full.tar.gz` | 735M | 404 CG 插画 |
| `morimens-scenes.tar.gz` | 1.0G | 953 场景资产 |
| `morimens-effects.tar.gz` | 353M | 6,091 特效贴图 |
| `morimens-uiresources.tar.gz` | 1.4G | 3,029 UI 资源 |
| `morimens-icons-full.tar.gz` | 368M | 2,690 图标 |
| `morimens-units.tar.gz` | 184M | 432 战斗单位 |
| `morimens-misc.tar.gz` | 121M | 711 杂项 |
| `morimens-audio-ogg-part1/part2.tar.gz` | 2.0G | 2,325 OGG（Wwise 转码可直接听）|
| `morimens-audio-raw-bnk/wem.tar.gz` | 2.1G | Wwise 原始 156 bnk + 3,302 wem |
| `SoundbanksInfo.xml` / `wwise_id_mapping.csv` | 3M | 音频 ID 映射元数据 |
| `morimens-video.tar.gz` | 1.0G | 201 视频（过场/CG/战斗特效）|

### 2.3 社区归档数据（community-data，§4.1 全量保全）

- 单个滚动 release `community-data`：**30 个月** `discord-archive-{YYYY-MM}.tar.gz`（2023-11 ~ 2026-04），共 ~287 MB（2026-06-21 排空时由 force-month 重归档为含回填补全的更全版本，较初版 6.6 MB 大幅充实）。
- 由归档引擎 `archive_engine.py`（`archive_sources.json` 的 discord 条目，`release_tag: community-data`）**每月自动追加一个资产**（`gh release upload --clobber`，只替换当月不动其它月），取代旧「每月一 tag」。
- github-actions[bot] 经 `discord-archive.yml` 触发。

### 2.4 社区归档资产（community-assets）

- 单个滚动 release `community-assets`，含两类：
  - **回填社区媒体**（合并自原 `media-archive-v1`，索引 `media/backfill_manifest.json`）。
  - **同人图月归档** `fanart-archive-{YYYY-MM}.tar.gz`：由归档引擎 fanart 条目（`release_tag: community-assets`，`month_from_parent_dir` 分桶，60 天 cutoff + git_rm）**每月自动追加**。

## 三、四分类整理历程（2026-06-21）

- **迁移**（经 `consolidate-releases.yml`：下载→上传→校验资产数→删源 tag）：
  - `unpacked-data` ← game-data-v1 + lua-bytecode-v1
  - `unpacked-assets` ← art-assets-v2 + audio-assets-v1 + audio-raw-v1 + video-assets-v1（单源逐个并入，避开 ~10G 一次性下载逼近 runner 磁盘上限）
  - `community-data` ← 30 个 discord-archive-* 月 tag
  - `community-assets` ← media-archive-v1
- **引擎改造**：discord / fanart 归档切换为滚动单 release 模式，未来周期自动并入对应桶，不再散落新 tag。
- **完整性核对**：`community-data` 实测 30 资产（2023-11 → 2026-04 连续无断档）✓；`unpacked-assets` 实测 15 资产、约 10.7 GB ✓；所有旧源 tag + 悬空 tag `art-assets-v1` 均已删（404 核实）。
- **对冲缺口闭合（repo-slimming-plan §4）**：历史回填曾每小时把已归档月 jsonl 拉回 git（与月清理对冲，致 channels/ 3.3G 虚胖）。根因修复（`discord_archiver.py` 加「已归档月跳过」守卫）已在 main 生效；2026-06-21 force-month 一次性排空 30 个已归档月，channels/ 12,803→1,882 文件、3.3G→600M，仅留近月 2026-05/06（未够龄）。

## 四、治理待办

- **（已闭合 2026-06-21）** 归档标记成功但 git 主数据仍在的对冲缺口——根因（历史回填无「已归档月跳过」）已修复 + 30 月存量已排空，详见 §三 末条与 `memory/strategy/repo-slimming-plan.md` §4。当前无未决治理项。

## 五、如何取用

- 网页：`https://github.com/lightproud/brain-in-a-vat/releases`
- CLI（守密人本地有 gh）：`gh release download <tag> -p '<asset>'`（如 `gh release download community-data -p 'discord-archive-2026-04.tar.gz'`）
- 受限层提示：银芯为受限/非公开层（CLAUDE.md §0），下载可能需认证凭据。
