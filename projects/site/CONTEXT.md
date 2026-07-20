# Code-site 子项目上下文

> 最后更新：2026-07-02 by 艾瑞卡会话（档案漂移修复：对外两页使命段由「三新使命」
> 改「二核心使命」——使命#3 已于 2026-06-28 守密人裁定退役，主站与 biav 页此前仍
> 展示三卡片，属对外漂移，已同步删卡并改 meta 文案。下文 4-26 的 D-* 记录为历史
> 验收记录，其中「三新使命」措辞为当时事实，不再逐条改写）
> 上次：2026-04-26 by 艾瑞卡（D-fix + D-mission + 自审清理 + D-biav 落地后状态同步）

## v2.0 新使命定位（2026-04-26 起）

**site = 银芯使命对外门户 / 三轴（site·news·wiki）发现入口**（非任一单一使命的载体；使命#2「社区共建知识底座」载体为 wiki，见 CLAUDE.md §1.2）

- **新定位**：让外部社区/Studio 团队/守密人能找到银芯的入口（对外发现入口）
- **本子项目在 Phase 2（4-27 → 7-19，84 天）的优先级**：核心主线 #3（site/news/wiki 三轴之一），但工作量低于 news/wiki
- **派发关系**：Code-site 继续维护部署流水线 + 视觉一致性。Phase 2 评估对外门户齐备度（首页指引 / 项目说明 / 贡献入口）

## 当前状态：Phase 2 对外门户优化期（在维护稳定基础上加强对外发现入口）

## Phase 2 任务（M1-M4）

- **M1（4-27 → 5-10）**：评估当前主站导航页的"对外发现入口"齐备度（贡献者怎么找到 wiki / news / 贡献流程）
  - D-fix ✅（`6cf6b7b`，2026-04-26）：emoji 合规清理 + nav BIAV 死链修复 + Community 区 8 占位真实化（4 真实 URL + 删 4 卡）
  - D-mission ✅（`6347ad3`，2026-04-26）：hero 与 features 之间新增 Mission 段，三卡片展示银芯三新使命，引导至 news/wiki/GitHub
  - 自审清理 ✅（`61d3da6`，2026-04-26）：补 favicon + canonical + og:locale + twitter:card；改 select onchange 反模式为 details/summary 可访问下拉；hero-title 字符空格 → letter-spacing；删 5 死 CSS 变量；404 色彩对齐 + 加仓库入口；同步 design-system-guide
  - D-biav ✅（本批次，2026-04-26）：新建 `public/biav/index.html` 项目说明页（命名缘由 / 银芯系统 / 三新使命 / 仓库结构 / 入口协议）；nav BIAV 链接恢复指向 `biav/`，消除 P1-2 重复；改 deploy-site.yml 为 `cp -r public/. dist/` 递归部署
  - D-token-unify ✅（本批次，2026-04-26）：`public/index.html` 与 `public/biav/index.html` 通过 `<link rel="stylesheet">` 引入 `design/morimens-design-tokens.css`；`:root` 短名映射至 `--m-*` 长名（含 fallback 硬编码值），design-tokens.css 真正成为视觉真值源，解 P1-5
  - 贡献模板 ✅（本批次，2026-04-26）：按 `memory/contribution-protocol.md` § 6 M1 末任务落档 `.github/ISSUE_TEMPLATE/{bug,data-gap,config}.yml` + `.github/PULL_REQUEST_TEMPLATE.md`（Code-site 实施）
  - ~~待办：D-contribute（M2 5-11 起）— 仓库根 `CONTRIBUTING.md` 形式化 + 主站「贡献者入口」镜像页双轨实施~~（**2026-07-10 作废**：守密人裁定取消社区贡献、对社区单向可读，贡献入口线全线撤销）
