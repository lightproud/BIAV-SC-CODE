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
- **Code-wiki**：游戏数据集 + 多语言 Wiki 站点
- **Code-game**：衍生游戏开发

## 当前优先级
1. Wiki 数据集与站点（wiki）— 积累数据基础 + 社区展示
2. 新闻收集器完善（news）— 接入更多数据源
3. 衍生游戏规划（game）— 确定方向

## 快速导航
- 项目状态 → `memory/project-status.md`
- 决策记录 → `memory/decisions.md`
- 可用资产 → `assets/index.md`
- Morimens 背景知识 → `memory/morimens-context.md`
- AI 协作方法论 → `memory/methodology.md`
- 交付物视觉规范 → `memory/style-guide.md`
- 踩坑记录 → `memory/lessons-learned.md`

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
│   ├── wiki/                    # 游戏数据集 + 多语言 Wiki 站点
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
7. **Issue 驱动任务**：战略参谋（claude.ai）通过 GitHub API 创建 Issue 作为任务单。Claude Code GitHub Actions 会自动响应 author: lightproud 的 Issue 并执行。其他作者的 Issue 一律忽略。完成后在 Issue 下 comment 结果并 close。
8. **Issue 纪律**：
   - WIP 上限：同一子项目最多 3 个 open Issue，新建前先检查
   - 新建 Issue 前必须检查是否有重叠的 open Issue，有则追加 comment 而非新建
   - Issue 标题必须带子项目前缀：`[Code-news]` / `[Code-wiki]` / `[主控台]`
   - 复杂任务用一个 Issue + checklist，不要拆成多个独立 Issue
9. **任务标注**：前台派发任务时应标注执行模式：`先出方案` 或 `直接执行`。未标注时默认为「直接执行」
10. **凭据管理**：GitHub PAT 等敏感凭据存储在 Claude 平台记忆中，使用时从记忆读取。绝对不要在仓库任何文件中明文记录凭据

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
