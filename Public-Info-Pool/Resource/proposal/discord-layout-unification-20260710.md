# Discord 三服布局统一迁移方案（提案）

> 类型：proposal（迁移动手前需守密人「批准执行」；本档案不是决策记录）
> 作者：艾瑞卡会话 2026-07-10（归档策略评估 P1-7 的展开，应守密人「3 迁移方案是怎样」问询）
> 目标规范：守密人 2026-06-21 grilling 裁定 `discord/{global,jp,volunteer}/`（见 `projects/news/CONTEXT.md`）

## 一、现状与问题

当前三服布局不一致（历史原因：Global 先建、后来的 guild 走 `guilds/` 分层）：

| 服务器 | guild_id | 现路径 | 规模（实测 2026-07-10） |
|--------|----------|--------|------------------------|
| Global 官方服 | 1131791637933199470 | `discord/` **根**（channels/ + activity_daily/ + state.json 等直挂） | 570 频道 / 14,899 JSONL / 2.0 G |
| 日服 | 1377475512716234902 | `discord/guilds/1377475512716234902/` | 1,473 JSONL |
| 志愿者服 | 1402537664619479100 | `discord/guilds/1402537664619479100/` | 458 JSONL |

三个问题：

1. **根特例**：Global 挂根导致所有读方要写「根 + guilds/ 两套」判断，且 `discord/`
   根同时承载「平台目录」与「Global guild 数据目录」双重身份。
2. **SSOT 之外**：`archive_layout.py` 明文豁免 discord（「调用方自理」）——最大的源
   （800 万条）游离于布局单一真相源之外，正是 06-22 读写漂移事故的病根形态。
3. **顺带发现的真缺陷**：`archive_sources.json` 的 discord 条目 glob 为
   `channels/*/*.jsonl`（相对 `discord/` 根），**只匹配 Global**——日服/志愿者服的
   月度档案从未进过 Release 备份桶（`after_archive: keep` 下仅影响备份冗余，无数据丢失）。

## 二、目标形态（方案甲，规范原文，推荐）

```
Public-Info-Pool/Record/Community/discord/
├── global/     # ← 原根内容整体平移（channels/ activity_daily/ state.json guild_meta.json channel_index.json）
├── jp/         # ← 原 guilds/1377475512716234902/
├── volunteer/  # ← 原 guilds/1402537664619479100/
└── archive-log.json  guilds_seen.json   # 平台级档案留根
```

- **区服别名注册表**（guild_id → 区服名）进 `archive_layout.py`：
  `DISCORD_GUILD_REGIONS = {'1131791637933199470': 'global', '1377…': 'jp', '1402…': 'volunteer'}`。
  未登记 guild 归档时**响亮失败**（拒绝落盘并报错），杜绝匿名新服静默落根。
- **discord 收编 SSOT**：`archive_layout.py` 新增 `iter_discord_files(region|all)` 遍历函数，
  读方一律 import；契约测试锁定「归档器落的路径，遍历函数必能找回来」。
- 三服目录内部结构不变（channels/{id_suffix}/{date}.jsonl 等），紧凑 schema 不动。

### 备选（方案乙，零迁移豁免）：物理布局不动，仅把「Global 在根、其余在 guilds/」
登记进 `archive_layout.py` 为规范形态 + 提供统一遍历函数。成本近零，但与 2026-06-21
规范裁定相悖，需守密人明文豁免该条。**若批准方案甲则乙作废。**

## 三、迁移步骤（单会话可完成，预估半天含验证）

1. **冻结窗口**：暂停 3 个 discord workflow（`discord-archive.yml` 每日 18:00 /
   `discord-archive-volunteer.yml` 每时 :15 / `discord-archive-jp.yml` 每时 :45）——
   守密人 Actions UI 一键 disable，或迁移 PR 首个 commit 注释掉 schedule。
2. **文件平移**（纯 `git mv`，blob 不变、仓库体积不涨，~17k 路径改名）：
   根五件套 → `global/`；`guilds/{id}/` → `jp/`、`volunteer/`；`guilds/` 空壳删除。
3. **写方改造**：`discord_archiver.py` 数据根解析改为查区服注册表
   （删根特例分支，约 10 行）；3 个 workflow 若显式传 `DISCORD_DATA_ROOT` 同步改。
4. **读方改造**（一律改 import `archive_layout.iter_discord_files`）：
   `build_community_index.py` / `aggregator_collectors.py`（discord 桥）/
   `collect_fanart.py` / `backfill_media.py` / `backfill_forum_starters.py` /
   `discord_list_guilds.py` / `okf_pointer_layers.py`（community 层指针）。
   消费端保留「新路径优先、回落旧」双布局兼容一个观察期（与 06-21 迁移同法）。
5. **修 Release 备份缺陷**：`archive_sources.json` discord glob 改
   `*/channels/*/*.jsonl`（覆盖三区服），资产模板加区服段
   `discord-archive-{region}-{group}.tar.gz`。
6. **档案同步**：CLAUDE.md §5.2 路径（改后必跑三卫）/ `projects/news/CONTEXT.md` /
   `memory/methodology.md` 报告流程节中的 discord 路径。
7. **验证**（合并门槛，全过才 squash）：
   - 迁移前后逐服 (channel_suffix, date) 键集合相等 + JSONL 行数合计相等（零丢失证明）；
   - `pytest tests/` 全量 + 新增 discord 布局契约测试全绿；
   - 重建 `community_index.json` 与 OKF bundle，指针零落空；
   - 恢复 3 个 workflow，观察一轮 cron 各自正常落 `discord/{region}/`。
8. **回滚预案**：迁移为单 commit（或紧凑 commit 组），异常时 `git revert` 干净回退
   （纯改名可逆）；workflow 恢复前不会有新数据写入旧路径，无双写窗口。

## 四、风险与定界

| 风险 | 评估 | 对策 |
|------|------|------|
| push 胖包（lesson #28/#34/#39） | 改名只产 tree 对象、blob 复用，包很小 | pre-push 钩子照常护航 |
| 迁移窗口漏采 | Global 每日一采、jp/volunteer 每时一采，停 2-3 小时后归档器按 state.json 增量补齐 | 归档器本就断点续采，无需人工回填 |
| 隐藏读方漏改 | `rg "discord/channels|guilds/"` 全仓清点 + 双布局回落期兜底 | 观察期后再删回落分支 |
| 历史 Release 资产名不含区服 | 旧 `discord-archive-{YYYY-MM}.tar.gz` 全部是 Global 数据，语义不变 | `RELEASES.md` 加一行注释即可，不重传 |

## 五、请守密人裁定

- [ ] **批准方案甲**（规范原文迁移，按第三节执行）
- [ ] 或改批方案乙（零迁移豁免，需明文覆盖 2026-06-21 规范该条）
- [ ] 冻结窗口方式：Actions UI disable（推荐，无提交噪声）或 PR 内注释 schedule

（采纳后本提案转正为迁移执行依据，完成后在 `memory/decisions.md` 落决策条目。）
