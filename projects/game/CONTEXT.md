# Game 衍生游戏 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## 当前状态：规划中

## 目标
基于 `assets/data/` 中积累的数据和资产，开发一款忘却前夜衍生同人游戏。

## 做了什么
- （尚未开始）

## 待决策
- [ ] 游戏类型（RPG / 卡牌 / 视觉小说 / 其他）
- [ ] 技术选型（游戏引擎 / 框架）
- [ ] 美术方向（复用资产 / 原创 / 混合）
- [ ] 核心玩法设计

## 依赖
- `assets/data/characters.json` — 角色数据（来自 database 子项目）
- `assets/data/game-config.json` — 游戏配置（本项目产出）
- `assets/images/` — 图片素材

## 验证清单
- [ ] 设计文档已写入且制作人已确认方向

## 给 Code 会话的指令
- 工作目录：`projects/game/`
- 游戏配置输出到：`assets/data/game-config.json`
- 中间产出放：`projects/game/output/`

## 启动验证清单

新会话启动时，请逐项检查：

- [ ] 阅读根目录 `CLAUDE.md` 了解全局上下文
- [ ] 阅读 `memory/project-status.md` 确认 game 子项目当前状态
- [ ] 阅读 `memory/morimens-context.md` 了解游戏背景知识（游戏设计的基础）
- [ ] 检查 `assets/data/` 中可用的数据资产（characters.json 等）
- [ ] 确认"待决策"清单中哪些已有结论，更新本文件
- [ ] 确认你要修改的文件不属于其他子项目
- [ ] 完成任务后更新本文件状态和 `memory/project-status.md`
