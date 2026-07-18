# CONTEXT — silver-core-testbed（试金石）

> 施工封面（建成什么样的唯一权威）：守密人 2026-07-18「silver-core-testbed 施工封面」
> 会话派发（两包效果验证床，四战：骨架 / 巡检集 / 浸泡 / 基线）。
> 漏缝清单：`GAPS.md`（验收件）；浸泡手册：`SOAK.md`；效果基线：`testbed-baseline.json`。

## 定位（红线级）

1. **消费者，不是家族第三包**：`private: true`、版本恒 `0.0.0`（锁步豁免）、永不发布
   npm；依赖**仅限** `silver-core-agent-sdk` 与 `silver-core-maestro-sdk` 的公开导出面
   （`tests/surface-discipline.test.mjs` 自守；家族包不得 import 本项目）。施工中凡需
   触碰非公开面才能完成的任务：停该项、记入 `GAPS.md`，绝不打补丁绕过。
2. **自举**：巡检目标 = 本仓自身（CI 状态 / 文档死链 / 版本锁步 / 变异棘轮）——
   无外部依赖、坏了无害、产出对仓库有用，testbed 同时是仓库值班员。
3. **台账即评测数据源**：完成率 / 熄火 / 成本一律从 `state/ledger.json` 导出
   （`src/baseline.mjs`），不另建统计设施。

## 结构

```
targets/   热层（改清单 = 改覆盖面，零代码）：inspect.targets.json / schedule.specs.json
src/       store.mjs（JSON 文件台账店）· inspectors.mjs（四巡检器）· dream.mjs（做梦归并卡）
           daemon.mjs（宿主 main：台账+调度器+驱动器装配、崩溃自扫、零号日播种）· memory.mjs · baseline.mjs
scripts/   driverctl.sh（start/stop/kill9/status）· soak-drill.mjs（真实钟演练）
state/     ledger.json（台账，入 git）· drills/（演练报告，入 git）· 日志与 pid（gitignore）
memory/    记忆区（agent SDK memory store 管理）：reports/{巡检器}/{日期}.md · cards/{日期}.md · MEMORY.md
tests/     store-contract（LedgerStore 契约套件 14 例）· inspectors · surface-discipline
```

## 命令（仓库根）

| 场景 | 命令 |
|------|------|
| 测试 | `npm test --workspace=projects/silver-core-testbed`（vitest，29 例） |
| 单轮巡检（CI 姿势） | `node projects/silver-core-testbed/src/daemon.mjs --once` |
| 浸泡启停 | `projects/silver-core-testbed/scripts/driverctl.sh {start\|stop\|kill9\|status}` |
| 浸泡演练 | `node projects/silver-core-testbed/scripts/soak-drill.mjs`（真实钟，~35 秒） |
| 基线导出 | `npm run baseline --workspace=projects/silver-core-testbed` |

代理环境注（银芯云容器）：直连 GitHub API 需 `NODE_USE_ENV_PROXY=1`；本会话容器的代理
策略拦仓库级 API（403），ci-status / ratchet 巡检器诚实降级为 `blocked`——GitHub Actions
环境（`GITHUB_TOKEN` 注入）不受此限。

## 运转

- **每日无人值守**：CI `testbed-patrol.yml`（每日北京 15:20 / 07:20 UTC）跑
  `daemon --once`：崩溃自扫 → 零号日播种（仅缺足迹的 spec）→ Scheduler 恢复 + 错过
  补偿（cron 落点刻意晚于 07:00 UTC fire point，**每天都走一遍补偿路径**）→ 驱动器
  执行 → 报告入记忆区 → 做梦归并卡 → 台账与记忆区提交 `[skip ci]`。
- **做梦任务**：读当日四报告 → 归并成 R9 三段卡（结论/依据/过期条件，经 agent SDK
  `validateCardsContent` 校验后才准入库）→ 刷新 `MEMORY.md` 常驻索引 → 45 天保留剪除
  （R8 64 文件/目录限额卫生）。记忆工具 + 台账 + 调度三件套全部真实使用；巡检器与
  做梦均为确定性执行器（无模型调用，无人值守 cron 不带 key）——`tokensPerTask` 槽位
  留给三配置端点对照实验。
- **浸泡**：见 `SOAK.md`（72h 长跑 + 每日 kill -9 + 2h 停机补偿；演练已实证短程语义）。

## 当前状态（2026-07-18 施工日）

- 四战全部落地：契约套件 14 例绿（验收 1）；四巡检器 + 做梦首轮生产真跑全绿
  （5 会话 done，台账逐轮可查）；真实钟演练 10 检查 PASS（kill -9 恢复 + 停机补偿，
  验收 3 的短程实证）；首份基线入库（验收 4）；漏缝清单四条实缝（验收 5）。
- **等待真实时间的验收**：验收 2「连续 7 天无人值守」自 CI 首轮起算（挂账 todo）；
  §2 第三战 72h 连续长跑需常驻宿主（云容器短命，跑法见 `SOAK.md`），演练件先行。
- 首日真实发现：agent SDK `mutation-ratchet.json` 的 `loop-support` 靶（地板 94.35）
  不在周检矩阵中、从未被实测——ratchet 巡检器的「地板无实测」检查将在 CI 环境每日
  盯住此类缺口。
