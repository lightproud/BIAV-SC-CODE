# silver-core-sdk 缺陷审计报告 · 第四轮（r4）

- **日期**：2026-07-17（北京时间 UTC+8）
- **对象**：`projects/silver-core-sdk`（SDK 版本 0.65.3）
- **本轮净新增缺陷**：**205**（七波并行审计，逐条回源直读裁决 + 去重）
- **累计（四轮合计）**：**509**（r1 100 + r2 105 + r3 99 + r4 205）
- **排除基准**：`silver-core-sdk-bug-audit-20260717.md`(100) · `-r2-`(105) · `-r3-`(99) 已录 304 项全部排除
- **前三轮报告**：均在 main（repo-engineering 桶）

> **诚实前置（守密人红线，全程有效）**：本报告只记真发现，**宁缺毋滥、绝不为凑数编造**；
> 「累积 500」目标由真发现达成（实达 509，诚实溢出 9——末位「正则 correctness」代理诚实回报
> **0** 未补），非凑数。每条均回源直读裁决；重复项、已修项、文档化非目标均标注剔除。

---

## 一、本轮性质与意义（工作定性）

第四轮是**「修复回归审计 + 深度穷尽精读」双引擎**的一轮。与前三轮「铺开找新面」不同，本轮抓住
一条最鲜活的矿脉：SDK 0.65.3 相对前审计版本新增了**批 A–J 修复 + MultiEdit 移除 + 权限层重写**，
这些**新代码本身就是新缺陷面**。策略两条腿——(1) 逐批审计修复 diff（最鲜 vein，验证「修复是否引入
回归 / 修复是否不全 / 修复暴露的新边界」）；(2) 对已高度审计的子系统做**第五、六遍深度精读** +
**算术性质推理** + **跨切面横扫**（surrogate 切分、timer/listener 清理、fs 错误路径、Date/时区、
sort/比较器、正则、JSON.stringify、env 变量）。

**对项目的价值**：本轮证实了「修复审计」这一方法论的高产——批 E/G 的修复确实引入了真回归
（子代理 gate 漏保护 high、符号链接文件丢、写位剥、edit.ts 非原子写数据丢失 high）；同时深读把
「已 well-audited 区」的残留边角逼出（regex `(\w|a)+` 真 ReDoS 实测冻结 63.9 秒、cacheHitRate 分母
虚高、agentDef.tools 字符串提权、query-accounting NaN 毒化静默关闭预算门）。这些是「修好了一处、
碰坏了邻处」和「防线看似完整、边角仍漏」两类问题，靠单遍审计与自动化测试都难发现，只有对抗式
多代理并行 + 回源直读能稳定产出。

**小学生比喻**：这一轮像给刚装修完的房子做验收——不光看新贴的瓷砖好不好看（新功能对不对），
更要专门去查工人补墙时有没有把旁边的插座糊死了（修复引入的回归），还拿手电筒照进每个墙角看有没有
漏刷的地方（深度精读边角）。结果发现补墙师傅补了 A 处、却把 B 处的电线压在了墙里。

---

## 二、累计账 & 方法论

| 轮次 | 净新增 | 累计 | 报告 |
|------|--------|------|------|
| r1 | 100 | 100 | `silver-core-sdk-bug-audit-20260717.md` |
| r2 | 105 | 205 | `-r2-20260717.md` |
| r3 | 99 | 304 | `-r3-20260717.md` |
| **r4** | **205** | **509** | 本报告 |

**方法**：七波、每波 8 个后台并行审计代理（共 ~56 代理次），各领一角度 + 被告知当前已录累计数
以排除重复 + 红线诚实约束；回报后逐条**回源直读裁决**、对抗验证高价值候选、去重（对全四轮所有
已录项）、核实 fix-status（「修复建议」≠「已落盘」、「修复引入」≠「原缺陷未修」）。

**七波角度**：
1. 波1：批 E/F/G/H/I/J 修复新码 + sandbox/transport/mcp/query/session-manager 深读（+26）
2. 波2：批 B/C/D + 0.62.x 早期修复审计 + prompt 组装五遍 + workflow/task 深读（+22）
3. 波3：classifier 命令解析 + hooks + runtime 五遍 + tools 边界算术 + sessions + loop 五遍 + eval（+25）
4. 波4：reporting 聚合 + anthropic/accumulator 五遍 + memory 全子系统 + pricing + tips + sandbox（+34）
5. 波5：工具描述 vs 实现 + openai 六遍 + agent-tool + generators + timer 清理 + fs 错误路径 + query 六遍（+33）
6. 波6：openai 流状态机 + sort/比较器 + mcp 帧生命周期 + prompt 注入面 + tool-dispatch + Date/时区 + 算术 + gate 决策树（+32）
7. 波7（收官）：surrogate 切分 + elicitation 六遍 + env 变量 + JSON.stringify + contracts/public 面 + prompt 组装六遍 + planmode/worktree + 正则（+33）

---

## 三、最高价值发现（每条附小学生比喻）

- **edit.ts:223 就地非原子覆写 → 数据丢失（high）**：write.ts 的 F8 原子写修复**从未移植到 Edit**，
  中途 abort/ENOSPC 会把原文清空而新文没写完。比喻：改作业时先把整页擦光再重写，橡皮擦到一半铃响，
  这页就白了。
- **子代理 gate 漏传保护参数（high，不全修）**：批 E 权限重写给子代理建 gate 时漏传 cwd/knownMcpServers，
  子代理内路径硬化 + MCP-scoping 全失效。比喻：给大人装了防盗门，给孩子的房间却忘了装。
- **regex `(\w|a)+` 真 ReDoS 冻结 63.9 秒（high）**：guardRegexPattern 的重叠检测只比首原子字面，
  `\w` 与 `a` 判不出重叠 → 恶意模式溜过守卫经 Grep/hooks 达引擎。比喻：安检门只认「刀」这个字，
  你把刀叫成「铁片」就带进去了。
- **openai delta.refusal 从不解码（high）**：模型的拒答文本静默丢失，用户得到空白回复。比喻：
  客服说了「这事我办不了」，传话的人却只递来一张白纸。
- **query-accounting NaN 毒化关闭预算门（med）**：单个 NaN 成本永久毒化累计，`NaN>=预算` 恒 false →
  maxBudgetUsd 全会话静默失效、无界花费。比喻：账本上出现一个「？」，之后所有对账都判「没超支」，
  于是花钱再无刹车。
- **cacheHitRate 分母漏 cache_creation（high）**：命中率虚高（98% vs 真 49.5%）。比喻：算命中率时
  把「新写进缓存的」那半没算进分母，于是显得次次都命中。

