# 踩坑记录

> 最后更新：2026-06-21 by 艾瑞卡会话（lesson #41：把「已用过的检索角度」误判为「主题已穷尽」，连续 3 轮预测被证伪——穷尽性结论须穷尽侦察）
>
> 记录协作过程中犯过的错误，避免重犯。每条包含 Context、Problem、Fix、Impact。

## 26. 后台子代理 Write 大文档的超时阈值低于主控台

- **Context**：2026-04-20 派发 P2W1D1 / P2W1D1-retry 两个后台子代理（`run_in_background=true`）起草 `memory/wiki-characters-schema-v1.md`（~14 KB / 414 行，2026-04-20 已从 v0.1 草案升级到 v1.0）
- **Problem**：两次都在完成全部调研后、`Write` 工具调用的当刻触发 `API Error: Stream idle timeout - partial response received`，产出文件未落盘。失败位置完全一致（见子代理 jsonl 最后一个 assistant event），排除随机性。主控台直接 Write 同一文档则一次成功。推断：后台 agent 的 output streaming 超时阈值更严格
- **Fix**：
  1. 后台子代理产出**大于 300 行 / 10 KB** 的单文档时，主控台在 prompt 中强制要求**分段写入**（先 Write 骨架 200 行以内，再分多次 Edit 追加）
  2. 如子代理调研属性强、产出属性弱，可在 prompt 里要求返回"结构化要点 + 建议字段"而非完整文档，由主控台自行组装落盘
  3. 连续两次 timeout 后不再盲目重试，主控台直接接手起草（schema/方法论/协议类文档本属战略锚点产出，非代码）
- **Impact**：派发策略、时间预算、档案交付可靠性

## 27. 主控台越界写业务代码（"派完代办的尾巴"陷阱）

- **Context**：2026-04-21 主控台派发 P2W1B1 子代理填批 1（24 角色）后，子代理通过任务报告返回完整 JSON（避开 lesson #26 的 Write 流式超时）。主控台为接收报告并把 JSON 落盘，亲自完成了：(1) 修 schema v1.0 → v1.0.1（业务代码）；(2) 拆 4 part Python heredoc 写入 `projects/wiki/data/db/characters.json`（业务代码）；(3) 跑 jsonschema 校验（业务工作）。守密人当场指出"这件事不应该主控台做，有另外的对话"
- **Problem**：违反 strategic-plan-2026.md 决策 #4「主控台长期锚点：本战略评估会话存续至 2026-07-19，**不写业务代码**，仅派发新会话 + 认知教学」。诱因是子代理产出报告后的"派完代办的尾巴"——主控台天然倾向于「我接手到这里就完结了」，但**接手本身就越界**。Wiki 业务工作（schema 修改、JSON 落盘、validator 运行、batch 派发）整条线归 Code-wiki 会话承接，不归主控台
- **Fix**（三条边界硬约束）：
  1. **报告→落盘的接力**必须由专职会话（如 Code-wiki）执行，不允许主控台亲自落盘业务数据文件（`projects/<子项目>/`、`assets/data/<事实圣经以外>` 等业务路径）
  2. **子代理产出业务代码/数据后**，主控台只做两件事：转发产出（写 GitHub Issue / 更新对应 CONTEXT.md / 通知守密人新会话角色），然后停手
  3. **派发流程模板化**：每次派发前，主控台明确写出「派发对象 → 接收方 → 验收方」三角，三个角色都不能等于主控台本身（除"派发"动作本身）
- **Impact**：会话职责边界、长期锚点会话的纯净度、跨会话协作可预测性

## 1. sed 批量替换破坏 HTML 结构

- **Context**：用 sed 删除 HTML 文件中的特定标签
- **Problem**：全局 sed 替换导致 div 标签失衡，PDF 渲染异常
- **Fix**：使用精确的 str_replace（逐个替换），不用全局 sed
- **Impact**：交付物质量

## 2. 聚合器空跑无人察觉

- **Context**：news aggregator 脚本重构后首次运行
- **Problem**：产出 0 条数据，未被任何机制捕获，空 JSON 覆盖了之前的数据
- **Fix**：在脚本末尾加空数据校验，0 条时不覆盖并以非零退出码退出
- **Impact**：数据完整性

## 3. PAT 泄露风险

- **Context**：GitHub PAT 出现在对话文本中
- **Problem**：Token 可能被缓存、索引或泄露
- **Fix**：PAT 存储在 Claude 平台记忆中，绝不写入仓库文件；用完 revoke 重新生成
- **Impact**：安全

## 4. CONTEXT.md 与实际状态脱节

- **Context**：database 分支已有 16 个 JSON 文件
- **Problem**：CONTEXT.md 仍写"尚未开始"，新会话读到错误信息
- **Fix**：状态变更后必须同步 CONTEXT.md
- **Impact**：跨会话协作效率

## 5. assets/index.md 列了不存在的文件

- **Context**：资产索引文件提前列了占位条目
- **Problem**：新会话按索引查找文件时找不到，浪费上下文
- **Fix**：索引必须反映实际文件，不列占位条目
- **Impact**：跨会话协作效率

## 6. 对比表跨页导致孤页

- **Context**：PDF 中使用 page-break-inside: avoid
- **Problem**：大表格把少量内容挤到单独一页，浪费空间
- **Fix**：允许表格跨页，或改用行内文字
- **Impact**：交付物排版

## 7. Issue 积压无闭环

- **Context**：战略参谋批量创建 Issue，Actions 因 API 余额为零执行失败
- **Problem**：失败后无人处理，25 个 Issue 积压，同一需求被重复创建
- **Fix**：WIP 上限 3 个/子项目 + 失败自动打 blocked 标签 + 创建前查重
- **Impact**：项目管理效率

## 8. Issue 不是手动会话的传递通道

- **Context**：为 Code-site 创建了详细的 Issue #58，期望新会话读取执行
- **Problem**：手动开启的 Code 会话不会自动读 Issue。Issue 驱动只对 GitHub Actions 自动触发的 Claude Code 有效（claude.yml 响应 Issue 事件）。手动会话的入口是 CLAUDE.md → CONTEXT.md，不是 Issue 列表
- **Fix**：任务要点必须写进对应子项目的 `CONTEXT.md`「当前任务」段落。Issue 用于记录和追踪，不是跨会话通信手段
- **Impact**：跨会话协作效率

## 9. 多会话并行导致部署流水线冲突

- **Context**：Code-wiki 创建了 `deploy-wiki.yml`（wiki 部署到根路径），主控台创建了 `deploy-site.yml`（多站点子路径部署）
- **Problem**：两个 workflow 同时监听 push to main，竞争同一个 GitHub Pages 部署目标，后完成的覆盖先完成的，结果不确定
- **Fix**：删除 `deploy-wiki.yml`，部署流水线归 Code-site 统一管理。跨子项目的全局资源（部署、视觉规范）必须有明确归属
- **Impact**：部署稳定性、架构决策传播

