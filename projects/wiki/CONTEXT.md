# Wiki 子项目上下文

> 最后更新：2026-07-02 by 艾瑞卡会话（档案漂移全面修复：正文重写为现行新链状态。
> 旧 `data/db/` 链（Fandom 合成抓取 / 24 角色占位 / `generate_pages.py` / `content_db.py`）
> 已于 2026-06-15 守密人裁定整层清空、PR #253 整套退役删除——本档案不再保留其操作性描述，
> 溯源见 `memory/decisions.md`（2026-06-15 清空条）与 `memory/decisions-archive.md`。
> 实时进度权威在 `memory/project-status.md`，本档案不复刻进度数字。

## 定位

**wiki = 银芯二核心使命之 #2「社区共建知识底座」核心载体**（CLAUDE.md §1.2）。
构建忘却前夜（Morimens）的游戏数据集与 Wiki 站点，让社区与 Studio 外部派生内容
（全语言 Wiki / 二创资料等）有可信、可贡献的基础。

关键约束（守密人裁定）：

- **一手解包为唯一数据源，禁用合成占位**（2026-06-15）——外部合成数据链
  （Fandom / GameKee / Gamerch 抓取）已整套退役，不得复用。
- **信息要全**（2026-04-25）——贡献底座不是空骨架，72 角色要完整资料。

## 数据血缘（唯一现行链）

```
data/extracted/                 客户端一手解包（lua_tables / categorized / art_assets）
  → 顶层 scripts/parse_*.py    解析器（awaker_config / voice_lines / collection_hall / item_stories / cg_gallery）
  → data/processed/            加工 JSON（characters.json 可信基线 + 剧情层 story/ 等）
  → 顶层 scripts/generate_wiki_pages.py   生成 VitePress Markdown 页（由 deploy-site.yml 驱动）
  → docs/                      站点源（VitePress 构建 → gh-pages /wiki/ 子路径）
```

注意：解析器与页面生成器都在**仓库根 `scripts/`**（非本目录 `scripts/`），
`generate_wiki_pages.py` 硬编码相对路径，须从仓库根运行。

## 当前状态（2026-07-02 实测；进度权威 `memory/project-status.md`）

- **可信基线已重建**：`data/processed/characters.json`——72 真实角色
  （playable 58 / unreleased 12 / easter_egg 2），一手解包 + 守密人 2026-06-16
  多维证据法逐一裁定，无合成占位。形态为 `{_meta, characters: [72 条]}`，`id` 为整数。
- **静态页已投产**：`generate_wiki_pages.py` 生成 58 个真实唤醒体详情页
  （`docs/zh/awakeners/{id}.md`）+ 图鉴 / 剧情正文 / 收藏馆 / 画廊等约 81 页，
  VitePress 构建通过。
- **运行时数据桥已接回（2026-07-02）**：`generate_wiki_pages.py:generate_runtime_data()`
  从 processed 基线 + 玩法层单点产出 `docs/.vitepress/theme/data/characters.runtime.json`
  （72 条，id 已字符串化，含 realm/role/status/has_page），`characters.ts` 导入消费；
  CharacterGrid 挂载 `docs/characters.md`「交互检索」段（withBase 链接 + 无立绘占位符 +
  界域/类目/搜索筛选）。CharacterSheet 等详情向组件仍为脚手架，待字段缺口补全后启用。
- **三语未恢复**：`config.mts` 仅 zh root locale，`docs/` 无 en/ja 子目录；
  清空前的「三语全量 ~580 页」为假数据史，恢复属后续任务。
- **界域 / 职业来源**：解包无 realm 字段，玩法层 `data/processed/character_skills.md`
  （社区源）是界域归属唯一来源，由 `generate_wiki_pages.py:load_playstyle()` 解析。

## 目录说明

- `data/extracted/` — 客户端解包原始数据（只读，血缘源头）
- `data/processed/` — 加工 JSON（现行 source of truth；剧情层在 `processed/story/`）
- `data/schemas/` — schema 定义。现行校验对象为 processed 基线
  （`characters.processed.schema.json`，2026-07-02 对齐）；旧 db 链 schema
  （characters / meta / realms / trinkets / banners / stages / items）保留注册、
  数据文件缺失时 SKIP，待未来结构化层重建时重订
- `scripts/` — 本目录脚本：`decrypt_and_extract.py` / `extract_client_data.py` /
  `build_drop_index.py` / `generate_rss.py` / `check_version.py` / `validate_data.py`
  （精确清单以 `ls` 为准）
- `docs/` — VitePress 源文件；`docs/.vitepress/` — 配置 / 主题 / 组件

## 开发命令

```bash
# Wiki 站点
cd projects/wiki
npm install
npm run dev         # 本地开发
npm run docs:build  # 构建（node --stack-size=65536，应对大体积内嵌页）

# 重新生成静态页（须在仓库根）
python3 scripts/generate_wiki_pages.py

# 数据校验（processed 基线 + 遗留 schema SKIP 语义）
python3 projects/wiki/scripts/validate_data.py
```

## 本期任务（Phase 2 收尾，→ 07-19）

- [x] **W2 收尾**：数据桥接回 processed 基线 + CharacterGrid 上线图鉴页（2026-07-02 完成）
- [ ] 真实字段缺口推进：skills / 命轮 Effect / 立绘映射 / 三语 name_en·name_ja，
  缺口清单见 `memory/wiki-phase-2-gap-inventory.md`（以一手解包补，禁合成）
- [ ] 贡献流程：数据修正的 PR / Issue 路径跑通至少 1 轮（M3 遗留）
- [ ] 三语目录恢复评估（M4 遗留，量大，须守密人裁定优先级）

## 验证清单

- [x] `data/processed/characters.json` 72 角色、无合成占位（2026-06-16 守密人裁定）
- [x] 58 真实唤醒体详情页生成、VitePress 构建通过（BUILD_OK）
- [x] `validate_data.py` 对 processed 基线校验通过（2026-07-02 对齐后）
- [x] `characters.ts` 数据桥接回后：CharacterGrid SSR 渲染 72 卡片 + 构建通过（2026-07-02）
- [ ] 三语目录结构一致（恢复后）

## 给会话的指令

- 工作目录：`projects/wiki/`（页面生成器在仓库根 `scripts/`）
- 动数据先读 `memory/wiki-phase-2-gap-inventory.md` 与本档案「数据血缘」
- 新数据文件添加后更新本档案与 `memory/project-status.md`
- 角色 / 系统信息同步更新 `memory/morimens-context.md`
