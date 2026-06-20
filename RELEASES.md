# Releases 索引

> 用途：让人与 AI 定位 GitHub Releases 中的档案。银芯采集/瘦身把大二进制与全量历史
> 移出 git、存入 Releases（决策 178/179/199），本索引是仓内的「藏宝图」。
>
> **维护约束**：云容器（含艾瑞卡会话）**无 Releases 写权限**（gh/hub 不存在，mcp__github__
> 仅 list/get 只读，无 create/delete/upload）。增删改 Release 须经守密人手动或 GitHub
> Actions workflow；本索引（普通文件）由会话维护。最后核对：2026-06-20。

## 一、解包大资产（手动发布，约 10GB+）

| Tag | 体量 | 内容 | 状态 |
|-----|------|------|------|
| `art-assets-v2` | 5.1G | 18,795 图（立绘/CG/场景/特效/UI/图标/单位，完整集）| 现行 |
| `audio-assets-v1` | 1.9G | 2,325 OGG（Wwise 转码）| 现行 |
| `audio-raw-v1` | 1.9G | Wwise 原始（156 bnk + 3,302 wem）| 现行 |
| `video-assets-v1` | 975M | 201 视频（过场/CG/战斗特效）| 现行 |
| `art-assets-v1` | 943M | 5,218 图 | **冗余**：已被 `art-assets-v2` 明确取代（v2 body 注 "Supersedes art-assets-v1"），建议删 |
| `game-data-v1` | 112M | 2,295 脚本 + 149 配置 + 文本 + SDK | 现行 |
| `lua-bytecode-v1` | 37M | 1,592 luac（Frida 运行时解密）| 现行 |

## 二、社区数据月归档（机器人发布，§4.1 全量保全）

- `discord-archive-YYYY-MM`：**30 个月**，2023-11 ~ 2026-04，github-actions[bot] 经 `discord-archive.yml`→`archive_discord.py` 发布。
- `media-archive-v1`：回填社区媒体 691 文件，索引 `media/backfill_manifest.json`。

**完整性核对（2026-06-20，元数据层）**：`archive-log.json` 30 月全部 `uploaded_to_releases: true`、连续无断档，与 30 个 `discord-archive` release tag 一一对应 ✓。（注：内容字节级校验需下载，受容器空间限制未做。）

## 三、治理待办（需守密人手动 / workflow —— 云容器无 release 写权限）

- **清重复旧版**：删 `art-assets-v1`（943M，被 v2 取代）。排查其他被取代版本：暂未发现第二例（audio/video/game-data/lua 均为 v1 单版）。
- **命名版本规整**：现状两套约定——大资产 `{类}-v{N}`、月归档 `discord-archive-{YYYY-MM}`，各自内部一致，无须强行统一；若引入新资产沿用 `{类}-v{N}` 即可。
- **已知缺口（非 release 本身）**：归档标记成功但 git 主数据仍在（见 `memory/strategy/repo-slimming-plan.md` §4），待诊断。

## 四、如何取用

- 网页：`https://github.com/lightproud/brain-in-a-vat/releases`
- CLI（守密人本地有 gh）：`gh release download <tag> -p '<asset>'`
- 受限层提示：银芯为受限/非公开层（CLAUDE.md §0），下载可能需认证凭据。
