# BPT Desktop 命令框架 落成方案 v1.0

- 日期：2026-07-10
- 作者：艾瑞卡（守密人 /goal「你自己试一下所有命令，然后分析命令的实现，落成方案」工单终件）
- 性质：银芯 → 黑池单向输出物；**基于一手自体试用观测**（非纯文档推演）
- 证据基线：观测台账 `cc-command-behavior-observations-20260710.md` OBS-001~010
  （10 条活体观测）+ 需求说明书 v1.1（R1-R5）+ 五类盘点档 + SDK v0.39
- 与需求档的关系：需求档回答「要什么」，本方案回答「怎么建 + 官方实际怎么建的」

---

## 1. 观测定论：命令的实现是四层架构

自体试用 10 组观测（含 2 组守密人触发、8 组艾瑞卡自触）收敛出官方实现的四层：

```
第 1 层 客户端本地层（A 类）          /model /clear /goal(注册动作) …
        客户端解析执行，模型只收事后通报（<local-command-caveat> + system-reminder）
        ↓ 证据：OBS-001/002/009（代理侧结构性不可达）
第 2 层 技能注入层（B/C/D/E 类统一！） /loop /code-review /validate-data …
        联邦注册表解析 → 技能 markdown 以用户回合注入 → 模型照章执行
        ↓ 证据：OBS-003/004/005/007/008
第 3 层 harness 工具层                CronCreate / ScheduleWakeup / Monitor / Skill
        技能文本是「菜谱」，真正的手脚是工具；调度双平面（会话级/服务端持久级）
        ↓ 证据：OBS-005/006
第 4 层 引擎层                        /compact 特判 · Stop 钩子门控
        唯一进引擎主循环的命令语义；BPT SDK v0.38/v0.39 已对齐
        ↓ 证据：OBS-002/010 + SDK stop-hook-block 5 测
```

**最重要的架构定论**（修正五类盘点的认知）：B/C/D/E 四类在现代 harness 里
**不是四套机制，是一套技能注入机制的四个注册来源**。「命令」只是技能的触发语法糖；
技能文本本身无能力，能力全在工具层。小学生比喻：菜名（命令）→ 菜谱卡（技能文本）→
厨具（工具）→ 灶台（引擎），四类命令的差别只是菜谱卡从哪个抽屉来。

**试用覆盖度**（诚实申报）：自体全试 8 组（validate-data / keybindings-help /
loop+Cron 三连 / code-review low / send_later+list+delete / ListSkills / ListPlugins /
CronList）；守密人触发观测 2 组（/model /goal×2）；结构已知未重复执行 13 个
（simplify/review/security-review 与 code-review 同族、daily-news/sync-memory 与
validate-data 同机制、deep-research/grilling 等重型或交互型——机制无新增量，费用有）；
A 类约 25 个结构性不可自触（OBS-009 边界证明）。

## 2. 方案：BPT Desktop 五模块

### 模块 M1 命令路由器（壳层，P0）

单一入口拦截 `/x args`，四路分发（对应需求档 §2 分工图，落成为代码结构）：

```
CommandRouter.dispatch(input)
  ├─ localTable.has(name)      → M2 本地命令执行器
  ├─ skillRegistry.has(name)   → M3 技能注入器
  ├─ schedulerCmds.has(name)   → M4 调度器（/loop /schedule /goal）
  └─ else                      → 原文透传 SDK（引擎侧或落 .claude/commands 的由 SDK 展开）
```

**观测移植点**：本地命令执行后向模型上下文注入「事后通报」，**逐字段仿官方格式**
（OBS-001 实测：`<local-command-caveat>` 防误答 + `<command-name>/<command-args>/
<local-command-stdout>` 三件套 + 必要时 system-reminder 描述状态变化）。SDK 侧用
`streamInput` 附带 `shouldQuery:false` 型注入（官方文档快照 1031 行同款语义：入
transcript 不触发回合）。

### 模块 M2 本地命令执行器（壳层，P0）

需求档 R1.3 清单不变；本方案补观测到的实现契约：

- 输出**不入会话史**（OBS-001：/model 的 stdout 从不变成对话回合）；
- 每条本地命令绑定 SDK 控制面调用（/model→setModel、/permissions→setPermissionMode、
  /mcp→mcpServerStatus+reconnectMcpServer）——OBS-004 斩获的 120+ UI 动作表
  （chat:modelPicker / chat:fastMode / voice:pushToTalk…）作 P1/P2 扩展的完整菜单。

