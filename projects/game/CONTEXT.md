# Game 衍生游戏 — 会话上下文

> 最后更新：2026-07-02 by 艾瑞卡会话（档案漂移修复：config/ 依赖描述对齐实际 6 个配置文件、output/ 状态订正。上次 2026-04-26 写入 v2.0 game 重定位 — **退主线**）
> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## v2.0 重新定位（2026-04-26 起）

**game = 守密人个人兴趣项目（主）+ 未来扩展可能 ⓐⓒ（备）**

- **新定位**：
  - **当前**：守密人个人兴趣项目，与银芯使命无关，**不是银芯主线**
  - **未来扩展 ⓐ**：原设想演化为 Studio 团队 AI 训练场（原使命#3 的具体场景）——**使命#3 已于 2026-06-28 退役**，此扩展不再绑定正式使命
  - **未来扩展 ⓒ**：可能演化为社区共建衍生项目
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的状态**：**不主线派发，主控台不分配资源**
- **派发关系**：守密人主导，主控台不派子代理处理 game。如果守密人想推进，自己开 Code-game 会话或者直接动手
- **不冻结也不重点投入**：保留 CONTEXT.md 与目录结构，等守密人想推进时随时可启动

## 当前状态：守密人个人兴趣项目（不主线）· 环行记 MVP 已可玩

## 目标
基于事实圣经和 Wiki 数据集，开发一款忘却前夜衍生同人游戏。**仅作为守密人个人兴趣，不是 Phase 2 战略主线交付。**

## 做了什么
- **环行记（Ring Chronicle）— 吸血鬼幸存者玩法 MVP**（2026-06-03）：
  - 体验定义 + 设计方案见 `DESIGN.md`；玩法/工程总览见 `README.md`
  - 技术：单页 HTML5 Canvas + 原生 JS，零构建、双击即玩；核心逻辑环境无关可 headless 测试
  - 四界域武器家族（混沌/深海/血肉/超维）+ 纯界域共鸣（混沌通配），取自真实四界域机制
  - 4 名可玩唤醒体（环行·拉蒙娜 / 图鲁 / 潘狄娅 / 朵尔·熔毁），天赋对应正典能力
  - 程序化 Canvas 美术（按界域配色，零外部图）；角色选择 / HUD / 升级三选一 / 结算界面
  - 验证：`test/core.test.mjs` 23 项全绿；`test/playthrough.mjs` 整局模拟 4 角色稳定，熟练走位 3/4 通关

## 待决策
- [x] 游戏类型 → 吸血鬼幸存者（Roguelite 生存）
- [x] 技术选型 → 单页 HTML5 Canvas + 原生 JS（零构建）
- [x] 美术方向 → 程序化 Canvas 精灵（按界域配色）
- [x] 核心玩法设计 → 见 `DESIGN.md`
- [ ] 后续：更多唤醒体 / 武器进化树 / 真实立绘接入 / 音效

## 依赖
- 角色数据 — 现行源 `projects/wiki/data/processed/characters.json`（72 真实角色，一手解包；底层原始字段 `projects/wiki/data/extracted/categorized/character_data.txt`）。**原 `projects/wiki/data/db/characters.json` 占位结构化层 2026-06-15 已清空、勿引用**；W2 可信基线已重建（72 齐）
- `projects/game/config/` — 游戏配置（已建立，2026-06-03 MVP 随附）：`characters.json` / `enemies.json` / `upgrades.json` / `waves.json` / `weapons.json` + `config.js` 加载器（原设想的单文件 `game-config.json` 未采用）
- `assets/images/` — 图片素材

## 验证清单
- [ ] 设计文档已写入且制作人已确认方向

## 给 Code 会话的指令
- 工作目录：`projects/game/`
- 游戏配置输出到：`projects/game/config/`（已建立）
- 中间产出放：`projects/game/output/`（已建立，当前为空）

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 game 子项目当前状态
- [ ] 阅读 `memory/morimens-context.md` 了解游戏背景知识（游戏设计的基础）
- [ ] 检查现行角色源 `projects/wiki/data/processed/characters.json`（72 真实角色，一手解包；旧 `data/db/` 占位层 2026-06-15 已清空，勿引用）
- [ ] 确认"待决策"清单中哪些已有结论，更新本文件
- [ ] 确认你要修改的文件不属于其他子项目
- [ ] 完成任务后更新本文件状态和 `memory/project-status.md`
