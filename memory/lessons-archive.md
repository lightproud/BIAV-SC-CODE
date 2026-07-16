# 踩坑记录归档层

> 建档：2026-07-12（守密人裁定，比照 `decisions.md` ↔ `decisions-archive.md` 分层模式）。
> 本档收录已从 `memory/lessons-learned.md` 主档迁出的条目全文：**已毕业**（升格为 CLAUDE.md
> 自动加载层硬约束，此处保留完整案例与根因分析）与**已过时**（所述机制退役或引用路径已删，
> 仅供追溯，不作运行时指引）。主档对应编号处留有一行指针。编号永久固定，不重用、不追溯改动。

---

## 一、已毕业（升格为自动加载层硬约束，原文留档备溯源）

## 12. VitePress 构建：YAML frontmatter 中的冒号必须加引号 [已毕业]

- **Context**：generate_pages.py 批量生成 189 个角色页面的 md 文件
- **Problem**：部分角色名含冒号（如 `Doll: Inferno`），写入 frontmatter `title: Doll: Inferno | ...` 后 VitePress 构建报 YAML 解析错误
- **Fix**：含冒号的 frontmatter 值必须用双引号包裹：`title: "Doll: Inferno | ..."`
- **Impact**：构建失败，站点无法部署

## 19. VitePress cleanUrls: true 与 GitHub Pages 不兼容 [已毕业]

- **Context**：VitePress 配置了 `cleanUrls: true`，生成无扩展名链接（如 `/awakeners/tulu`）
- **Problem**：GitHub Pages 是纯静态托管，不支持服务端 URL 重写。访问 `/awakeners/tulu` 返回 404，因为实际文件是 `tulu.html`。首页和索引页正常（因为有 `index.html` 兜底），但所有详情页全部 404
- **Fix**：改为 `cleanUrls: false`，链接自动带 `.html` 后缀。只有支持 URL 重写的服务器（Nginx、Vercel、Netlify）才能用 cleanUrls
- **Impact**：角色详情页、攻略页等 189×3 个页面全部 404，用户可见

## 30. 数据层 vs 输出层混淆，把过滤选样当全量 [已毕业 → CLAUDE.md §4.1 硬约束]

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

## 32. 生成连贯性压倒数据完整性（事实采信纪律 3 条硬规则） [已毕业 → CLAUDE.md §4.2 硬约束]

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

## 46. 知识库索引「事后补 rebuild PR」循环吃掉三周会话时间 [已毕业 → CLAUDE.md §6.1「索引更新一步到位协议」]

- **Context**：2026-06-21 → 07-10 反复出现同型 PR：#341（#333 迁移社区数据未重建 → 主线 15 红测冻结合并）、#494（#492 加 Resource 文档未重建 → 治理测试红）、#549（#548 加 SDK 文档后专开一个 rebuild PR 补指针）。每次都是「内容 PR 落地 → okf/ 悬空 → 机械检查报警或人工发现 → 再开一个 PR 补重建」，两步走成了常态。
- **Problem**：「一步到位」的机制其实 #497（2026-07-06 乙+丙）后就已齐备——合并 main 自动重建直推 + 治理测试子集化容忍源增长——但两个缺口让它没生效：(1) **`build-okf-bundle.yml` 的 push 触发器只盖 3 条路径**（生成器 / characters.json / source-health.json），而 bundle 实际消费 15+ 源家族（memory / assets / Resource / 项目文档 / wiki 数据……），绝大多数内容 PR 合并后不触发重建，只能等次日 6:17 cron，会话等不及就手工补 PR；(2) **「内容 PR 不必手工重建」这条协议只存在于 #497 的 PR 描述里**，未落任何自动加载档案，后续会话根本不知道有此裁定，于是 #549 重蹈覆辙。
- **Fix**：(1) 触发器路径清单**从生成器实际消费的源反推**补全（每小时归档层刻意不含——其提交带 `[skip ci]` 本就不触发，由每日 cron 兜底，防高频重建）；(2) 协议写进 CLAUDE.md §6.1（自动加载层）：内容 PR 不带 okf/ diff、不开 follow-up rebuild PR；唯一例外是改生成器结构本身（改名 / 删层 / 变 type）须同 PR 重建。
- **Impact**：「一步到位」= 机制 + 协议缺一不可。协议只写在 PR 描述 / 会话记忆里 = 对未来会话**不存在**（同 decisions-archive 2026-05-19「prompt 级文档是弱约束」——不自动加载的约束等于没约束）；声明式触发器的路径清单是**生成器消费面的镜像**，消费面扩了 12 层、清单还停在初版 3 条，就是这类「幽灵两步流程」的温床。与 #42 同簇：多条自动化的分工边界（谁触发 / 谁兜底）必须显式写死，不能靠会话临场猜。

