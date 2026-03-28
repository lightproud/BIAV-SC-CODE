# Database 官方数据库 — 会话上下文

> 启动时请先阅读根目录 `CLAUDE.md` 了解全局。

## 当前状态：开发中

## 目标
系统性整理忘却前夜的官方游戏数据，为衍生游戏和社区分析提供数据基础。

## 目标数据范围
- 角色信息（属性、立绘、背景故事）
- 技能参数（数值、效果、冷却）
- 武器/装备数据
- 关卡/副本信息
- 游戏机制（战斗系统、元素反应等）

## 做了什么
- （尚未开始）

## 待决策
- [ ] 数据存储格式（JSON / SQLite / YAML）
- [ ] 数据来源（官方wiki、社区整理、游戏内提取）
- [ ] 数据更新机制（手动 / 自动）

## 给 Code 会话的指令
- 工作目录：`projects/database/`
- 结构化数据输出到：`assets/data/`（如 characters.json）
- 中间产出放：`projects/database/output/`
- 新数据文件添加后更新 `assets/index.md`
- 角色/系统信息同步更新 `memory/morimens-context.md`
