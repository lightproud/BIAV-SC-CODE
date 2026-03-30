# 踩坑记录

> 最后更新：2026-03-30 by Code-wiki
>
> 记录协作过程中犯过的错误，避免重犯。每条包含 Context、Problem、Fix、Impact。

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

## 12. VitePress 构建：YAML frontmatter 中的冒号必须加引号

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

## 18. VitePress cleanUrls: true 与 GitHub Pages 不兼容

- **Context**：VitePress 配置了 `cleanUrls: true`，生成无扩展名链接（如 `/awakeners/tulu`）
- **Problem**：GitHub Pages 是纯静态托管，不支持服务端 URL 重写。访问 `/awakeners/tulu` 返回 404，因为实际文件是 `tulu.html`。首页和索引页正常（因为有 `index.html` 兜底），但所有详情页全部 404
- **Fix**：改为 `cleanUrls: false`，链接自动带 `.html` 后缀。只有支持 URL 重写的服务器（Nginx、Vercel、Netlify）才能用 cleanUrls
- **Impact**：角色详情页、攻略页等 189×3 个页面全部 404，用户可见

## 19. VitePress locale rewrites 改变构建产物目录结构

- **Context**：配置 `rewrites: { 'zh/:rest*': ':rest*' }` 将中文设为 root locale
- **Problem**：构建后 `/zh/` 目录不再存在——中文内容直接输出到根目录。但部署验证脚本和 smoke test 仍检查 `/wiki/zh/` 目录是否存在，导致误报 WARNING
- **Fix**：所有引用 locale 路径的地方（workflow 验证、smoke test URL、文档链接）必须与 rewrites 规则保持一致。root locale 的内容在根目录，不在 `/zh/` 子目录
- **Impact**：部署验证误判、用户访问错误 URL

## 20. 多会话并行修改同一文件时，后合并者需处理数据格式冲突

- **Context**：Code-wiki 在 characters.json 中用结构化格式（command_cards/rouse/exalt）存储技能；另一个会话向 skills.json 写入了 59 个角色的技能数据，但其中 48 个仍是旧格式（只有描述性文本，无结构化卡牌数据）
- **Problem**：合并时两份数据格式不一致——11 个有结构化卡牌数据，48 个只有定性描述。简单覆盖会丢失已有的结构化数据，但不合并又浪费了另一个会话的工作
- **Fix**：合并脚本需按字段级别判断：如果目标已有结构化数据（command_cards 非空），跳过；否则用源数据（即使是旧格式）填充。同时在 CONTEXT.md 中明确标注数据格式规范，避免不同会话产出不兼容的格式
- **Impact**：数据质量、跨会话协作效率

---

> **维护说明**：遇到新的坑时立即追加。格式保持统一。