---

## 二、已过时·甲档（所述机制已整体退役）

## 7. Issue 积压无闭环 [已过时：Issue 驱动派发随多会话架构 2026-06 退役]

- **Context**：战略参谋批量创建 Issue，Actions 因 API 余额为零执行失败
- **Problem**：失败后无人处理，25 个 Issue 积压，同一需求被重复创建
- **Fix**：WIP 上限 3 个/子项目 + 失败自动打 blocked 标签 + 创建前查重
- **Impact**：项目管理效率

## 8. Issue 不是手动会话的传递通道 [已过时：多会话派发模型退役，现行任务入口 = 守密人会话派发 + CONTEXT.md]

- **Context**：为 Code-site 创建了详细的 Issue #58，期望新会话读取执行
- **Problem**：手动开启的 Code 会话不会自动读 Issue。Issue 驱动只对 GitHub Actions 自动触发的 Claude Code 有效（claude.yml 响应 Issue 事件）。手动会话的入口是 CLAUDE.md → CONTEXT.md，不是 Issue 列表
- **Fix**：任务要点必须写进对应子项目的 `CONTEXT.md`「当前任务」段落。Issue 用于记录和追踪，不是跨会话通信手段
- **Impact**：跨会话协作效率

## 16. Web 端 Claude Code 无外网，部署验证应在 PC 端做 [已过时：前提失效——现行云容器经代理可出网（HTTPS proxy / anysearch / 会话内采集例程均实测可用），网络能力由环境网络策略决定，非一律封锁]

- **Context**：在 claude.ai/code（Web 端）排查 GitHub Pages 部署问题
- **Problem**：Web 端代码运行在云端沙箱，外网访问被封锁（curl 超时、WebFetch 返回 403）。无法自主验证线上页面状态，只能让制作人截图反馈，导致排查循环极慢
- **Fix**：部署相关任务（站点上线、样式调试、线上验证）应在 PC 端 Claude Code（CLI / VS Code / JetBrains）执行，本机无沙箱限制，可直接 curl、本地预览。Web 端适合不依赖外网的任务（代码编写、数据处理、文档生成）
- **Impact**：排查效率，制作人体验

## 17. Discord 论坛帖归档后新回复丢失 [已过时：前提失效——2026-06-21 discord de-tier 后全量永驻 git，60 天驱逐机制不复存在]

- **Context**：Discord 数据按频道×创建日存储，60天后归档到 Releases 并从 git 删除
- **Problem**：帖子归档后，60天以上的老帖若有新回复，无法追加到已归档文件，回复数据丢失
- **Fix**：已知限制，接受。60天以上仍活跃的帖子极少，月报由 Claude 全文分析不依赖精确日期
- **Impact**：极少量长寿帖的尾部回复缺失，不影响整体分析质量

## 27. 主控台越界写业务代码（"派完代办的尾巴"陷阱） [已过时：主控台 / Code-* 多会话架构 2026-06 退役，战略锚点会话随 2026-07-12 Phase 2 收口终结]

- **Context**：2026-04-21 主控台派发 P2W1B1 子代理填批 1（24 角色）后，子代理通过任务报告返回完整 JSON（避开 lesson #26 的 Write 流式超时）。主控台为接收报告并把 JSON 落盘，亲自完成了：(1) 修 schema v1.0 → v1.0.1（业务代码）；(2) 拆 4 part Python heredoc 写入 `projects/wiki/data/db/characters.json`（业务代码）；(3) 跑 jsonschema 校验（业务工作）。守密人当场指出"这件事不应该主控台做，有另外的对话"
- **Problem**：违反 strategic-plan-2026.md 决策 #4「主控台长期锚点：本战略评估会话存续至 2026-07-19，**不写业务代码**，仅派发新会话 + 认知教学」。诱因是子代理产出报告后的"派完代办的尾巴"——主控台天然倾向于「我接手到这里就完结了」，但**接手本身就越界**。Wiki 业务工作（schema 修改、JSON 落盘、validator 运行、batch 派发）整条线归 Code-wiki 会话承接，不归主控台
- **Fix**（三条边界硬约束）：
  1. **报告→落盘的接力**必须由专职会话（如 Code-wiki）执行，不允许主控台亲自落盘业务数据文件（`projects/<子项目>/`、`assets/data/<事实圣经以外>` 等业务路径）
  2. **子代理产出业务代码/数据后**，主控台只做两件事：转发产出（写 GitHub Issue / 更新对应 CONTEXT.md / 通知守密人新会话角色），然后停手
  3. **派发流程模板化**：每次派发前，主控台明确写出「派发对象 → 接收方 → 验收方」三角，三个角色都不能等于主控台本身（除"派发"动作本身）
