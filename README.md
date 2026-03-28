# 忘却前夜 Morimens — 情报收集与衍生游戏计划

> 收集忘却前夜（忘卻前夜 / Morimens）全方位情报、数据与资产，最终制作衍生同人游戏。

---

## 授权声明

本项目由忘却前夜官方授权制作人维护，拥有游戏资产的完整使用权限。游戏设计内容、系统内容、资产内容归属脑缸组及其合作伙伴所有，本项目引用公开可查阅信息。

## 项目定位

本项目承载两层目标：

- **AI 协作方法论**：实践并开源"Claude Code 多会话协作开发模式"，一个人驱动一个 AI 团队完成复杂项目。详见 [`deliverables/2026-03/ai-collaboration-method.html`](deliverables/2026-03/ai-collaboration-method.html)
- **游戏数据平台**：构建忘却前夜的开放数据平台，欢迎社区共同贡献

## 仓库结构

```
Claude/
├── CLAUDE.md                # 总控文件（AI 会话的第一份读物）
├── memory/                  # 结构化记忆（决策、状态、背景知识）
├── assets/                  # 可调用资产（数据、图片、模板）
├── projects/                # 子项目工作区
│   ├── news/                # 社区新闻聚合（运行中）
│   ├── database/            # 官方数据库（开发中）
│   └── game/                # 衍生游戏（规划中）
└── deliverables/            # 已交付成品存档
```

## 子项目

| 子项目 | 目录 | 说明 | 状态 |
|--------|------|------|------|
| 社区新闻聚合 | `projects/news/` | 多平台热点自动抓取与展示 | 运行中 |
| 官方数据库 | `projects/database/` | 游戏数据系统性整理 | 开发中 |
| 衍生游戏 | `projects/game/` | 同人游戏开发 | 规划中 |

## 快速开始

```bash
# 本地运行新闻抓取
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# 预览页面
open projects/news/index.html
```

## 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **后端**: Python 3.11+
- **部署**: GitHub Pages + GitHub Actions
- **协作**: Claude Code 多会话架构 + claude.ai 战略参谋

## 参与贡献

欢迎通过 Issue 或 Pull Request 参与共建，尤其是：
- 补充游戏数据（角色、技能、机制等）
- 完善社区新闻数据源
- 分享 AI 协作方法论的实践经验

## 许可

代码部分采用 [MIT License](LICENSE) 开源。游戏相关内容版权归脑缸组及其合作伙伴所有。