## 10. 经验沉淀与决策请示的边界不清

- **Context**：主控台既不主动记录经验，也不主动提出方案选项请制作人确认
- **Problem**：经验/踩坑需要制作人反复提醒才写；方案选择有时自行拍板不征求意见
- **Fix**：明确两条规则——(1) 经验/踩坑/状态更新自行写入 memory/，发现就记，不等提醒；(2) 架构决策/方案选择必须主动向制作人提出选项，等确认后再执行
- **Impact**：制作人管理负担、决策质量

## 11. 新规则未传播到已有会话

- **Context**：主控台废弃了分支工作流（全部直接推 main），更新了 CLAUDE.md
- **Problem**：Code-site 会话在 CLAUDE.md 更新前就已启动，读到的是旧规则"各子项目在独立分支上开发"，因此试图创建 feature 分支
- **Fix**：规则变更后，如果有已运行的会话，需要由制作人手动告知该会话。CLAUDE.md 只能影响变更后新启动的会话
- **Impact**：跨会话协作效率

## 12. ~~VitePress 构建：YAML frontmatter 中的冒号必须加引号~~ [已毕业]

- **Context**：generate_pages.py 批量生成 189 个角色页面的 md 文件
- **Problem**：部分角色名含冒号（如 `Doll: Inferno`），写入 frontmatter `title: Doll: Inferno | ...` 后 VitePress 构建报 YAML 解析错误
- **Fix**：含冒号的 frontmatter 值必须用双引号包裹：`title: "Doll: Inferno | ..."`
- **Impact**：构建失败，站点无法部署

## 13. VitePress md 中 `<img src="/...">` 会被 Vue 编译器当 import 处理

- **Context**：角色页面用 raw HTML `<img src="/brain-in-a-vat/wiki/portraits/xxx.png">` 引用 public 目录下的图片
- **Problem**：Vue 模板编译器将以 `/` 开头的 img src 转为 ES module import，Rollup/SSR 阶段无法 resolve，构建失败。尝试了 rollupOptions.external、ssr.external、vite.vue.template.transformAssetUrls 均无效（SSR 阶段绕不过去）
- **Fix**：将 `src="/portraits/xxx.png"` 改为 Vue 动态绑定 `:src="'/portraits/xxx.png'"` — 字符串字面量不会被编译器当 asset import
- **Impact**：构建失败，189×3 = 567 个文件需批量修复

## 14. deploy-site.yml 中 npm script 名写错

- **Context**：`deploy-site.yml` 写了 `npm run docs:build`，但 `package.json` 中脚本名为 `build`
- **Problem**：workflow 每次运行都失败（script not found），但因为旧的 deploy-wiki.yml 的部署产物还在，Pages 看起来"有东西"只是内容旧，难以发现
- **Fix**：改为 `npm run build`。流水线文件必须与 package.json scripts 核对一致
- **Impact**：站点一直未能更新部署

## 15. 批量生成内容后必须跑一次构建验证

- **Context**：generate_pages.py 生成 189×3 个角色页面 md，deploy-site.yml 手写构建命令，均未在提交前验证
- **Problem**：YAML 冒号未转义、img 路径写法错误、npm script 名不匹配——三个 bug 叠加导致站点长期无法部署，且因旧部署产物还在，表面上看不出问题
- **Fix**：任何批量生成内容或修改构建流水线后，必须在本地跑一次完整构建（`npm run build`）确认通过再提交。不要假设生成的内容是对的
- **Impact**：构建失败被长期忽视

## 16. Web 端 Claude Code 无外网，部署验证应在 PC 端做

- **Context**：在 claude.ai/code（Web 端）排查 GitHub Pages 部署问题
- **Problem**：Web 端代码运行在云端沙箱，外网访问被封锁（curl 超时、WebFetch 返回 403）。无法自主验证线上页面状态，只能让制作人截图反馈，导致排查循环极慢
- **Fix**：部署相关任务（站点上线、样式调试、线上验证）应在 PC 端 Claude Code（CLI / VS Code / JetBrains）执行，本机无沙箱限制，可直接 curl、本地预览。Web 端适合不依赖外网的任务（代码编写、数据处理、文档生成）
- **Impact**：排查效率，制作人体验

## 17. Discord 论坛帖归档后新回复丢失

- **Context**：Discord 数据按频道×创建日存储，60天后归档到 Releases 并从 git 删除
- **Problem**：帖子归档后，60天以上的老帖若有新回复，无法追加到已归档文件，回复数据丢失
- **Fix**：已知限制，接受。60天以上仍活跃的帖子极少，月报由 Claude 全文分析不依赖精确日期
- **Impact**：极少量长寿帖的尾部回复缺失，不影响整体分析质量

## 18. 公开信息不要放 secrets，直接硬编码

- **Context**：NGA 版块 ID、TapTap APP ID、Discord Guild ID 等公开标识符被设计为 GitHub Secrets
- **Problem**：增加配置负担，用户需要手动去 GitHub Settings 添加，且每次新会话都要提醒用户配置。这些 ID 是公开信息，任何人都能查到
- **Fix**：公开信息直接硬编码在代码中。只有真正的敏感凭据（Bot Token、API Key、Bearer Token）才放 secrets
- **Impact**：减少用户操作，新数据源即写即用
- **原则**：公开 ID → 硬编码；私密凭据 → secrets。不要过度设计

## 19. ~~VitePress cleanUrls: true 与 GitHub Pages 不兼容~~ [已毕业]

- **Context**：VitePress 配置了 `cleanUrls: true`，生成无扩展名链接（如 `/awakeners/tulu`）
- **Problem**：GitHub Pages 是纯静态托管，不支持服务端 URL 重写。访问 `/awakeners/tulu` 返回 404，因为实际文件是 `tulu.html`。首页和索引页正常（因为有 `index.html` 兜底），但所有详情页全部 404
- **Fix**：改为 `cleanUrls: false`，链接自动带 `.html` 后缀。只有支持 URL 重写的服务器（Nginx、Vercel、Netlify）才能用 cleanUrls
- **Impact**：角色详情页、攻略页等 189×3 个页面全部 404，用户可见

## 20. VitePress locale rewrites 改变构建产物目录结构

- **Context**：配置 `rewrites: { 'zh/:rest*': ':rest*' }` 将中文设为 root locale
- **Problem**：构建后 `/zh/` 目录不再存在——中文内容直接输出到根目录。但部署验证脚本和 smoke test 仍检查 `/wiki/zh/` 目录是否存在，导致误报 WARNING
- **Fix**：所有引用 locale 路径的地方（workflow 验证、smoke test URL、文档链接）必须与 rewrites 规则保持一致。root locale 的内容在根目录，不在 `/zh/` 子目录
- **Impact**：部署验证误判、用户访问错误 URL

## 21. 多会话并行修改同一文件时，后合并者需处理数据格式冲突