- **Impact**：会话职责边界、长期锚点会话的纯净度、跨会话协作可预测性

## 31. 上游 LLM agent framework 是 high-churn 决策点（≥ 3 次/3 月警戒线） [已过时：BPT 已换装自有栈（silver-core-sdk 2026-07-12 使命转正），周报模板/主控台干预机制不存在；「框架冻结期」原则本身仍可参考]

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

## 33. distill hook 软失败 git 推送的取舍 [已过时：蒸馏/SessionEnd 钩子 2026-06-14 退役、06-20 连码带数据删除；内嵌 meta 教训「参考实现要用自己的边界条件先校验」已并入主档 #29 簇精神]

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

---

## 三、已过时·乙档（引用路径 / 消费场景已删）

## 9. 多会话并行导致部署流水线冲突 [已过时：deploy-wiki.yml 早已删除，wiki 2026-07-12 冻结；「全局资源须有明确归属」原则已被后续实践吸收]

- **Context**：Code-wiki 创建了 `deploy-wiki.yml`（wiki 部署到根路径），主控台创建了 `deploy-site.yml`（多站点子路径部署）
- **Problem**：两个 workflow 同时监听 push to main，竞争同一个 GitHub Pages 部署目标，后完成的覆盖先完成的，结果不确定
- **Fix**：删除 `deploy-wiki.yml`，部署流水线归 Code-site 统一管理。跨子项目的全局资源（部署、视觉规范）必须有明确归属
- **Impact**：部署稳定性、架构决策传播

## 13. VitePress md 中 `<img src="/...">` 会被 Vue 编译器当 import 处理 [已过时：wiki 2026-07-12 冻结，角色页生成场景不再新增]

- **Context**：角色页面用 raw HTML `<img src="/brain-in-a-vat/wiki/portraits/xxx.png">` 引用 public 目录下的图片
- **Problem**：Vue 模板编译器将以 `/` 开头的 img src 转为 ES module import，Rollup/SSR 阶段无法 resolve，构建失败。尝试了 rollupOptions.external、ssr.external、vite.vue.template.transformAssetUrls 均无效（SSR 阶段绕不过去）
- **Fix**：将 `src="/portraits/xxx.png"` 改为 Vue 动态绑定 `:src="'/portraits/xxx.png'"` — 字符串字面量不会被编译器当 asset import
- **Impact**：构建失败，189×3 = 567 个文件需批量修复

## 15. 批量生成内容后必须跑一次构建验证 [已过时：所涉 wiki 批量生成场景随冻结停派；「生成后必构建验证」原则已被 §7.6「对话内全量测试绿即合并」纪律吸收]

- **Context**：generate_pages.py 生成 189×3 个角色页面 md，deploy-site.yml 手写构建命令，均未在提交前验证
- **Problem**：YAML 冒号未转义、img 路径写法错误、npm script 名不匹配——三个 bug 叠加导致站点长期无法部署，且因旧部署产物还在，表面上看不出问题
- **Fix**：任何批量生成内容或修改构建流水线后，必须在本地跑一次完整构建（`npm run build`）确认通过再提交。不要假设生成的内容是对的
- **Impact**：构建失败被长期忽视

## 20. VitePress locale rewrites 改变构建产物目录结构 [已过时：wiki 2026-07-12 冻结]

- **Context**：配置 `rewrites: { 'zh/:rest*': ':rest*' }` 将中文设为 root locale
- **Problem**：构建后 `/zh/` 目录不再存在——中文内容直接输出到根目录。但部署验证脚本和 smoke test 仍检查 `/wiki/zh/` 目录是否存在，导致误报 WARNING
- **Fix**：所有引用 locale 路径的地方（workflow 验证、smoke test URL、文档链接）必须与 rewrites 规则保持一致。root locale 的内容在根目录，不在 `/zh/` 子目录
- **Impact**：部署验证误判、用户访问错误 URL

## 22. Wiki 人工整理层数据不可靠 [已过时：所引 db/ 层 2026-06-15 整层清空、解包 text 层（lua_tables）2026-07-12 整层删除；现行唯一权威 = W2 可信基线 `projects/wiki/data/processed/characters.json`（见 CLAUDE.md §5.1）]

> ⚠ 本条所引用的 `projects/wiki/data/db/` 路径在 2026-04-20 B3 调研揭露从未建立（详见主档 #29 簇内原 #25 案）。本条历史陈述保留，路径标注为 pending。

