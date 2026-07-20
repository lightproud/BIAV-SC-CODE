# 环行记 · Ring Chronicle

> 《忘却前夜》（Morimens）衍生同人玩法 · 吸血鬼幸存者（Vampire Survivors-like）
> B.I.A.V. Studio 银芯知识层项目 · 仅引用公开可查阅信息 · 非官方商业内容

操控**守密人**与**唤醒体**，在融蚀（Erosion）吞噬世界的最后时刻，于环行之地抵抗成群涌来的融蚀造物，靠不断觉醒命运卡变强，存活十分钟并击败融蚀领主。

## 怎么玩

1. （首次或改了配置后）在本目录运行 `node build.mjs` 生成 `config/config.js`。
2. 浏览器直接打开 `index.html`（双击即可，无需服务器）。
3. 选择唤醒体 → WASD / 方向键移动 → 武器自动攻击 → 升级时三选一命运卡。
4. 存活 10 分钟并击败**融蚀领主**即胜利；生命归零则被世界遗忘。

操作：移动 WASD / ↑↓←→ · 暂停 P / Esc。

## 玩法要点

- **四界域武器家族**（取自真实四界域机制）：混沌·回响刃 / 深海·触腕 / 血肉·荆棘场 / 超维·爆发。
- **纯界域共鸣**：同界域武器 ≥ 3 触发增益；混沌为通配，可补足任意界域共鸣（移植正典「混沌可与任何界域协同」）。
- **唤醒体天赋**：环行·拉蒙娜（回响积累，硬核挑战）/ 图鲁（投射物 +1）/ 潘狄娅（受击反击）/ 朵尔·熔毁（范围扩张）。

设计依据见 `DESIGN.md`。

## 工程

| 路径 | 作用 |
|------|------|
| `config/*.json` | 配置层（唯一事实源）：角色 / 武器 / 敌人 / 生成 / 升级 |
| `build.mjs` | JSON 配置 → `config/config.js`（供 file:// 加载） |
| `src/core.js` | 纯逻辑引擎（浏览器与 node 共用，可 headless 测试） |
| `src/sprites.js` `render.js` `input.js` `main.js` | 程序化美术 / 渲染 / 输入 / 装配 |
| `test/core.test.mjs` | 单元测试：`node test/core.test.mjs`（23 项） |
| `test/playthrough.mjs` | 整局模拟：`node test/playthrough.mjs [角色id]` |

平衡数值均在 `config/` 中，可直接调整后重跑 `build.mjs`。