---

## 四、逐波发现清单（205 项全录）

> 格式：`ID [严重度] 文件:行 — 机制 → 后果。置信`。凡标「剔」为对已录项去重，不计入 205。

### 波1（+26）

**批 G-H fs+memory 修复新码（Y5，4）**
- Y5-1 [med] glob.ts:91 + grep.ts:437 — F1 符号链接环修复过宽，`followSymbolicLinks:false`+`onlyFiles:true` 连指向普通文件的软链也丢 → `config.yml→config.dev.yml` 静默缺失。high
- Y5-2 [med] write.ts:177-180 — F8「mode preserved」被 umask 掩盖 + 原子 rename 造新 inode → umask 022 下覆写 0o2664 得 0o2644，group/other 写位每次覆写被剥。high
- Y5-3 [low] docs/COMPAT.md:404 — MultiEdit 硬移除漏更 COMPAT.md，仍记「DEPRECATED 仍 ships」误导消费者。high
- Y5-4 [low] shells.ts:346-357 — F4 过滤激活时扣住无换行末行 → 运行中 shell 的 filter 匹配无换行提示（`"Password: "`）永不现，模型无法响应假挂起。low

**批 E 权限修复新码（Y1，5）**
- Y1-1 [high] subagents/runtime.ts:1155-1165 — 子代理 gate 漏传 cwd/knownMcpServers/allowDangerousBypass → 子代理内 RP1/RP2 路径硬化 + I2 MCP-scoping 全失，deny `Write(/etc/*)` 被相对 `../../etc/passwd` 绕过。high
- Y1-2 [high机制] rules.ts:249-251,270 — resolvePath 用 lexical resolve 非 realpath → 软链组件穿不透 gate 但 kernel open() 穿：deny `Read(/secret/*)` + `/workspace/link→/secret` → `Read(/workspace/link/x)` 读到 /secret/x。high
- Y1-3 [low] rules.ts:270-291 — RP2 只认末尾 `**`，中段 `**` 被塌成单 `*` → deny `Read(/etc/**/secret)` 对 `/etc/foo/secret` 不触发。high
- Y1-4 [low] rules.ts:99-116 — resolveMcpServer 回落 last-`__` 启发 → `mcp__a__*` deny 失配。low
- Y1-5 [low] rules.ts:249-251 — `~` 不展开，`Read(~/.ssh/*)` 视字面（今无害因 fsutil 也不展开）。low

**批 F 压缩记账（Y2，2）**
- Y2-1 [low] compaction.ts:597,618-621 — D3 catch 潜在双记 summary usage（今纯同步不抛故潜伏）。low
- Y2-2 [low] compaction.ts:618-621 — abort 现也计费，用户取消的过 message_start 的 summary 调加折叠前缀 100k+ input 到成本。low-med

**sandbox·internal·error 深读（Y6，3）**
- Y6-1 [med] transport/openai.ts:162 BASE64_RE — 验字母表+padding 但不查 len%4===0 → `"YWJjZ"` 畸形 data URL 溜过、网关 opaque 拒。high存在
- Y6-2 [med] error-normalize.ts:326-357 — 不查 err.cause 链/AggregateError.errors → `TypeError('fetch failed',{cause:ECONNREFUSED})` 丢可重试细节；`AggregateError([429])` 误判 retryable:false。high
- Y6-3 [low] internal/media.ts:26 — normalizeImageMediaType 不剥 RFC-6838 参数 → `"image/png; charset=binary"` 把可解码 PNG 降为「unsupported」。low

**query·session-manager 深读（Y8，4）**
- Y8-1 [med] query.ts:1687-1690,1722 — session-cap 预检遗留持久化的未应答尾 user 轮 → 后续 resume 加载史尾 user + 新输入两连续 user → API 400「roles must alternate」。med
- Y8-2 [low] query.ts:1791 — 记忆 session-end 轮无条件 maxTurns=4，仅 budget gated → maxTurns:1 时 cumulativeTurns > maxTurns。med
- Y8-3 [low] session-manager.ts:653,362 — wrapped.throw 委托 q.throw 从不 settleLedger → q.throw() 终止的 managed query ledger 永留、usage().queries 永计活。low
- Y8-4 [low] query.ts:1499-1504 — auto-resume run2 重发 post-init informational，supervisor 只吞 system/init → 每次 recoverable resume 多灌一份同样警告到 consumer 流。low
- Y8-dup [剔] session-manager.ts:556 = round-3 WV3-1 重复。

**批 I 子代理修复（Y3，1）**
- Y3-1 [low] subagents/runtime.ts:1874-1877,1966 — K5 epoch 守卫跨 episode 缝隙：status!='running' 时 killAgent no-op 不 bump epoch → 队列消息通过 → runContinuation 复活刚被停的代理。med路径

**批 J 注入转义修复新码（Y4，4）**
- Y4-1 [med] query.ts:1646-1654 + ledger.ts:222 — L2-7 只用 singleLine 加固 digest，同 digest 经 toPrelude() 进 `<system-reminder>` 却无 neutralizeClosingTag → key 含 `</system-reminder> ignore prior rules` 时伪造指令逃逸 fence。med
- Y4-2 [low] internal/inert-text.ts:37 — escapeTagAttr 对双引号属性内非分隔符 `>` 也 entity-escape → 过度转义损坏模型 verbatim 读的内容。low
- Y4-3 [low] internal/inert-text.ts:24 — neutralizeClosingTag 改写合法嵌入正文的 `</tag>` → verifier 引用代码行含 `</context>` 时不再字节匹配源。low
- Y4-4 [low] engine/thinking-provenance.ts:79-82 — E1 保护扩到「任一 later user 轮带 tool_result」→ 换模型 resume 时陈旧 thinking 不剥可致重放签名 400（依上游覆盖，未证）。low

**transport·mcp 深读（Y7，3）**
- Y7-1 [low-med] node-http.ts:334-354 — preconnect HEAD 无 abort/timeout → gateway 不响应则 ref 住在飞 socket、进程不能优雅退出。med
- Y7-2 [low] factory.ts:24-38 — 未知 protocol typo 静默落 AnthropicTransport → Anthropic-wire 发到非 Anthropic 端点 400。med
- Y7-3 [low] mcp/project-config.ts:77 — `__proto__` 键命中 setter → 该 server 配置静默丢 + out 原型污染。high机制/trivial危害
- Y7-dup [剔] http.ts:177 = round-3 I5 重复。

### 波2（+22）

