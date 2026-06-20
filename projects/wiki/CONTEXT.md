# Wiki 子项目上下文

> 最后更新：2026-06-09 by 主控台（艾瑞卡会话，状态核验刷新；实时进度权威在 `memory/project-status.md`）

> **2026-06-20 架构订正（守密人「wiki 用新数据」裁定）**：外部合成数据旧链已整条退役删除——
> `fetch_skills/cards/stats/stages/wheels/lore/portraits.py`（抓 Fandom/Bilibili 合成数据写 `data/db/`）、
> `generate_pages.py`（读已清空的 `db/`）、`wiki_sources.py`、`fetch-wiki-data.yml` 工作流及其 9 个测试，
> 全部删除。**wiki 数据唯一血缘改为新链**：`data/extracted/`（一手客户端解包）→ `parse_*`（顶层 scripts/）
> → `data/processed/` → `generate_wiki_pages.py` → `deploy-site.yml` 部署。
> 本档案下文凡涉及 `data/db/` 自举 / `generate_pages.py` / 批 1-3 角色 stub 的描述均为**退役旧链的历史记录**，
> 不再生效；W2 重建以 `data/extracted/` 为唯一数据源（禁合成占位），进度权威见 `memory/project-status.md`。

## 负责会话
Code-wiki

## 2026-06-09 状态核验（实测）

- **`data/db/characters.json` 已自举 24/72**（23 partial + 1 fixture，批 1 完成）——本档案下文凡写「尚未建立」处均为 4-26 前的过期描述，已逐处订正
- **批 2/3（剩余 48 角色）未开工**：M2 窗口（5-11 → 6-10）即将到期，M2 六项任务均未完成，需 Code-wiki 接管推进
- Pandia 垂直切片（12 Vue 组件 + 详情页 + 列表筛选）已落盘可访问（4-26 验收记录见下文）

## Mooncell 对标 Phase 1 已完成（2026-04-26）

> 蓝图档案：`/root/.claude/plans/wiki-fgo-wiki-eager-candle.md`（已修订：放弃「人格卡成熟度」论证，改 fixture-driven）

**本次落盘**：
- **12 个 Vue 组件**（`docs/.vitepress/theme/components/`）：CharacterSheet（根容器）+ CharacterInfobox / SkillTable / AscensionMaterialBlock / TrinketRecommendationCard / BondRewardList / StatGrowthChart / AffinityTags / VoiceLineList / PortraitGallery / FixtureBadge / CharacterGrid
- **数据加载层**（`docs/.vitepress/theme/data/characters.ts`）：JSON 类型化导入 + findById/findBySlug 工具 + REALM/ROLE 标签映射
- **全局注册**：`theme/index.ts` 12 个 enhanceApp.app.component 注入
- **Pandia fixture 数据**：`data/db/characters.json` 中 id=15560 字段从全 pending 升级为完整 fixture（skills/trinkets_recommended/ascension_materials/bond_rewards/stat_growth_curve/affinities），status=`fixture` 防误读为权威
- **schema 扩展**：`characters.schema.json` 状态枚举增加 `fixture`（v2 → v3）
- **首批角色页**：`docs/zh/awakeners/pandia.md`（per-character 路由）+ `docs/zh/awakeners/index.md`（列表筛选）
- **generate_pages.py 升级**：兼容顶层数组数据 / 改用 slug 作路由 / 加 `--only <id|slug>` 过滤

**关键修复（lesson 触发）**：
- lesson #7（绝对路径 img src 被 Vite 当 import）：修复 `docs/icons.md` 2097 处 + `docs/battle-units.md` 1 处。Python lambda 替换，非 sed
- generate_pages.py 之前假设 `data.get("characters", [])`，与现实顶层数组形态不符，已修

**验收**：
- `npm run build` 通过（24 秒，0 错误，1 个 chunk size 警告来自 icons.md 内嵌大体积资产，非组件问题）
- Pandia 页面 HTML 渲染所有 11 个组件类（m-infobox 19 / m-skills 54 / m-ascension 52 / m-trinkets 15 / m-bond 18 / m-stats 69 / m-aff 13 / m-gallery 5 / m-voice 3 / m-fixture-badge 1 / m-sheet 5）
- FIXTURE 警示横幅渲染可见
- `validate_data.py` exit 0；fixture 数据通过 schema 校验

**本地预览路径**：
- 唤醒体列表（带筛选器）：`/zh/awakeners/`
- Pandia 详情页：`/zh/awakeners/pandia`

**本次落盘内容**：
- **新 schema**（`data/schemas/`）：`trinkets.schema.json`、`banners.schema.json`、`stages.schema.json`、`items.schema.json`
- **schema 重写**：`characters.schema.json` 旧版与现实数据形态完全脱节（顶层对象 vs 顶层数组），已重写为顶层 array 形态并叠加 Mooncell 目标字段（trinkets_recommended / ascension_materials / bond_rewards / stat_growth_curve / affinities / voice_line_refs / cg_refs），向后兼容 anyOf("pending" | object) 模式
- **空 stub 数据档**（`data/db/`）：trinkets.json / banners.json / stages.json / items.json 全部以最小必填形态通过 jsonschema 校验
- **反向索引脚本**（`scripts/`）：
  - `build_drop_index.py` → 写入 `data/processed/drops_by_item.json`（当前 0 stage 扫描，db/stages.json 待 Phase 3 填）
  - `build_banner_character_index.py` → 写入 `data/processed/banners_by_character.json`（已匹配 41/366 banner，6/24 角色）