- **Context**：`projects/wiki/data/db/` ⚠ 中的 JSON 是人工整理的 Wiki 展示数据
- **Problem**：约 58% 角色标注"待补充"，部分数据为推测而非客户端实际数值，不适合作为分析引用来源
- **Fix**：分析游戏数据时以 Lua 解包层（`projects/wiki/data/extracted/lua_tables/`）和事实圣经层（`assets/data/`）为唯一可靠来源。Wiki JSON 仅作为前端展示用途，不作为事实依据
- **Impact**：分析可信度

## 23. idealab 两个入口语义不等价：/code/ 需 SSO，API key 消费方必须用 /api/anthropic/ [已过时：bpt-next 及所涉档案随 2026-04-19 战略转向删除，纯历史]

- **Context**：bpt-next 对接阿里内部 idealab 网关，文档列出 `/api/anthropic/v1/messages` 与 `/code/v1/messages` 两个端点并标注"两种 url 都可以使用"
- **Problem**：初步推测 `/code/` 是代码场景专用入口、适合 coding agent，但实测 `/code/` 路径需浏览器 SSO 登录，不支持 API key 直调——`claw` / `bpt-next` 用 `x-api-key` 调 `/code/` 会 401
- **Fix**：API key 消费方（bpt-next / 后端服务 / CI）必须锁定 `/api/anthropic/v1/messages`；`/code/` 仅供 Web IDE / 浏览器 SSO 场景。档案同步固化到 `projects/bpt-next/LOCAL-SETUP-ZH.md` ⚠（已删除）情境八，防止未来会话重新评估时踩坑
- **Impact**：接入方案、API 调用可用性

## 24. idealab 模型命名不一致：Sonnet/Opus 连字符 vs Haiku 下划线 [已过时：同 #23，纯历史]

- **Context**：idealab 支持三个 Claude 模型——`claude-sonnet-4-6`、`claude-opus-4-6`、`claude-haiku-4_5`
- **Problem**：三个命名**不统一**——Sonnet/Opus 用连字符分隔版本号（`4-6`），Haiku 单独用下划线（`4_5`）。`claw` 内置别名表 `haiku` → `claude-haiku-4-5-20251213`（连字符 + 日期后缀）与 idealab 的 `claude-haiku-4_5`（下划线、无后缀）不匹配。直接执行 `--model haiku` 会把错误名透传给 idealab，返回 404 / InvalidModel
- **Fix**：在 `projects/bpt-next/.claw/settings.json` ⚠（已删除）用户别名表覆盖 `haiku → claude-haiku-4_5`；Sonnet/Opus 恰好匹配 claw 内置别名无需改动。命名约定说明同步到 `LOCAL-SETUP-ZH.md` 情境八
- **Impact**：配置可用性、别名系统兼容

---

## 四、案卷区（在役条目的长叙事全文，主档只留准则）

> 2026-07-12 守密人裁定：主档改「准则先行」定额格式（每条 3–5 行），长叙事下沉本区。
> 案卷是记入时点的快照；对应主档条目后续更新时追加新案卷，不改旧案卷。

### 案卷 #26. 大文档单次写入易超时，后台子代理阈值更低（并入 #21乙）

- **Context**：两案同坑。案 A（2026-04-20，原 #26）：两个后台子代理（`run_in_background=true`）起草 ~14 KB / 414 行 schema 文档，均在 `Write` 调用当刻触发 `API Error: Stream idle timeout - partial response received`，失败位置完全一致，排除随机性；主控台直接 Write 同一文档一次成功——后台 agent 的输出流超时阈值更严格。案 B（原 #21乙）：会话内把 6 章节完整报告一次性写入单个 Markdown，超时导致工作丢失、反复重写
- **Problem**：单次 Write/Edit 内容过长即有超时风险；后台子代理的阈值又低于主会话，大文档一次性落盘是双重雷区
- **Fix**：(1) 大于 300 行 / 10 KB 的单文档分段写入（先 Write 骨架，再分多次 Edit 追加），或拆分为多个独立文件逐个写；(2) 调研属性强、产出属性弱的子代理，改在 prompt 里要求返回「结构化要点」，由主会话组装落盘；(3) 连续两次 timeout 后不再盲目重试，换写入路径
- **Impact**：派发策略、档案交付可靠性、会话稳定性

### 案卷 #29. 档案声明与实际状态脱节（并入 #4/#5/#11/#25）

