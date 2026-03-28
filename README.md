# 忘却前夜 Morimens — 情报收集与衍生游戏计划

> 收集忘却前夜（忘卻前夜 / Morimens）全方位情报、数据与资产，最终制作衍生同人游戏。

---

## 授权声明

本项目由忘却前夜官方授权制作人维护，拥有游戏资产的完整使用权限。项目中的游戏数据、资产（立绘、模型、音频等）均为授权使用。

## 项目定位

本项目承载两层目标：

- **AI 协作方法论**：实践并开源"Claude Code 多会话协作开发模式"，一个人驱动一个 AI 团队完成复杂项目。详见 [`docs/ai-collaboration-method.html`](docs/ai-collaboration-method.html)
- **游戏数据平台**：构建忘却前夜的开放数据平台，欢迎社区共同贡献

## 项目结构

本项目由多个子项目组成，采用 Claude Code 多会话协作模式开发：

| 子项目 | 目录 | 说明 | 状态 |
|--------|------|------|------|
| 社区新闻聚合 | `news/` | 多平台热点自动抓取与展示 | 运行中 |
| 官方数据库 | `database/` | 游戏数据系统性整理 | 开发中 |
| 衍生游戏 | `game/` | 同人游戏开发 | 规划中 |
| 方法论文档 | `docs/` | AI 多会话协作开发方法论 | 已发布 |

## 社区新闻聚合 (`news/`)

自动聚合 B站、Reddit、Twitter/X、NGA、TapTap 等平台的忘却前夜社区热点。

- **前端**：纯 HTML/CSS/JS 深色主题页面，支持平台筛选和热门标记
- **后端**：Python 抓取脚本，支持 AI 生成每日总结
- **自动化**：GitHub Actions 每小时抓取，前端每 5 分钟刷新
- **部署**：GitHub Pages，零成本运行

### 快速开始

```bash
# 本地运行抓取
pip install -r news/requirements.txt
python news/scripts/aggregator.py

# 预览页面
open news/index.html
```

## 官方数据库 (`database/`)

整理角色、技能、装备、关卡等官方游戏数据，为衍生游戏提供数据基础。

## 衍生游戏 (`game/`)

基于收集的情报和数据，开发一款衍生同人游戏。

---

## 技术栈

- **前端**: 纯 HTML + CSS + JavaScript
- **后端**: Python 3.11+
- **部署**: GitHub Pages + GitHub Actions
- **协作**: Claude Code 多会话架构

## 参与贡献

欢迎通过 Issue 或 Pull Request 参与共建，尤其是：
- 补充游戏数据（角色、技能、机制等）
- 完善社区新闻数据源
- 分享 AI 协作方法论的实践经验

## 许可

本项目代码开源。游戏相关内容版权归忘却前夜官方所有，本项目经官方授权使用。
