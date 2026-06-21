# Releases 索引

> 用途：让人与 AI 定位 GitHub Releases 中的档案。银芯采集/瘦身把大二进制与全量历史
> 移出 git、存入 Releases（决策 178/179/199），本索引是仓内的「藏宝图」。
>
> **四分类整理（2026-06-21）**：原 37 个零散 release 归并为四类——**解包数据 / 解包资产 /
> 社区归档数据 / 社区归档资产**。社区归档数据由归档引擎滚动写入单个 `community-data`
> release（不再每月一 tag）。解包资产桶暂留四个 `*-v1/v2` tag，待后续合并。
>
> **维护约束**：云容器（含艾瑞卡会话）**无 Releases 直接写权限**（gh/hub 不存在，mcp__github__
> 仅 list/get 只读）。增删改 Release 经 GitHub Actions workflow（`consolidate-releases.yml` /
> `delete-release.yml`，会话可触发）或守密人手动；本索引（普通文件）由会话维护。最后核对：2026-06-21。

## 一、快速定位（我要找 X → 哪个 tag）

| 我要找…… | 去哪个 tag | 具体资产 |
|----------|-----------|----------|
| 角色立绘 / 头像 / mini | `art-assets-v2` | `morimens-portraits-full.tar.gz` |
| CG 插画（各章动/静态）| `art-assets-v2` | `morimens-cg-full.tar.gz` |
| 场景背景 | `art-assets-v2` | `morimens-scenes.tar.gz` |
| 技能 / UI 特效贴图 | `art-assets-v2` | `morimens-effects.tar.gz` |
| UI 资源 / 图标 | `art-assets-v2` | `morimens-uiresources.tar.gz` / `morimens-icons-full.tar.gz` |
| 战斗单位图（bunit/munit）| `art-assets-v2` | `morimens-units.tar.gz` |
| 语音 / BGM / 音效（可直接听）| `audio-assets-v1` | 2,325 OGG |
| 音频重转码的原始源 | `audio-raw-v1` | Wwise bnk + wem |
| 过场 / CG / 战斗特效视频 | `video-assets-v1` | 201 视频 |
| 游戏脚本 / 数值配置 / 文本 / SDK | `unpacked-data` | `morimens-gamescript/config/text-data/sdk-scripts.tar.gz` |
| Lua 字节码（逆向源）| `unpacked-data` | `morimens-lua-bytecode.tar.gz` |
| 某月 Discord 历史全量 | `community-data` | `discord-archive-{YYYY-MM}.tar.gz`（30 月，单 release 内）|
| 回填的社区媒体 | `community-assets` | 媒体资产 |

> 找图取 `art-assets-v2`（完整集 18,795 图）。旧版 `art-assets-v1`（5,218 图子集）已于 2026-06-21 删除。

## 二、四分类总览

### 2.1 解包数据（unpacked-data，合并自 game-data-v1 + lua-bytecode-v1）

| 资产 | 内容 | 典型用途 |
|------|------|----------|
| `morimens-gamescript.tar.gz` | 2,295 游戏逻辑脚本 | 解包脚本溯源 |
| `morimens-config.tar.gz` | 149 配置表 + binary/debug | 数值配置 |
| `morimens-text-data.tar.gz` | 文本/本地化/数据 dump | 文本溯源 |
| `morimens-sdk-scripts.tar.gz` | ejoysdk/foundation/launcher 等 | SDK 逆向 |
| `morimens-lua-bytecode.tar.gz` | 1,592 luac（Frida 运行时解密）| Lua 字节码逆向源 |

### 2.2 解包资产（暂留四 tag，待合并 unpacked-assets）

| Tag | 体量 | 内容 | 典型用途 |
|-----|------|------|----------|
| `art-assets-v2` | 5.1G | 18,795 图（立绘/CG/场景/特效/UI/图标/单位，完整集）| wiki 配图 / 角色头像 / 场景背景 / 特效素材 |
| `audio-assets-v1` | 1.9G | 2,325 OGG（Wwise 转码）| 语音/BGM/音效试听、广播剧素材 |
| `audio-raw-v1` | 1.9G | Wwise 原始（156 bnk + 3,302 wem）| 音频逆向 / 重新转码的源头 |
| `video-assets-v1` | 975M | 201 视频（过场/CG/战斗特效）| 过场动画 / CG 视频取用 |

> 待办：四者 ~10G 合并入单 `unpacked-assets` release（守密人定「随后」做；单文件仍 ≤ 2 GiB，合并 = 同一 release 多分卷）。

### 2.3 社区归档数据（community-data，§4.1 全量保全）

- 单个滚动 release `community-data`：**30 个月** `discord-archive-{YYYY-MM}.tar.gz`（2023-11 ~ 2026-04），共 ~6.6 MB。
- 由归档引擎 `archive_engine.py`（配置 `archive_sources.json` 的 discord 条目，`release_tag: community-data`）**每月自动追加一个资产**（`gh release upload --clobber`，只替换当月不动其它月），取代旧「每月一 tag」。
- github-actions[bot] 经 `discord-archive.yml` 触发。

### 2.4 社区归档资产（community-assets）

- 单个 release `community-assets`（合并自原 `media-archive-v1`）：回填社区媒体，索引 `media/backfill_manifest.json`。

## 三、四分类整理历程（2026-06-21）

- **迁移**：`unpacked-data` ← game-data-v1 + lua-bytecode-v1；`community-data` ← 30 个 discord-archive-* 月 tag；`community-assets` ← media-archive-v1。经 `consolidate-releases.yml`（下载→上传→校验资产数→删源 tag）。
- **引擎改造**：discord 归档切换为滚动单 release 模式（见 §2.3），未来月份自动并入 `community-data`，不再散落新 tag。
- **完整性核对**：`community-data` 实测 30 资产（2023-11 → 2026-04 连续无断档）✓；旧 30 个月 tag 与 game-data-v1/lua-bytecode-v1/media-archive-v1 已删（404 核实）。

## 四、治理待办

- **解包资产合并**：art-assets-v2 / audio-assets-v1 / audio-raw-v1 / video-assets-v1（~10G）合并入单 `unpacked-assets`（守密人定「随后」；旧下载链会失效）。
- **art-assets-v1 残留 git tag**：release 已于 2026-06-21 删除，残留 git tag（指向 commit `3c4ae7d`）待清。
- **已知缺口（非 release 本身）**：归档标记成功但 git 主数据仍在（见 `memory/strategy/repo-slimming-plan.md` §4），待诊断。

## 五、如何取用

- 网页：`https://github.com/lightproud/brain-in-a-vat/releases`
- CLI（守密人本地有 gh）：`gh release download <tag> -p '<asset>'`（如 `gh release download community-data -p 'discord-archive-2026-04.tar.gz'`）
- 受限层提示：银芯为受限/非公开层（CLAUDE.md §0），下载可能需认证凭据。