- **校验升级**：
  - CI 校验（`scripts/validate_data.py`）：注册 4 份新 schema，缺失文件改 SKIP（修复历史 CI 红：meta.json/realms.json 从未存在）
  - fact-bible 校验（`assets/data/validate.py`）：从 7 项扩至 13 项（schema 形态一致性 + 神器/卡池/掉落/skills 缺口基线）
- **CI workflow**：`.github/workflows/validate-data.yml` 路径已覆盖 `projects/wiki/data/**`，无需改动

**当前缺口基线**（fact-bible audit 报表）：
- 角色总数 24/63（差 39）
- skills 非 pending 率 0/24
- 神器 effect / 卡池数值化 / 关卡反向索引 三项均为「空 stub 待填」基线

**下一步阻塞 Phase 1（艾瑞卡垂直切片）**：需先派批 2/3 完成 72 角色基线，并在 `assets/data/character-personas/` 之外为艾瑞卡补 skills/trinkets/ascension_materials 实数据。

## v2.0 新使命定位（2026-04-26 起）

**wiki = 银芯三新使命之 #2「社区共建知识底座」核心载体**

- **新定位**：社区知识共享平台 / 让社区与 Studio 外部派生内容（如全语言 Wiki / 二创资料 / Studio 团队 AI 项目）有可贡献的基础
- **关键约束**：**信息要全**（守密人 4-25 裁定）— 贡献底座 ≠ 空骨架，wiki 仍要 72 角色完整资料才能让贡献者基于它做事
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的优先级**：核心主线，与 news 并列最高
- **派发关系**：批 1（24 角色 stub）已由主控台派子代理完成（2026-04-26，commit 818a518）。**批 2/3（剩余 48 角色）由 Code-wiki 接管**，主控台不再亲自落 wiki 业务文件（lesson #27 边界硬约束）

## 目标
构建忘却前夜的游戏数据集与多语言 Wiki 站点，作为社区共建知识底座。Phase 2 内部里程碑：M2（5-11 → 6-10）实现 wiki 72 角色完整自举（含技能/命轮/立绘/三语）。

## 项目包含两部分

### 1. 游戏数据集（原 database 子项目）
- **数据文件**：`data/db/characters.json` 已自举 24/72（批 1，2026-04-26），剩余 48 待批 2/3。真实角色总数 72（含皮肤/联动/彩蛋）
- **查询模块**：`scripts/content_db.py`，Python 接口
- **数据来源**：GameKee wiki、Fandom Sialia、Gamerch JP
- **存储格式**：JSON

### 2. Wiki 站点
- **框架**：VitePress 1.6.3 + Vue 3.5.13
- **语言**：英语、日语、中文（ZH 为 root locale）
- **页面**：基于早期假数据生成，Phase 2 基线自举后需重跑 `generate_pages.py`

## 目录说明
- `data/extracted/` — 客户端解包原始数据（Lua 表、角色字段、美术清单）
- `data/processed/` — 加工过的 JSON 数据（CG 画廊 / 物品故事 / 语音台词 / 世界观）
- `data/schemas/` — 数据 schema 定义（characters / meta / realms）
- `data/db/` — 已建立：`characters.json`（24/72）+ trinkets / banners / stages / items 空 stub
- `scripts/` — 数据抓取与处理脚本（Python）
- `docs/` — VitePress 源文件（Markdown 页面，含 zh/en/ja 子目录）
- `docs/.vitepress/` — VitePress 配置和主题

## 开发命令
```bash
# Wiki 站点
cd projects/wiki
npm install
npm run dev         # 本地开发
npm run docs:build  # 构建
npm run preview     # 预览构建结果

# 数据查询
python scripts/content_db.py
```

## 本期任务（Phase 2 银芯三新使命建设期，2026-04-27 ~ 07-19，84 天）

> 来源：2026-04-26 银芯重新定位 v2.0（守密人「全部采纳」+「信息要全」+ Phase 大一统）。
> wiki 子项目作为「社区共建知识底座」核心载体，必须 72 角色完整。

### 批 1 已完成（2026-04-26，commit 818a518）
- **schema v1.0.1 锁定**：`memory/wiki-characters-schema-v1.md`（含 4-20 守密人 6 项裁决 + 4-26 子代理校验暴露的 v1.0.1 热补丁）
- **批 1 落盘**：`projects/wiki/data/db/characters.json` 包含 24 角色 stub（IDs 15560-15582 + 15593），24/24 通过 schema v1.0.1 校验
- **15578/15593 詹金 duplicate_bug 互指**已应用
- 批 1 由主控台派子代理 + 主控台亲自落盘——**lesson #27 已写入**，批 2/3 不再走此路径

