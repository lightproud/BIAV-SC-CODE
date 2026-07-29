# SCS 工具调用参数健壮性审计 · 三代理全工具面扫描

- 日期：2026-07-29（北京时间）
- 触发：守密人「工具调用还有什么 bug 请继续查找」（承 2.2.1 输入形状诊断案）
- 落地版本：silver-core-agent-sdk **2.2.2**（maestro 2.2.2 锁步，零代码改动）
- 状态：SHIPPED — 六缺陷全修 + 一权限旗镜头判 CLEAN；`tests/tool-param-robustness.test.ts` 11 例锁定；全量 3450 绿
- 方法：三个子代理按文件分区并行审计（fs/exec 组、网络/交互组、记忆/工作流/注册表组），
  每条发现由艾瑞卡逐一读码 + 部分 dist 产物 / fast-glob 实测复核后采信

## 一、审计镜头与统一主题

承 2.2.1 的镜头：**「工具调用参数被静默错待——产出错误结果或崩溃，而非正确执行或诊断报错」**。
2.2.1 修的是「参数在链路上蒸发」（宿主改写丢字段），本轮扫的是同族的另一半：
**参数类型 / 形状错误时，工具静默吞没（回落默认 / 转前台 / 清空结果）而非诊断报错**。
SDK 既有明确纪律（Read / WebSearch query / Grep type 均对错类型显式报错），
本轮找的正是**违背该纪律的静默回落点**，以及少数会**崩整调用**的 try 外解引用。

## 二、已修缺陷（六条，按严重度）

| # | 严重度 | 位置 | 触发 | 机理 | 修复 |
|---|--------|------|------|------|------|
| 1 | HIGH | `grep.ts` 枚举 / `glob.ts` fg 调用 | Grep `glob:"!*.test.ts"`、Glob `pattern:"!**/*.md"` | 纯否定 glob 无正向基，fast-glob 返回 `[]`，含命中语料被报「No matches / No files」——ripgrep `-g '!x'` 惯用法在此静默失效 | 纯否定时枚举 `['**/*', 负模式]`，从全部文件排除；type 扩展后置过滤仍协同 |
| 2 | HIGH | `bash.ts:612` | `run_in_background:"true"`（字符串） | 严格 `=== true` 令字符串静默转**前台**执行，长驻服务被 120s 超时 SIGTERM/SIGKILL | 非布尔诊断报错（点名收到的类型）；`undefined` 仍走前台 |
| 3 | MED | `bash.ts:601` | `timeout:"5000"`（字符串）/ 0 / 负 / NaN | 静默回落 120s 默认，模型自以为给危险命令上了 5s 紧箍 | present-but-非正有限数诊断报错；`undefined` 仍用默认 |
| 4 | MED | `websearch.ts:214/216` | 后端回调返回数组含 `null` 元素 | `filterResults`/`renderResults` 在后端 try 外解引用 `r.url`，一个 null 抛 TypeError、dispatch 兜成泛化失败、**整批结果丢失** | filter/render 前丢弃非对象元素（同 askuserquestion/todo 逐元素守卫，同本档既有 lax 后端容忍纪律） |
| 5 | LOW | `askuserquestion.ts:182` | 宿主 handler 应答 `header`/`answers` 含换行 | 行式应答摘要未过 `singleLine`，换行伪造额外「Header: value」记录行（同 WebSearch 1.4.0 已修 title 换行伪造同型） | `header` 与每条 answer 过 `singleLine` |
| 6 | MED | `memory-tool.ts:449` | 注入 `MemoryStore` 以**非 Error** 值 reject（`throw 'db down'` / 驱动 `{code}` 对象） | `(e as Error).message` 得 `undefined`，报错**无因** + `content:undefined` 而 dispatch 只归一空数组不归一 undefined（有 400 风险） | `e instanceof Error ? e.message : String(e)`（L74 同族守卫，运行时 memory 工具是唯一漏网——contract-suite/resources/webfetch/websearch/askuserquestion 早已具备） |

