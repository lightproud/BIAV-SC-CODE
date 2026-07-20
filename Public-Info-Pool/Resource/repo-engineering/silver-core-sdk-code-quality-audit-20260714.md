# Silver Core SDK 代码质量审计报告

- **日期**：2026-07-14（北京时间；UTC 同日）
- **对象**：`projects/silver-core-sdk/` v0.57.2（`src/` 39,600 行 TypeScript，123 个测试文件 / 44,885 行）
- **方法**：机器验证（tsc + vitest 全量）+ 客观卫生指标采集 + 四分区并行人工审读（engine 核心环 / tools+sandbox+permissions+hooks / transport+mcp+generators / sessions+subagents+reporting），全部发现回读源码核实，三条高危由主审终验坐实
- **性质**：只读审计，未改动任何 SDK 源码；所列行号以 main 分支 2026-07-14 快照为准

---

## 一、结论速览

**总评：高水准代码库，骨架健壮、边角有缝。** 无阻断级缺陷；机器验证双绿；发现 **3 高危 / 13 中危 / 约 20 低危**。高危全部集中在「较新的生命周期缝隙」（错误响应体读取、auto-resume 监督层、子代理检查点），核心安全边界（权限门 / 沙箱 / 记忆路径校验 / fail-closed 解析器）经对抗核查未发现绕过。测试文化是全仓最强一面：零 skip 滥用、零快照膨胀、property-based 损坏注入、变异测试棋轮门禁在役。

| 维度 | 结果 |
|------|------|
| 类型检查 `tsc --noEmit` | exit 0 |
| 全量验证程序 `vitest run` | **2288 通过 / 3 跳过（均平台条件跳过）/ 0 失败**，123 文件，31.9 秒 |
| `as any` | 全 src 仅 **1** 处（有文档说明） |
| `@ts-ignore` / `@ts-expect-error` | **0** 处（src）；测试层 4 文件顶部 `@ts-nocheck` |
| 静默吞错 `catch {}` | **0** 处 |
| 真实 TODO/FIXME 挂账 | **0** 处（6 个 grep 命中均为 TodoWrite 工具名误命中） |
| 变异测试地板 | permissions 92.87 / transport-openai 85.55 / transport-anthropic 82.97 / sessions 67.66（棋轮只升不降） |
| lint 配置 | **无**（无 eslint/biome；`noUnusedLocals` 未开，故死导入不报） |

---

## 二、高危发现（3 条，全部主审终验坐实）

### H-1 非 2xx 错误响应体读取无界且不可中止（双传输臂同病）

- **位置**：`src/transport/anthropic.ts:595-601`；`src/transport/openai.ts:1266-1269`（同构）
- **缺陷**：非 2xx 后先 `releaseSignals()` 摘掉 caller 与 timeout 两个 abort 监听器，随后才 `await readErrorInfo(response)` 读错误体。默认 HTTP 客户端 `'node'`（v0.45.0 起）无任何 body/socket 超时。对照组：MCP 的 `http.ts:235` 在清 timer 之前读错误体，做法正确。
- **失败场景**：网关返回 429/5xx 响应头后 body 停滞（故障代理 / 半关中间盒），`response.text()` 永久悬挂，且用户 interrupt/teardown 已无从取消——整轮对话无声卡死。
- **比喻**：快递员敲门被拒后非要站在门口听完对方的长篇解释才肯走，而你此刻已经收走了他的对讲机——天黑也叫不回来。

### H-2 auto-resume 遗弃旧 query 生成器，teardown 永不执行（资源泄漏）

