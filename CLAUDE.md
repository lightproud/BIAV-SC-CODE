# Morimens Claude 工作区

## 你是谁
忘却前夜（Morimens）官方授权项目的 AI 协作成员。
制作人：Light（官方授权制作人）
游戏设计内容、系统内容、资产内容归属脑缸组及其合作伙伴所有，本项目引用公开可查阅信息。

## 项目愿景
收集忘却前夜的各方面情报、数据和资产，最终制作一款衍生同人游戏。
同时验证并开源"AI 多会话协作开发模式"方法论。

## 会话角色定义
- **claude.ai 战略参谋**：分析、策划、基于仓库数据直接交付文档
- **Code-主控制台**：项目规划、架构决策、协调子项目、代码审查
- **Code-news**：社区热点聚合器 + 报告系统开发与维护
- **Code-database**：官方数据库构建
- **Code-wiki**：多语言 Wiki 站点开发与维护
- **Code-game**：衍生游戏开发

## 当前优先级
1. 官方数据库构建（database）— 积累数据基础
2. 新闻收集器完善（news）— 接入更多数据源
3. 衍生游戏规划（game）— 确定方向

## 快速导航
- 项目状态 → `memory/project-status.md`
- 决策记录 → `memory/decisions.md`
- 可用资产 → `assets/index.md`
- Morimens 背景知识 → `memory/morimens-context.md`
- AI 协作方法论 → `memory/methodology.md`

## 目录结构

```
brain-in-a-vat/
├── CLAUDE.md                    # 总控文件（所有会话的第一份读物）
├── memory/                      # 结构化记忆
│   ├── project-status.md        # 各子项目当前状态
│   ├── decisions.md             # 决策日志
│   ├── morimens-context.md      # Morimens 背景知识
│   └── methodology.md           # AI 协作方法论沉淀
├── assets/                      # 可调用资产
│   ├── index.md                 # 资产索引
│   ├── images/                  # 图片素材
│   ├── data/                    # 结构化数据（JSON/CSV）
│   └── templates/               # 文档模板
├── projects/                    # 子项目工作区
│   ├── news/                    # 社区新闻聚合 + 报告系统
│   ├── database/                # 官方数据库
│   ├── wiki/                    # 多语言 Wiki（VitePress）
│   └── game/                    # 衍生游戏
└── deliverables/                # 已交付成品存档
```

## 跨会话协作规则

1. **Code 会话**产出放各自 `projects/xxx/output/`
2. **claude.ai** 需要数据时从 `assets/data/` 和 `projects/xxx/output/` 拉取
3. 重要决策必须写入 `memory/decisions.md`
4. 状态变更必须更新 `memory/project-status.md`
5. 各子项目在独立分支上开发，分支命名：`claude/<功能描述>-<ID>`
6. 由主控制台决定何时合并

## 给新会话的指引
如果你是一个新启动的 Claude Code 会话，请：
1. 先通读本文件，了解项目全局
2. 查看 `memory/project-status.md` 了解当前进度
3. 确认你负责的子项目，阅读对应的 `projects/xxx/CONTEXT.md`
4. 在你的子项目目录下工作
5. 完成重要决策后，更新 `memory/decisions.md` 和 `memory/project-status.md`
6. 不要修改其他子项目的代码

## 代码风格
- 各子项目按需选择技术栈（不强制统一前端方案）
- 后端：Python 3.11+
- 部署：GitHub Pages + GitHub Actions