### Code-wiki 接管批 2/3（M1 里程碑：4-27 → 5-10）

**剩余 48 角色拆分建议**：
- 批 2（24 角色）：主干常驻 15583-15604（21 条）+ CoC 主干 54116/54117/77913（3 条）= 24 ✓
- 批 3（24 角色）：CoC 神话剩余（77911/77914/77917/77918/77921/77922/77923/77924/77925/77926/77927/77928）= 12 + 校猫彩蛋 78754/78840/78841（3）+ 联动皮肤 94450/94451/95786/122587/125346/130226/130375/130384/130901（9）= 24 ✓

**Code-wiki 接管时的工作范式**（避免主控台越界）：
1. 读 `memory/wiki-characters-schema-v1.md` v1.0.1（最新版）+ `projects/wiki/data/extracted/categorized/character_data.txt`
2. 派子代理或自身处理（Code-wiki 自身就是业务执行会话，可以直接落盘）
3. 子代理产出 → Code-wiki 落盘 → Code-wiki jsonschema 校验 → Code-wiki 提交
4. **不通过主控台**

### M2 信息齐备（5-11 → 6-10，31 天）
- [ ] 72 角色 schema 校验全通过（含 stub → partial → complete 状态升级）
- [ ] 命轮 29 条 Effect/Condition 字段补全（从 AwakerPotency.lua 或 Fandom）
- [ ] 立绘缺口补齐（47/72 → 72/72）
- [ ] 三语 name_en / name_ja 翻译来源标注（official > community 优先级）
- [ ] 触发 fetch-wiki-data workflow 补技能/命轮/立绘
- [ ] 填充 Wiki 模板页面（基线齐备后重跑 generate_pages.py）

### M3 稳定化 + 贡献流程（6-11 → 7-10，30 天）
- [ ] 贡献流程文档（社区/Studio 团队成员如何提交角色数据修正）
- [ ] PR 模板 / Issue 模板（针对 wiki 数据贡献）
- [ ] 至少 1 轮贡献流程对内（Studio 团队）或对外（社区）跑通

### M4 开放测试 + 战略验收（7-11 → 7-19，9 天）
- [ ] 三语目录结构一致性最终校验
- [ ] 验收：72 角色完整 + 至少 1 种贡献流程跑通 1 轮

## 验证清单
- [x] `data/db/characters.json` 通过 `data/schemas/characters.schema.json` 校验（2026-04-26 Phase 0）
- [x] CI 校验脚本 `scripts/validate_data.py` 退出码 0（5/5 schemas 校验通过）
- [ ] characters.json 角色数量 = 72（Phase 2 自举后）
- [ ] VitePress 能本地启动无报错
- [ ] 三语目录结构一致（zh/en/ja 页面数量相近）
- [ ] `db/trinkets.json` 填入 29 条（Phase 3）
- [ ] `db/stages.json` 填入主线/活动关卡（Phase 3）
- [ ] `db/items.json` 填入 375+ 物品（Phase 3，从 processed/item_stories.json 整理）
- [ ] `db/banners.json` 填入 366 卡池（Phase 3，从 processed/summon.json 数值化）

## 给 Code 会话的指令
- 工作目录：`projects/wiki/`
- 数据文件最终归宿：`projects/wiki/data/db/`（已建立，characters.json 24/72）
- 原始数据源：`projects/wiki/data/extracted/categorized/character_data.txt`
- 新数据文件添加后更新本文件和 `assets/index.md`
- 角色/系统信息同步更新 `memory/morimens-context.md`

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 wiki 子项目当前状态
- [ ] `ls projects/wiki/data/db/` 校验 characters.json 自举进度（当前 24/72，批 2/3 见本期任务）
- [ ] 读 `memory/wiki-phase-2-gap-inventory.md` 与 `memory/wiki-characters-schema-v1.md` 了解自举现状
- [ ] 确认 GitHub Pages 部署状态（最新 Actions 是否成功）
- [ ] 检查 `memory/morimens-context.md` 了解游戏背景知识
- [ ] 确认你要修改的文件不属于其他子项目
- [ ] 完成任务后更新本文件"本期任务"部分和 `memory/project-status.md`

## Phase 2 权威路线图

Phase 2 启动会话必读：`memory/wiki-phase-2-gap-inventory.md`

该文档为 B3 Wiki 调研子代理于 2026-04-20 产出的权威缺口清单，包含：
- 72 角色真实名单（含 AwakerConfig ID 映射）
- 按难度分组的补全建议（易补 11 / 中补 9 / 难补 5）
- fetch-wiki-data workflow 安全触发评估
- 基线自举建议顺序（Week 1-5）
- 预估耗时（悲观 28-35 天，含 3-5 天基线自举）

**开工第一优先级**：澄清 `projects/wiki/data/db/characters.json` ⚠ 基线来源（从 `character_data.txt` 自举），而非直接跑 fetch 脚本。