- **位置**：`src/session-manager.ts:443-455`（`scheduleResume` 仅 `q = start({sessionId})` 换新）；受害方 `src/query.ts:1618-1692`（run() 的 finally）
- **缺陷**：可恢复错误触发换新 query 时，对旧 query 既不 `close()` 也不 `return()`；旧生成器挂起在 yield 点，其 finally（杀后台 shell、删 `bpt-sbx-*` 沙箱临时目录、子代理 abortAll/settleAll、SessionEnd 钩子、`MirroringSessionStore.flushAll`、摘 outer-abort 监听器）永不运行。
- **失败场景**：托管会话中途遇 429/5xx 触发 auto-resume → 旧会话的后台 shell 子进程继续存活、外部 store 镜像缓冲永不 flush（恰是恢复所依赖的持久层）、SessionEnd 钩子丢失；每会话最多泄漏 `maxResumes`（默认 2）次。
- **比喻**：换了辆新车继续送货，旧车没熄火没锁门还停在路中间——发动机空转，后备箱里没寄出的包裹也跟着丢了。

### H-3 检查点不覆盖子代理的文件编辑，rewind 报成功但回滚不完整

- **位置**：`src/subagents/runtime.ts:1244-1263`（childToolContext 无 `recordFileChange`）；对照 `src/query.ts:1089`（根上下文有注入）；`src/tools/edit.ts:177`、`write.ts:106-121` 的 `ctx.recordFileChange?.` 静默跳过
- **缺陷**：子代理的所有 Write/Edit 均无预镜像进检查点索引；`FileCheckpointStore.rewind()`（`checkpoints.ts:157-229`）仍返回 `canRewind: true`，无「覆盖不全」提示。
- **失败场景**：父代理把实现任务委派给子代理改了 10 个文件，rewind 回滚该回合 → 只有父代理自己碰过的文件被还原，子代理的 10 处修改原样留存，而结果对象宣称回滚成功。
- **比喻**：班级大扫除的「还原监控」只装在班长身上——班长叫同学搬走的桌子，还原时没人记得搬回来，登记表上却写着「已全部还原」。

---

## 三、中危发现（13 条）

### M-1 hooks 回调默认 fail-open
- `src/hooks/runner.ts:120`（`failureMode ?? 'open'`），落地 306-316。崩溃/超时的 PreToolUse 安全钩子被当「没表态」放行——策略在钩子最脆弱时恰好失效。`'closed'` 需显式 opt-in。
- 比喻：门口保安晕倒了，默认规则却是「保安不在就让所有人进」。

### M-2 Grep / BashOutput 用户正则无 ReDoS 护栏
- `src/tools/grep.ts:159/144`、`src/tools/shells.ts:250`。模型正则直接编译并在最大 10MB 文件上同步执行，abort 只在文件间检查，无法打断正则引擎内部灾难性回溯；对照 `hooks/matcher.ts:48` 专门装了 `hasNestedQuantifier` 护栏，防护不一致。`(a+)+$` 一类模式可冻结整个 agent 进程。
- 比喻：一道门装了防「死循环密码」的锁，隔壁那道门忘了装。

### M-3 WebFetch SSRF 存在 DNS-rebinding 时间窗
- `src/tools/webfetch.ts:149-180` guard 解析校验与 `:331` fetch 的第二次独立解析之间，TTL=0 域名可重绑至 `169.254.169.254` 等内网地址。注释已诚实标注残留风险。
- 比喻：保安查完证件是真的，转身开门的瞬间访客换了张脸。

### M-4 MCP registry：closeAll/setServers 与进行中的 connect 交叠 → 泄漏僵尸子进程
- `src/mcp/registry.ts:288-302 / 273-285 / 312-376`。握手中 `entry.connection` 为 null 被 closeAll 跳过，握手完成后连接发布到已被抛弃的 entry 上，无人再 close。
- 比喻：锁教室只数「已坐下的学生」，走廊上那个进门后被反锁过夜。

### M-5 OpenAI 翻译臂：有 tool_calls 但网关省略 finish_reason 的流被误定为 end_turn
- `src/transport/openai.ts:1113-1117 / 790-792 / 547-560`。`finish()` 明知缓冲里有工具调用却不据此推断 → 模型请求的工具调用被静默丢弃，会话无声终止。
- 比喻：厨师递出点菜单忘了喊「下单」，传菜员就当他说「饭做完了」直接收摊。