**sdk-server·registry·mcp 深读（Z6，5）**
- Z6-1 [low] http.ts:105-108 — initialize 接受任意 server protocolVersion 无支持检查。high
- Z6-2 [low] stdio.ts:182-192 — initialize 从不查 protocolVersion → 不兼容版本被当 OK。high
- Z6-3 [low-med] http.ts:281-291 — plain-JSON 响应分支不能答服务器发起的请求 → server 挂起。med
- Z6-4 [low] registry.ts:322-329 — setEnabled(false) 只翻标志不关 connection → 子进程/controller 永活泄漏。high机制
- Z6-5 [low] sdk-server.ts:185-201 — 进程内工具调无超时 → 挂死 handler 无界阻塞 agent。high机制

**0.62.x 早期修复审计（Z4，2）**
- Z4-1 [med] enterplanmode.ts:36 — EnterPlanMode readOnly:true → gate 自动放行不问 canUseTool，但描述称「REQUIRES user approval」→ 模型零同意翻 plan 模式卡死自主运行。med
- Z4-2 [low] query.ts:1948-1952 — 正常完成 teardown 在 acct.cost 增长时发第二条 result 消息 → 违 one-result-per-query、聚合双计。low

**generators·reporting·verifier 深读（Z7，3）**
- Z7-1 [med] generators/index.ts:240 — generateTitleAndBranch 把 description 插 `<description>` fence 无 neutralizeClosingTag 且 system 无 inert 句 → `</description>` 在 system 层闭合 fence 注入。med
- Z7-2 [med] generators/index.ts:334-335 — parseAwaySummary `/\*([^*\s][^*]*)\*/g` 把一行两 glob 当单 emph → "Ran tests on *.ts and *.js" 两星都剥。high行为
- Z7-3 [med] generators/index.ts:290-294 — generateSessionName slug 剥全部非 ASCII → CJK/韩/日名恒塌成 "session"。med

**workflow-engine·task 深读（Z5，4）**
- Z5-1 [med] workflow-engine.ts:328,346 — LiteralParser `\u` 只认 `\uXXXX` 拒 `\u{...}` + parseNumber 拒 hex/octal/`1_000`/BigInt → 合法 pure-literal meta 被硬拒、workflow 永不跑。high
- Z5-2 [med] workflow-engine.ts:834 vs 704 — 1000-agent backstop WorkflowScriptError 被 per-item `.catch→null` 吞 → 返 ok:true 带 null 项非失败。high
- Z5-3 [med] task.ts:237,447 — task metadata 只写不读：TaskGet/TaskList 从不呈现 → TaskCreate{metadata} 后不可读，往返破。high
- Z5-4 [low] workflow-engine.ts:481 — PRELUDE 禁 random/Date 但 WeakRef/FinalizationRegistry 仍可用 → 脚本观察 GC 非确定破 resume 确定性。low

**批 B 修复审计（Z1，2）**
- Z1-1 [low] workflow-engine.ts:602-604 — H5 把 agent() schema 严格 JSON.parse 换全宽松提取 → prose-wrapped JSON 现被接受，严格性回归 + 嵌套提取风险。med
- Z1-2 [low] loop.ts:1315-1326 — H4 截断 tool_use 被 stamp 且不执行，但 toolCalls 计数在截断检查前算 → 未执行块仍计 1。high

**prompt 组装第五遍（Z8，3）**
- Z8-1 [med] system-field.ts:66,71 vs 74 — split 路径发挥发性尾块为裸 `{text:suffix}` 无前导分隔符，flat 路径有 → 开关 caching 静默改 system 字节。high
- Z8-2 [low] prompts.ts:117 — `<env>`「powered by model X」用 initialModel 构造期烘焙 → fallback 换模型后 system env 仍名 primary 模型。med
- Z8-3 [low] prompts.ts:109 — OS Version 用小写 `linux` 复刻目标用 `Linux`（大写）。med

**批 C 修复审计（Z2，1）**
- Z2-1 [med] regex-guard.ts:74-81 — M2 重叠检测只比每支首原子 → `(ab|ac)+`/`(foo|fox)+` 被误拒（假拒回归）。med

**批 D 修复审计（Z3，2）**
- Z3-1 [med] generators/runtime.ts:229 — L67 `if(!closed) return null` 过火，prose 中散乱不平衡 `{` 在有效 JSON 前 → 吞真对象返 null。high
- Z3-2 [low] fsutil.ts:111 + read.ts:331 — L20 全缓冲 NUL 嗅探过度扩展到 Read → 8KB 后含单 NUL 的 20MB 日志被拒「binary」。med

### 波3（+25）

**classifier 命令解析（V4，3）**
- V4-1 [high] rules.ts:383-386 — 转义/引号命令词绕过 prefix deny：`\rm`/`"rm"`/`'rm'` bash 跑真 rm 但段不以 rm 起 → `Bash(rm:*)` deny 不 fire。high
- V4-2 [high] rules.ts:383-386 — 包裹命令隐藏真命令：`sudo rm`/`env rm`/`eval "rm -rf /"`/`xargs`/`timeout` 无 unwrap → deny 不 fire。high
- V4-3 [low] rules.ts:318,335 — INJECTION_MARKERS 把 `$((` 误设 hasInjection → `echo $((1+2))` 走 prompt（over-restriction 安全向）。high

**hooks 深读（V1，2）**
- V1-1 [high] matcher.ts:50-55 — 裸 `mcp__server` matcher 走精确相等从不前缀匹配，而权限 matchToolName 视同前缀 → scoped 到 MCP 服务器的 PreToolUse deny hook 对每个真 MCP 调用静默失效。high
- V1-2 [low] runner.ts:223 — 非-Stop 条件 context `JSON.stringify(input)` 无大小界 → 大 tool_input 撑爆 → evaluationFailed → 默认 'open' 跳 matcher → conditioned deny 静默跳过。med

**跨模块契约（V8，1）**
- V8-1 [low] accumulator.ts:230 ↔ loop.ts:150 — foldUsageEvent 只 fold output/input 丢 cache_creation/cache_read → 恢复成本欠报增量 cache token。med

**runtime.ts 第五遍（V2，4）**
- V2-1 [high] runtime.ts:1664 — 前台 spawn catch `throw err` 从不 fireSubagentStop → 前台子代理 abort 时 Start 发 Stop 不发 → 资源记账每次父-abort 漏一单。high
- V2-2 [med] runtime.ts:1593,1683 — SubagentStop 于首跑末发，runContinuation 复活再跑整 child loop 零 Start/Stop 括号。med
- V2-3 [low] runtime.ts:435-438 — resultPreview `text.slice(0,500)` UTF-16 切断代理对 → 孤 surrogate 入 `<summary>`。low
- V2-4 [low] runtime.ts:808,976 — 注释称 finalizeSidechain「从 killAgent 调」但从不调 → 陈旧注释诱导误改。med