- **Context**：五案同根——档案（CONTEXT.md / 索引 / 决策档 / CLAUDE.md）所述与仓库实际状态不一致，新会话按假信息工作：
  - 原 #4：database 分支已有 16 个 JSON，CONTEXT.md 仍写「尚未开始」
  - 原 #5：assets/index.md 提前列了占位条目，新会话按索引找不到文件、浪费上下文
  - 原 #11：规则改了 CLAUDE.md，但已启动的旧会话读到的是启动时的旧规则——CLAUDE.md 只影响变更后新启动的会话，存量会话需守密人手动告知
  - 原 #25（2026-04-20 B3 调研）：`projects/wiki/data/db/` 在 git 历史**从未存在**，但 project-status / wiki CONTEXT / CLAUDE.md 三处声称其已建成（18 JSON / 63 唤醒体 / 83% 完成度，真实角色总数实为 72）；下游脚本依赖不存在的文件必然失败，Phase 2 工期严重低估。根因正是原 #4 只要求「变更后同步」、未建立「周期性交叉校验」
  - 本条原案（2026-03-29）：「废弃分支工作流」写入 decisions.md 后 CLAUDE.md 未同步，一个月内累积 35 个 stale 分支、auto-merge 空转、main 双向漂移引爆 413（#39 的根因之一）——与原 #11 同款机制但范围更大
- **Problem**：档案更新与实际文件/规则操作脱节且无校验机制；当脱节发生在自动加载入口（CLAUDE.md）时，错误会被平台级强约束放大到所有新会话
- **Fix**（现行有效做法；原案例中的 memory_writeback / session_briefing / 做梦哨兵等机制均已随子系统退役，勿照抄）：(1) 状态变更后立即同步对应档案；决策落 decisions.md 后 grep 全仓找出引用旧规则处逐一更新；(2) 涉文件存在性的陈述，落笔前 `ls` 核实；索引不列占位条目；(3) 机制化守护：CLAUDE.md 对账三卫 `pytest tests/test_claude_md*.py` + OKF 覆盖哨兵 `tests/test_kb_coverage_sentinel.py`；(4) 重要「废弃」决策必须回原条目加删除线与新决策日期/位置
- **Impact**：跨会话协作可信度、规则一致性、工期估算准确性；本簇是踩坑档案里复发最多的一族

### 案卷 #38. Web 环境 git 凭据缺 `workflow` 权限，含 `.github/workflows/*.yml` 的推送被整单拒绝

- **Context**：2026-06-20 推送功能目录首版（5 普通文件 + 1 个新工作流 `build-capability-registry.yml`）。`git push` 连续报 HTTP 413 / 502 / `unexpected disconnect while reading sideband packet`，且每次尾随诡异的 `Everything up-to-date`。误判过「包太大」「代理抽风」，重试 5 次均败。
- **Problem**：根因不是体积——是 Web 远端执行环境的 git 凭据**缺 GitHub `workflow` OAuth scope**，凡推送包里含 `.github/workflows/` 下文件，GitHub 服务端**整次拒绝**（连带包里其余文件一起退回），代理把拒绝表现为断连。把工作流文件移出该次提交后，普通文件秒推成功，反证此判据。
- **Fix**：含工作流文件的提交改走 GitHub App 凭据（MCP `push_files`，实测具 workflow 权限）单独推送；普通文件走常规 `git push`。即「机房特权件单独投递，别和普通包裹混寄」。
- **Impact**：界定本环境两条推送通道的能力边界；与 #39 并列为本环境两条独立推送约束（权限 / 基线）。

### 案卷 #39. push 413/断连真因是本地基线陈旧发「胖包」（并入 #28/#34）

- **Context**：三案同源：
  - 案 A（原 #28）：Web 沙箱快照恢复的本地 main 与 origin/main 双向漂移（触发临界点约 ahead ≥50 / behind ≥150），`git push` 撞代理 HTTP 413，全部依赖 push 的操作跟着堵塞。当时靠 SessionStart 同步钩子开工硬重置根治——该钩子 2026-06-14 已裁定退役，勿再复活（退役理由正是开工硬重置烦扰）。
  - 案 B（原 #34，2026-06-16）：本地 `origin/main` 跟踪指针陈旧停在旧位，待推改动实际仅 1 提交 / 12.5 KB，却连败约 10 次 413/502 + `unexpected disconnect`；HTTP/1.1、增大 postBuffer、延时退避全部无效。真因：smart-HTTP want/have 协商无法对齐共同基底，包退化到接近全史（713 MB）。`git fetch origin main` 刷新指针后一次推送成功。
  - 案 C（本条原案，2026-06-20）：main 被 CI `[skip ci]` 采集提交高频推进，本地分支基线一落后，协商出的 pack 含大量非共享对象、体积膨胀，撞本地代理请求体上限。
