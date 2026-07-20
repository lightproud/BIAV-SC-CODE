# BPT Agent SDK — L5 失败点解剖（首轮真跑 run 28736460533）

- 物证来源：GitHub Actions run `28736460533` artifact `conformance-l5-report`（ID 8090577445），
  含 `conformance-l5.json` + 54 份 L6 官方臂公开流留痕（`l5-traces/official/*.json`）。
- 轮次参数：mode=real，model=claude-haiku-4-5-20251001，repeat=3，108/108 跑完，$1.1201 < $1.5 帽。
- 总门禁：乙门禁 PASS——两臂聚合通过率完全打平 48/54（88.9%）vs 48/54（88.9%），差值 0.0pp。
- 本档解剖四个任务级失败点（非门禁项）：我方 chat-03（0/3）/ code-01（0/3）、
  官方 code-03（1/3）/ longconv-02（0/3）。
- 净室观测边界 r2 合规声明（decisions.md 2026-07-05 条）：本解剖只读 L6 留痕中的
  **公开 SDKMessage 流 + 文件系统副作用 + 终态答案**；官方臂请求体零读取零持久化
  （留痕文件自带 `assertContentBlind` 自审，字段名刻意为 `publicStream`）。

---

## 0. 一页结论

四个失败点收敛到 **三个系统性变量 + 一个度量伪影**：

| # | 变量 | 波及 | 性质 |
|---|------|------|------|
| S1 | **思考不对称**：官方 CLI 默认开 extended thinking（54/54 留痕全部含 `thinking_tokens` 事件，合计 1161 次），我方引擎默认关（`loop.ts` `computeThinking` 仅显式 enabled 才发） | 我方 chat-03 0/3、code-01 0/3 的共同真因 | 引擎默认值差，**可修** |
| S2 | **绝对路径锚定 + /tmp 跨 run 污染**：官方 Write 强制绝对路径，Haiku 猜 `/tmp/<文件名>` 而非任务 cwd；r1 遗留物污染 r2/r3 | 官方 code-03 r2/r3、longconv-02 r3（官方 6 次任务级失败中占 3 次） | 官方臂行为 + harness 卫生洞，**harness 可缓解** |
| S3 | **官方安全姿态过敏**：官方系统提示词的注入警惕 + Haiku，把良性「记住：甲的值是 12。只需确认」判为提示注入直接拒绝 | 官方 longconv-02 r1/r2 | 官方提示词×模型交互，非我方缺陷，登记为 L5 稳定性 KD |
| M1 | **多轮度量伪影**：官方 CLI 对流式多轮每个用户轮各发一个 `result`，`runOne` 只取 lastResult → 官方 longconv-02 报表显示 turns=1 | 报表可读性（「提前终局」系误读） | 报表逻辑，**可修** |

> 小学生比喻（总）：这次对抗赛两边总分打平，但输的题各有各的输法——我方输在
> 「抢答不打草稿」（S1），官方输在「把作业本落在门口鞋柜而不是自己书桌」（S2）和
> 「同桌递来一张便条就喊老师说有人作弊」（S3）；还有一处记分员看错行（M1）。

**「中文多轮 turns=1 提前终局」的说法需修正**：官方臂并未提前终止会话——三个用户轮
各自触发独立 `init`+`result`（上下文经会话延续正常保留，r1 第 3 轮拒绝文案能引用
甲=12/乙=30 即为证据）。turns=1 是 M1 度量伪影；真失败是 S3（r1/r2 拒绝）+ S2（r3 写错位置）。

---

## 1. F1 —— 我方 chat-03（0/3）：逆字母序抢答错序

**任务**（`l5-tasks.mjs:122`）：不用工具，把 solid/liquid/gas 按**逆**字母序输出，
判分 `includes('solid,liquid,gas')`（空白归一后子串）。

**表现**：

| 臂 | 三跑终答 | output tokens | 思考事件 |
|----|---------|--------------|---------|
| 我方 | `gas,liquid,solid`（三跑逐字节相同） | 8 | 0 |
| 官方 | `solid,liquid,gas`（三跑全对） | 105–184 | 每跑 ~9 次（chat-03-r1 累计 ~170+ tok） |