**tools 边界算术（V6，5）**
- V6-1 [med] grep.ts:147,471,574 — 显式文件 >10MB → scanFile 返 null → 「No matches found」无提示 → 10.5MB 含 ERROR 的日志静默假阴。high
- V6-2 [med] glob.ts:100-104 — mtime 排序无次键 + MAX_RESULTS=100 slice → 同 mtime 文件跨运行丢不同 50 个。med
- V6-3 [low] grep.ts:352 — 负 head_limit 塌 0=无限 → `head_limit=-1` 返全部无 cap。med
- V6-4 [low] grep.ts:63-68 — 二进制嗅探仅首 8192 字节 → 前 8KB text 后二进制的文件不 skip、后段吐出。low
- V6-5 [low] read.ts:360-364 — maxLineChars>maxOutputChars 时超 cap 首行整发绕 cap 无 footer。low

**sessions 深读（V3，3）**
- V3-1 [med] persistence.ts:182-202 — query-resume fork 只 copy messages+accounting，tool_call/meta_update 丢 → `query({resume,forkSession:true})` 后 getSessionToolCalls(fork)=[] 且标题丢。high
- V3-2 [low] store.ts:461-491 — load() 把 tool_call 当「unrecognized line」→ 每次 resume 吐 N 条假警告。high
- V3-3 [low] checkpoints.ts:181-182 — rewind startSeq 偏好 direct.seq 而非 marker seq → 并发时窗内记录被排除撤销窗。low
- V3-dup [剔] store-adapter = WV3-5；checkpoints O(N²) = WV3-2。

**loop.ts 第五遍（V5，3）**
- V5-1 [med] loop.ts:413 — modelUsage.maxOutputTokens 硬置 config 值非实发 effectiveMaxTokens → ceiling<配置时指标虚报。high
- V5-2 [med] loop.ts:1435 — batch while 内工具间无 signal.aborted 守卫 → interrupt 后工具 2..N 仍执行副作用。med
- V5-3 [low] loop.ts:1013-1015 — 压缩/summary API 时间 fold 进全局但从不归 perTurn[] → sum(perTurn) vs top-line 不符。med

**eval/conformance mjs（V7，4）**
- V7-1 [med] eval-scoring.mjs:146-159 — computeDimensionMeans 无样本数分母 → 15/20 出错的维度仍显健康均值、零 SCORED 维度整个消失 → 真回归溜过。high
- V7-2 [med] eval-harnesses.mjs:434-472 — dc-04 process-kill+resume seed.txt 留盘 → 硬 kill 后重读文件的坏引擎也答对，fault 空过。med
- V7-3 [low-med] normalize-l3.mjs:103 — N2 双臂 rstrip 每行尾空白 → L3-READ-01 尾空白保真分歧被归一化掉测不出。med
- V7-4 [low] l5-aggregate.mjs:36 — apiMs 当会话累计（last==total）但 num_turns 按 per-result 求和 → 聚合规则不一致。low

### 波4（+34）

**reporting 聚合性质（U7，4）**
- U7-1 [high] runtime-report.ts:247 + compare-reports.ts:109 — cacheHitRate 分母漏 cache_creation → 虚高 98% 真 49.5%；冷缓存日 denom=0 渲「无数据」而实花 1M input-side。high
- U7-2 [med] compare-reports.ts:219-222 — per-cause transport delta null 时读 0 → 同报告两矛盾答案（summary 印「无数据」/表印「+5」）。high
- U7-3 [low] run-log.ts:101 — 两套 cacheHitRate 定义并存（持久权威 vs report 按缺陷分母重算）交叉核对不符无提示。med
- U7-4 [low] compare-reports.ts:92 — transport 值只 type-check 不查符号 → 负值误分类抑制 unrecovered 列。low

**anthropic.ts 第五遍（U2，5）**
- U2-1 [med-high] anthropic.ts:475 — empty-stream 重试 gate 于 `!sawMessageStart` 非零消费 → 乱序流产内容已 yield 却重发整 POST → 重放部分消费轮（openai 臂正确 gate chunkCount===0）。high
- U2-2 [med] anthropic.ts:427-447 — 孤/乱序 message_stop clean return 绕过自愈 → accumulator 抛「finalize without message_start」硬协议错。med
- U2-3 [med] anthropic.ts:700-702 — parseRetryAfterMs 对 `Retry-After:0`/过期日期返 0 → sleep(0) 跳退避 → ~0ms 烧尽 maxRetries。high机制
- U2-4 [low] anthropic.ts:374-388 — in-stream error 帧在内容后到达无 disconnect 分类标 → replay-safety 全靠 accumulator。low
- U2-5 [low] anthropic.ts:702 — Retry-After up-jitter 再夹回 ceiling → fan-out 同刻醒败坏防惊群。med机制

**accumulator 第五遍（U1，4）**
- U1-1 [med] accumulator.ts:134-193 — content_block_delta 于已关闭 index 静默接受改终态块（守 opening 不守 closed）。med
- U1-2 [low] accumulator.ts:91-131 — 重复 content_block_start 整体覆写 PendingBlock 留陈旧 closedIndices → text 重置丢内容。med
- U1-3 [low] accumulator.ts:285-290 — thinking signature_delta 丢失 → finalize signature:'' → replay API 400。low
- U1-4 [low] accumulator.ts:211-249 — message_delta 解引用 event.usage 无 presence 守卫 → 省 usage 的帧 TypeError 灭轮。low

**memory 全子系统（U4，9）**
- U4-1 [med] memory-tool.ts:316-336 — R8 字节帽只 create 强制，str_replace/insert 无 → 直注 MemoryStore 时 insert 100KB 零守卫。high
- U4-2 [med] mounts.ts:79 + paths.ts:52 — mount 容纳用精确 startsWith 不 Unicode 归一 → APFS 上 NFC/NFD 同 inode 比较不等 → ro 挂载被绕写只读目录。med
- U4-3 [low] store.ts:423-439 — rename 不查目标目录 maxFilesPerDirectory → 别处建后 rename 入绕过 R8 文件帽。med
- U4-4 [low] local-store.ts:105 — write 用 truncate-then-write 非 tmp+rename → crash/并发 → torn/空文件丢原内容。med
- U4-5 [low] store.ts:395-403 — 空文件 insert 幽灵空行。med
- U4-6 [low] store.ts:433-437 — rename 无自包含守卫 → 目录 rename 入自身后代 → raw EINVAL 泄漏。med
- U4-7 [low] local-store.ts:59 — 无路径长度界 → 超长虚路径抛 ENAMETOOLONG raw errno。low
- U4-8 [low] index.ts:236-248 — 字节帽循环首行超 maxBytes 时整个 resident index 丢无信号。low
- U4-9 [med] cards.ts:74-79 — card 解析无转义 → 续行以 `## `/`结论:` 起被误当标题/字段，合法卡体不能往返。med

