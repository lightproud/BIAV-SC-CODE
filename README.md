# 缸中之脑 Brain in a Vat

> 忘却前夜（忘卻前夜 / Morimens）情报收集、数据平台与衍生游戏计划。

---

## 授权声明

本项目由忘却前夜官方授权制作人维护。游戏设计内容、系统内容、资产内容归属脑缸组及其合作伙伴所有，本项目引用公开可查阅信息。

## 项目定位

- **游戏数据平台**：构建忘却前夜的开放数据集与多语言 Wiki，欢迎社区共同贡献
- **AI 协作方法论**：实践并开源"双集群 + 人类调度器"多会话协作开发模式

## 仓库结构

```
brain-in-a-vat/
├── CLAUDE.md                # 总控文件（AI 会话的第一份读物）
├── memory/                  # 结构化记忆（决策、状态、方法论、视觉规范）
├── assets/                  # 共享资产（数据、图片、模板）
├── projects/                # 子项目工作区
│   ├── news/                # 社区新闻聚合 + 报告系统
│   ├── wiki/                # 游戏数据集 + 多语言 Wiki 站点
│   └── game/                # 衍生游戏（规划中）
└── deliverables/            # 已交付成品存档
```

## 子项目

| 子项目 | 目录 | 说明 | 状态 |
|--------|------|------|------|
| 新闻聚合 + 报告系统 | `projects/news/` | 多平台热点抓取、AI 分析、多渠道推送 | 运行中 |
| 数据集 + Wiki | `projects/wiki/` | 16 个 JSON 数据文件 + VitePress 三语言站点 | 数据就绪 |
| 衍生游戏 | `projects/game/` | 同人游戏开发 | 规划中 |

## 快速开始

```bash
# 本地运行新闻抓取
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# 本地预览 Wiki
cd projects/wiki
npm install
npm run docs:dev
```

## 技术栈

- **Wiki**: VitePress + Markdown（EN/JA/ZH 三语言）
- **新闻聚合**: Python 3.11+ / 纯 HTML 前端
- **报告系统**: Python（29 平台采集 + AI 分析 + 通知推送）
- **自动化**: GitHub Actions（每小时新闻抓取 + 每日报告 + Issue 驱动执行）
- **协作**: Claude Code 多会话架构 + claude.ai 战略参谋

## AI 协作方法论

本项目采用「双集群 + 人类调度器」模式：

- **Chat 集群**：无状态，随开随用，负责分析、策划、审视
- **Code 集群**：有状态，按子项目分工（主控台 + wiki + news + game）
- **仓库**：共享外脑，连接两个集群

详见 [`memory/methodology.md`](memory/methodology.md) 和 [`deliverables/2026-03/缸中之脑计划 Brain in a Vat Project.html`](deliverables/2026-03/缸中之脑计划%20Brain%20in%20a%20Vat%20Project.html)。

## 参与贡献

欢迎通过 Issue 或 Pull Request 参与共建，尤其是：
- 补充游戏数据（角色、技能、机制等）
- 完善 Wiki 页面内容
- 分享 AI 协作方法论的实践经验

## 许可

代码部分采用 [MIT License](LICENSE) 开源。游戏相关内容版权归脑缸组及其合作伙伴所有。