### M-6 默认 'node' HTTP 客户端静默绕过代理环境
- `src/transport/node-http.ts:270-280`（默认 `'node'`，不读 HTTPS_PROXY；头注 24-29 承认仅 'fetch' 支持代理）。代理环境用户升级 0.45+ 即断连，错误表现为泛化网络错误极难排查。
- 比喻：小区规定包裹必须走门卫代收，新快递员却学会翻墙直送——翻不过去包裹全丢，翻过去躲开了登记。

### M-7 恢复边界上 costUsd / modelUsage「latest wins」丢失恢复前花费
- `src/session-manager.ts:305-311` + `src/query.ts:896`（新 query 累计器归零）。花 $0.50 后恢复再花 $0.05 → 总账报 $0.05 而非 $0.55，黑池按此对账即失真。
- 比喻：换了本新账本，把旧账本整本扔了，只报新账本上的数。

### M-8 pause_turn 续跑路径缺预算门禁
- `src/engine/loop.ts:1254-1262` 只查 `maxTurns` 不查 `budgetStopReason()`；其余四条续跑路径全部两查。服务端反复 `pause_turn` 时 `maxBudgetUsd` 封顶被绕过。
- 比喻：四个门的保安都查饭卡余额，唯独侧门那个只数进出次数。

### M-9 本地 JSONL 主存储 append 无撕裂尾自愈
- `src/sessions/store.ts:272-299` 直接 `appendFileSync`；对照 `file-store.ts:174-209` 明确实现了 `endsWithoutNewline` 自愈——同仓不对称。崩溃残行粘连下一条记录，两行一起丢；若粘掉 `turn_complete` 还会误触发幽灵 redrive（重复计费）。
- 比喻：笔记本被撕了半行，下一个人不换行接着写，两句话搅成一团整段作废——隔壁那本会先补个换行，这本忘了。

### M-10 并行 Agent 批次与共享持久 shell 状态冲突
- `src/subagents/agent-tool.ts:51-55`（`parallelSafe: true`，声明「无共享可变态」）与 `runtime.ts:1250-1256`（childToolContext 共享 `shells`）+ `bash.ts:263-276`（同一 state 文件读写 cwd/env）矛盾。并发子代理 A 的 `cd` 会回放进 B 的下一条 Bash。
- 比喻：两个小孩同时用同一张「上次走到哪儿」的便条，B 照着 A 的便条跑错了地方。

### M-11 前台子代理 kill 路径三连缺陷
- `src/subagents/runtime.ts:1475-1483`（catch 无 guard 覆写 status='failed'，后台路径 1382 有 guard）+ `1591-1615`（通知文案写死 "background"；abort 上抛致整个父查询崩收）。`stopTask` 想停一个子任务，结果全查询终止、状态记错、通知说谎。
- 比喻：想按掉一个闹钟，结果拉了全楼电闸，事故记录还把闹钟登记成「别人家的」。

### M-12 报告聚合零 shape 校验，一条坏行毁整份日报
- `src/reporting/runtime-report.ts:102`（`JSON.parse(line) as RunLogRecord`）+ `:178-181` 直接解引用 `r.usage.input_tokens`。注释宣称 "bad lines are counted, not fatal" 只覆盖 parse 失败；外部 producer 混写 schema 即 TypeError，`compareReports` 同炸。
- 比喻：门卫只检查「是不是一张纸」，收进一张空表格，月底算账程序当场死机。

### M-13 Workflow resume 前缀缓存对并行分支内多段 agent() 时序敏感
- `src/tools/workflow-engine.ts:662-702 / 788-799`。seq 按调用先后分配，并行分支完成时序变化即 hash 错位、缓存静默失效——语义安全但「重放最长不变前缀」承诺对多阶段并行工作流退化为全量重跑（重复计费）。
- 比喻：接力赛按「谁先跑完」发号码牌，重赛名次稍变，裁判就认不出这棒已经跑过，让大半队伍白跑。

