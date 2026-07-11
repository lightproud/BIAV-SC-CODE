# Releases 索引

> 用途：让人与 AI 定位 GitHub Releases 中的档案。本索引是仓内的「藏宝图」。
>
> **2026-06-21 数据本体重构（决策见 `memory/decisions.md` 2 条 2026-06-21 裁定）**：
> 总纲「**可检索 text → git，二进制 → Releases**」。**全部社区/解包 text 已迁回 git**
> （discord 全量 729 万 + 16 平台 → `Public-Info-Pool/Record/Community/`；解包 text →
> `Public-Info-Pool/Reference/Game-Unpacked/`），**不再在 Release**。Release 收敛为
> **两个**，**只放二进制**：
> - **「解包」`unpacked-assets`** —— 游戏内部二进制（立绘/CG/音视频/特效/UI/units + lua-bytecode + config binary）
> - **「社区二创」`community-assets`** —— 社区产出二进制（fanart 同人图 + 回填媒体）
>
> 已退役删除：`community-data`（discord 文本，已永驻 git）、`unpacked-data`（已并入解包桶）、
> `media-archive-v1`（已并入社区二创）。
>
> **维护约束**：云容器（含艾瑞卡会话）**无 Releases 直接写权限**（gh/hub 不存在，mcp__github__
> 仅 list/get 只读）。增删改 Release 经 GitHub Actions workflow（`consolidate-releases.yml` /
> `delete-release.yml`，会话可触发）或守密人手动；本索引（普通文件）由会话维护。最后核对：2026-06-21。

## 一、快速定位（我要找 X → 去哪）

### 文本类（已在 git，不在 Release，直接读/grep）

| 我要找…… | 位置（git） |
|----------|------------|
| 某频道/月 Discord 历史全量 | `Public-Info-Pool/Record/Community/discord/channels/{id}/{date}.jsonl` |
| 各社区平台采集档案（bilibili/reddit/steam…）| `Public-Info-Pool/Record/Community/{platform}/{date}.json` |
| 游戏脚本 / 配置文本 / 文本 dump / SDK 脚本 | `Public-Info-Pool/Reference/Game-Unpacked/`（gamescript/config 文本/text-data/sdk-scripts）|

### 二进制类（在 Release，按需下载整件）

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
| Lua 字节码（逆向源）| `unpacked-assets` | `morimens-lua-bytecode.tar.gz` |
| config 二进制/debug | `unpacked-assets` | `morimens-config.tar.gz`（含 binary/debug；文本部分另在 git）|
| 同人图月归档 | `community-assets` | `fanart-archive-{YYYY-MM}.tar.gz` |
| 回填的社区媒体 | `community-assets` | `media/backfill_manifest.json` 索引的媒体 |

## 二、两个 Release 总览

### 2.1 「解包」`unpacked-assets` —— 游戏内部二进制

合并自 art-assets-v2 + audio-assets-v1 + audio-raw-v1 + video-assets-v1 + （2026-06-21）原 `unpacked-data`。约 10.9 GB：

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
| `morimens-lua-bytecode.tar.gz` | 38M | 1,592 luac（Frida 运行时解密）|
| `morimens-config.tar.gz` | 55M | 149 配置表 + binary/debug |
| `morimens-gamescript/sdk-scripts/text-data.tar.gz` | ~60M | （文本，权威已在 git；此处为合并残留冗余，待重打包剥离）|

> 注：gamescript/sdk-scripts/text-data 是文本，权威副本已在 git `Reference/Game-Unpacked/`；
> 它们仍留在本 release 是 2026-06-21 整体合并的无害冗余，未来可重打包 config 为纯 binary 时一并清。

### 2.2 「社区二创」`community-assets` —— 社区产出二进制

合并自原 `media-archive-v1`，含两类：
- **回填社区媒体**（索引 `media/backfill_manifest.json`）；`backfill_media.py --upload` 以 `gh release upload --clobber` 追加。
- **同人图月归档** `fanart-archive-{YYYY-MM}.tar.gz`：归档引擎 fanart 条目（`release_tag: community-assets`，`month_from_parent_dir` 分桶）。fanart 不入 git（2026-06-21 de-tier），采集工作流（`collect-fanart.yml` 每日 / `recover-fanart.yml` 手动补录）取回当月资产合并新采后经 `archive_engine.py --force-group` 重传，月资产随采集滚动更新。

## 三、整理历程

### 3.1 四分类整理（2026-06-21 早）

原 37 个零散 release 经 `consolidate-releases.yml` 归并为四个（unpacked-data / unpacked-assets / community-data / community-assets），并把 discord/fanart 归档切换为滚动单 release 模式。

### 3.2 数据本体重构 → 2 release（2026-06-21）

守密人 `/grill 规划社区数据存放和目录` 裁定「text→git / 二进制→Releases」总纲后执行「一次到位」迁移：

- **text 迁回 git**：discord 全量（729 万 / 17,377 文件，2023-07~2026-06）+ 16 平台 → `Public-Info-Pool/Record/Community/`（BPT 4R）；解包 text → `Public-Info-Pool/Reference/Game-Unpacked/`。
- **discord de-tier**：`archive_sources.json` discord `after_archive: git_rm → keep`，退役月度 git_rm 瘦身，全量永驻 git。
- **二进制移出 git**：fanart/media `git rm`（不改历史），`.gitignore` 排除，归档直传 release。
- **Release 收敛为 2**：`unpacked-data` 并入 `unpacked-assets`；`media-archive-v1` 并入 `community-assets`；`community-data` 退役删除（discord 已入 git）。
- **验证**：迁移 workflow + 采集终验（discord-archive 增量写新路径 + 提交）均 GREEN；全量 1651 测试通过。
- **代价（待守密人择期）**：git 体积 1.1G→1.6G（全量 text 进库；历史未改写）；config 含文本冗余留待重打包。详见 `memory/strategy/repo-slimming-plan.md` §8。

## 四、如何取用

- 网页：`https://github.com/lightproud/brain-in-a-vat/releases`（公开 repo，匿名可下）
- CLI（守密人本地有 gh）：`gh release download <tag> -p '<asset>'`（如 `gh release download unpacked-assets -p 'morimens-portraits-full.tar.gz'`）
- 文本类不在 release：直接 git 读 `Public-Info-Pool/`（clone 即在手，可 grep/diff）。
