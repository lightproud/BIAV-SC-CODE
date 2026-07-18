# CONTEXT — silver-core-maestro-sdk(银芯编排 SDK)

> 动手前先读本档。需求裁定书(建成什么样的唯一权威):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`
> 地基(代理侧定位与 R1–R6 接口面):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-repositioning-loop-support-20260717.md`

## 定位

编排 SDK 持有分子:钟、跨会话状态、会话装配。代理 SDK(`projects/silver-core-sdk/`,
npm 名 `silver-core-agent-sdk`)持有原子:一次结构化调用。判别式:节点要活得比父调用久、
或要等墙钟/外部事件 → 编排;否则 → 代理引擎内。

三条硬性质(红线,违规推倒重来):

1. 库不是框架——宿主持有 main(),零件可单独拿取。
2. 对代理 SDK 无特权通道——只准 import `silver-core-agent-sdk` 公开面;深路径 / 相对路径
   伸进代理源码 = 违规。CI `check-dep-direction` 机器执法(反向 import 亦红)。
3. 数据面在 SDK、渲染在宿主——送达/显示只定契约缝,实现宿主注入。

## 家族纪律

- 两包各自 semver,版本钟永不同步,「顺手一起 bump」违规(需求档 §2)。
- 依赖单向:编排 → 代理。共享代码只准下沉进代理 SDK 或独立第三包。
- 发版纪律与代理侧同构:改 shipped 运行时代码即 bump + CHANGELOG 一行。
- monorepo:仓库根 `package.json` workspaces 持两包,单一根 lockfile;
  `npm ci` 在仓库根跑,workspace 内 `npm run <script>` 照常。

## 当前状态

第零战(monorepo 迁移)+ 第一战(任务台账 + 驱动器,0.2.0)完成:

- 封闭状态机(`pending | running | retrying | failed | done`,定稿回填需求档 §4)
  + 纯核 `src/ledger/state.ts` **变异分 100%**(棘轮地板 100,周检 CI 值守);
- `LedgerStore` 存储缝(宿主注入,零内置电池)/ `TaskLedger` / `LedgerDriver`
  (持钟活组件,宿主生杀,stop 中止走正常重试路径、重启自然续跑);
- 例程一 `examples/minimal-loop.ts`(周期派发 + 预算帽 + 到帽收尾,消费代理侧
  R2 预算事件流),e2e 对本地仿真器真跑双 R2 事件 + closeout。

**不在已完范围**(需求档提到不等于已做):商店巡检真实场景接入(第二战)、
周报 loop 迁入、schedule、workflow 图执行器、goal 追逐器、送达契约。
