# Code-site 子项目上下文

> 最后更新：2026-04-26 by 艾瑞卡（Code-site 维护会话，D-fix + D-mission 落地后状态同步）

## v2.0 新使命定位（2026-04-26 起）

**site = 银芯三新使命之 #2「社区共建知识底座」对外门户**

- **新定位**：让外部社区/Studio 团队/守密人能找到银芯的入口（对外发现入口）
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的优先级**：核心主线 #3（site/news/wiki 三轴之一），但工作量低于 news/wiki
- **派发关系**：Code-site 继续维护部署流水线 + 视觉一致性。Phase 2 评估对外门户齐备度（首页指引 / 项目说明 / 贡献入口）

## 当前状态：Phase 2 对外门户优化期（在维护稳定基础上加强对外发现入口）

## Phase 2 任务（M1-M4）

- **M1（4-27 → 5-10）**：评估当前主站导航页的"对外发现入口"齐备度（贡献者怎么找到 wiki / news / 贡献流程）
  - D-fix ✅（`6cf6b7b`，2026-04-26）：emoji 合规清理 + nav BIAV 死链修复 + Community 区 8 占位真实化（4 真实 URL + 删 4 卡）
  - D-mission ✅（`6347ad3`，2026-04-26）：hero 与 features 之间新增 Mission 段，三卡片展示银芯三新使命，引导至 news/wiki/GitHub
  - 待办：D-contribute（贡献者入口段，依赖仓库根 `CONTRIBUTING.md` 落地，跨边界阻塞中）
- **M2（5-11 → 6-10）**：补对外说明文档（如 README 重写 / 主站 About 加深 / 贡献指南入口）
- **M3（6-11 → 7-10）**：跨站视觉一致性最终校验 + 三新使命展示
- **M4（7-11 → 7-19）**：验收：对外发现路径顺畅

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

- **主站导航页**：已上线，深黑金色调
  - 段落顺序：nav → hero → **mission**（D-mission 新增）→ features → world-strip → community → footer
  - 合规基线：emoji 全清（D-fix），nav 全部链接可达，community 仅保留 4 真实 URL（Discord 国际服 / NGA / Reddit / TapTap）
  - 设计系统：`design/morimens-design-tokens.css` 为视觉 Token 真值源，但 `public/index.html` 当前以 `:root` 硬编码 Token 子集（未 import，存在漂移风险，列入 M3 校验范围）
- **部署流水线**：已上线，使用 `peaceiris/actions-gh-pages@v4` 推送到 gh-pages 分支
- **GitHub Pages Source**：设为 gh-pages 分支（Settings → Pages）
- **站点地址**：`https://lightproud.github.io/brain-in-a-vat/`

## 部署架构

```
https://lightproud.github.io/brain-in-a-vat/
├── /         ← projects/site/public/index.html（主站导航页，单文件 HTML，全内联 CSS）
├── /404.html ← projects/site/public/404.html（GitHub Pages 自动接管错误页）
├── /design/  ← projects/site/design/（设计系统 Token + 落地指南，对外可访问）
├── /wiki/    ← projects/wiki/docs/.vitepress/dist/*（Code-wiki 维护，VitePress base: /brain-in-a-vat/wiki/）
├── /news/    ← projects/news/index.html + 数据（Code-news 维护）
└── /docs/    ← deliverables/2026-03/缸中之脑计划.{html,pdf}（如存在）
```

> design/ 通过 `deploy-site.yml:92` 的 `cp -r projects/site/design dist/design` 部署到外网，
> 即 `morimens-design-tokens.css` 与 `morimens-design-system-guide.html` 是**对外可见**的开发者文档，
> 维护时需保证内容时效性（属 P0 级一致性约束）。

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

主站源文件已迁移至 `projects/site/public/`（index.html、404.html）。
设计系统文件位于 `projects/site/design/`。

> **路径已同步**（2026-04-20 B1a 清理）：`.github/workflows/deploy-site.yml`
> 已统一使用 `projects/site/**` 路径触发，不再引用旧的 `site/**` / `design/**`。

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
