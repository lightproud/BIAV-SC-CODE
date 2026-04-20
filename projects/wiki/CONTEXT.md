# Wiki 子项目上下文

> 最后更新：2026-04-20 by 主控台（艾瑞卡会话）

## 负责会话
Code-wiki

## 目标
构建忘却前夜的游戏数据集与多语言 Wiki 站点，为社区和衍生游戏提供数据基础。

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

## 本期任务（Phase 1.5 → Phase 2 启动窗口，2026-04-19 ~ 04-26）

> 来源：2026-04-19 战略转向（BPT 从银芯删除，整体战略压缩至 3 个月）。
> Wiki 子项目进入 Phase 2 准备期，**开工第一优先级是基线自举，而非 fetch-wiki-data 抓取**。

1. **schema 草案审核**：`memory/wiki-characters-schema-draft.md` v0.1 已落盘，待守密人裁决 6 项遗留问题后锁定 v1.0
2. **基线自举准备**：待 schema v1.0 锁定后派发 P2W1W1 批量自举会话（72 角色 → `data/db/characters.json`）。建议按 24 角色 / 批拆 3 批，规避 lesson #26 的 Write timeout 风险
3. **不要在基线建立前跑 fetch-wiki-data workflow**：fetch_skills.py 等脚本依赖 `data/db/characters.json`，该文件不存在时必然失败

## 后续待做（Phase 2 正式窗口 2026-04-27 → 06-05）
- [ ] 基线自举完成后触发 fetch-wiki-data 补技能/命轮/立绘
- [ ] 命轮 29 条 Name 的 Effect/Condition 字段补全（从 AwakerPotency.lua 或 Fandom）
- [ ] 立绘缺口补齐（47/72 → 72/72）
- [ ] 填充 Wiki 模板页面（基线建立后重跑 generate_pages.py）
- [ ] 三语目录结构一致性校验

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
- [ ] 读 `memory/wiki-phase-2-gap-inventory.md` 与 `memory/wiki-characters-schema-draft.md` 了解自举现状
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

**开工第一优先级**：澄清 `projects/wiki/data/db/characters.json` 基线来源（从 `character_data.txt` 自举），而非直接跑 fetch 脚本。
