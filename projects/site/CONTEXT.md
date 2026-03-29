# Code-site 子项目上下文

## 职责范围

Code-site 会话负责：
- **主站导航页** (`site/index.html`)：项目入口，连接 Wiki / News / Game 三个子站
- **统一部署流水线** (`.github/workflows/deploy-site.yml`)：构建并发布整个 GitHub Pages 站点
- **跨站视觉一致性**：确保各子站风格与 `memory/style-guide.md` 协调
- **交互体验优化**：响应式布局、动画效果、用户体验

## 不负责的范围

- `projects/wiki/` — 由 Code-wiki 负责
- `projects/news/` — 由 Code-news 负责
- `projects/game/` — 由 Code-game 负责
- `memory/` 和 `CLAUDE.md` — 由主控台负责

## 部署架构

```
https://lightproud.github.io/brain-in-a-vat/
├── /        → site/index.html（主站导航页）
├── /wiki/   → VitePress 构建产物（Code-wiki 维护内容）
└── /news/   → projects/news/index.html（Code-news 维护内容）
```

## 文件位置说明

主站源文件位于仓库根目录下的 `site/index.html`（而非 `projects/site/`），
因为部署流水线 `.github/workflows/deploy-site.yml` 直接引用该路径。
如需迁移，必须同步修改工作流文件。

## 视觉规范

严格遵循 `memory/style-guide.md`，核心约束：
- 背景 `#0a0b10`，主金 `#c5a356`，亮金 `#e2c97e`
- 禁止使用 emoji（任何交付物）
- 禁止冷色调
- 字体：Noto Serif SC（标题）+ Noto Sans SC（正文）

## 协作约定

- Code-wiki 修改 VitePress base 路径时，需通知 Code-site 同步确认部署流水线
- Code-news 新增页面时，需通知 Code-site 确认 `cp` 命令覆盖范围
- 发现跨站视觉不一致时，记录到对应子项目的 Issue（不直接修改其代码）
