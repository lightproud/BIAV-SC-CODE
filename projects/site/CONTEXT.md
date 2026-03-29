# Code-site 子项目上下文

> 最后更新：2026-03-29

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

## 当前状态

- **主站导航页**：已上线，深黑金色调，3 卡片（Wiki/News/Game）+ About + 方法论段落
- **部署流水线**：已上线，使用 `peaceiris/actions-gh-pages@v4` 推送到 gh-pages 分支
- **GitHub Pages Source**：设为 gh-pages 分支（Settings → Pages）
- **站点地址**：`https://lightproud.github.io/brain-in-a-vat/`

## 部署架构

```
https://lightproud.github.io/brain-in-a-vat/
├── /        → site/index.html（主站导航页，单文件 HTML，全内联 CSS）
├── /wiki/   → VitePress 构建产物（Code-wiki 维护内容，base: /brain-in-a-vat/wiki/）
└── /news/   → projects/news/index.html（Code-news 维护内容）
```

### 部署方法

使用 `peaceiris/actions-gh-pages@v4`，将 `dist/` 目录推送到 `gh-pages` 分支。
GitHub Pages 从 gh-pages 分支读取静态文件。

**不使用** `actions/deploy-pages@v4`（artifact 方式），因为旧 workflow 遗留的
environment 部署记录会阻止新 workflow 部署（详见 `memory/lessons-learned.md` #9）。

### 构建流程

1. checkout → setup-node → npm ci（wiki 依赖）
2. VitePress build（`projects/wiki/` 下）
3. 组装 dist/：主站 index.html + wiki 构建产物 + news 页面 + .nojekyll
4. 验证构建产物（检查关键文件存在性和大小）
5. 推送到 gh-pages 分支

### 触发条件

push to main 且路径匹配：`site/**`、`projects/site/**`、`projects/wiki/docs/**`、
`projects/wiki/package.json`、`projects/news/index.html`、`.github/workflows/deploy-site.yml`。
也支持 `workflow_dispatch` 手动触发。

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
- 装饰符号用 `◇ ◇ ◇`（style-guide deco-diamond）

## 协作约定

- Code-wiki 修改 VitePress base 路径时，需通知 Code-site 同步确认部署流水线
- Code-news 新增页面时，需通知 Code-site 确认 `cp` 命令覆盖范围
- 发现跨站视觉不一致时，记录到对应子项目的 Issue（不直接修改其代码）

## 踩坑备忘（Code-site 相关）

以下经验直接影响 Code-site 的日常工作，完整记录在 `memory/lessons-learned.md`：

- **#9 多会话部署冲突**：部署流水线归 Code-site 统一管理，其他子项目不得创建独立部署 workflow
- **#12 YAML frontmatter 冒号**：wiki 角色页 title 含冒号时必须加引号，否则 VitePress 构建失败
- **#13 img src 被 Vue 编译器拦截**：用 `:src="'...'"` 动态绑定避免 Vite 将路径当 import
- **#14 npm script 名必须与 workflow 一致**：当前 package.json 同时定义了 `build` 和 `docs:build`
- **#15 批量生成内容后必须跑构建验证**：不要假设生成的内容是对的
- **#16 Web 端 Claude Code 无外网**：部署验证任务应在 PC 端执行
