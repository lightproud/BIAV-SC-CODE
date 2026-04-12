# BIAV-SC — 忘却前夜 AI 增强插件

> 本文件为 Claude Code 自动加载入口。完整平台无关定义见根目录 **`BIAV-SC.md`**，新会话建议按需阅读。
>
> 项目名称：缸中之脑（Brain in a Vat），服务于 B.I.A.V. Studio 的《忘却前夜》（Morimens）。
> 制作人：Light。当前阶段：Phase 1（记忆宫殿）✅ 已验证 → Phase 2（内容权威）准备中。

---

## 沟通规则

- **始终使用中文**进行所有过程说明、状态报告和对话。
- 代码注释和 commit message 可用英文。
- 绝不使用 emoji（任何交付物、站点文案、代码注释，全部禁止）。

---

## 仓库结构

```
brain-in-a-vat/
├── CLAUDE.md                  # 本文件（Claude Code 自动加载入口）
├── BIAV-SC.md                 # 平台无关完整定义（按需读取）
├── README.md                  # 对外仓库说明
├── memory/                    # 结构化记忆（决策、状态、方法论、视觉规范、教训）
│   ├── boot-snapshot.md       # 会话启动压缩快照
│   ├── project-status.md      # 各子项目进度与 workflow 运行表
│   ├── decisions.md           # 决策日志（当前有效 + 历史归档）
│   ├── lessons-learned.md     # 踩坑记录（必读，避免重犯错误）
│   ├── morimens-context.md    # 游戏世界观、角色、术语
│   ├── strategic-plan-2026.md # 四阶段战略规划
│   ├── methodology.md         # 双集群多会话协作方法论
│   ├── style-guide.md         # 交付物视觉规范
│   ├── dreams/                # 做梦 Agent 产出（日志/周报/洞察）
│   └── session-digests/       # 会话摘要
├── assets/                    # 共享资产（事实圣经 + 图片 + 样式）
│   ├── data/                  # 事实圣经（interview/narrative/design-decisions JSON + 校验器）
│   ├── images/                # 立绘和图片素材
│   └── styles/                # 共享样式
├── projects/                  # 子项目工作区（见下方速查表）
│   ├── site/                  # 主站导航页 + 设计系统
│   ├── news/                  # 多平台社区新闻聚合 + 报告系统
│   ├── wiki/                  # VitePress 三语 Wiki + 游戏数据集
│   ├── game/                  # 衍生同人游戏（规划中）
│   ├── bpt-web/               # 黑池终端 Web 版（单文件 PWA，BPT-WEB）
│   └── bpt-desktop/           # 黑池终端 桌面版（Electron + Vite，BPT-DESKTOP）
├── scripts/                   # 银芯记忆系统与 MCP 服务器（Python）
├── deliverables/              # 已交付成品存档
└── .github/workflows/         # GitHub Actions 自动化流水线
```

### 子项目速查

| 子项目 | 路径 | 负责会话 | 技术栈 | 状态 |
|--------|------|---------|--------|------|
| 主站 + 部署 + 视觉 | `projects/site/` | Code-site | 纯 HTML/CSS/JS | 已部署，维护模式 |
| 社区新闻聚合 | `projects/news/` | Code-news | Python 3.11+ / 纯 HTML | 收缩夯实，3 源运行中 |
| Wiki + 数据集 | `projects/wiki/` | Code-wiki | VitePress 1.6.4 + Vue 3.5.13 | 数据补全中（~83%） |
| 衍生游戏 | `projects/game/` | Code-game（未启用） | 待决策 | 暂缓，Phase 4 启动 |
| 黑池终端 Web (BPT-WEB) | `projects/bpt-web/` | 主控台 | 单文件 PWA（HTML + 内联 CSS/JS + SW） | v0.1.0 已部署 |
| 黑池终端 桌面 (BPT-DESKTOP) | `projects/bpt-desktop/` | Code-site | Electron 33 + React 18 + Vite 6 + sql.js | v0.1.0 开发中 |

每个子项目根目录都有 `CONTEXT.md`，新会话启动时必须先读。

---

## 新会话启动流程

