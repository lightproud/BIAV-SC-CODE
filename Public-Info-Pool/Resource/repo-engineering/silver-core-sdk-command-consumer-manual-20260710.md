# Silver Core SDK 命令框架消费手册 v1.0（黑池开发者向）

- 日期：2026-07-10
- 作者：艾瑞卡（守密人「银芯需要派一个说明书给黑池消费方」派单）
- 受众：BPT Desktop（Electron 壳）开发者——拿着 `silver-core-sdk-0.41.0.tgz`（0.41.0 起更名，原 bpt-agent-sdk）要把
  命令框架五模块（方案档 M1-M5）接上线的人
- 性质：银芯 → 黑池单向输出物。**所有代码形状逐一对照 SDK v0.39 源码核实、经 0.40（纯追官方类型面）/ 0.41（纯更名）CHANGELOG 确认无涉**，
  非文档推演；类型名 / 字段名可直接抄用
- 前置阅读：`docs/MIGRATION.md`（换装基线：装包 / query() 起步 / Electron 宿主样例）；
  本手册只讲命令框架增量
- 姊妹档：需求 `bpt-desktop-command-framework-requirements-20260710.md`（要什么）·
  方案 `bpt-desktop-command-impl-plan-20260710.md`（怎么建）· 本手册（**API 怎么接**）

---

## 0. 一页总图：五模块各接 SDK 哪个口

| 方案模块 | SDK 消费面 | 本手册配方 |
|---------|-----------|-----------|
| M1 命令路由器 | 无（纯壳层）+ 未命中透传 `prompt` | §1 |
| M2 本地命令执行器 | `setModel` / `setPermissionMode` / `mcpServerStatus` 等控制面 + 通报注入 | §2 |
| M3 技能注入器 | `settingSources` + `.claude/commands` 引擎展开 + `supportedCommands()` | §3 |
| M4 调度器 | `resume` 会话重入 + `maxTurns`/`maxBudgetUsd` | §4 |
| M5 目标门控 | `options.hooks` 的 Stop 事件 + `condition` | §5（本手册核心） |

## 1. 路由与透传（M1）

未命中本地命令表的输入**原文透传**，不预处理：

```ts
const q = query({ prompt: userInput, options }); // '/greet Alice' 原样进去
```

引擎侧行为（v0.38 起，无需壳层配合）：纯文本 `/name args` 回合若命中已装载的
自定义命令即自动展开；未知名字原样作普通 prompt。**壳层绝不自行展开**——防双端漂移。

## 2. 本地命令的控制面与通报注入（M2）

### 2.1 控制面直连（对照观测 OBS-001）

```ts
await q.setModel('claude-sonnet-5');          // /model
await q.setPermissionMode('acceptEdits');     // /permissions
const st = await q.mcpServerStatus();         // /mcp 面板数据
await q.reconnectMcpServer('biav-sc-memory'); // /mcp 重连按钮
```

### 2.2 本地命令执行后如何让模型知道（诚实边界 + 推荐配方）

**边界申报**：官方 SDK 文档有「`shouldQuery:false` 入史不触发回合」的注入通道，
**本 SDK v0.39 未实现该参数**——不要按官方文档写。推荐等价配方：壳层维护待通报
队列，用 **UserPromptSubmit 钩子的 additionalContext** 把通报捎在下一个用户回合上
（引擎会把 additionalContext 逐行追加进该回合，源码 `query.ts appendContextLines`）：

```ts
const pendingNotices: string[] = [];   // 本地命令执行后 push，如 'model switched to X'

const options = {
  hooks: {
    UserPromptSubmit: [{
      hooks: [async () => ({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit' as const,
          additionalContext: pendingNotices.splice(0).join('\n'),
        },
      })],
    }],
  },
};
```

## 3. 命令面板与自定义命令（M3）

### 3.1 面板数据源（对照需求 R1.1/R1.2）

```ts
const q = query({ prompt, options: { settingSources: ['user', 'project'] } });
// 快速首帧：init 消息
for await (const msg of q) {
  if (msg.type === 'system' && msg.subtype === 'init') {
    renderPalette(msg.slash_commands);        // string[]，bare name，如 ['compact','greet']
  }
}
// 完整元数据（description + argumentHint）：
const cmds = await q.supportedCommands();     // SlashCommand[]{name, description, argumentHint}
```

### 3.2 装载语义（壳层 UI 必须如实标注的三条）

1. `.claude/commands/*.md` 按 `settingSources` 装载：`'project'` 读 `<cwd>/.claude/commands/`、
   `'user'` 读 `~/.claude/commands/`；同名 project 胜出；`compact` 等内建名保留；