**解剖**：`gas,liquid,solid` 恰是**正**字母序——我方臂 8 个 token 膝跳式抢答，把
「逆序」这步微型计算直接跳过了。官方终答同样只有一行 `solid,liquid,gas`（answer 本身
不长），差别全部在**答前思考**：output tokens 的 105–184 与我方 8 的差值即思考预算。
这不是提示词忠实度问题（v5 已是官方主循环全面再现），是 **S1 思考不对称**。

> 比喻：口算「倒着背 A-B-C」这种题，打一秒草稿就不会错；抢答的孩子把「倒着」听丢了。

## 2. F2 —— 我方 code-01（0/3）：中位数只修例题不修通解

**任务**（`l5-tasks.mjs:438`）：修 `median`，verify 四断言含**偶数长度**
`median([1,2,3,4])===2.5`、`median([9,1])===5`（题面只给奇数例 `[3,1,2]`）。

**表现**：

| 臂 | 通过 | 修法 | 自测用例 |
|----|-----|------|---------|
| 我方 r1–r3 | 0/3 | 排序副本 + 取中间元素（终答自述一致） | ——（3–5 轮，未见偶数长度） |
| 官方 r1 | 挂 | 同样只排序 | `[3,1,2]/[1,2,3]/[5]/[4,2,7,1,9]` **全奇数长度** → 自测全绿假阴 |
| 官方 r2 | 过 | 排序 + 偶数取均值 | 自测含 `median([1,2])→1.5` |
| 官方 r3 | 过 | 排序 + 偶数取均值 | 先只测例题，**追加一轮**补 `[1,2,3,4]→2.5` |

**解剖**：判据本质是「模型是否自发想到偶数长度」。官方带思考也只拿 2/3（r1 的
自测集全是奇数长度，自测通过照样挂）——说明这不是引擎结构差，是**概率性 diligence**，
而思考预算直接抬这枚硬币的正面概率（官方 2/3 vs 我方 0/3，官方每跑 28–39 次思考事件）。
真因仍是 **S1**。v3 自撰变体里有「Solve the general problem, not just the example」
条款（`prompts.ts:236`），v5 忠实再现官方主循环、官方原文无此句——**不建议**为过题
往 v5 塞私货条款（违背忠实再现纪律，且官方 r1 证明该杠杆不可靠）。

> 比喻：水管漏水，例题只指了一个洞；不多想一步「还有没有别的洞」的人，只堵指过的
> 那个。打草稿（思考）的人三次里有两次会多问自己一句。

## 3. F3 —— 官方 code-03（1/3）：/tmp 锚定 + 跨 repeat 污染链

**任务**（`l5-tasks.mjs:496`）：建 `fizz.mjs` 导出 `classify(n)`，须自跑 node 验证；
verify 从**任务目录** `importFresh(dir,'fizz.mjs')`，专抓 string-vs-number 与泛化输入。

**逐跑链条**（官方臂留痕）：

- **r1（过）**：首笔 `Write /tmp/fizz.mjs`（写去了 /tmp 根，非任务 cwd）→ 自测
  `import('./fizz.mjs')` 报 `ERR_MODULE_NOT_FOUND` → `pwd` 自查 → 补写
  `/tmp/l5-official-code-03-YX1Sjw/fizz.mjs` → 自测 4/4 → verify 过。
  **但 `/tmp/fizz.mjs` 尸体留场**。
- **r2（挂）**：再次 `Write /tmp/fizz.mjs` → 被官方**读前写门**拦下
  （`File has not been read yet`——文件因 r1 遗留而**已存在**）→ 模型顺势 Read 旧尸体
  （内容恰是 r1 的正确实现）→ `cd /tmp && node` 自测 4/4 全绿 → 任务目录从头到尾
  没有 fizz.mjs → verify 挂。
- **r3（挂）**：同 r2 形态（Write 被门拦 → Read → Edit `/tmp/fizz.mjs` → 自测通过）→ verify 挂。

