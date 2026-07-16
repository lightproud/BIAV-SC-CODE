# 致黑池 BPT：/loop 与 /goal 原语已发货（silver-core-sdk 0.59.0 / 0.60.0）

> 银芯 → 黑池单向输出物 · 2026-07-14 · 发件：艾瑞卡（守密人同日两次裁定的执行回执）
> 性质：接线通知 + 升级指引。黑池侧不回流，本档不期待回执。

## 一、事由

2026-07-14 缺口调查确认：BPT 中 `/loop 10m <任务>` 未被任何层解释——GUI 未注册
`/loop`，SDK 斜杠层仅 `/compact` 内建 + markdown 命令展开，指令原样透传为**一次性
普通 prompt**，周期语义静默丢失。`/goal` 同病：引擎的 Stop-hook block 语义（0.39.0）
与 stop 变体条件评估器（0.6 线）早已在 SDK 内发货，但没有任何层解析 `/goal` 表面。

守密人同日两裁：`/loop` 走「SDK 侧加循环原语」案；`/goal`「也给实现了吧」。两原语
均已合并 main 并随版本发货：

| 版本 | 原语 | PR | 模块 |
|------|------|----|------|
| 0.59.0 | `/loop` 区间循环 | #690 | `src/prompt-loop.ts` |
| 0.60.0 | `/goal` 会话目标 | #693 | `src/hooks/session-goal.ts` |

建议直接升 pin 至 **0.60.0**（0.59.1 为审计 P2 批，已含在内；0.59.x→0.60.0 纯增量、
零破坏点）。

## 二、/loop 接线（约十行）

```ts
import { parseLoopCommand, createPromptLoop, LOOP_SLASH_COMMAND } from 'silver-core-sdk';

const parsed = parseLoopCommand(userInput);
if (parsed) {
  if (!parsed.ok) return showError(parsed.error);   // 绝不透传为 prompt
  const loop = createPromptLoop({
    ...parsed.directive,                 // intervalMs + prompt
    run: (prompt) => submitTurn(prompt), // 宿主自有提交：起新 query 轮
    signal: sessionAbort.signal,
  });
  loop.start();                          // 立即首跑，之后固定延迟
}
```

语义要点：语法唯一真相源在 `parseLoopCommand`（s/m/h + 别名 + 小数，缺省 10m，
界 [1s, 2^31-1ms]）——**BPT 不要自写解析**；调度为固定延迟（上一次**结清**后再计时，
绝不重叠）；`onError` 默认出错即停（可 `'continue'` 或回调）；`done` promise 出摘要、
永不 reject。`LOOP_SLASH_COMMAND` 可直接并进命令菜单元数据。

## 三、/goal 接线

```ts
import { createSessionGoal, GOAL_SLASH_COMMAND } from 'silver-core-sdk';

const goal = createSessionGoal({
  utility: { provider },            // 评估器凭据（默认 Haiku 档 utility 模型）
  onEvent: (e) => updateBadge(e),   // set / met / blocked / impossible / ...
});
// 每个 query 都要挂（会话级复用同一 goal 实例）：
const q = query({ prompt, options: { hooks: { ...goal.hooks() } } });
// 用户输入先过桥再当 prompt 提交：
const outcome = goal.handleCommand(userInput);
if (outcome.handled) {
  return outcome.ok ? showInfo(outcome.message) : showError(outcome.error);
}
```

语义要点：`/goal <条件>` 布防、`/goal clear` 撤防；agent 试图停机时评估器查转录——
「未达成」block 停机并把理由回喂续跑（引擎 `maxTurns` / `maxBudgetUsd` 照常封顶）、
「已达成」自动撤防、`impossible` 逃生口撤防。**失败方向刻意反向**：评估器故障 /
乱码 / 零转录一律**放行停机、目标保持布防**——坏裁判绝不把 agent 困进强制循环。
需要更硬的宿主策略可设 `maxBlocks` 帽。

## 四、三条纪律（接线时勿省）

1. **`ok:false` / `handled+!ok` 必须报错给用户**，绝不再透传为普通 prompt——本次缺口
   的病根就是静默透传。
2. `goal.hooks()` 要展进**该会话每个 query** 的 `options.hooks`；goal 实例本身跨 query
   复用（状态在实例里）。
3. 评估器凭据经 `utility.provider` 传入；不传则无凭据评估失败 → 按反向失败方向放行
   停机（goal 形同虚设），接线后务必配。

## 五、升 pin 后建议实测两条链路

1. `/loop 5m /daily-news`：嵌套斜杠命令任务——loop 的 prompt 原样回交宿主提交，经 SDK
   既有 markdown 展开层解释，确认展开生效。
2. `/goal <条件>` 全链路：目标未达成 → 停机被顶回续跑 → 达成 → 自动撤防（观察
   `onEvent` 序列 set → blocked×N → met）。

## 六、指针

- README「/loop interval loops」「/goal session goals」两节（含桥接范本）
- `CHANGELOG.md` 0.59.0 / 0.60.0 条目；`docs/ARCHITECTURE.md` 错误类白名单两补行
- 测试：`tests/prompt-loop.test.ts`（24 条）、`tests/session-goal.test.ts`（20 条）、
  `tests/stop-hook-block.test.ts`（引擎链既有回归锁）
- PR：#690（/loop）、#693（/goal）