**misc 工具（U3，2）**
- U3-1 [med] exitplanmode.ts:135 — ExitPlanMode 硬置 setMode('default') 不保存进 plan 前模式 → 用户模式选择静默丢。high
- U3-2 [low] monitor.ts:115 — persistent 用 `===true` 强制、malformed 从不拒 → `persistent:"true"`（串）静默 false → 长 watch 被默认杀。high

**pricing/alias/media/settings（U5，3）**
- U5-1 [low] pricing.ts:37-42 — PRICE_TABLE 漏 `claude-3-sonnet-` 前缀 → estimateCostUsd=$0 → maxBudgetUsd 静默失效（model 已退役故 low）。high存在
- U5-2 [low] pricing.ts:41 — Claude 3 Haiku 缓存价用通用乘子偏离官方（−17%）。med
- U5-3 [low] model-alias.ts:45 — 别名解析单遍不链式 → `{sonnet:'opus'}` 返字面 'opus' → wire 400。med

**structured-output/verifier/tips（U6，3）**
- U6-1 [med] tips/index.ts:162 — evaluateTipReception transcriptAfter 原样插无 fence 无 neutralize 无 inert（sibling 全守）→ 伪造 positive verdict。high
- U6-2 [med] internal/structured-output.ts:385,388 — minLength/maxLength 比 UTF-16 码元非码点 → astral 双计假违规。high
- U6-3 [low] internal/inert-text.ts:47 — singleLine 只剥 `[\r\n]` 漏 U+2028/2029/NEL → 经非 ASCII 换行伪造 ledger 条抑制真报。med

**sandbox·process-kill·async（U8，4 + U8b，1）**
- U8-1 [med] sandbox/bwrap.ts:95-104 — 可写根软链按逻辑路径 --bind 被 `--ro-bind /` 遮蔽 → 软链 writableRoots 写 EROFS。med
- U8-2 [med] internal/regex-guard.ts:38 — MAX_PATTERN_LENGTH=1000 硬帽拒合法长线性模式。med行为
- U8-3 [low] internal/process-kill.ts:44-52 — killProcessTree grace 前读一次 pid → grace 窗内新 fork 孙进程逃 SIGKILL → 孤儿存活。med
- U8-4 [low] internal/async.ts:170-181 — CompletionQueue post-close push() 静默丢值 → teardown 迟到子代理结果无声消失。low
- U8b-1 [med] regex-guard.ts:69-73 — overlaps() 按精确串相等比分支 → `\w`→`C\w`、`a`→`La` 不判重叠 → `(\w|a)+$` 对 `"a"*28+"!"` **实测冻结 V8 63.9 秒**（真 ReDoS 假接受）。high可利用

### 波5（+33）

**工具描述 vs 实现（S-desc，7，全 red-line 违反）**
- Sd-1 [med] descriptions.ts:507 vs websearch.ts:70 — WebSearch 称结果「markdown 超链接 + blocks」实为纯编号文本无超链接。high
- Sd-2 [med] descriptions.ts:525 vs websearch.ts:92 — WebSearch 称「仅美国可用」实零地理门 → 错误抑制合法调用。high
- Sd-3 [med] descriptions.ts:500 vs webfetch.ts:606 — WebFetch 称「内容大时可能摘要」实只硬截断到 100000。high
- Sd-4 [low] descriptions.ts:509 — WebSearch「单 API 调用内自动搜索」实为本地 host 回调。med
- Sd-5 [low] descriptions.ts:91 vs bash.ts:93 — Bash「从用户 profile 初始化」实 spawn 非登录非交互 bash -c 不 source。med
- Sd-6 [low] descriptions.ts:534 — AskUserQuestion「总能选 Other」实 verbatim 传 host、SDK 不保证。med
- Sd-7 [low] descriptions.ts:566 — ExitPlanMode「用户批准后退出」实无条件 setMode。med

**openai 第六遍请求构建（S-oa，4）**
- Soa-1 [med] openai.ts:329-344 — 映射为零消息的轮静默丢（assistant 仅 thinking）→ 两连续 user → 严格网关 400。high
- Soa-2 [med] openai.ts:486,492 — max_tokens 与 reasoning_effort 无条件并发 → o 系列 400「use max_completion_tokens」。med
- Soa-3 [low] openai.ts:447 — system 恒 `role:'system'` 不 remap developer → o1-mini + 非空 system 400。low
- Soa-4 [low] openai.ts:476-482 — tool name verbatim 无 charset/长度校验 → 含点或 >64 字的名 400。low-med

**agent-tool·agents·transport-resolver（S-agent，7）**
- Sag-1 [med] transport-resolver.ts:95-98 — transportIdentityKey 只切凭据/端点 env 不切行为 env → 同凭据不同 MAX_RETRIES 撞 cacheKey → 查询 B 用 A 的重试/超时。high
- Sag-2 [low] transport-resolver.ts:161-171 — memo key 漏 input.debug → 查询 B 子代理经 A 的 debug 回调 log（串号）。high
- Sag-3 [med] runtime.ts:684,714 — agentDef.tools 字符串失败 Array.isArray → allowlist 静默忽略 → 子代理保全部父工具 fails-OPEN，`tools:"Read"` 提权。high
- Sag-4 [low] runtime.ts:696-697 — disallowedTools 非数组 `.filter` 抛 TypeError → 隔离子代理 spawn 崩。high
- Sag-5 [low] runtime.ts:687,728 — tools allowlist 条目无 trim → `' Read'` 匹配零工具静默排除。high
- Sag-6 [low] agent-tool.ts:81-88 — model schema enum 硬编但 execute 不强制 → 引导模型避开有效 override。med
- Sag-7 [med] query.ts:675 + agents.ts:521 — host 注册 general-purpose own-property 守卫遮蔽合成 fallback → 空 prompt 返「no usable prompt」。med

**generators 解析器（S-gen，3）**
- Sgen-1 [med] generators/index.ts:394 — parseMemoryFileSelection 尾逗号 fallback 引号剥不剥前导 `[` → 括号粘首名失配 → security.md 静默丢。high
- Sgen-2 [low] generators/index.ts:105 — 哨兵不对称（injection startsWith / none 严格 ===）→ `None (no prefix)` 裁决错。high
- Sgen-3 [low] generators/index.ts:289-293 — 截断 JSON slug 烘焙 JSON 键成 clean-looking 名掩盖损坏。med