1. **读启动快照**：`Read memory/boot-snapshot.md`（压缩启动包，一步就绪）。
2. **按需扩展**：根据任务读取相应文件，详见下方"按需加载索引"。
3. **读所属子项目的 CONTEXT.md**：了解该子项目当前任务、职责边界、验证清单。
4. **首次回复**：主动告诉用户你能做什么 + 3~5 个基于真实数据的建议。

### 按需加载索引（避免全量读文件）

| 你想做什么 | 读这个 |
|-----------|--------|
| 了解项目当前状态 | `memory/boot-snapshot.md`（优先）+ `memory/project-status.md` |
| 理解游戏世界观 | `memory/morimens-context.md` |
| 查角色数据库（63 角色） | `projects/wiki/data/db/characters.json` |
| 查社区动态 | `projects/news/output/daily-latest.md` / `all-latest.json` |
| 查制作人第一手陈述 | `assets/data/interview-2026-04.json` |
| 了解被砍机制/设计哲学 | `assets/data/design-decisions.json` |
| 查三部叙事结构 | `assets/data/narrative-structure.json` |
| 查决策历史 | `memory/decisions.md` |
| 查战略规划 | `memory/strategic-plan-2026.md` |
| 避免重复犯错 | `memory/lessons-learned.md`（22 条踩坑）|
| 查交付物视觉规范 | `memory/style-guide.md` |
| 查联动事件响应 | `memory/collab-event-playbook.md` |

> ⚠️ **时效规则**：`projects/news/output/` 下的数据是历史+近期混合，分析时必须检查每条 `time` 字段（ISO 8601），绝不能把旧数据当新事件报告。

---

## 银芯记忆系统（Silver Core）

你拥有 9 模块记忆基础设施，处理本项目问题时**优先使用以下工具而非手动 Read/Grep**。

### 搜索与查询（日常使用）

```bash
# 语义搜索知识库（TF-IDF + 4 维重排序，替代手动 grep）
python scripts/memory_search.py "查询关键词"

# 查询知识图谱（实体关系，如角色、界域、决策间的连接）
python scripts/knowledge_graph.py --query "实体名"

# 不知道该读什么文件时，按角色/问题推荐 4 层上下文
python scripts/context_manager.py --query "你的问题" --role "当前角色"

# 检查预计算缓存（做梦 Agent 产出）
python scripts/dream.py --check-cache

# 查看文件效用排名（MemRL-lite EMA 评分）
python scripts/memrl.py --top 10

# 重建全部索引
python scripts/dream.py --rebuild
```

### 知识写入（对话中主动调用）

**遇到以下情况时主动写入事实**（用 `scripts/fact_store.py` 或 MCP `store_facts` 工具）：

1. **decision**：做出技术/架构选择（如"选用 X 替代 Y，因为..."）
2. **discovery**：找到 bug 根因、理解某段代码的行为
3. **preference**：了解到用户习惯或喜好
4. **convention**：项目中约定俗成的做法
5. **context**：重要背景信息
6. **lesson**：踩坑后的经验总结

**不要写入**：临时调试信息、显而易见的代码结构、已在 CLAUDE.md 明确记录的规则。

### 记忆写回

**主力手段（跨工具通用）**：会话过程中主动写入 `memory/` 文件和 `fact_store.py`。遇到决策、发现、教训时立即写，不要等会话结束。

**SessionEnd hook（Claude Code 自动，v0.2）**：`.claude/settings.json` 注册，会话结束时自动执行：
- `scripts/session-end-distill.sh` → `scripts/session_distiller.py`
- 每次会话产出三份文件到 `memory/session-digests/`：
  - `{stamp}-{sid}.json` — 结构化元数据索引（gitignored，本地查阅）
  - `{stamp}-{sid}.md` — 完整对话 Markdown（推进 git，公开成长记录）
  - `{stamp}-{sid}.jsonl.gz` — 原始 transcript 压缩存档（推进 git）
- 纯结构化解析，不调 LLM。日志落在 `/tmp/session-distill.log`
- 限制：仅 Claude Code 有效；仅在 cwd 为 brain-in-a-vat 时触发

手动写回（按需触发）：
- `python scripts/memory_writeback.py --verbose` — 检测 git 变更 → 提取知识 → 写入图谱 → 增量重索引
- `python scripts/session_reflexion.py` — 扫描失败信号 → 写入 `lessons-learned.md`

