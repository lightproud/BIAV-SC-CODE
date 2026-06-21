# Releases 索引

> 用途：让人与 AI 定位 GitHub Releases 中的档案。银芯采集/瘦身把大二进制与全量历史
> 移出 git、存入 Releases（决策 178/179/199），本索引是仓内的「藏宝图」。
>
> **维护约束**：云容器（含艾瑞卡会话）**无 Releases 写权限**（gh/hub 不存在，mcp__github__
> 仅 list/get 只读，无 create/delete/upload）。增删改 Release 须经守密人手动或 GitHub
> Actions workflow；本索引（普通文件）由会话维护。最后核对：2026-06-21。

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
| 游戏脚本 / 数值配置 / 文本 | `game-data-v1` | 脚本 + 配置 + 文本 + SDK |
| Lua 字节码（逆向源）| `lua-bytecode-v1` | 1,592 luac |
| 某月 Discord 历史全量 | `discord-archive-{YYYY-MM}` | 见二节 |
| 回填的社区媒体 | `media-archive-v1` | 691 文件 |

> 找图优先取 `art-assets-v2`（完整集）；`art-assets-v1` 是旧子集，勿用（见下表「冗余」行）。

## 二、解包大资产（手动发布，约 10GB+）

| Tag | 体量 | 内容 | 典型用途 | 状态 |
|-----|------|------|----------|------|
| `art-assets-v2` | 5.1G | 18,795 图（立绘/CG/场景/特效/UI/图标/单位，完整集）| wiki 配图 / 角色头像 / 场景背景 / 特效素材 | 现行 |
| `audio-assets-v1` | 1.9G | 2,325 OGG（Wwise 转码）| 语音/BGM/音效试听、广播剧素材 | 现行 |
| `audio-raw-v1` | 1.9G | Wwise 原始（156 bnk + 3,302 wem）| 音频逆向 / 重新转码的源头 | 现行 |
| `video-assets-v1` | 975M | 201 视频（过场/CG/战斗特效）| 过场动画 / CG 视频取用 | 现行 |
| `art-assets-v1` | 943M | 5,218 图 | 旧子集，勿用（取 `art-assets-v2`）| **冗余**：已被 `art-assets-v2` 明确取代（v2 body 注 "Supersedes art-assets-v1"），建议删 |
| `game-data-v1` | 112M | 2,295 脚本 + 149 配置 + 文本 + SDK | 解包脚本 / 数值配置 / 文本溯源 | 现行 |
| `lua-bytecode-v1` | 37M | 1,592 luac（Frida 运行时解密）| Lua 字节码逆向源 | 现行 |

## 三、社区数据月归档（机器人发布，§4.1 全量保全）

- `discord-archive-YYYY-MM`：**30 个月**，2023-11 ~ 2026-04，github-actions[bot] 经 `discord-archive.yml`→`archive_discord.py` 发布。
- `media-archive-v1`：回填社区媒体 691 文件，索引 `media/backfill_manifest.json`。

**完整性核对（2026-06-20，元数据层）**：`archive-log.json` 30 月全部 `uploaded_to_releases: true`、连续无断档，与 30 个 `discord-archive` release tag 一一对应 ✓。（注：内容字节级校验需下载，受容器空间限制未做。）

## 四、治理待办（需守密人手动 / workflow —— 云容器无 release 写权限）

- **清重复旧版**：删 `art-assets-v1`（943M，被 v2 取代）。**2026-06-21 核实仍在线**（API 返回完整元数据，非 404；todo.md B 节「已删」系 flaky 环境假回执，见 lesson #41）。逐类核实 v2 为 v1 完整超集（立绘 478→4,485 / CG 38→404 / 单位 317→432 / 图标 169→2,690 / UI 700→3,029），删 v1 不丢任何资产。**删除方式**：跑 `Delete Release` workflow（`.github/workflows/delete-release.yml`，Actions 页面 → Run，tag 填 `art-assets-v1` + confirm 重复一遍即执行，免手机手动），删后把上方表中 `art-assets-v1` 行移除。排查其他被取代版本：暂未发现第二例（audio/video/game-data/lua 均为 v1 单版）。
- **命名版本规整**：现状两套约定——大资产 `{类}-v{N}`、月归档 `discord-archive-{YYYY-MM}`，各自内部一致，无须强行统一；若引入新资产沿用 `{类}-v{N}` 即可。
- **已知缺口（非 release 本身）**：归档标记成功但 git 主数据仍在（见 `memory/strategy/repo-slimming-plan.md` §4），待诊断。

## 五、如何取用

- 网页：`https://github.com/lightproud/brain-in-a-vat/releases`
- CLI（守密人本地有 gh）：`gh release download <tag> -p '<asset>'`
- 受限层提示：银芯为受限/非公开层（CLAUDE.md §0），下载可能需认证凭据。