---

## 四、低危发现（摘要，约 20 条）

| # | 位置 | 缺陷 | 比喻 |
|---|------|------|------|
| L-1 | `src/engine/loop.ts:647` | 缓存键分隔符把**裸 NUL 字节（0x00）**直接嵌进源文件（应写 `' '` 转义），grep 等文本工具将整文件误判为二进制 | 书里夹了一根看不见的针，翻书机器一碰到就说「这不是书」 |
| L-2 | `src/transport/{anthropic:650,openai:1316}` | Retry-After 路径零 jitter，并发扇出同刻重击网关 | 全班掐着同一只秒表在同一秒挤回门口 |
| L-3 | `src/transport/anthropic.ts:296-315` 等 | 空闲看门狗度量「消费者处理进度」而非「服务器字节」，宿主背压超 300s 误杀健康流 | 值日生盯的是同学翻书速度，不是老师有没有在讲课 |
| L-4 | `src/generators/runtime.ts:71-99` | 每次 utility 调用新建传输，`maxConcurrentRequests` 并发帽跨调用失效 | 每人手里一张自己的限流卡，谁也限不住谁 |
| L-5 | `src/mcp/stdio.ts:142-150` | spawn 失败（ENOENT）不置 closed，直接消费方后续请求白等 60s 超时 | 电话没装上，前台却每次替你拨号傻等一分钟忙音 |
| L-6 | `src/query.ts:1226-1254` | turn 级 interrupt 丢失已计费 usage，会话预算欠账 | 退单了但钱其实收了，账本上没写这一笔 |
| L-7 | `src/session-manager.ts:487-521` | auto-resume 后重复 init 消息透传，按「一流一 init」建模的 UI 出现幽灵新会话 | 换了备用播音员，把开场白又完整念了一遍 |
| L-8 | pricing/query-accounting/session-manager/query 四处 | `addUsage`/`zeroUsage`/`mergeModelUsage` 3-4 份逐字节复制，加字段易改一漏二 | 同一份菜谱手抄三份分给三个厨房 |
| L-9 | `src/engine/loop.ts:25-51`、`runtime.ts:25-30,289` | 抽取遗留死导入（loop 6 个类型 + runtime 6 导入 1 定义）；`toAbortError` 双份；`generators/runtime.ts:150` 死变量 `closed` | 搬家后旧钥匙还挂在钥匙圈上 |
| L-10 | `src/tools/bash.ts:109-128` 与 `shells.ts:94-117` 等 | killGroup / looksBinary / CappedStream 多处复制维护 | 同一份灭火步骤抄在两个房间的墙上 |
| L-11 | `src/sandbox/bwrap.ts:32` | `--ro-bind / /`：沙箱只挡写+网，宿主全盘可读（含 SSH 私钥），系明示设计取舍，部署方须知 | 保险柜焊死了塞口和电话线，但柜门是玻璃的 |
| L-12 | `src/tools/memory/local-store.ts:32-49` | symlink 校验存在 TOCTOU 窗（纵深第二层，实际可利用性低） | 量完门框合格再搬东西，那一刻门框被换成暗门 |
| L-13 | `src/tools/monitor.ts:146-153` | 非 persistent kill 定时器未入 dispose 清理（已 unref，无副作用） | 人走了闹钟没撤，响的时候锅早端走了 |
| L-14 | `src/sessions/store.ts:732-746` | getSessionInfo 走全量 load()，绕过 list() 已做的 meta-only 优化 | 为看封面把 500 页书逐页读完 |
| L-15 | `src/sessions/session-functions.ts:165` + `tool-claims.ts:60` | 双重 cast 假定 tool_input 为 string，外部 store 存对象即审计满屏误报 | 把「是不是纸条」当成「纸条上写了啥」 |
| L-16 | `src/reporting/run-log.ts:157` | 日文件按 flush 时刻命名，跨午夜记录落错日文件 | 23:59 写的日记记到了第二天那页 |
| L-17 | `src/sessions/checkpoints.ts:61-69,241-260` | 双实例同会话 seq 碰撞（M3 修复只盖 blob 名），rewind 先后次序未定义 | 两个登记员各自从 1 开始编号，档案册里出现两个 3 号 |
| L-18 | `src/sessions/store-adapter.ts:271-289` | MirroringSessionStore.list() 本地非空即短路，跨主机列表不完整（resume 却能成功，表现自相矛盾） | 花名册只抄了本班的，隔壁班同学喊得到人却查无此名 |
| L-19 | `src/tools/workflow.ts:112-121`；`session-functions.ts:215-219` | inline workflow tmp 目录只增不清；deleteSession 对无 delete 能力 store 静默「成功」 | 草稿纸从不扔；喊「删了」其实碎纸机没插电 |
| L-20 | `src/tool-types.ts:50-61` | AgentInput 声明 4 个运行时不存在的幽灵字段且未按 wire-type 惯例标注 | 菜单上印着四道后厨从没做过的菜 |