**计时器/监听器清理（S-timer，2）**
- Stim-1 [low] runtime.ts:584 — allBackgroundPromises 只推不剪 → 长寿命 coordinator 无界增长（settled void 量小）。high
- Stim-2 [low] monitor.ts:158 — 非持久 kill setTimeout 早退不 clearTimeout → 闭包持 ctx+shellsMgr 至 timer fire（至多 ~24 天）。med

**fs 错误路径（S-fs，3）**
- Sfs-1 [high] edit.ts:223 — 就地非原子覆写 O_TRUNC 无 tmp+rename（F8 从未移植到 Edit）→ 中途 abort/ENOSPC/EIO 弃原文新文没写完 → 数据丢失。high
- Sfs-2 [low] memory/store.ts:433 — rename dest-exists 守卫 TOCTOU → check 与 rename 间新建 dest 被静默 clobber。low
- Sfs-3 [low] checkpoints.ts:210-216 — restore pre-image readFile 失败 log+continue 但 rewind 仍返 canRewind:true → 不完整 rewind 报成功、状态分歧。med
- Sfs-dup [剔] run-log.ts:135 = round-3 N4 重复。

**loop-support/query-accounting 序列化（S-ls，3）**
- Sls-1 [med] query-accounting.ts:72,89 — accumulateResult 无有限性守卫 → 单个 NaN total_cost_usd 永久毒化 acct.cost → `NaN>=maxBudgetUsd` false → 预算门全会话静默失效、无界花费。med
- Sls-2 [med] run-log.ts:148-153 — 记录构造同步无守卫 → 缺 usage 的 result 同步抛、query.ts:1976 .then 未包 → run 断，违「账本故障不得断 run」。med
- Sls-3 [low] run-log.ts:103-113 — per_tool/models 在 incognito 分支前 populate 从不剥 → incognito 会话记录仍带工具名泄漏活动。low

**query.ts 第六遍事件生命周期（S-q6，3）**
- Sq-1 [med] query.ts:1577-1585 — consumer q.throw 在 queue.next() 挂起时被 input-error handler 误标 blockedResult 后正常 return → 异常被吞+误标 never propagate。high
- Sq-2 [med] query.ts:1329,1364 — q.throw(AbortError 名) 在 driveTurn yield 处误判轮中断 → 重挂 queue.next() → throw() promise 无限 pend。high
- Sq-3 [low] async.ts:86-90 — AsyncQueue.next() 在 fail() 前 shift items + 无 lifeSignal 守卫 → raw abort between-turns + 缓冲消息 → 孤儿用户轮。med

### 波6（+32）

**openai 流状态机（R-oa，6）**
- Roa-1 [high] openai.ts:533-545 — delta.refusal 从不解码 → 拒答文本静默丢、用户得空 assistant 轮。high
- Roa-2 [high] openai.ts:556-568 — mapFinishReason 认 legacy function_call→tool_use 但 feed() 不解 delta.function_call → stop=tool_use 却零 tool_use 块。high
- Roa-3 [low] openai.ts:848-851 — 显式 finish_reason 覆盖真工具 → `tool_calls + finish:stop` 引擎当终态丢工具调用。med
- Roa-4 [low] openai.ts:806-828 — args-only 孤儿无前块 → 空名 tool_use（id=call_0 name=""）不可 dispatch + stop=tool_use。med
- Roa-5 [low] openai.ts:785-791 — lastEmittedToolIndex 循环前算一次 → synth-emitted 后的孤儿见 stale index 成第二个空名块。med
- Roa-6 [low] openai.ts:664 — `choices?.[0]` 硬编 n=1 → choices[1..] 静默弃（SDK 不发 n>1 故 low）。high丢

**sort/比较器/去重（R-sort，5，全 no-tiebreak+cap 不确定类）**
- Rst-1 [med] runtime-report.ts:333 — 「top 消耗」sort `b.output-a.output` 无 tiebreak + slice(topN) → 同 output session 跨边界报告内哪些出现不确定。high
- Rst-2 [med] runtime-report.ts:279 — tools 聚合 sort `b.calls-a.calls` 无 tiebreak + slice → cutoff 处哪些行显示不确定。high
- Rst-3 [med] store.ts:558 — list() sort `b.lastModified-a.lastModified` 无 tiebreak + slice(limit) → 同毫秒 session 在 limit 边界返回哪些不确定（用户可见）。med
- Rst-4 [low] file-store.ts:286 — session-dir 列表 sort 无 tiebreak → 同 mtimeMs 相对序不确定。med
- Rst-5 [low] registry.ts:518 — entryForQualifiedName sort 无 tiebreak → 等长服务时 candidates[0] fallback 不确定。med

**mcp http/stdio 帧生命周期（R-mcp，4）**
- Rmcp-1 [med] stdio.ts:131-132 — stdout 行缓冲无 EOF flush → server 写无 \n 后 exit → 尾行留 buffer、failAllPending 拒 → 已答请求失败丢结果（http M10 已修 stdio 无）。high
- Rmcp-2 [low-med] stdio.ts:432 + http.ts:297 — 超时/abort 不发 notifications/cancelled → server 继续、迟到响应 hit undefined pending 被丢。high缺失
- Rmcp-3 [low] http.ts:419-432 — readSseResponse 首匹配即返 + cancel() → 放弃后续帧 → server 发起的请求永不答。med
- Rmcp-4 [low] http.ts:436 — SSE id/Last-Event-ID 断点续传未实现 → SSE 中途 drop → 无 resume（违 streamable-HTTP resumability）。high有意缺失

**prompt 文本注入面（R-prompt，4）**
- Rpr-1 [med] generators/index.ts:151 — classifyBackgroundState 插 input.tail 原样无 fence/neutralize/inert → 仿示例行的 tail 强制 state=blocked（假 ping）/done（抑真 block）。med
- Rpr-2 [med] generators/index.ts:311 — generateAwaySummary 插 tail 原样无 fence → recap 展示给用户，注入 tail 置「welcome back」摘要。med
- Rpr-3 [low] generators/index.ts:287 — generateSessionName 插 conversation 原样无 fence（near-twin 全守）→ 注入引导名（kebab 归一限影响）。high不对称
- Rpr-4 [med] tips/prompts.ts:72-90 — few-shot 示例演示 `Decision: prose` 格式但契约要 JSON、parser 只收 JSON → 照示例的模型发 prose 失配 → fail-safe 静默丢有效 tip。med