- **M2（5-11 → 6-10）**：补对外说明文档（如 README 重写 / 主站 About 加深 / 贡献指南入口）
- **M3（6-11 → 7-10）**：跨站视觉一致性最终校验 + 使命展示（二核心；原使命#3 训练场 2026-06-28 退役）
- **M4（7-11 → 7-19）**：验收：对外发现路径顺畅

## 职责范围

Code-site 会话负责：
- **主站导航页** (`projects/site/public/index.html`)：项目入口，连接 Wiki / News / Game 三个子站
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
  - **知识库入口（D-kb，2026-07-04）**：nav 新增「知识库」链接 → `/kb/`；mission 段下方加底座入口卡（105 概念 · 104 关系，链 `/kb/`）；biav 页出口区同步加「知识库」。部署期 `cp okf/visualizer.html dist/kb/index.html`（放指针不放本体，okf/ 为真值源）。知识库定位为「二核心使命共用事实底座」，**非**第三使命（避免重蹈三卡对外漂移坑）
  - 合规基线：emoji 全清（D-fix + 自审），nav 全部链接可达且无重复，community 仅保留 4 真实 URL（Discord 国际服 / NGA / Reddit / TapTap）
  - SEO/可访问性基线：favicon（inline SVG 宋体「夜」字）+ canonical + og:locale 三语 + twitter:card；语言切换为可访问 details/summary（替代旧 select onchange 反模式）
  - 设计系统：`design/morimens-design-tokens.css` 为视觉 Token 真值源，`public/index.html` 与 `public/biav/index.html` 通过 `<link rel="stylesheet">` 引入并以 `var(--m-*, fallback)` 模式映射；改 design-tokens.css 即全站生效（D-token-unify 已落地）
- **biav 子页**：已上线（D-biav，`public/biav/index.html`），项目说明页面，含命名缘由 / 银芯系统 / 二核心使命（2026-07-02 由三新使命改） / 仓库结构 / 入口协议五段
- **404 页**：色彩与字重已对齐主站，含返回主站/Wiki/News/仓库四入口
- **部署流水线**：使用 `peaceiris/actions-gh-pages@v4` 推送到 gh-pages 分支
  - **2026-04-26 改造**：site 部署改为 `cp -r projects/site/public/. dist/` 递归，未来 `public/` 下任何子目录或新增文件自动部署，不需再追加 cp 行
- **GitHub Pages Source**：设为 gh-pages 分支（Settings → Pages）
- **站点地址**：`https://lightproud.github.io/brain-in-a-vat/`

## 部署架构

```
https://lightproud.github.io/brain-in-a-vat/
├── /         ← projects/site/public/index.html（主站导航页，单文件 HTML，全内联 CSS）
├── /404.html ← projects/site/public/404.html（GitHub Pages 自动接管错误页）
├── /biav/    ← projects/site/public/biav/index.html（D-biav 项目说明页）
├── /kb/      ← okf/visualizer.html（知识库关系图，部署期 cp 成 kb/index.html；okf/ 为唯一真值源，非 public/ 下本体）
├── /design/  ← projects/site/design/（设计系统 Token + 落地指南，对外可访问）
├── /wiki/    ← projects/wiki/docs/.vitepress/dist/*（Code-wiki 维护，VitePress base: /brain-in-a-vat/wiki/）
├── /news/    ← projects/news/index.html + 数据（Code-news 维护）
└── /docs/    ← Public-Info-Pool/Resource/proposal/biav-project-plan-202603.{html,pdf}（如存在；deliverables/ 已 2026-06-21 迁此）
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

push to main 且路径匹配（`deploy-site.yml` paths）：`projects/site/**`、
`projects/wiki/docs/**`、`projects/wiki/package.json`、`projects/news/index.html`、
`Public-Info-Pool/Resource/proposal/**`（原 `deliverables/**`，2026-06-21 迁移）、`.github/workflows/deploy-site.yml`。
也支持 `workflow_dispatch` 手动触发。旧 `site/**` 路径已不在触发列表（与下文 2026-04-20 B1a 清理记述一致）。

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