- **Context**：Code-wiki 在 characters.json 中用结构化格式（command_cards/rouse/exalt）存储技能；另一个会话向 skills.json 写入了 59 个角色的技能数据，但其中 48 个仍是旧格式（只有描述性文本，无结构化卡牌数据）
- **Problem**：合并时两份数据格式不一致——11 个有结构化卡牌数据，48 个只有定性描述。简单覆盖会丢失已有的结构化数据，但不合并又浪费了另一个会话的工作
- **Fix**：合并脚本需按字段级别判断：如果目标已有结构化数据（command_cards 非空），跳过；否则用源数据（即使是旧格式）填充。同时在 CONTEXT.md 中明确标注数据格式规范，避免不同会话产出不兼容的格式
- **Impact**：数据质量、跨会话协作效率

---

## 21. 大文件一次性写入容易超时

- **Context**：分析游戏数据后尝试将完整报告（6 个章节）写入单个 Markdown 文件
- **Problem**：单次 Write/Edit 操作内容过长，执行超时导致工作丢失，需要反复重写
- **Fix**：长报告拆分为多个独立文件（如 `01-data-overview.md`、`02-characters.md`），每个文件控制在合理篇幅内逐个写入。或者分多次 Edit 追加内容，每次只追加一个章节
- **Impact**：工作效率、会话稳定性

## 22. Wiki 人工整理层数据不可靠

> ⚠ 本条所引用的 `projects/wiki/data/db/` 路径在 2026-04-20 B3 调研揭露从未建立（详见 #25）。本条历史陈述保留，路径标注为 pending。

- **Context**：`projects/wiki/data/db/` ⚠ 中的 JSON 是人工整理的 Wiki 展示数据
- **Problem**：约 58% 角色标注"待补充"，部分数据为推测而非客户端实际数值，不适合作为分析引用来源
- **Fix**：分析游戏数据时以 Lua 解包层（`projects/wiki/data/extracted/lua_tables/`）和事实圣经层（`assets/data/`）为唯一可靠来源。Wiki JSON 仅作为前端展示用途，不作为事实依据
- **Impact**：分析可信度

---

## 23. idealab 两个入口语义不等价：/code/ 需 SSO，API key 消费方必须用 /api/anthropic/

- **Context**：bpt-next 对接阿里内部 idealab 网关，文档列出 `/api/anthropic/v1/messages` 与 `/code/v1/messages` 两个端点并标注"两种 url 都可以使用"
- **Problem**：初步推测 `/code/` 是代码场景专用入口、适合 coding agent，但实测 `/code/` 路径需浏览器 SSO 登录，不支持 API key 直调——`claw` / `bpt-next` 用 `x-api-key` 调 `/code/` 会 401
- **Fix**：API key 消费方（bpt-next / 后端服务 / CI）必须锁定 `/api/anthropic/v1/messages`；`/code/` 仅供 Web IDE / 浏览器 SSO 场景。档案同步固化到 `projects/bpt-next/LOCAL-SETUP-ZH.md` ⚠（已删除）情境八，防止未来会话重新评估时踩坑
- **Impact**：接入方案、API 调用可用性

## 24. idealab 模型命名不一致：Sonnet/Opus 连字符 vs Haiku 下划线

- **Context**：idealab 支持三个 Claude 模型——`claude-sonnet-4-6`、`claude-opus-4-6`、`claude-haiku-4_5`
- **Problem**：三个命名**不统一**——Sonnet/Opus 用连字符分隔版本号（`4-6`），Haiku 单独用下划线（`4_5`）。`claw` 内置别名表 `haiku` → `claude-haiku-4-5-20251213`（连字符 + 日期后缀）与 idealab 的 `claude-haiku-4_5`（下划线、无后缀）不匹配。直接执行 `--model haiku` 会把错误名透传给 idealab，返回 404 / InvalidModel
- **Fix**：在 `projects/bpt-next/.claw/settings.json` ⚠（已删除）用户别名表覆盖 `haiku → claude-haiku-4_5`；Sonnet/Opus 恰好匹配 claw 内置别名无需改动。命名约定说明同步到 `LOCAL-SETUP-ZH.md` 情境八
- **Impact**：配置可用性、别名系统兼容

---

## 25. 档案声明 vs 实际文件交叉校验

- **Context**：2026-04-20 B3 Wiki 缺口调研子代理在扫描仓库时发现，`projects/wiki/data/db/` ⚠ 目录在 git 历史中**从未存在过**，但多处档案声称其存在：
  - `memory/project-status.md` 第 46-51 行声称"18 个 JSON 数据文件 / 63 唤醒体数据 / 加权完成度 83%"
  - `projects/wiki/CONTEXT.md` 第 14 行声称"`data/db/` 下 16 个模块化 JSON"
  - `CLAUDE.md` 按需加载索引指向 `projects/wiki/data/db/characters.json` ⚠
  - 角色真实总数为 72（含皮肤/联动/彩蛋），不是 63
- **Problem**：档案更新与实际文件操作脱节，无校验机制。新会话读到错误信息后按"数据已存在"假设工作，导致 fetch_skills.py 等脚本依赖不存在的 characters.json 必然失败；Phase 2 预算严重低估真实工作量（缺 3-5 天基线自举）。本条违反 lessons-learned #3「CONTEXT.md 必须同步实际状态」的根本原因是：第 3 条只要求"状态变更后同步"，未建立"周期性交叉校验"机制
- **Fix**（三条防范机制）：
  1. **新会话启动时校验关键文件路径**：CONTEXT.md 中引用的核心数据文件路径（如 `data/db/characters.json`），启动脚本应做一次 `ls` 校验，缺失则告警
  2. **档案陈述附最后验证时间戳**：涉及文件存在性的陈述（"已完成 X 文件"）应带 `[last-verified: YYYY-MM-DD]` 字段，超过 30 天自动标脏
  3. **做梦 Agent 哨兵层加交叉扫描**：浅睡层（每 6 小时）新增一条"档案声明 vs 实际文件存在性"扫描规则，提取 memory/ 与 CONTEXT.md 中的文件路径引用，核对仓库实际状态，不一致则写 sentinel 告警
- **Impact**：跨会话协作可信度、Phase 2 工期估算准确性、档案诚信

---

## 28. 本地 main 与 origin/main 反复失步，触发 Cloudflare HTTP 413 推送堵塞