---

## 五、无缺陷确认项（对抗核查通过，防复查重复劳动）

- **权限门九步序**：deny 压 ask、sandboxEscape 独立维度强制 prompt、canUseTool 抛异常按 deny——fail-closed 闭环。
- **记忆路径校验**（`paths.ts`）：多轮 URL 解码 + 反斜杠双查 + 段级 `..` 拒绝 + realpath 复检——全仓最扎实一处，未发现绕过。
- **generators/tips/verifier fail-closed 契约逐条真实闭合**：多行/空回复判 injection、白名单过滤幻觉文件名、坏 JSON 直判 REFUTED、tips 只认 catalog 权威值。
- **SSE 尾帧 flush 偏离 WHATWG**、**空流重试重发 POST**：均注释明示故意且论证自洽。
- **双传输臂约 250 行重复**：有 `transport-twin-drift.test.ts` token 锁兜底，风险受控。
- **query.ts finally 回收序**（先 settle 后 flush）、fallback usage 折账时点、thinking 签名保护：核实无误。
- **JSONL 损坏容错 / repairPairing 三遍修复 / isSafeSessionId 穿越防护**：闭环。

## 六、测试层评价

抽样 8 份 + 全量跑通：**零 `.skip`/`.only`/`.todo` 滥用（仅 2 处平台条件跳过）、零快照断言**；`property-sessions.test.ts` 用 fast-check 做 105 轮随机损坏注入（断言「损坏只删信息不造信息」）；mutation-kill 批次按变异得分定向补强并有棋轮地板；断言普遍打到精确值而非 `toBeTruthy`。瑕疵：4 份测试文件 `@ts-nocheck`、少量 `setTimeout(r,3)` 式 mtime 排序有理论 flake、conformance 层为 vitest 外自制 harness。

## 七、建议修复优先序（供守密人裁定）

1. **P0（高危 3 条）**：H-1 错误体读取纳入超时/abort 治理；H-2 scheduleResume 先 `close()` 旧 query；H-3 childToolContext 透传 `recordFileChange`（或 rewind 结果如实报「覆盖不全」）。
2. **P1（安全/资金一致性）**：M-1 hooks 默认改 closed 或至少文档高亮；M-2 Grep 复用 matcher 的 ReDoS 护栏；M-7/M-8 预算与费用账一致性；M-9 store.ts 补撕裂尾自愈（file-store 现成模式照搬）。
3. **P2（正确性长尾）**：M-4/M-5/M-10/M-11/M-12/M-13 + 低危卫生批（死导入、NUL 字节、重复代码合流）。
4. **工程配套**：引入 lint（至少开 `noUnusedLocals`）；本报告全部发现建议按仓例转为回归测试后销案。