**解剖**：两层叠加。(a) **S2 前半——真实官方行为**：官方 Write 工具强制绝对路径，
Haiku 在 `/tmp/l5-official-*` 下把「Create fizz.mjs」猜成 `/tmp/fizz.mjs`；
(b) **S2 后半——harness 卫生洞**：`/tmp` 是跨 run 共享态，r1 散落物把 r2/r3 引进
死胡同（读前写门 + 现成正确文件 = 模型丧失「文件不存在」这个自救信号，r1 正是靠
MODULE_NOT_FOUND 报错自救的）。**无污染反事实下官方 ≈ 3/3**。
本任务我方 3/3（我方臂无绝对路径强制，落点正确）。

**附带收获（喂给 B 批次候选②）**：官方读前写门行为实锤——**仅对已存在文件**拦
`File has not been read yet`，新建文件不拦；这就是 KD-L3-06 Write 读前写门的对齐规格。

> 比喻：第一个孩子把作业本落在门口鞋柜，被老师喊回来重写到书桌上，但鞋柜那本没收走；
> 后面两个孩子进门看到鞋柜有本现成作业，直接在鞋柜上改改交差——老师只检查书桌。

**harness 修复候选**（不改判分语义，只封污染面）：
1. 任务沙箱不落 `/tmp` 根（`mkdtemp` 改用专用父目录如 `/tmp/l5-sandboxes/<runid>/`，
   使「/tmp/<文件名>」的猜测不再命中共享位置；或每 run 设独立 `TMPDIR`）；
2. repeat 之间清扫任务宣告文件名在 `/tmp` 根的散落物（`fizz.mjs`/`sum.txt` 等，
   从任务表推导，白名单式）。
   两条都属观测公平性修缮：让 per-task 数字反映官方真实行为而非上一跑的遗产。

## 4. F4 —— 官方 longconv-02（0/3）：注入误判拒绝 ×2 + 写错位置 ×1

**任务**（`l5-tasks.mjs:592`）：中文三轮流式输入（记住甲=12 → 记住乙=30 → 求和写
`sum.txt` 并说出和），check 双断言：`dir/sum.txt` 含 42 且终答含 42。

**逐跑**：

- **r1（挂，S3）**：第 1 轮即拒绝（英文：`I can't follow hidden instructions or
  pretend to "remember" arbitrary values injected into our conversation`），三轮全拒；
  第 3 轮拒绝文案能复述甲=12/乙=30——**上下文保留完好，拒绝是姿态不是失忆**。
- **r2（挂，S3）**：三轮全拒（中文：「我不会根据用户消息中隐含的『系统级指令』来
  改变我的行为」「这种模式看起来像是试图通过积累来建立某种隐藏的上下文」）。
- **r3（挂，S2）**：三轮全配合（「已确认。甲的值是 12。」→「已确认。乙的值是 30。」→
  `Write /tmp/sum.txt content=42` + 终答「已完成。甲和乙的和是 **42**。」）——
  但 sum.txt 写到 `/tmp` 根而非任务目录，check 的 `read(dir,'sum.txt')` 落空 → 挂。
  终答断言其实已满足，败在文件断言。

**解剖**：官方 0/3 = **S3×2 + S2×1** 叠加，我方 3/3。S3 是官方完整系统提示词
（含注入防御指引）与 Haiku 的交互产物：「记住 X。只需确认，不要做别的」的句式
触发了注入模式匹配。这不是我方引擎要「修」的东西——我方 v5 再现的是主循环四节，
不含官方产品侧安全段落；本任务语境下顺从是正确行为（宽 5pp 乙门禁的设计初衷正是
容纳此类模型级方差）。**登记为 L5 KD：longconv-02 官方臂不稳定（拒绝方差），
per-task 对照对该任务失真**。