小学生比喻（逐条）：
1. 保安拿到「除穿蓝衣的都放行」的名单，却理解成「名单没写具体名字＝谁都不放」，回报「今天没人来」。
2. 快递单「放门口」栏写了「对」而没打勾，快递员当没勾，站门口举包裹等两小时再带回销毁。
3. 定了 3 分钟的煮蛋计时器，旋钮其实没拧动，锅按出厂默认煮了半小时。
4. 分拣员被交代「有的包裹没贴标签也照收」，却没被告知「箱里可能混着空气」——一遇空位就愣住、整车退回。
5. 回执单每行算一条，用户勾选栏塞了个回车，一条勾选冒充成两条批复。
6. 医生说「设备坏了」却不说哪坏了，病历上那一栏是空白——后面的人既不知原因、又被一张空病历卡住。

## 三、权限旗镜头判定 CLEAN（最高价值确认）

对 `index.ts` 注册表逐工具比对 `readOnly`/`isFileEdit`/`parallelSafe` 声明 vs `execute` 实际副作用：

- **无任何写 / POST / kill / worktree 工具被误标 `readOnly:true`**（误标会令其在**所有**权限模式含 plan 自动放行）。
  所有 `readOnly:true` 内建工具均外部无副作用或仅推进内部游标 / 会话态（同 TodoWrite 先例、测试锁定）；
  所有改状态工具（Bash/Write/Edit/Monitor/KillShell/TaskStop/EnterWorktree/Workflow/SendMessage/memory）均正确 `readOnly:false`。
- `parallelSafe` 仅 `Agent` 置位（隔离子上下文），无 fs/状态工具误标并行安全。
- 记忆挂载边界：五个改写命令（create/str_replace/insert/delete/rename）**均**命中只读挂载拒绝；
  `validateMemoryPath` 多轮 URL 解码 + NFC 后对任何 `.`/`..` 段**先行整体拒绝**（`/memories/team/../../etc` 在 mount 前缀匹配前就抛）；`local-store` realpath 拒符号链接越界。
- worktree/plan 态机：建两次拒、无 enter 就 exit 报错、kill 未知 id 报错，跨轮 cwd 经 `peekWorktreeSession` 重取（`enterworktree.ts:29` 档头「下轮回退」注释为**陈旧**、行为已正确，非 bug）。

## 四、审计后判为「非缺陷 / 有意设计」（不修，照实记录）

- **fence 反引号根数**（`structured-output.ts:255`）：4 反引号内含 3 反引号行时 strict 提取截断；
  但 schema 校验兜底 → `agent()` 返回 `null`（虚假死代理），非数据损坏，非可证缺陷（与 maestro 1.3.0 图加载器不同，那里误扫会派发假图）。
- **memory `view` 在 plan 模式被粗粒度工具旗拒**（`memory-tool.ts:275` 六命令共用 `readOnly:false`）：
  只读 view 在 plan 模式无 handler 时**fail-closed**（拒读、非提权），一旗服务六命令的固有取舍，无安全影响。
- **ExitPlanMode/EnterPlanMode `readOnly:true` 自动放行权限模式变更**：有意设计 + 测试锁定（Z4-1 明记 skipped by design）。
- Grep `path` 非字符串静默回落 cwd、Grep 选项（-i/-C/glob 等）类型错误静默丢弃、Bash 后台 ack 无 structuredOutput、
  Grep `numFiles` 跨模式语义漂移、Grep 单文件目标附「已排除」失实披露等 **LOW 静默回落 / 契约小疵**：
  与本轮已修的 timeout/run_in_background 同族，但属**更广的行为收紧面**（一次改多参数、改宽容→严格），
  未纳入本批以保提交聚焦；如守密人认可「静默回落全线改诊断报错」的方向，可另开一轮统一收口。

## 五、验证

- typecheck exit 0；`npm run build` exit 0；全量 **3450 通过 + 5 skipped**（较 2.2.1 的 3438 +12）
- 新测 `tests/tool-param-robustness.test.ts` 11 例：否定 glob 命中/正向 glob 不变/Glob 否定、
  Bash 两参数类型错误报错 + 合法值仍跑、WebSearch null 元素存活、AskUserQuestion 换行不伪造、memory 非 Error 抛值两形。
- 版本守卫、档案三卫（size/facts/doc-facts）全绿。