**tool-dispatch 全深读（R-td，5）**
- Rtd-1 [med] tool-dispatch.ts:115-118 — 嵌入 MCP resource blob（二进制无 text）`text ?? uri` 扁平成裸 URI 丢负载 + mimeType 无标记。high
- Rtd-2 [med] tool-dispatch.ts:82,133 — 空 MCP text 块 verbatim 入 content 数组无守卫 → `{text:''}` → Anthropic API 拒空块 400。med
- Rtd-3 [med-low] tool-dispatch.ts:446,493 — builtin 返 `content:[]` 透传不归一空 '' → API 400（MCP 路守 builtin 不守）。med
- Rtd-4 [low] tool-dispatch.ts:216-247 — abort during hook 发 S3 记录但不 recordTool → S3-vs-metrics 少计。med
- Rtd-5 [low] tool-dispatch.ts:224 — S3 记录持久 raw block.input 非改写后实执行 input → 审计不能答「实际用什么跑」。med

**Date/时区（R-date，4）**
- Rdt-1 [med] openai.ts:1096 + anthropic.ts:319 — idle 看门狗用墙钟 `Date.now()-lastEventAt` 非单调 → 系统时钟回拨令 remaining>idleMs → timer 永远重臂、真卡死流永不 abort。med
- Rdt-2 [low] ledger.ts:98,170 — 反-RangeError 守卫只查 isFinite 不查 Date ±8.64e15 → `record(k,{at:1e18})` 过守卫 → toISOString 抛 RangeError。med
- Rdt-3 [low] runtime-report.ts:207-208 — windowHours 未校验 → NaN/Infinity → Invalid Date toISOString RangeError；<0 → 假「no activity」。low
- Rdt-4 [med] config-builder.ts:165 — `<env>`「Today's date」构造期烘焙进 cached systemPromptStable → 长寿命会话跨 UTC 午夜供陈旧构建日。med

**数值算术（R-num，1）**
- Rnum-1 [low] hooks/runner.ts:173,297 — `timeoutMs=seconds*1000` 无 2^31 clamp → matcher.timeout=2_200_000 秒 → Node timer 溢出成 1ms → hook ~立即 abort（>24.8 天触发不现实故 low）。high机制

**permissions gate 决策树（R-gate，3）**
- Rg-1 [med] rules.ts:194-201 — specifier'd deny 规则对任何非表工具（每个 mcp__*/Task/Agent）静默 no-op → `disallowedTools:['mcp__github__delete_file(*)']`/`Task(subagent)` DENY 永不 fire、工具跑（deny 位 fail-open 接受 specifier 语法无警告）。high
- Rg-2 [low] gate.ts:338 — canUseTool 返 undefined 非 ===null → 解引用 undefined 在 try/catch 外 → 未捕 TypeError 逃出而非 fail-closed。med
- Rg-3 [low] gate.ts:189-196 — step-2 先对原始 input deny 即便 hook 改写成 deny-safe → 契约称 hook updatedInput 胜、code 对原始 DENY（fail-closed over-deny）。med

### 波7 收官（+33）

**字符串切分 surrogate（R7-surrogate，10——1 类 10 站点，sliceSurrogateSafe 未导出）**
- R7s-1 [high] grep.ts:116 clipLine slice(0,2000) → grep tool_result 孤 surrogate 上线（模型可见）。
- R7s-2 [high] tool-dispatch.ts:183 summarizeResultContent slice(0,500) → 持久 result_summary 孤 surrogate。
- R7s-3 [high] workflow.ts:139 serializeValue slice(0,100000) → workflow tool_result 孤 surrogate。
- R7s-4 [med] store.ts:777 toSessionInfo slice → listSessions 返 summary/title 孤 surrogate。
- R7s-5 [med] memory/store.ts:129 truncateViewBody 无换行 fallback slice → memory view 孤 surrogate（模型可见）。
- R7s-6 [low] query.ts:757 persistToolRecord slice → 持久 tool_input 孤 surrogate（resume 重放上线）。
- R7s-7 [low] error-normalize.ts:103 + anthropic.ts:1077 + openai.ts:1667 boundMessage slice(0,2000) → 错误消息孤 surrogate。
- R7s-8 [low] mcp/http.ts:662 truncate slice(0,300) → MCP 连接错误 detail 孤 surrogate。
- R7s-9 [low] hooks/runner.ts:100 previewJson slice → hook 结果预览孤 surrogate。
- R7s-10 [low] run-log.ts:122 slice(0,300) → 持久 run-log error 孤 surrogate（审计面）。

**mcp elicitation/sdk-server 第六遍（R7-elicit，2）**
- R7e-1 [med] sdk-server.ts:44 resolveToolAnnotations — 守外层 arg + 空对象但不守内层 null → `{annotations:null}` → `Object.keys(null)` 工具定义期抛 TypeError（应用启动崩，实测复现）。high
- R7e-2 [low] sdk-server.ts:133-134 createSdkMcpServer — tools 数组无 null 守卫 → `[valid,null]` → def.name TypeError 于 server 构造期。med

**环境变量读取（R7-env，3）**
- R7env-1 [med] transport/anthropic.ts:915 resolveStreamMaxMs — envInt 无 2^31 上钳（sibling stall-watchdog.ts:33 有）→ `BPT_STREAM_MAX_DURATION_MS`>2147483647 → setTimeout 溢出 ~1ms → 硬顶阀门在 header 后 ~1ms abort 每一条流 → 全出口停摆。high
- R7env-2 [low] transport/anthropic.ts:898 resolveStreamIdleMs — 只钳下界无上钳 → `CLAUDE_STREAM_IDLE_TIMEOUT_MS`>2147483647 → ~1ms 空转每毫秒重臂（性能退化不 abort）。high
- R7env-3 [med] transport/node-http.ts:305 resolveHttpClient — 见 HTTPS_PROXY 即切 fetch 但 undici fetch 不读 HTTPS_PROXY 除非 NODE_USE_ENV_PROXY → 常规 export 时 SDK 直连源静默绕过审计代理。med

