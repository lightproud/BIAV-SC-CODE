# Wiki 子项目上下文

> 最后更新：2026-04-26 by 主控台（艾瑞卡会话，写入 4-26 银芯重新定位 v2.0 wiki 新使命）

## 负责会话
Code-wiki

## v2.0 新使命定位（2026-04-26 起）

**wiki = 银芯三新使命之 #2「社区共建知识底座」核心载体**

- **新定位**：公开知识共享平台 / 让社区与 Studio 外部派生内容（如全语言 Wiki / 二创资料 / Studio 团队 AI 项目）有可贡献的基础
- **关键约束**：**信息要全**（守密人 4-25 裁定）— 贡献底座 ≠ 空骨架，wiki 仍要 72 角色完整资料才能让贡献者基于它做事
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的优先级**：核心主线，与 news 并列最高
- **派发关系**：批 1（24 角色 stub）已由主控台派子代理完成（2026-04-26，commit 818a518）。**批 2/3（剩余 48 角色）由 Code-wiki 接管**，主控台不再亲自落 wiki 业务文件（lesson #27 边界硬约束）

## 目标
构建忘却前夜的游戏数据集与多语言 Wiki 站点，作为社区共建知识底座。Phase 2 内部里程碑：M2（5-11 → 6-10）实现 wiki 72 角色完整自举（含技能/命轮/立绘/三语）。

## 项目包含两部分

### 1. 游戏数据集（原 database 子项目）
- **数据文件**：`data/db/characters.json` 尚未建立，Phase 2 开工需先自举（参考 `assets/data/character_data.txt` 解析）。真实角色总数 72（含皮肤/联动/彩蛋）
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
- `data/db/` — ⚠ **尚未建立**，Phase 2 W1 待自举 `characters.json`
- `scripts/` — 数据抓取与处理脚本（Python）
- `docs/` — VitePress 源文件（Markdown 页面，含 zh/en/ja 子目录）
- `docs/.vitepress/` — VitePress 配置和主题

## 开发命令
```bash
# Wiki 站点
cd projects/wiki
npm install
npm run docs:dev    # 本地开发
npm run docs:build  # 构建
npm run docs:preview # 预览构建结果

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
- [ ] `data/db/characters.json` 通过 `data/schemas/characters.schema.json`（或 v1.0 新 schema）校验
- [ ] characters.json 角色数量 = 72（Phase 2 自举后）
- [ ] VitePress 能本地启动无报错
- [ ] 三语目录结构一致（zh/en/ja 页面数量相近）

## 给 Code 会话的指令
- 工作目录：`projects/wiki/`
- 数据文件最终归宿：`projects/wiki/data/db/`（⚠ 目前未建立）
- 原始数据源：`projects/wiki/data/extracted/categorized/character_data.txt`
- 新数据文件添加后更新本文件和 `assets/index.md`
- 角色/系统信息同步更新 `memory/morimens-context.md`

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 wiki 子项目当前状态
- [ ] `ls projects/wiki/data/db/` 校验 characters.json 是否已自举（缺失则回到 Phase 2 路线图）
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
