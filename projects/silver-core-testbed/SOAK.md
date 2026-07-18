# SOAK — 浸泡与演练手册（施工封面 §2 第三战）

> 纪律声明：两包 e2e 的 fake-timer 纪律在本战**反向**——浸泡与演练一律真实钟，
> 特此声明不算违规（封面原文）。

## 已实证（短程演练，真实钟）

`node scripts/soak-drill.mjs`（秒级节拍打真 daemon 二进制，~35 秒，报告落
`state/drills/{时间戳}.json`）。2026-07-18 首轮 10 检查全 PASS：

1. **kill -9 恢复**：慢 tick（1.5s 在飞 × 1s 节拍）保证 SIGKILL 落在尝试中途——
   2 个孤儿 `running` 会话被重启后的崩溃自扫记为 error 尝试、送回重试路径并最终
   完成；调度跨杀继续开火，无卡死。
2. **停机补偿**：8 秒计划停机（4 个错过点，2s 节拍）——`catchUp: 'latest'` 恰好
   补 1 发（塌缩到最新点）；`catchUp: 'all'` 全部错过点升序补齐、幂等键零重复。

## 72 小时长跑（需常驻宿主，云容器短命跑不了）

在任一常驻 Linux 宿主（守密人本机 / 长命服务器）仓库根执行：

```bash
npm ci && npm run build --workspace=projects/silver-core-sdk \
       && npm run build --workspace=projects/silver-core-maestro-sdk
projects/silver-core-testbed/scripts/driverctl.sh start     # 起浸泡驱动器
```

节奏（人工只看结果）：

| 时刻 | 动作 |
|------|------|
| 每日一次 | `driverctl.sh kill9` → 等 1 分钟 → `driverctl.sh start`（验硬杀恢复） |
| 任选一段 | `driverctl.sh stop` → 等 2 小时 → `start`（验错过补偿语义） |
| 72h 结束 | `driverctl.sh stop` → `npm run baseline --workspace=projects/silver-core-testbed` |

## 浸泡报告三项结论从哪读

- **调度漏发数**：`testbed-baseline.json` → `schedule.*.uncoveredPoints`
  （catchUp all 的未覆盖点 = 真漏发；latest 的 = 设计塌缩，报告已分别标注）；
  辅证 `state/heartbeat.jsonl`（30s 心跳，断档 = 停机窗口，用于区分「漏发」与「停机」）。
- **恢复正确性**：`state/ledger.json` 中 `crash-sweep:` 前缀的 query 行数与其后
  会话终态（应全部走到 done / failed，无 `running` 残留）；`daemon.log` 的
  `crash sweep settled N` 行。
- **补偿行为**：停机窗口内 `sched:{spec}:{fireAt}` 会话的 fireAt 分布
  （latest 应恰 1 发、all 应逐点补齐），演练脚本的判定逻辑即读数口径。
