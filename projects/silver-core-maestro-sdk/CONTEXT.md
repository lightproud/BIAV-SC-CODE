# CONTEXT — silver-core-maestro-sdk(银芯编排 SDK)

> **维护态（守密人 2026-08-02 换轨裁定 + 文书裁 3）**：随家族转**纯维稳**——版本冻结、仅修影响生产的 bug、零新功能（载体换轨 `projects/black-pool-agent/`；迁移终裁后冻结，触发线 `memory/todo.md` #T78）。
> 动手前先读本档。需求裁定书(建成什么样的唯一权威):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`
> 地基(代理侧定位与 R1–R6 接口面):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-repositioning-loop-support-20260717.md`

## 定位

编排 SDK 持有分子:钟、跨会话状态、会话装配。代理 SDK(`projects/silver-core-sdk/`,
npm 名 `silver-core-agent-sdk`)持有原子:一次结构化调用。判别式**三项**(第三项为守密人
2026-07-26 产品审视 P5 补维):节点要活得比父调用久、或要等墙钟/外部事件、**或由 agent 侧
主动发起且需在台账留审计的对外动作(触发权)** → 编排;否则 → 代理引擎内。
补维缘由:`createDeliveryChannel` 不满足原两项(只用 clock 打时间戳、零 setTimeout),
但需求档 §3 一直按「触发权」把它归编排——**是判据表述漏了 §3 已在用的那一维,不是它放错了**。

三条硬性质(红线,违规推倒重来):

1. 库不是框架——宿主持有 main(),零件可单独拿取。
2. 对代理 SDK 无特权通道——只准 import `silver-core-agent-sdk` 公开面;深路径 / 相对路径
   伸进代理源码 = 违规。CI `check-dep-direction` 机器执法(反向 import 亦红)。
3. 数据面在 SDK、渲染在宿主——送达/显示只定契约缝,实现宿主注入。

## 家族纪律

- **版本钟锁步同版**(守密人 2026-07-18 裁定,覆盖需求档 §2「永不同步」条):两包永远同号、任一侧 shipped 变更双双 bump,CI 守卫版本相等;未动侧 CHANGELOG 记一行锁步对齐注。
- 依赖单向:编排 → 代理。共享代码只准下沉进代理 SDK 或独立第三包。
- **不声明对代理 SDK 的 peerDependency**(守密人 2026-07-26 裁定,覆盖需求档 §2 该条):
  本包 `src/` 对代理 SDK 零 import,声明一个从不使用的包会被 npm 7+ 自动装上,
  与硬性质①「整箱不要」冲突。`devDependencies` 保留(测试与两个例程真用它)。
- 发版纪律与代理侧同构:改 shipped 运行时代码即 bump + CHANGELOG 一行。
- monorepo:仓库根 `package.json` workspaces 持两包,单一根 lockfile;
  `npm ci` 在仓库根跑,workspace 内 `npm run <script>` 照常。

## 当前状态

<!-- CONTEXT-FACTS:BEGIN 机器生成，勿手改；重算 `python3 scripts/build_status_facts.py` -->

**当前版本 `2.2.3`** · 发布日 2026-07-29 · 家族锁步对端 `silver-core-agent-sdk` = `2.2.3`

> 本行由 `scripts/build_status_facts.py` 从 `package.json` + `CHANGELOG.md` 生成，**勿手改**；规模数字不在此列，指 `memory/project-status.md` 的 STATUS-FACTS 块。下方叙述由人写（「这一版做了什么」是判断、生成不出来），其**新鲜度**由`tests/test_status_doc_facts.py` 守。

<!-- CONTEXT-FACTS:END -->

**v2.2.3（2026-07-29）**：家族锁步同号（agent = 2.2.3）。

**当前形态**：八族零件、成熟度两级（标尺见需求档 §6：「已验证」须有非为演示它而写的消费方）——
`ledger` / `driver` / `scheduler` **已验证**；`workflow` / `goal` / `delivery` / `assembly` / `routine`
为**实验面**。在产消费方两个：`examples/store-patrol.mjs`（每日北京 15:15 商店巡检）与
silver-core-testbed。硬性质：对 agent SDK **零 import 零依赖**，依赖方向 maestro→agent 单向由 CI 执法。
文档 `docs/ONBOARDING.md`（宿主 store 样板）/ `docs/CONCURRENCY.md`（并发模型）/ `docs/ASSEMBLY.md`（四原语接线谱）。

**2026-08-02 起随 T78 转维护态**：纯维稳、仅修影响生产的 bug、零新功能；家族工程守卫工作流
已降级为手动触发；BPT 换装完成后按 wiki 先例冻结。

**不在已完范围**：周报 loop 迁入生产切换（机制已由 schedule 承载；切换待 T37 推送形态裁定 +
判卷侧充值，见 `memory/todo.md`）。agent 侧棘轮 floor 抬升待每周 CI 实测出分后按 bump 提示落地
（本地不盲抬）。

**逐版发布叙述以 `CHANGELOG.md` 为唯一权威**；2026-08-08 之前累积的逐战施工记录与逐版叙述
已下沉 `memory/archive/maestro-context-chronicle-20260808.md`（原文逐字未改），状态档侧同类内容
见 `memory/archive/maestro-status-chronicle-20260808.md`。

> **本档 12,500 字符封顶**（`tests/test_claude_md_size.py` 守）——撞线时下沉、且一次整理到
> 上限的 50%，不抬上限、不压回刚好达标（守密人 2026-08-08 追裁）。