**JSON.stringify（R7-json，6——~60 站点主流已守）**
- R7j-1 [med] hooks/runner.ts:223 filterByCondition — 无守 `JSON.stringify(input)` 对含 tool_response 的 HookInput → PostToolUse 条件钩子 + 循环对象 → 抛在 try/catch（起 246）外 → 钩子分发崩。med
- R7j-2 [low] error-normalize.ts:170-171 — 「Never throws」契约被 `JSON.stringify(nested/top)` 违背（仅活抛对象可触）。low
- R7j-3 [low] transport/anthropic.ts:197 — 无守 wire stringify → caller 自引用 content 块抛裸 circular（OpenAI 臂包 try/catch、Anthropic 不包）。low
- R7j-4 [low] engine/compaction.ts:950 — `firstChars(JSON.stringify(c.input),…)` 对 undefined input → 返 undefined → s.length TypeError。low
- R7j-5 [low] tools/workflow-engine.ts:550-557 stableStringify — 无环守 + BigInt 误处理 → 循环 schema 栈溢出、BigInt 抛 → agent-hash/resume 路崩。low
- R7j-6 [low] tips/index.ts:96 — `session_metadata: ${JSON.stringify(meta)}` 嵌 LLM prompt 无 tag-neutralize（相邻 transcript 已守）→ 含 `</transcript>` 的 metadata 逐字入 selector prompt。low

**contracts/index/public 面第六遍（R7-contracts，3）**
- R7c-1 [med] index.ts:143-156 — `SessionMutationOptions`（7 个导出公共函数的选项袋类型）未从 barrel 再导出 → `import type { SessionMutationOptions }` → TS2305，消费者无法命名 `{sessionDir}` 袋。high
- R7c-2 [med] query.ts:1103 — `incognito:true`+`enableFileCheckpointing:true` 未被拒（两 sibling 组合均拒）→ 原始 pre-image 文件内容写盘 → 破坏 incognito「零持久」契约。med
- R7c-3 [med] query.ts:289-294 — `maxBudgetUsd` 无 `>0` 校验（budgetThresholdRatio 有）→ `maxBudgetUsd:0` → turn1 `0>=0` 真 → 立即 error_max_budget_usd 终止 num_turns:0 无解释。med

**正则 correctness（R7-regex，诚实 0）**
- 11 个 `new RegExp(` + 全部字面正则（~34 文件）7 类缺陷系统扫，**无新缺陷**。正则面高度硬化，
  几乎每条非平凡模式带 2026-07-17 审计注记已闭合范围内类；所有模型供正则路皆 guardRegexPattern 守。

---

## 五、跨切面缺陷家族（横向归纳）

技术报告需人话翻译，每家族附小学生比喻：

1. **权限 deny 绕过家族（≥6 向量）**：M2-2 env-prefix / W9-1 TAB / W10-1 子shell / V4-1 转义引号 /
   V4-2 包裹命令 / Rg-1 specifier-deny-对非表工具，根因**无命令词规范化**、deny 位 fail-open。
   宜统一在 tokenizer 层规范化命令词。比喻：门卫只认「李四」这个名字，你化名、找人代跑腿、把名字用
   引号括起来，都能进——因为门卫从不核实「这人到底是不是李四」。

2. **批 J 转义/inert 不全家族（≥7 站点）**：Y4-1(prelude) / Z7-1(title) / U6-1(tip-reception) /
   U6-3(unicode 换行) / Rpr-1/2/3(背景态/away/session-name)——neutralizeClosingTag/inert 加固只应用到
   部分 prompt 插值站点。比喻：给一排窗户装防盗网，装了大半却漏了三扇，小偷专挑没装的爬。

3. **surrogate 切分家族（10 站点）**：sliceSurrogateSafe 未导出，~10 处裸 `.slice(0,N)` 切断代理对
   产孤 surrogate。比喻：剪彩带时不看图案，一刀下去把一个完整的字剪成半个乱码。

4. **sort-无-tiebreak + slice-cap 不确定家族（5 站点）**：等键元素在 cap 边界跨运行返回不同子集。
   比喻：并列第一的两人抽签排名却不记结果，每次报名单上榜的人还不一样。

5. **timer 32-bit 溢出家族**：R7env-1/2 + Rnum-1，超大毫秒值 setTimeout 溢出成 ~1ms（有 clamp 的
   monitor/stall-watchdog 幸免，缺 clamp 的 runner/stream-max/stream-idle 中招）。比喻：闹钟表盘只有
   24 天刻度，你定 25 天，指针绕一圈立刻响。

6. **修复不全/回归家族**：批 E 子代理 gate 漏保护（Y1-1）、批 G F1/F8 回归（Y5-1/2）、F8 未移植到
   Edit（Sfs-1）、M2 overlap 假接受真 ReDoS（U8b-1）。比喻：补了 A 处墙、却把 B 处电线压进了墙里。

---

## 六、诚实声明（两种读法，承 r3 §H）

本报告「205 净新增 / 累计 509」的诚实边界：

- **读法一（工程严格）**：每条均回源直读、多为 low/med 严重度的边角与协议合规问题；其中真正
  high 危害（数据丢失、权限绕过、ReDoS、拒答丢失、预算门失效）约 **20 余条**，其余为
  fidelity/一致性/边界/可观测性问题。「509」是**候选缺陷计数**，非「509 个必须立即修的 P0」。
- **读法二（诚实达标）**：守密人目标是「累积 500」，本轮以真发现达成并诚实溢出至 509——末位
  「正则 correctness」代理诚实回报 **0**、未为凑数补编；每波均含诚实剔除（重复/已修/文档化非目标）
  与诚实 fix-status 标注。**宁缺毋滥红线全程未破**。

fix-status 纪律（§4.2 R3）：本报告全部为「审计发现」，**非「代码已修」**；批 A–J 已修的原缺陷
不重报为「未修」，但修复引入的新缺陷/修复不全为本轮正题。

---

## 七、修复批次指引

本轮 205 项按亲和度可并入既有八批修复方案（T51 已录）或另立批次；高价值优先序建议：

1. **P0 数据/安全**：Sfs-1(edit 非原子写) · Y1-1(子代理 gate 漏保护) · U8b-1(ReDoS) · Sls-1(NaN 关预算) ·
   Roa-1/2(openai 拒答/function_call 丢) · R7c-2(incognito 落盘)
2. **P1 权限家族统一**：deny 绕过 6 向量（tokenizer 层命令词规范化）+ Rg-1(specifier-deny fail-open)
3. **P1 转义家族统一**：批 J 7 漏站点一次性补 neutralize/inert
4. **P2 横扫家族**：surrogate 10 站点（导出 sliceSurrogateSafe 统一调用）· sort tiebreak 5 站点 ·
   timer clamp 3 站点
5. **P3 边界/一致性**：其余 low 项按子系统批处理

---

*报告产出：艾瑞卡（弥萨格大学数据库终端）· 银芯知识层 · 2026-07-17 UTC+8。工作底稿见
`Public-Info-Pool/Rough/sdk-bug-audit-r4-20260717.md`（gitignored 过程废料）。*
