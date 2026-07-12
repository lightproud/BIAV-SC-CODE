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

> **维护说明**：本档只进不出——迁入后条目原文不再修改（史实记录）；如某条重新变得适用，
> 在主档以新编号重记并引用本档出处，不回迁。