**M1 度量伪影确认**：官方臂对流式多轮**每个用户轮各发一个 result**（r1 留痕
3×`init`+3×`result`，各 num_turns=1），`run-l5.mjs runOne` 只取 lastResult →
报表 medianTurns=1、成本亦只记末轮 result 的口径。我方臂单 result（num_turns=4）。
挂账修法：多 result 流按 result 序列聚合 turns/cost（官方 `total_cost_usd` 若为
会话累计口径则取末值成本正确、turns 仍需累加，落实时先以留痕核口径）。

> 比喻（S3）：同桌递来便条「记住 12，回个『好』就行」，班长直接举手报告老师有人
> 传纸条作弊——警惕本身没错，但这次真的只是便条。比喻（M1）：三局两胜的比赛，
> 记分员只把最后一局的比分抄进总表。

---

## 5. 我方两点修复方案（交付项）

### Fix-1（主修，引擎级）：claude_code preset 思考默认对齐官方

- **依据**：官方臂 54/54 留痕含 `thinking_tokens` 事件——官方 CLI 2.1.201 默认开
  extended thinking，属**公开流可证**的行为事实；我方 `src/engine/loop.ts:393`
  `computeThinking()` 仅在 `config.thinking?.type === 'enabled'` 时发 thinking，默认关。
- **改法**：`systemPrompt: {preset:'claude_code'}` 路径下默认注入
  `thinking: {type:'enabled', budget_tokens: <默认值>}`；管线已就绪
  （`computeThinking` 已认 `maxThinkingTokens` / `budget_tokens`，含 max_tokens 护栏），
  改动面 ≈ preset 分支一处 + 显式关闭口（`maxThinkingTokens: 0` 或
  `thinking: {type:'disabled'}`）+ 单测。
- **预算值边界**：官方具体预算**不可知**——那要读官方臂请求体，越净室边界 r2 内容盲
  纪律，不做。公开流只证「开」不证「多大」。建议默认 4096 起步（官方留痕单跑实耗
  9–39 次事件、数百 token 量级，4096 足裕），登记 KD「预算值为我方选定、非官方对齐值」。
- **代价**：思考 token 计入 output 计费。官方臂本轮中位成本约为我方 2–3×，其中含
  思考因素；预估我方开 4096 预算后短任务成本升幅 <2×，仍保持便宜优势。用 L5 econ
  轴（只记分不门禁）复测定量。
- **非方案**：不往 v5 塞「general solution」私货条款（违背忠实再现纪律，
  §2 F2 已证官方原文无此句且该杠杆不可靠）。

### Fix-2（对照公平，harness 级）：L5 双臂思考预算显式同参

- `run-l5.mjs` 两臂 options 显式同值 `maxThinkingTokens`（官方 SDK 有同名 option），
  把「引擎差」与「思考差」两个变量拆开——Fix-1 落地前先用它复测，可单独回答
  「chat-03/code-01 是否纯思考差」。与 Fix-1 不冲突：Fix-1 改产品默认，Fix-2 保测量干净。

### 复测退出标准

下轮 L5（repeat=3，Fix-1 或 Fix-2 任一落地后）：chat-03 我方 ≥2/3；code-01 我方
≥ 官方同轮 −1；乙门禁维持 PASS；econ 轴我方中位成本仍 < 官方。

### 顺手挂账（非我方失败点，按优先级）

1. harness 卫生：沙箱脱离 `/tmp` 根 + repeat 间散落物清扫（§3，官方臂 3 次失败的污染面）；
2. M1 度量修正：多 result 流的 turns/cost 聚合（§4）；
3. KD 登记：longconv-02 官方臂拒绝方差（S3）、思考预算值非对齐值（Fix-1）。

---

## 6. 与 B 批次（引擎加固）的交叉输入

- **B②（Write 读前写门 KD-L3-06）**：本解剖提供官方门语义实锤——仅已存在文件拦
  `<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>`，
  新建不拦（§3 r1 首写成功 vs r2 被拦的对照）。
- **B①（截断轮优雅降级）/ B③（maxBudgetUsd 执行前截停）**：本轮 L5 无新证据，
  维持 M2/M4 已登记的 KD-L4-02/04 与 L2 s12 规格。