### MCP 服务器

`scripts/mcp_server.py` 暴露 7 个工具给任意 MCP 客户端：search / graph / utility / cache / context / rebuild / store_facts。`.mcp.json` 已配置为默认加载。

---

## 关键开发约定

### Git 规则

- **所有会话推 feature 分支**，完成后合并 main。分支命名：`claude/{简短描述}-{随机后缀}`。GitHub Actions 会话由 `claude.yml` merge step 自动合并并清理分支；Web Code 交互式会话在会话末尾手动合并或由制作人确认后合并。
- 修改 `memory/` 文件时更新头部时间戳：`最后更新：YYYY-MM-DD by 会话角色`
- 凭据绝不写入仓库文件。
- 禁止 `-i` 交互式 git 命令（rebase -i / add -i）。

### 黑池终端 BPT-WEB 版本管理（严格执行）

每次修改 `projects/bpt-web/index.html` 并提交时，**必须**同步更新 5 处版本号：

1. `const APP_VERSION = 'x.y.z'`（JS 常量）
2. `<div id="sidebar-footer">vx.y.z</div>`（侧边栏 HTML）
3. `projects/bpt-web/sw.js` 的 `const SW_VERSION = 'x.y.z'`（触发 SW 更新清缓存）
4. `projects/bpt-web/manifest.json`（如涉及 description 等版本相关字段）
5. `projects/bpt-web/CHANGELOG.md`（顶部添加新版本条目）

版本规则：修复 → patch +1；新功能 → minor +1；重大变更 → major +1。

**绝对禁止**提交 index.html 功能改动但不更新版本号。

### Issue 规则

- 只响应 `author: lightproud` 的 Issue。
- 同一子项目最多 3 个 open Issue。
- 创建前先查重，有重叠则追加 comment。
- 标题前缀：`[Code-site]` / `[Code-news]` / `[Code-wiki]` / `[主控台]`。
- 未标注执行模式时默认「直接执行」。
- Issue 不是跨会话通信手段，任务要点必须写进对应 `CONTEXT.md`。

### 视觉规范（style-guide.md）

- 背景 `#0a0b10`，主金 `#c5a356`，亮金 `#e2c97e`
- 禁止 emoji、禁止冷色调
- 字体：Noto Serif SC（标题）+ Noto Sans SC（正文）
- 装饰符号：`◇ ◇ ◇`

### 写入决策

| 写什么 | 写哪里 | 谁批准 |
|--------|--------|--------|
| 代码产出 | `projects/<子项目>/output/` 或对应源目录 | 自主 |
| 经验/踩坑/状态更新 | `memory/` 对应文件 | 自主，发现就写 |
| 架构决策/方案选择 | 先向制作人提出选项 | 等确认后再执行 |
| 重要决策记录 | `memory/decisions.md` | 决策后立即写入 |

---

## 常用开发命令

```bash
# 新闻聚合器
pip install -r projects/news/requirements.txt
python projects/news/scripts/aggregator.py

# Wiki 本地预览
cd projects/wiki && npm install && npm run docs:dev
cd projects/wiki && npm run build     # 构建（注意：package.json 脚本名是 build，不是 docs:build）

# 黑池终端 Web（BPT-WEB，单文件 PWA，无构建）
cd projects/bpt-web && python -m http.server 8000

# 黑池终端 桌面（BPT-DESKTOP）
cd projects/bpt-desktop && npm install && npm run electron:dev

# 事实圣经校验
python assets/data/validate.py

# 银芯记忆系统（见上一节）
python scripts/memory_search.py "..."
```

---

## 自动化流水线（.github/workflows/）