- **Problem**：413「包太大」是真实的，但「大」来自基线陈旧导致的协商失败，不是本次改动的体积；误诊成「网关抖动等自愈」或盲目退避重试会白耗数小时。
- **Fix**：(1) 现行防护 `.githooks/pre-push`（2026-06-20 裁定重新引入，git 层非会话层），新克隆/云容器先跑 `git config core.hooksPath .githooks` 装配；(2) 手动口径：每次 push 前 `git fetch origin main && git rebase origin/main`；(3) 诊断三命令：`git ls-remote origin | head`（远端真实 refs vs 本地跟踪指针）、`git rev-list --objects origin/main..HEAD | git pack-objects --stdout | wc -c`（待推包真实字节，极小却 413 = 对齐问题）、`git merge-base --is-ancestor <基底> origin/main`；(4) 与 #38 区分：含工作流文件被拒是权限问题，与基线无关。
- **Impact**：本环境 push 故障的标准诊断路径；结论必须由直接产出该事实的工具支撑（呼应 §4.2）。

### 案卷 #42. 两条 CI 互不感知 = 对冲永动机：清理删数据，回填每小时又写回来

- **Context**：2026-06-21 诊断 `discord/channels/` 3.3GB 滞留。`discord-archive.yml`（每月）把超 60 天月份传 Releases 后 `git_rm`；`discord-history-backfill.yml`（每小时）沿历史倒退按真实日期重写同一批 jsonl。
- **Problem**：归档刚删，回填就把同一批已归档月份重新拉回写盘——10921 文件 / 2.65GB 在「删→写回」间无限循环。根因双重：(1) 回填不读 `archive-log.json`，不知哪些月已归档；(2) 回填指针触底（建服月）后置 None，下次运行 `_init_historical_month` 见 None 又重置为上月，整个倒退-回填永动。冒烟枪：已归档的 `2024-01-01.jsonl` git 史显示 2026-06-01 删除 → 2026-06-20 被 backfill 重写。
- **Fix**：A 回填感知归档（`_archived_months()` 读账本，已传 Releases 的月份跳过不再 fetch）+ B 终结永动机（`history_backfill_complete` 标志，触底后不再 `_init` 重置）。两处月循环共用 `_advance_historical_month()` helper 防双写漂移。（涉事月度归档代码已随 2026-06-21 de-tier / 2026-07-02 死代码清理删除；教训通用）
- **Impact**：同路径写盘的两条自动化必须共享「谁该留谁该删」的单一事实源；带 `[skip ci]` 的流互不触发 ≠ 互不冲突——它们在文件系统上对冲；一次性回填任务务必有显式「完成」终态。

### 案卷 #43. 否定性/穷尽性结论须穷尽侦察（并入 #35/#36/#37/#40/#41）

- **Context**：六案同根——凭「我当下看到/想到的」下否定性、穷尽性或分类性结论，被一手数据或守密人连环证伪：
  - 原 #35（2026-06-16）：不先 `ls` 就假设 `processed/` 目录空白，自建脚本覆盖再删除，差点毁掉两月前更优的 `voice_character_map.json`（做得更深：44 个说话者簇 + 「关于X=八卦对象」模式）；靠 `git status` 的 ` D` 标记 + `git log` 追溯才发现并从 `HEAD~1` 还原。
  - 原 #36（2026-06-16）：给 72 角色打「可玩/非可玩」标签——单一判据（召唤台词）54/18 → 多维证据 66/6 → 守密人逐个确认 58 可玩/12 未上线/2 彩蛋，每版自动判据都自以为客观、都漏关键维度。
  - 原 #37（#36 根因深挖）：解包全部信号（召唤台词/卡池/语音/简介）只能证明「数据存在于客户端」，永远证不了「已正式上线」——厂商预埋未来角色、保留废弃卡池（同样卡池信号：阿拉克涅已上线 vs 本源萝坦未上线）。上线状态必须人工确认，解包数据一律只标「数据层证据」。
  - 原 #40（2026-06-20）：单一 `grep` 只扫 `.py` 为空，便断言「Releases 归档从未写脚本」写进方案与 decisions.md，实则归档系统完整在跑（4 workflow + 9 个月归档 release 在线为证）；守密人「先验证上传」一问逼出真相，诚实更正。
  - 原 #41（2026-06-21）：连续 3 轮预测「矿脉见底」全被证伪（每轮都挖出全新正交域），穷尽预测准确率 0/3 已失信——把「我已用过的角度挖空」偷换成「主题挖空」。
  - 本条原案（2026-06-22）：事实圣经层专名从未解包核验，错名/杜撰/反向错杀三类齐发（持光者教会→提灯教会等 6 处错名；「阿拉米人」「灵魂牌/命运牌」零命中系杜撰；猎错模式反把正确全名「星辰正位之刻」误杀——它同时是篇章名与图鲁技能名）。轻信脑补与过度猎错是同一枚硬币：都没回一手源。
