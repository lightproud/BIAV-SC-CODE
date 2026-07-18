# CONTEXT — @biav/orchestrator-sdk(银芯编排 SDK)

> 动手前先读本档。需求裁定书(建成什么样的唯一权威):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-orchestrator-sdk-20260717.md`
> 地基(代理侧定位与 R1–R6 接口面):
> `Public-Info-Pool/Resource/repo-engineering/scs-req-repositioning-loop-support-20260717.md`

## 定位

编排 SDK 持有分子:钟、跨会话状态、会话装配。代理 SDK(`projects/silver-core-sdk/`,
npm 名 `@biav/agent-sdk`)持有原子:一次结构化调用。判别式:节点要活得比父调用久、
或要等墙钟/外部事件 → 编排;否则 → 代理引擎内。

三条硬性质(红线,违规推倒重来):

1. 库不是框架——宿主持有 main(),零件可单独拿取。
2. 对代理 SDK 无特权通道——只准 import `@biav/agent-sdk` 公开面;深路径 / 相对路径
   伸进代理源码 = 违规。CI `check-dep-direction` 机器执法(反向 import 亦红)。
3. 数据面在 SDK、渲染在宿主——送达/显示只定契约缝,实现宿主注入。

## 家族纪律

- 两包各自 semver,版本钟永不同步,「顺手一起 bump」违规(需求档 §2)。
- 依赖单向:编排 → 代理。共享代码只准下沉进代理 SDK 或独立第三包。
- 发版纪律与代理侧同构:改 shipped 运行时代码即 bump + CHANGELOG 一行。
- monorepo:仓库根 `package.json` workspaces 持两包,单一根 lockfile;
  `npm ci` 在仓库根跑,workspace 内 `npm run <script>` 照常。

## 当前状态

第零战(monorepo 迁移)完成:空包立包。首战能力面 = 任务台账 + 驱动器
(需求档 §4),验收线见施工封面;loop 骨架 / schedule / workflow 图 /
goal 追逐器 / 送达契约按后续战役进驻。