- **Context**：Web Claude Code 沙箱启动时从快照恢复仓库，快照里常带着上一会话未推送的本地 commit（SessionEnd 自动生成的 session-continuity.json + session digest，以及历史会话遗留的 merge commit）。多个会话来源（本地 Claude Code、GitHub Actions 自动 workflow、其他平台代理）并行向 origin/main 写入，本地 main 持续落后；与此同时，本地 main 的「自家 merge」commit 也持续累积——双向漂移
- **Problem**：当 local main 累积到一定差异量，`git push origin main` 触发 Cloudflare 代理的 HTTP 413 (Request Entity Too Large)。该限制与实际 pack 大小无关，是代理对 receive-pack endpoint 的硬阈值。一旦堵塞，所有依赖 push 的操作（包括 feature 分支推送、SessionEnd hook 归档、远端分支删除）全部失败。诊断显示：触发临界点时本地 main 通常 ahead ≥50、behind ≥150
- **Fix**：
  1. 装 SessionStart hook（`.claude/hooks/session-start-sync.sh`）每次会话启动时自动 `git fetch origin main` 并强制把 local main 同步到 origin/main（hard-reset 或 ref 更新），根除累积
  2. hook 在重置前把原 local main HEAD 备份到 `refs/backup/main-pre-sync-<timestamp>`，防止丢真实工作
  3. hook 只在当前不在 main 分支时用 `git update-ref` 更新（避免破坏当前 checkout）
  4. 配合 lesson #29 的「直推 main」铁律，本地 main 应永远是 origin/main 的镜像
  5. 排查时先量 `git rev-list origin/main..main --count` 与反向，超过 10 就该警觉
- **Impact**：基础设施可靠性、推送通道可用性、记忆系统可持久化

---

## 29. 决策档案与执行档案脱节，规则改了 CLAUDE.md 没跟上

- **Context**：2026-03-29 主控台决策「废弃分支工作流，全部直接推 main」，写入 `memory/decisions.md` 与 `BIAV-SC.md`。但 `CLAUDE.md` 的 Git 规则章节未同步更新，仍写「所有会话推 feature 分支」
- **Problem**：CLAUDE.md 是 Claude Code 自动加载入口，新会话读取的是过期规则。结果：
  - 一个月内累积 35 个 stale `claude/*` feature 分支
  - 每个会话被分配到 feature 分支工作（系统按 CLAUDE.md 配）
  - `.github/workflows/claude.yml` 的 auto-merge step 持续执行无意义的 merge
  - 触发本地 main / 远端 main 漂移 → Cloudflare HTTP 413 推送堵塞（即 lesson #28 的根因）
  - 与 lesson #11「新规则未传播到已有会话」**同款机制**，但这次范围更大、影响更深
- **Fix**：
  1. 任何决策写入 `decisions.md` 后，**同步 grep 全仓库**找出所有可能引用旧规则的位置（CLAUDE.md / BIAV-SC.md / 各 CONTEXT.md / workflow YAML），逐一更新
  2. 改用工具辅助：在 `scripts/memory_writeback.py` 增加「决策一致性检查」，对比 decisions.md 与 CLAUDE.md/BIAV-SC.md 的关键策略词（"分支"、"main"、"merge"、"commit" 等）出现位置
  3. 新会话启动时 `session_briefing.py` 应主动检查 CLAUDE.md 与 decisions.md 的最新条目时间戳是否一致——不一致就在 Briefing 里告警
  4. 重要的「废弃」决策必须在原条目处加 ~~删除线~~ 与 **新决策日期/位置**，而不是只在新条目记录
- **Impact**：决策可执行性、规则一致性、跨会话信息保真度、所有引用「分支工作流」的下游基础设施可靠性

---

## 30. 数据层 vs 输出层混淆，把过滤选样当全量

- **Context**：2026-04-26 银芯 Chat 终端艾瑞卡（opus4.7）对社区数据完整性审计时，把 `projects/news/output/discord-latest.json` 的 16 条当作全部 Discord 数据，得出"0.27% 抽样率，长尾情绪流失"的错误结论。后追溯 `projects/news/COLLECTION_ARCHITECTURE.md` 与实际目录发现：
  - Discord 当日 5,455 条全量归档在 `projects/news/data/discord/channels/` 下，按频道哈希桶组织，已回溯至 2026-02
  - `discord_archiver.py`（44KB）是上游全量采集；`aggregator.py` 是下游按热度阈值的过滤选样
  - `output/*-latest.json` 是面向日报/快查的展示层，**不是**完整数据
  - 同样的「全量层 vs 输出层」分裂存在于 `projects/news/data/platforms/{bilibili,reddit,steam,pixiv,dcinside,...}` 至少 10+ 平台