- **Problem**：否定性结论（「不存在/没有了/不是/挖完了」）比肯定性结论更需穷尽侦察，却更常被单一判据轻率下达；用「当下想得到的角度」估「全部存量」会系统性低估。
- **Fix**：(1) 动手前先 `ls` + `git log -- <path>` 查来历，非自建文件绝不静默覆盖删除；(2) 业务语义标签机器证据只作 evidence，人工裁定记 `confirmed_by`，上线状态不得由解包推断；(3) 否定「存在」前查全脚本（多关键词）/ workflows / 运行产物三处；(4) 专名回解包字面核验（典藏馆条目标题为最强判据），勘误逐处看上下文、禁 replace_all，否定某名词某身份前先查其他合法身份；(5) 禁做「没有更多」预测，标明「我的角度枯竭」vs「可验证的存量枯竭」。
- **Impact**：研究/分类/审计类任务的结论纪律；与 §4.2 事实采信三规则互为表里。

### 案卷 #44. A/B 候选臂静默失效——变量只在某路径生效，测量却没进那条路径

- **Context**：2026-07-05 bpt-agent-sdk 提示词 A/B。多轮测出 v1-vs-v2/v3/v4「无可测收益」，据此判「更周全的官方提示词不值得提为默认」。守密人「2 模拟行为 / 目标是跟官方提示词一致」推动重查。
- **Problem**：`harnessPromptVariant` 只在 `systemPrompt={type:'preset',preset:'claude_code'}` 路径上被读取；而 A/B harness（`ab-benchmark.mjs`/`cache-probe.mjs`）选了 variant 却没设 preset → variant 被静默忽略，两臂实际都跑极简默认提示词。故「无差异」不是「候选不比基线好」，是「候选根本没上场」。修复后真对照翻案：v5（~3774 tok 忠实再现）比 v1（~238 tok）~3× 便宜、同正确——因缓存（v5 95% 命中 vs v1 落死区 0%）。
- **Fix**：(1) harness 只要给 `VARIANT` 就强制一并设 preset；(2) 测量前先自检「候选臂真的和基线不一样吗」——A/B 至少断言两臂实际入参有别；(3) 「配置只在特定条件下生效」的开关，其测量必须显式满足那个条件并在测试里锁定。
- **Impact**：测量管道本身要先被验证，否则量出的是管道 bug 不是被测对象；量错了要公开翻案。反直觉正解：更大提示词因跨过缓存门槛反而更省。

### 案卷 #45. rebase 冲突里 --ours/--theirs 语义反转

- **Context**：2026-07-10 bpt-agent-sdk v0.38.0 PR #553 推送时 pre-push 钩子自动 rebase 撞上 main 新落的 0.37.1 补丁，`version.ts` / `package.json` / `CHANGELOG.md` 冲突。意图「版本双源取本分支 0.38.0」，执行 `git checkout --ours`。
- **Problem**：rebase 期间 --ours/--theirs 与直觉相反——rebase 把本分支提交重放到目标基底上，此时 HEAD 是基底（origin/main），故 `--ours` = main 的 0.37.1、`--theirs` 才是本分支的 0.38.0。结果 v0.38.0 全部功能带着 `SDK_VERSION='0.37.1'` 合进 main。版本守卫没拦：`check-version-bump.mjs` 只校验 version.ts 与 package.json 互相一致——两者一致地错，守卫绿灯。直到下一工单 sed 替换 `0.38.0` 静默零命中才暴露。
- **Fix**：(1) rebase 冲突禁用裸 --ours/--theirs 直觉，先确认此刻谁是 HEAD，或看冲突标记块按语义挑；(2) `rebase --continue` 前对每个冲突文件 grep 关键值核实取到预期侧；(3) sed 替换必校验命中（替换后 grep 回读）；(4) 双源互证不防「一致地错」，可加 CHANGELOG 三方对账。
- **Impact**：「解决冲突」这个动作本身也是管道——取错侧不报错、守卫互证盲区、sed 静默零命中三层都没拦。修复随 v0.39.0 落地。

### 案卷 #49. CCR 例程事故簇（并入 #47/#48）