| Workflow | 频率 | 功能 |
|----------|------|------|
| `update-news.yml` | 每日 06:00 / 16:00 UTC | 多平台社区新闻聚合 |
| `discord-archive.yml` | 每日 18:00 UTC | Discord 全量归档 |
| `deploy-site.yml` | push 触发 | 主站 + Wiki + News 部署到 gh-pages |
| `fetch-wiki-data.yml` | 每周一 | 抓取 Fandom/Bilibili Wiki 角色数据 |
| `check-version.yml` | 每周一 | 游戏版本更新检测 |
| `validate-data.yml` | push 触发 | 事实圣经 JSON Schema 校验 |
| `dream.yml`（浅睡） | 每 6 小时 | 结构检查 + 哨兵扫描 + 索引重建 |
| `dream.yml`（深睡） | 每日 19:00 UTC | Claude 趋势分析 + 知识缺口识别 |
| `dream.yml`（REM） | 每周一 01:00 UTC | Claude 周报 + 经验提炼 |
| `claude.yml` | Issue 触发 | Claude Code GitHub Actions 自动响应 |

部署流水线归 **Code-site 统一管理**，其他子项目不得创建独立 deploy workflow（见 lessons-learned #9）。

---

## 双系统架构

本仓库是 **银芯（BIAV-SC）**（公开层）。另有 **黑池（BIAV-BP）**（内部层，内网 SVN + Qoder）。

- 银芯：公开信息 + 方法论验证 — 你在这里
- 黑池：商业数据 + 未发布内容 — 内网运行
- **数据单向流动**：黑池 → 脱敏 → 银芯，绝不反向
- 银芯验证过的模式，黑池直接复用
- 如果你是黑池会话读取本仓库，见 BIAV-SC.md 底部"黑池数据同步接口"章节

---

## 会话角色

| 角色 | 职责 |
|------|------|
| claude.ai 战略参谋 | 分析、策划、文档交付 |
| Code-主控台 | 架构决策、协调、代码审查（不写业务代码） |
| Code-site | 主站 + 部署流水线 + 跨站视觉一致性 |
| Code-news | 社区聚合器 + 报告系统 |
| Code-wiki | 游戏数据集 + 多语言 Wiki |
| Code-game | 衍生游戏（Phase 4 启动） |

---

## 关键教训摘要（完整见 memory/lessons-learned.md）

AI 会话最易踩的坑：

1. **不要用 sed 批量替换 HTML/YAML** — 会破坏结构，用精确 Edit 替换。
2. **聚合器空跑必须非零退出** — 0 条数据不能覆盖历史文件。
3. **CONTEXT.md 必须同步实际状态** — 脱节会让新会话读到错误信息。
4. **部署流水线归 Code-site** — 不要在子项目里创建独立 deploy workflow。
5. **批量生成内容后必须跑构建验证** — 不要假设生成的内容是对的。
6. **VitePress 角色页 frontmatter 含冒号必须加引号**（如 `title: "Doll: Inferno"`）。
7. **VitePress img src 以 `/` 开头会被 Vue 编译器当 import** — 用 `:src="'/...'"` 动态绑定。
8. **Web 端 Claude Code 无外网** — 部署验证任务应在 PC 端 Claude Code 执行。
9. **公开 ID 直接硬编码，不要放 secrets** — 只有真正的密钥才放 secrets。
10. **Issue 不是跨会话通信手段** — 任务要点必须写进 CONTEXT.md。

---

## 技术栈

- 各子项目按需选型，不强制统一
- 后端：Python 3.11+
- Wiki：VitePress 1.6.4 + Vue 3.5.13，三语（EN/JA/ZH，ZH 为 root locale）
- BPT-WEB：单文件 PWA（原生 HTML + 内联 CSS/JS + Service Worker），无构建
- BPT-DESKTOP：Electron 33 + React 18 + Vite 6 + sql.js + MCP + electron-updater
- 部署：GitHub Pages + GitHub Actions（peaceiris/actions-gh-pages@v4 推 gh-pages 分支）

---

## 索引：何时读哪个文件

| 场景 | 文件 |
|------|------|
| 初次启动，全局快速就绪 | `memory/boot-snapshot.md` |
| 需要完整平台无关定义 | `BIAV-SC.md` |
| 查子项目当前任务和约束 | `projects/<子项目>/CONTEXT.md` |
| 查记忆系统设计 | `memory/advanced-memory-design.md` |
| 查做梦 Agent 三层架构 | `memory/dreaming-agent-design.md` |
| 查 Discord 归档器设计 | `memory/discord-archiver-design.md` |
| 查黑池系统设计 | `memory/black-pool-design.md` |
