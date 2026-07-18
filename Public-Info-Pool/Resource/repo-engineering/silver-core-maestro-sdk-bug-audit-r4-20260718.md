# Silver Core Maestro SDK bug 审计第四轮战报（T56）

- 日期：2026-07-18（北京时间当日；UTC 同日）
- 范围：`projects/silver-core-maestro-sdk/`（0.72.1 基线 → 0.73.0 落位）
- 方法（第四轮换法 = 故障注入与并发交错，动态编排工作流 `maestro-audit-r4`）：
  四路镜头猎手（混沌店 fail-before-effect / 双宿主竞跑 / 暧昧失败
  apply-then-throw / 敌意输入），每条指控经独立查证官**默认驳回、亲手复现**
  后才入账；15 代理（4 猎手 + 11 查证），全部完成零失败。
- 账目：**原始 11 → 查证确认 11 → 驳回 0**（3 P1 + 4 P2 + 4 P3），另 8 条
  unproven leads 中 5 条经艾瑞卡核实一并处置。11/11 全修复配 fail-on-old 锁
  （`tests/audit-r4.test.ts`，17 锁）。
- 与产量曲线：29 → 16 → 0 → **11**。第三轮枯竭被第四轮换镜头打破——
  性质测试锤的是「单线程顺序调用下的不变量」，本轮锤的是「故障与并发交错」，
  病灶正好全在后者。

## 确认缺陷清单

### P1 集群（共同根因：recordOutcome 无 attempt 围栏 + 写入无原子性）

| ID | 摘要 | 处置 |
|----|------|------|
| R4-C1 | 双宿主 claimDue/claimSession 在**未过期租约内双认领**同一会话（300 种交错 295 次复现）——租约只保了「过期可扫」，没保「认领独占」 | 店缝可选 `putSessionIf`（CAS，`SessionRecord.revision`）+ 认领路径 CAS 化；素店维持文档化单认领边界。进程内另加**单会话互斥**，同实例并发认领恒一 |
| R4-C2 | 并发 recordOutcome 同一 attempt 的 check-then-append 竞态**双写查询行**，击穿 r2 幂等键 | 进程内互斥根治同实例；跨宿主经 settle-then-append 次序反转根治（见 R4-B 条）；`TaskLedger.listQueries` 读面按 attempt 规范化恒一行 |
| R4-C3 | 清扫官与迟到租约持有者竞跑可把**已提交的 done 回退成 retrying**（成功丢失、会话重跑） | 同实例互斥 + 跨宿主 CAS：后写方 CAS 失败即让位；终态经转移图拒绝任何事件 |

### P2

| ID | 摘要 | 处置 |
|----|------|------|
| R4-A | 租约清扫 + 再认领后，超租 attempt 的**迟到 recordOutcome 被接受并记到下一 attempt 账上**（文档承诺 InvalidTransitionError 落空；触发场景即 SDK 自家驱动器同 tick「先扫后领」） | `OutcomeInput.attempt` 围栏：号不对即 InvalidTransitionError；driver / delivery channel / lease sweep 全部传号，文档承诺兑现 |
| R4-C4 | recordOutcome 无 attempt 围栏的一般化陈述（stale 写手可对上任意再认领后的活 attempt） | 同上围栏根治 |
| R4-AF1 | 暧昧失败（putSession 生效后报错）下延迟重试在再认领后被接受，伪造下一 attempt 行并丢真结果 | 同上围栏 + settle-then-append 后该窗口消失 |
| R4-HI-1 | 毒化重试策略（factor NaN / baseDelayMs<0）构造期不查，**在 appendQuery 之后引爆**——半写 + 会话永卡 running | TaskLedger 构造器急切校验四字段（RangeError） |

### P3

| ID | 摘要 | 处置 |
|----|------|------|
| R4-B | 清扫把「已提交 ok 行」的会话记成 lease-expired **failed**（终态与自家账行自相矛盾） | settle-then-append（会话写为提交点）+ 已提交行调和（当前 attempt 已有行则按该行结算）+ 崩溃窗口一致性回填分支 |
| R4-HI-2 | claimDue/claimSession `now` 不校验：NaN 租约被立即误扫烧号、Infinity 租约永久废掉 G2 安全网 | 三入口 `Number.isFinite` 校验（RangeError） |
| R4-HI-3 | 调度恢复接受超 Date 域的纯数字后缀：一条毒行使 spec **永久断火**（或永久报错循环） | 恢复解析加 8.64e15 界拒绝 |
| R4-HI-4 | recordOutcome 把 NaN/Infinity 时间戳原样入账（JSON 店静默改写 NaN→null，破 QueryRecord number 契约） | startedAt/endedAt 有限性校验 |

### Leads 一并处置（5 条）

- sweepExpiredLeases 无逐会话隔离（一处抛错弃整批）→ try/catch continue + 围栏。
- dispatch 接受非字符串 id → TypeError 拒绝。
- goal chaser 缺 feedback 时把 `undefined` 塞进类型为 `| null` 的持久化字段 → `?? null`。
- claimDue「失败会话 UNTOUCHED」注释在 apply-then-throw 店下失真 → 注释改写诚实化。
- 契约套件对 CAS 缝零覆盖 → 条件化 `putSessionIf` 三检查（素店报告不变）。

## 语义变更注（诚实账）

settle-then-append 反转了 r2 时代的 append-first 次序：**会话状态写入成为提交点**，
put 失败时不再留下孤行（r2 锁按新语义改写，本质「重试不重复行」不变）；
settle 后 append 崩溃的窗口由「一致性回填」分支修复（终态 + 同号 + 同向结果才准回填）。
权衡：旧序半写留下的「行在、状态没动」矛盾窗口整个消失，代价是极端崩溃下审计行
可能迟到（等一次一致重试）。

## 修复过程反例记录（方法诚实）

- 「座位号预约」中间方案（CAS 预约后再落行）被自家竞跑锁打回——两个预约可先后
  都成功于双方落行前，仍留双行窗口；遂改为最终的 settle-then-append。
- 两条锁初稿表述错误经复盘修正：固定钟下退避 1s 使 `claimDue(T0+200)` 无货可领；
  双宿主竞跑中「清扫官先赢、迟到 ok 被拒」是合法租约语义，正确不变量是
  「终态与第一条落账行一致且恒一行」而非「恒 done」。

## 验证

- maestro 316 全绿（26 文件；净增 r4 锁 17、删除四份代理 harness）
- delivery-channel 变异靶复测 100%（30/30，地板保持）
- testbed 30 / agent 3080+2skip / pytest 2979+4skip 全绿
- 依赖方向守卫段 A–D 绿；家族锁步 0.73.0

## 累计账（T56）

29（r1）+ 16（r2）+ 0（r3）+ **11（r4）** + 前期审查 5 = **确认真缺陷 61 / 500 上限**。
产量曲线 29→16→0→11：r3 枯竭为「镜头内枯竭」，换故障注入镜头即再出货——
尚未整体枯竭。