### 模块 M3 技能注入器（壳层，P0——本方案相对需求档的最大升级）

OBS-008 定论：命令面是**联邦注册表**，故 M3 设计为：

1. **注册表接口** `SkillSource { list(): SkillMeta[]; load(name): string }`，四个实现：
   内建骨架命令源（B 类，按裁定「结构再现+文本自写」自产文本）、`.claude/commands`
   源（C 类——**直接透传给 SDK v0.38 引擎展开，壳层不重复展开**，防双端漂移）、
   插件源（D 类，预留）、MCP prompts 源（E 类，预留）；
2. **注入形态**：技能正文以用户回合送引擎（OBS-003 观测的官方形态）；UI 气泡显示
   `/name args` 原文、展开文可折叠（需求档 R2.2 不变）;
3. **指导型 vs 指令型**（OBS-004 分型）：注册表元数据加 `kind: guidance|protocol`，
   面板分组展示，指导型注入后不期待动作;
4. **档位闸门**（OBS-007 移植）：重型技能带 `effort` 参数，低档注入紧凑协议、
   高档注入多相协议——成本控制落在**注入哪份文本**上，不是运行时开关。

### 模块 M4 调度器（壳层，P1——按 OBS-005/006 双平面重构原 R3）

原需求档只设计了单平面，观测证明官方是双平面，照建：

| 平面 | 官方对照 | BPT 落地 | 用途 |
|------|---------|---------|------|
| 会话级 | CronCreate（内存态、随会话灭、7 天限、空闲触发） | 渲染进程内存定时器 | /loop 快速试验、临时轮询 |
| 持久级 | 服务端 Routine（账户级、跨会话、三种绑定目标） | Electron 主进程 + 本地存储任务表 | 无人值守长任务、重启存活 |

**观测移植的契约细节**：创建回执必含「人话节奏 + 生存期声明 + 取消句柄」三件套
（OBS-005 官方回执逐项）；抖动纪律（劝避 :00/:30）；仅空闲触发不打断进行中回合；
瞬态失败重试一次再报错（OBS-006 权限流瞬断实录）。**动态自调步模式**（OBS-005 新发现：
无间隔 /loop = 事件驱动 Monitor + 自选延迟 ScheduleWakeup）列 P2——需要壳层实现
「代理自报到点唤醒」原语，价值高但依赖面大，单独立项。

### 模块 M5 目标门控（壳层薄封装，SDK v0.39 已备，P1）

需求档 R5 全文有效；本方案补 OBS-010 结论：/goal 通报格式跨次稳定，BPT 可安全
按 OBS-002 逐字段仿制 system-reminder 文案结构（自写文本，非抄官方句子）。

## 3. 实施顺序与验收

1. **一期（P0）**：M1 + M2 最小集 + M3 的 C 类透传源——验收即需求档 V1/V2/V3/V6/V7；
2. **二期（P1）**：M4 双平面 + M5 门控 + M3 内建骨架命令源（首批自写 3 个：
   review / simplify 的结构再现版 + loop 固定模式）——验收 V4/V5/V8 +
   新增 **V9**：会话级任务随会话灭、持久级任务重启存活、两平面互不可见即合格；
3. **三期（P2）**：动态自调步、插件源、MCP prompts 源、120+ UI 动作逐项对标。

## 4. 风险与挂账

- **注册表漂移**：四源联邦无单一权威，M3 面板须容忍源缺席（某源不可用只缺该组，
  不塌整个面板）——OBS-008 中 ListSkills 只见云技能即此形态的官方先例；
- **B 类首批骨架命令的文本自写**：结构照 OBS-007 观测的档位分级协议设计，文本
  过一遍「零官方句子」自查（承 2026-07-10 裁定①）；
- **动态自调步**（P2 挂账）：ScheduleWakeup 的缓存窗口经济学（技能文本内嵌
  60s-3600s 档位论证）说明官方在此有深度调优，BPT 仿制前应先测自身缓存分层。

---

> 关联档案：需求 `bpt-desktop-command-framework-requirements-20260710.md`（v1.1）·
> 观测 `cc-command-behavior-observations-20260710.md`（OBS-001~010）·
> 盘点 `cc-engine-external-commands-20260710.md` · SDK `projects/bpt-agent-sdk/`
> （v0.39，COMPAT.md「Custom slash commands」+ hooks Stop 行）