- **Context**：2026-07-10~11 arca_live 日采例程落地的同一事故家族三面：
  - 误诊侧（原 #47，2026-07-10）：CCR 平台注入的 `~/.claude/stop-hook-git-check.sh` 用 `origin/<分支>..HEAD` 检查「未验证/未推送提交」；会话分支重置到 origin/main 而远端分支指针陈旧/被删时，把 origin/main 已发布的上游提交（github-actions bot 归档提交、平台 squash 合并提交）误报为「需 `--reset-author` 变基重推」——照做等于改写 main 已发布历史。当次点名 5 个上游提交，核实归属后拒绝执行。修法：两处检查改用 `git log/rev-list HEAD --not --remotes`（任何远端引用都不可达的提交才是本会话欠账）；三场景验证通过（误报放行 / 未签名拦截 / 欠推拦截）。该脚本随容器生成、补丁不跨会话持久——新容器复发时按本条重打，或在环境 setup script 固化；根治靠上游。
  - 模式选型侧（原 #48，2026-07-10/11）：fresh-session 例程两连败——①全新会话对无上下文提示词安全误判（「Cloudflare 拦截/探测佐证」类措辞被读成协助绕拦截），例程提示词须写中性事实；②`create_new_session_on_fire=true` 开出的会话工作目录为空、不继承环境仓库源，且非提示词可修。结论：需仓库与凭证的定时任务用自绑定（仓库/凭证/上下文三备齐，代价是原会话每日多一轮）；fresh-session 只适合无仓库依赖的独立任务。另：容器重启后 CCR 写类工具（create/delete/update_trigger）权限通道可能中断数小时，读类不受影响——拉长重试窗口而非放弃。
  - 真污染侧（本条原案，2026-07-11）：采集脚本 `collect_arca_daily.py` 沿用 CI 惯用写法 `git config user.name/email github-actions[bot]`；例程切自绑定后跑进守密人主会话容器，而 `git config user.*` 默认写仓库级 `.git/config`、跨进程持久——采集跑过一次，同容器后续所有人工会话提交全部顶着 bot 身份（Unverified）。修法：身份骑在单条命令上 `git -c user.name=… -c user.email=… commit/pull`（`pull --rebase` 重写提交同样需带身份），零持久写。
- **Problem**：CI 一次性容器掩盖的写法与平台钩子的检查假设在长命自绑定容器里全部翻车，且三面互相放大：污染产出 Unverified 提交 → 钩子误报 → 险些误诊成「需改写历史」。
- **Impact**：arca_live 日采稳定通路建立（首日 87 条入档）；CCR 例程选型准则与长命容器 git 纪律沉淀。

### 案卷 #50. unref 计时器用在「进行中的重试退避」上 = 无头消费方进程静默死亡（exit 13）

- **Context**：2026-07-12 首轮带故障注入 harness 的 LIVE 评估轮（run 29178257816）零输出死于 exit 13（Node「顶层 await 未决而事件环排空」）。本地 vitest 同场景 4 项测试全绿，STUB/无效 key 全管线也通——只有真流式 + 中途切流复现。
- **Problem**：SDK 引擎 `replayBackoff`（loop.ts）的退避计时器被 `unref`。回合重放的退避恰好发生在连接刚死之时——常常是进程最后一个存活句柄；unref 后事件环排空，纯脚本（顶层 await）消费方在恢复中途整个进程静默退出。两重掩蔽：① vitest 自身句柄常驻，单测永远测不出「事件环排空」类缺陷；② 同进程内起的仿真器服务端 socket 也持 ref——负控必须双进程（服务器独立子进程 + 客户端 unref 监听）才能复现。
- **Fix**：去掉该 unref（v0.51.1）——unref 的正当对象是空闲看门狗与空闲池化 socket（stall-watchdog / node-http），绝不是进行中的重试等待；配子进程级回归测试 `tests/replay-backoff-process-exit.test.ts`（spawn 真 node 进程 + 独立服务器进程 + dc-02 同源客户端切流，断言 exit 0 + turnReplays≥1；负控实测：unref 加回即 exit 13）。
- **Impact**：判别准则两条——① 写 `unref()` 前先问「这个计时器醒来时是否还有别的句柄必然存活」；② 「进程能否活过恢复窗口」只能用真子进程测，vitest/jest 宿主内的绿灯不作数。

---

> **维护说明**：本档只进不出——迁入后条目原文不再修改（史实记录）；如某条重新变得适用，
> 在主档以新编号重记并引用本档出处，不回迁。案卷区为对应主档条目记入时点的长叙事快照，
> 主档条目后续有新案情时追加新案卷、不改旧案卷。