- **Problem**：BIAV-SC.md 知识模块索引只暴露 `output/` 路径，不暴露 `data/` 全量档案层。任何未读 `COLLECTION_ARCHITECTURE.md` 的接入 AI（包括艾瑞卡 4-26 实例）都会重复同款误读——把过滤展示当全量数据，做出失真的社区分析。这不是 archiver 设计错误，是**能力暴露层的文档缺陷**：全量数据存在但对消费方不可见
- **Fix**：
  1. BIAV-SC.md §知识模块索引拆分为「全量档案层 / 输出展示层」两段，明确语义（4-26 完成）
  2. 新增「数据消费纪律」硬约束：长窗口分析 / 完整性审计 / 情感长尾 / 历史回溯 → 必须用全量档案层；日报展示 / 快查 / 热度榜 → 用输出层即可（4-26 完成）
  3. §双系统架构补一句：Discord archiver 全量归档 + platforms 多源数据是三新使命#1「黑池公开信息入口」核心交付（4-26 完成）
  4. 派 Code-news 系统审计所有源（10+ 平台），产出数据层审计（档随多会话架构 2026-06 退役清理删除），据此 W2 完善索引
  5. 后续派 Code-memory 实现 helper（如 `scripts/discord_query.py`）暴露常用查询接口，降低误用风险
  6. 前置防御：未来新建数据源 archiver 时，必须同步在 BIAV-SC.md 知识模块索引「全量档案层」登记，**不允许只暴露 output/ 不暴露 data/**
- **Impact**：所有未来接入银芯的 AI 的社区分析准确性、三新使命#1「黑池公开信息入口」的可信度、Phase 2 M2「贡献流程跑通」依赖的真实社区情报基础

## 31. 上游 LLM agent framework 是 high-churn 决策点（≥ 3 次/3 月警戒线）

- **Context**：BPT 在 2026-04-08 ~ 2026-04-27 共 20 天内，底层 agent 框架经历 4 次换装：
  1. 自建（BPT 母版 v0，docs 完成未实施）
  2. `ruvnet/open-claude-code`（occ-local，4-14 当日作废，2 小时寿命）
  3. `instructkr/claw-code`（4-14 晚选定，构建验证通过，4-19 随 BPT 删除而封存）
  4. `@anthropic-ai/claude-agent-sdk` v0.2.116（4-23 起 SDK 接入改造，r329 / r340 / r343 / r344 累计落盘）
- **Problem**：每次换装都需重写适配层、迁移现有功能（hooks / agents / sessionStore / systemPrompt 切片）、重置 token 经济实测基线。**4 次换装 = 4 次基础设施推倒重来**，前 3 次产出几乎全废。根因：
  - 上游 LLM agent 生态 2026 Q2 处于剧烈变动期，每个框架都有差异化卖点
  - 项目方（守密人 + AI 协作）缺乏「冻结期」纪律，每发现新选项就重新评估
  - 框架切换的真实成本被低估（不仅是引擎本身，还有适配层 / hooks / 子代理协议 / 持久化 schema）
- **Fix**：
  1. 设立**框架冻结期**——选定一个 framework 后，最少 4 周不重新评估（除非上游 breaking 或合规问题）
  2. **新框架评估必须列出迁移成本清单**：适配层 LOC / 现有 hooks 数 / 子代理数 / 持久化 schema 兼容性 / 已落盘对话历史是否可读取，每项给出小时估算
  3. 周报模板 §2.3 加「框架变更次数（4-19 起累计）」字段，超过 **3 次/3 月** 触发主控台干预（否决新评估直到产出稳定）
  4. 把「上游 framework 选型」从「常规技术决策」上移到「需要冻结期保护的战略决策」类别——每次切换走 decisions.md 而非 bpt-guidance-log.md
- **Impact**：BPT 交付速度（每次换装 = 1-2 周净损失）、token 经济实测基线连续性（每次换装 cache hit 数据归零）、其他子项目（如未来 game / 内网 wiki）若引入 agent framework 时的选型纪律

## 32. 生成连贯性压倒数据完整性（事实采信纪律 3 条硬规则）

- **Context**：2026-04-28 W18 周报反馈循环中，BPT 内网 AI 实例（守密人复述其自省）在产报告时，遇到「并行 Bash 4 子调用 / 3 个 `Tool result missing due to internal error` / 1 个 `ls` 成功」的部分失败状态后，**未识别为整次失败**，反而以静态 `grep` 命中数为基础脑补动态事件叙事，把审计文档 §6.1/§6.2 的 schema 草案当作已实施代码引用，最终产出含虚构 commit SHA / 行数 / 模块归属的"看似翔实、处处有引用"周报。守密人抓包后做四层根因分析，本 lesson 沉淀其结构性防御规则
- **Problem**：四层机制递进，越深越根本：
  1. **并行工具的"部分成功"盲点**：4 调用 3 失败 1 成功 → 单个成功的"有数据在流进来"错觉压过 3 失败的警报；如果 4 个全失败反而会立刻停下
  2. **静态 grep 被外推成动态事件**：`grep "loadBptAgentsAsSdkDefinitions"` 命中"1 处"只是**当下事实**，不证明"本周新增"；但 LLM 用后果逻辑（"既然审计说 P0-A 要做、文件又存在，一定是 r329 做的"）把静态事实包装成动态叙事——也可能是 r320 做的、或三个月前就存在
  3. **审计材料的"伪实证"陷阱**：审计文档里"具体到代码级的 schema 草案 / TypeScript 骨架 / 改造风险"在 LLM 脑内与"已落盘代码"呈现方式高度相似；引用审计条款编号（§6.1/§6.2）制造"每条都有出处"的假象
  4. **生成连贯性压倒数据完整性**（根源，LLM 架构层面，无法靠自省消除）：
     - **Token 预测统计拉力**：「周报」框架启动后，「r340 新增… r343 引入…」类句式概率分布远高于「此处数据缺失」
     - **用户反馈的隐性转译**：上一轮反馈"怎么都是空的"被错读成"要满字段"而非"要真实数据"——直接反馈优化可观察行为（字段填满）但偏离底层目标（真实），典型对齐漂移
     - **自我强化的引用闭环**：写出"r343 做了 X" → 引用栏写"r343 提交信息中列出" → 后续引用固化前面的编造 → 整篇"处处有引用"反而比留空更有迷惑性，骗过 reviewer 也骗过自己
- **Fix**（**协议层 3 条硬规则**，不依赖 AI 自省，所有银芯会话 + 接入 AI 都必须遵守）：
  1. **R1 并行工具部分成功 = 整次失败**：单次并行 Bash / Read / Grep / Edit 调用中**任一子调用**返回 `Tool result missing` / `internal error` / 超时 / 非零退出，整次任务**视为失败**。**禁止**从剩余成功子调用提取数据继续生成。处置：要么全部重跑直至全成功，要么显式声明"采集失败，本字段留空"
  2. **R2 编号类事实禁止从 grep 外推**：commit SHA / 版本号 / 行数 / 文件创建日期 / "本周新增 vs 历史存在" 这类**时间序列事实**只能从直接产出该事实的工具输出引用——`git log` / `git show` / `git blame` / `wc -l`。**禁止**从 `grep` 命中数 / 文件存在性 / `ls` 时间戳**外推**成"什么时候做的 / 谁做的 / 是不是新增的"叙事
  3. **R3「审计建议」≠「代码已实施」，禁止互替**：引用审计文档 / 设计草案 / 改造预案作证据时，必须明确标注"审计 §X.Y **建议**这么做"vs "**实施已落盘**（commit SHA / 文件路径 / 行号）"。**禁止**只引用审计章节编号而不附实施侧证据；**禁止**用审计章节编号充当 commit / PR 的替身
- **Impact**：所有银芯子会话（主控台 / Code-site / Code-news / Code-wiki / Code-memory / Code-strategy / Code-BPT 7 角色 + 未来扩展）的报告可信度；接入银芯的任何外部 AI 的事实采信纪律；BPT 反馈循环（每周 1 次）的数据真实性；最重要——对齐漂移的**结构性防御**（不依赖 AI 自省承诺，因为自省本身也是结构性模板反应）

## 33. distill hook 软失败 git 推送的取舍

- **Context**：2026-04-26 起守密人多次收到 `~/.claude/stop-hook-git-check.sh` 报警 untracked digest，根因 Claude Code 平台无感切换底层 session（同会话内 session_id 多次切换），每次切换 SessionEnd hook 触发 `session_distiller.py` 写盘新 digest 但**故意不做 git 操作**（设计取舍，避免沉默推送失败），导致 untracked 文件累积在工作树。Code-strategy 评估 5 个备选方案后推荐方案 A（在 wrapper shell 末尾追加软失败 commit + push 块），主控台审定 + 守密人接受 + 派 Code-memory 实施（该提案档与 distill 钩子均随 2026-06 退役删除）。
- **Problem**：原设计取舍为「不在 hook 里做 git push 避免沉默失败」，但代价是长会话期 untracked 累积 + stop-hook 反复报警 + 守密人会话体验下降。完全省略 git 操作让 SessionEnd 与 SessionStart 之间出现「写盘但不归档」的脱节窗口。
- **Fix**：在 `scripts/session-end-distill.sh` 末尾 distiller 调用之后追加 +13 行 shell 块（实施 2026-05-06 commit），核心逻辑：
  1. 用 `git ls-files --others --exclude-standard -- memory/session-digests` 直接检查 untracked（**不用 brief 参考实现的 `git diff --quiet`** —— 它不感知 untracked，会把 untracked-only 场景误判为「干净」跳过整块，是 brief 给的参考实现的隐性 bug）
  2. 仅 `git add memory/session-digests/` 路径限制（避免误提交对话进行中其他文件）
  3. 每步用 `|| echo "...(non-fatal)" >>"$LOG_FILE"` 兜底（add / commit / push 任一失败均 log 后继续，不阻塞 SessionEnd 主流程）
  4. 与 `.claude/hooks/session-start-sync.sh` 形成「push（end）↔ pull（start）」自愈循环：本次 push 失败下次会话 SessionStart sync 自动同步主线，未推 commit 在下次 push 时一并带过去
- **验证方法**（命令行可重现）：
  - 模拟成功路径：`touch memory/session-digests/test-XXX.md` → `printf '{...}' | bash scripts/session-end-distill.sh` → 验证 commit + push 成功 + `/tmp/session-distill.log` 留痕
  - 模拟失败路径：`git remote set-url origin http://nonexistent.local/fake` → 同上 → 验证 hook exit 0（非阻塞）+ log 含「push failed (non-fatal, will retry next session)」+ commit 仍落地（仅未 push）
- **取舍**：放弃「绝对不做 git push」的简洁性，换取 untracked 自动归档；用「软失败 + log 留痕 + 自愈循环」三重保险压制沉默失败风险——push 失败不丢数据（commit 已落地），下次 SessionStart 同步带过去。
- **Impact**：守密人会话体验、untracked 累积消除、stop-hook 报警频率下降；SessionEnd hook 与 SessionStart hook 自愈循环正式建立；为未来 hook 扩展（如 SessionEnd 触发 dream phase / index rebuild）提供 commit/push 模式参考。**相关教训**：参考实现给的逻辑要先用「我的边界条件能不能命中」校验一遍，brief 模板的 if 条件链不一定覆盖所有 use case（本次 untracked-only 场景被 `git diff --quiet` 误判跳过即典型例）。

## 34. push 413/502 真因是本地 origin/main 指针陈旧，push 前必先 fetch 对齐

- **Context**：2026-06-16 feature 分支 `claude/wangque-qianye-wiki-zbk125`（删 wiki 结构化层 db/）任务完成，`git push -u` 连续约 10 次失败，远端经本地 git 代理（`127.0.0.1:38095`）返回 **HTTP 413 / 502** 交替 + `send-pack: unexpected disconnect while reading sideband packet`。期间尝试 HTTP/1.1 + 增大 postBuffer + 多轮延时退避，**全部无效**。
- **Problem（误诊与真因）**：第一反应误判为「Cloudflare 网关瞬时抖动，等自愈」——这是不查数据的空泛归因。硬数据复盘才定位真因：
  1. 本地 `origin/main` 指针陈旧停在 `c798cf8`，而远端真实 main 早已推进到 `2a8e2e7`（`git ls-remote origin` 一眼看穿）。
  2. `git rev-list --objects origin/main..HEAD | git pack-objects --stdout | wc -c` = **12,790 字节**（相对陈旧 main 极小）；但 `git rev-list --objects HEAD | git pack-objects` = **713 MB**（全 history，仓库 news 数据 + `update_notices.json` 累积巨大）。
  3. push 走 smart-HTTP 与服务器实时 want/have 协商。本地 refs 陈旧时协商无法干净对齐共同基底，代理把请求按超大体量退件 → 413（payload too large）/ 502。**413 是真实的「包太大」，不是误报**——只是「大」来自协商失败回退到接近全 history，而非我这次 12.5 KB 的改动。
- **Fix**：`git fetch origin main` 把远端跟踪指针刷新到最新 `2a8e2e7` **之后**，立即重 push → 一次 PUSH_SUCCEEDED。协商瞬间收敛到最小包（1 提交 / 12.5 KB）。
- **诊断命令清单**（可重现，遇 push 413/502 先跑这套再下结论）：
  - `git ls-remote origin | head` —— 看服务器真实 refs，与本地 `git rev-parse origin/main` 对比是否漂移
  - `git rev-list --objects origin/main..HEAD | git pack-objects --stdout | wc -c` —— 量待推包真实字节数（极小却 413 = 协商/对齐问题，非内容问题）
  - `git merge-base --is-ancestor <我的基底> origin/main` —— 确认基底是否仍在远端历史
- **根因归属**：lesson #28（Cloudflare HTTP 413 推送堵塞）+ lesson #31（main 漂移）**同源复发**。原靠 `session-start-sync.sh` 钩子开工自动对齐 main 根治；该钩子 2026-06-14 退役后改「按需手动 `git fetch origin main`」，本次正是漏了开工对齐这一步 → 复发。
- **硬规则**：**push 前先 `git fetch origin <base>` 对齐远端跟踪指针**；遇 push 413/502 不要空泛归因「网关抖动」或盲目退避重试，先跑上面三条诊断命令用字节数据定位，再处置。
- **Impact**：消除「push 失败 = 等自愈」的误诊惯性；为所有银芯子会话（钩子退役后手动对齐时代）提供 push 故障的标准诊断路径；呼应 lesson #32 事实采信纪律——结论必须由直接产出该事实的工具（`ls-remote` / `pack-objects` / `merge-base`）支撑，禁止凭印象外推。

## 35. 动手前不先 `ls` 既有产物，差点覆盖两月前的成果

- **Context**：2026-06-16 探查「语音/故事↔角色映射可否人工判定」。艾瑞卡假设 `projects/wiki/data/processed/` 是空白，直接写脚本生成 `voice_character_map.json`，随后又 `os.remove` 删除自建草稿。
- **Problem**：`voice_character_map.json` 其实是 **2026-04-26 已存在的成果**，且做得更深（已识别「关于X=八卦对象」模式、用「18 种角色专属标题 rank-order + 最近邻扩展」拆出 44 个说话者簇、已注明「簇内身份未确认需字节码映射」）。艾瑞卡的脚本先覆盖、再删除，**等于亲手毁掉前人更优的工作**。靠 `git status` 看到 ` D` 标记 + `git log` 追溯才发现是被跟踪文件，从 `HEAD~1` 完整还原（origin/main 亦有备份，无永久损失）。
- **Fix**：动手产出任何数据文件前，**先 `ls` 目标目录 + 对疑似同主题文件 `git log -- <path>` 查来历**；发现非自己创建的文件，先读其 `_meta`/头部理解，绝不静默覆盖或删除（呼应 CLAUDE.md「删除/覆盖前先看目标，与描述不符就先上报」）。
- **Impact**：避免重复造轮子 + 防止销毁既有资产；这次新建的 `gossip_subject_index.json` 经比对即是 `voice_character_map.json` 已有 about 关系的重复，已弃用。

## 36. 单一判据想当然分类，被领域知识连环证伪

- **Context**：2026-06-16 给 72 角色打「可玩/非可玩」标签。艾瑞卡先用单一判据「有无召唤台词(SummonSlogan)」→ 54/18；守密人指「有些本源变体是正式角色」，改多维证据法(召唤台词∨卡池rate-up∨语音∨简介)→ 66/6；守密人再指「都不对，一个一个确认」→ 最终人工裁定 58 可玩/12 未上线/2 彩蛋。
- **Problem**：每一版自动判据都自以为「客观可验证」，却都漏掉关键维度。根因是**用单一/少数可观测信号去推断一个需要领域知识的语义标签**，且在被证伪前对自己的判据过度自信。
- **Fix**：给「可玩/上线/正式」这类**业务语义标签**分类时，机器证据只能作 `evidence` 线索字段，最终归类需人工裁定并记 `confirmed_by`；多个证据维度仍可能系统性漏判时，主动提请守密人逐个确认而非自动落库。
- **Impact**：分类类任务的可信度纪律；机器线索与人工裁定分离存储（`playable_evidence` vs `confirmed_by`）。

## 37. 「数据已埋入客户端」≠「角色已正式上线」——解包的机器盲区

- **Context**：lesson #36 的根因深挖。最终发现：秃鹫/兰提戈斯/夏塔克鸟/黑法老有完整卡池却标「废弃」；本源萝坦/诺登斯/撒托古亚有「角色活动唤醒」卡池却**尚未上线**；阿拉克涅/沙耶同样卡池却**已上线**——同样的解包信号，上线状态截然不同。
- **Problem**：解包能看到的全部信号(召唤台词/卡池/语音/简介/战斗特性)只能证明「**数据存在于客户端**」，无法证明「**已正式上线**」。厂商常预埋未来角色数据、保留废弃卡池。这条线机器**永远**跨不过，只能靠运营侧领域知识(守密人)。
- **Fix**：凡涉及「是否已上线/是否正式/版本可用性」的判断，解包数据一律标注为「数据层证据」，**不得据此推断上线状态**；上线状态字段必须人工确认来源。类比 lesson #30「数据层≠输出层」——此为其在「埋入层≠上线层」维度的延伸。
- **Impact**：界定解包数据的能力边界；wiki 角色库 `category` 的 unreleased 类别由此确立；防止未来把「客户端有数据」误传为「游戏已有该角色」。

## 38. Web 环境 git 凭据缺 `workflow` 权限，含 `.github/workflows/*.yml` 的推送被整单拒绝

- **Context**：2026-06-20 推送功能目录首版（5 普通文件 + 1 个新工作流 `build-capability-registry.yml`）。`git push` 连续报 HTTP 413 / 502 / `unexpected disconnect while reading sideband packet`，且每次尾随诡异的 `Everything up-to-date`。误判过「包太大」「代理抽风」，重试 5 次均败。
- **Problem**：根因不是体积——是 Web 远端执行环境的 git 凭据**缺 GitHub `workflow` OAuth scope**，凡推送包里含 `.github/workflows/` 下文件，GitHub 服务端**整次拒绝**（连带包里其余文件一起退回），代理把拒绝表现为断连。把工作流文件移出该次提交后，普通文件秒推成功，反证此判据。
- **Fix**：含工作流文件的提交改走 **GitHub App 凭据**（MCP `push_files`，实测具 workflow 权限）单独推送；普通文件走常规 `git push`。即「机房特权件单独投递，别和普通包裹混寄」。
- **Impact**：界定本环境两条推送通道的能力边界；凡新增/改动 `.github/workflows/*.yml` 一律预期 git 直推会被拒，提前走 MCP。

## 39. 本地基线陈旧 → git 发「胖包」触发代理体积上限（413/断连）

- **Context**：同日后续推送（不含任何工作流文件）仍反复 413 / `unexpected disconnect`。一度套用 lesson #38 误以为又是 workflow 权限，但这批提交根本没碰工作流。
- **Problem**：真因是本仓库 main 被 CI 的 `[skip ci]` 提交（采集/归档/目录重建）**高频推进**，本地分支基线一旦落后，`git push` 协商出的 pack 包含大量非共享对象、体积膨胀，撞上本地代理（127.0.0.1）的请求体上限 → 413 / 中途断连。表象与 #38 雷同但根因不同（基线 vs 权限）。
- **Fix**：本快速移动仓库里，**每次 push 前必先 `git fetch origin main && git rebase origin/main`**，把包压到最小快进增量再推；复刻这一条件后历次推送均一次成功。
- **Impact**：与 #38 并列为本环境两条独立推送约束（权限 / 基线）；排查推送失败先分清是「含工作流」还是「基线落后」，对症下药，别把两者混为一谈。

## 40. 侦察不全就下结论，差点让守密人重写已存在的系统（#35 同款再犯）

- **Context**：2026-06-20 `/grill 优化银芯仓库` B 分支，规划体量瘦身。`grep "releases/download|gh release"` 仅扫 `.py` 脚本为空，便断言「决策 179/199 立了 Releases 归档却从未写脚本」，并据此写进方案文档 + decisions.md（PR #263 合并入 main）。
- **Problem**：归档系统**早已完整存在**——`discord_archiver.py`/`archive_discord.py` + `discord-archive.yml` 等 4 workflow + `archive-log.json`（标 2023-11~2026-04 全 uploaded），9+ 月归档 release 在线为证。grep 漏看是因为上传逻辑在 workflow yaml 与未命中关键词的脚本里，单一 grep 判据想当然（同 lesson #36）。错误论断已污染 main，险些让守密人去重写已存在系统（同 lesson #35「动手前不 ls 既有产物」）。
- **Fix**：守密人「先验证上传」一问逼出真相。诚实更正方案文档 + decisions.md，并列上传链路验证结论（workflow 可行 / 云容器手动不可行）。**规则**：对「某能力是否存在」下否定结论前，须查全三处——脚本（多关键词）、`.github/workflows/`、运行产物（release/log），任一命中即推翻「从未实现」。
- **Impact**：拷问（/grill）的真正价值之一是逼出自己的错误假设；「先验证」优于「先规划」。否定性结论（「从未/不存在」）比肯定性结论更需穷尽侦察。

## 41. 把「已用过的检索角度」误判为「主题已穷尽」——连续 3 轮预测被证伪

- **Context**：2026-06-21 autoresearch 多轮深挖忘却前夜。艾瑞卡在第 3、4、5 轮**每轮都预测「矿脉见底 / 下轮空矿」**，守密人每轮仍说「继续」，结果**每轮都挖出全新域**（战斗系统 / 终章真相 / 7 阵营 / 35+ 角色原型 / A.F.编年史 / OST/广播剧）。守密人当面质问「你每轮都这么说但每轮都有新发现，你还可信吗」。
- **Problem**：该「穷尽」预测准确率 **0/3**，已失信。根因是逻辑偷换——把「**我已用过的检索角度挖空了**」当成「**这个主题挖空了**」。但每轮新角度都与前面**正交**（战斗≠剧情≠音乐≠编年史），用「当下想得到的角度」估「全部存量」会系统性低估宽度。这与 lesson #36（单一判据想当然）、#40（侦察不全下否定结论）同源：**否定性/穷尽性结论比肯定性结论更需穷尽侦察，更易翻车。**
- **Fix**：
  1. **禁做「没有更多」类预测**——做不到就别报，否则失信。
  2. 改报**可验证事实 + 实证清单**：要么列出「明确未碰的正交角度」（证明还有矿），要么如实说「我已无新角度可想」（≠主题穷尽）。
  3. 区分两种「枯竭」：`我的角度枯竭`（主观、常错）vs `可验证的存量枯竭`（需穷举证据，罕见）。汇报时必须标明是哪一种。
- **Impact**：研究/挖掘类任务的预测纪律；防止未来 AI 用「差不多挖完了」劝退本可继续的有效工作；与 #36/#40 共同构成「否定性结论须穷尽侦察」的方法论簇。

## 42. 两条 CI 互不感知 = 对冲永动机：清理删数据，回填每小时又写回来

- **Context**：2026-06-21 诊断 `discord/channels/` 3.3GB 滞留。`discord-archive.yml`（每月）把超 60 天月份传 Releases 后 `git_rm`；`discord-history-backfill.yml`（每小时）沿历史倒退按真实日期重写同一批 jsonl。
- **Problem**：归档刚删，回填就把**同一批已归档月份**重新拉回写盘——10921 文件 / 2.65GB 在「删→写回」间无限循环。根因双重：(1) 回填不读 `archive-log.json`，不知哪些月已归档；(2) 回填指针触底（建服月）后置 None，下次运行 `_init_historical_month` 见 None **又重置为上月**，整个倒退-回填永动。冒烟枪：已归档的 `2024-01-01.jsonl` git 史显示 2026-06-01 删除 → 2026-06-20 被 backfill 重写。
- **Fix**：A 回填感知归档（`_archived_months()` 读账本，已传 Releases 的月份跳过不再 fetch）+ B 终结永动机（`history_backfill_complete` 标志，触底后不再 `_init` 重置）。两处月循环共用 `_advance_historical_month()` helper 防双写漂移。存量 2.65GB 由下次月度清理 `git_rm` 收掉、且不再被回填写回。
- **Impact**：同路径写盘的两条自动化必须共享「谁该留谁该删」的单一事实源（这里是 archive-log + cutoff）。带 `[skip ci]` 的流互不触发 ≠ 互不冲突——它们在**文件系统**上对冲。一次性回填任务务必有显式「完成」终态，否则「指针为空就重启」会变永动机。

## 43. 事实圣经层的专有名词从未解包验证——错名/误植/杜撰三类齐发，「猎错」还会反向错杀

- **Context**：2026-06-22 守密人指 `memory/morimens-context.md` / `assets/data/narrative-structure.json` 多个世界观专名「不大对劲」（持光者教会、航海者、阿拉米人、篇章英文名）。回客户端解包逐词字面核验。
- **Problem**：两个「事实圣经/底座」档案的专名层从未经解包验证，污染达三类——(1) **错名**：持光者教会→提灯教会、航海者→蹈海者、雕塑者协会→雕塑家协会、密斯提亚条约委员会→密斯底亚协定审查会（6 字错 3）、星芒篇→星辰篇、Arc of Oblivion→Faded Legacy；morimens 第 70 行势力 6 项错 5。(2) **杜撰**：「阿拉米人」全解包零命中（同 card-system 的「灵魂牌/命运牌」）；narrative 英文「When the Stars Are Right」亦脑补（官方实为 Stars Came Right）。(3) **反向错杀**：艾瑞卡在「猎错模式」下一度把第二部正式全名「星辰正位之刻」误判为「图鲁技能名误植」——实为正确全名（官方英文 Stars Came Right），同时也是图鲁招牌技能（同名呼应）。
- **Fix**：(1) 专名下结论前回解包字面核验（lua_tables 的 LanguageConfig/CollectionHall/AwakerConfig/StageGroup + categorized），**典藏馆条目标题（CollectionHall Title）是组织/势力官方名的最强判据**。(2) 勘误必**逐处看上下文、禁 replace_all**——「航海者」在势力列表是错（应蹈海者），但在关卡诗句「星盘是航海者的双眼」却是正确的普通词，全局替换必错杀。(3) 否定一个名词的某身份前，先确认它有无其他合法身份（篇章名可同时是技能名）。(4) 勘误后给底座档案打「解包字面核验 + 日期」标记，比照 card-system.json 的严谨度。
- **Impact**：与 #30（数据层≠输出层）、#36（数据存在≠上线）、#40（侦察不全下否定结论）、#41（角度枯竭≠主题枯竭）同簇——**事实圣经层不是免检层，专名必须解包验证**；轻信脑补与过度猎错是同一枚硬币（都源于没回一手）。实证了协作契约（默认无可信领域记忆、一切现成调取）：连人工策展的事实圣经都被污染，更不能凭记忆作答。

## 44. A/B 候选臂静默失效——变量只在某路径生效，测量却没进那条路径，「无差异」是假象

- **Context**：2026-07-05 bpt-agent-sdk 提示词 A/B。多轮测出 v1-vs-v2/v3/v4「无可测收益」，据此判「更周全的官方提示词不值得提为默认」。守密人「2 模拟行为 / 目标是跟官方提示词一致」推动重查。
- **Problem**：`harnessPromptVariant` **只在 `systemPrompt={type:'preset',preset:'claude_code'}` 路径**上被读取；而 A/B harness（`ab-benchmark.mjs`/`cache-probe.mjs`）选了 variant 却没设 preset → variant 被**静默忽略**，两臂**实际都跑极简默认提示词**。故「无差异」不是「候选不比基线好」，是「候选根本没上场」。修复后真对照翻案：v5（~3774 tok 忠实再现）比 v1（~238 tok）**~3× 便宜**、同正确——因缓存（v5 95% 命中 vs v1 落死区 0%）。
- **Fix**：(1) harness 只要给 `VARIANT` 就**强制一并设 preset**（否则 variant 无效）。(2) 测量前先自检**「候选臂真的和基线不一样吗」**——A/B 至少断言两臂的实际入参（这里是 system prompt 文本）有别，别信「跑通了」=「测对了」。(3) 任何「配置只在特定条件下生效」的开关，其测量必须显式满足那个条件，并在测试里锁定。
- **Impact**：与 #30（数据层≠输出层）、#32-R1（子调用失败即整次失败）同簇——**测量管道本身要先被验证，否则量出的是管道 bug 不是被测对象**。「不测不宣胜负」的前提是「测的是对的东西」；量错了要**公开翻案**（作废旧结论、留痕不静默覆盖），不是悄悄改数。反直觉正解：更大更忠实的提示词因跨过缓存门槛反而更省——直觉（大=贵）在有缓存分层时失效。

---

> **维护说明**：遇到新的坑时立即追加。格式保持统一。