2. **每 query 构造期装载一次、无热更新**——命令编辑器保存后提示「下个会话生效」；
3. frontmatter 只消费 `description` / `argument-hint`；`allowed-tools` / `model` /
   `!bash` / `@file` 不支持（COMPAT.md「Custom slash commands」节），编辑器置灰勿装作生效。

### 3.3 UI 对照呈现（原文气泡 + 展开折叠，需求 R2.2）

引擎回流的 user echo 消息携带**展开后**正文；壳层自己记住用户敲的原文即可两相对照。

## 4. 调度器的会话重入（M4）

到点执行 = 用持久化的 sessionId 重入 + **必配双闸**：

```ts
const q = query({
  prompt: task.prompt,
  options: {
    resume: task.sessionId,      // 会话重入（Options.resume: string）
    maxTurns: 30,                // 双闸必配：无人值守任务失控的最后防线
    maxBudgetUsd: 0.5,
  },
});
```

观测移植契约（OBS-005/006）：创建回执给「人话节奏 + 生存期 + 取消句柄」三件套；
瞬态失败重试一次再报错；仅空闲期触发不打断进行中回合。

## 5. 目标门控 /goal（M5，本手册核心配方）

### 5.1 完整配方（对照 OBS-002/010 官方行为 + SDK v0.39 阻断语义）

```ts
function goalGateHooks(goal: string) {
  return {
    Stop: [{
      // condition 语义：满足才放行回调 → 把条件写成「尚未达成」，
      // 目标达成时评估为否 → block 回调被跳过 → 停止放行 = 自动清除，零壳层状态
      condition: `目标「${goal}」尚未达成`,
      hooks: [async (input) => {
        if ((input as { stop_hook_active?: boolean }).stop_hook_active) {
          // 已在门控续跑周期内：给出更收敛的提示，防泛化空转
          return { decision: 'block' as const,
                   reason: `目标仍未达成：${goal}。请直接完成剩余部分，勿重复已完成工作。` };
        }
        return { decision: 'block' as const,
                 reason: `会话目标未达成：${goal}。继续执行直到条件成立。` };
      }],
    }],
  };
}

const q = query({
  prompt: userInput,
  options: {
    hooks: goalGateHooks(currentGoal),
    maxTurns: 40, maxBudgetUsd: 2.0,   // R5.3 三闸之二（引擎强制）
  },
});
```

### 5.2 引擎侧语义速查（v0.39，COMPAT hooks 表 Stop 行）

- block → reason 作为**用户回合**注入（入 history，resume 可重放）→ 引擎续跑；
- `stop_hook_active` 在后续 Stop 输入上为 true（上例已消费）；
- 回调返回 `{ continue: false, stopReason }` = **强停**，优先于 block（做「/goal clear
  兼紧急刹车」用）；
- **仅主循环生效**：子代理不被门控捕获，壳层零处理；
- condition 评估 = 每次自然收束一次有界模型调用，**失败关门**（评估器坏 → 视为
  条件不满足 → 回调跳过 → 允许停止）——安全默认，但意味着评估器故障时门控静默失效，
  壳层 UI 应展示门控「活动 / 已达成 / 评估异常」三态（需求 R5.2）。

### 5.3 会话级生命周期（关键：钩子是 per-query 的）

`options.hooks` 随 query 构造，**不跨 query 存活**。「会话级目标」= 壳层把
`currentGoal` 存在会话元数据里，**每次 query()/resume 重注册** `goalGateHooks`；
`/goal clear` = 置空元数据、下次 query 不再注册（当前进行中的 query 用
`interrupt()` 或强停回调终止门控）。

## 6. 反模式清单（黑池侧勿踩）

1. **勿壳层预展开自定义命令**（§1，双端漂移）；
2. **勿把 /goal 写成提示词恳求**——「请务必做完」是建议，Stop 钩子是强制，二者不可互换
   （门框长在引擎里）；
3. **勿给无人值守任务省 maxTurns/maxBudgetUsd**——顽固 block + 无闸 = 烧钱永动机；
4. **勿按官方文档用 `shouldQuery`**（本 SDK 未实现，§2.2 有等价配方）；
5. **勿假设命令热更新**（§3.2，每 query 装载一次）。

---

> 版本锚：本手册配方核实于 `bpt-agent-sdk@0.39.0`、适用至 `silver-core-sdk@0.41.0`（0.40 追官方 0.3.205 纯类型面、0.41 纯更名，均不触命令框架消费面）；SDK 升级时以 `docs/COMPAT.md` 与
> `CHANGELOG.md` 为准对账本手册（发现漂移回银芯提修订）。
