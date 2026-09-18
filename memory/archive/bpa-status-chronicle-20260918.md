# Black Pool Agent 状态编年归档（截至 2026-08-17）

> **⚠ 归档层，不作运行时约束**：本档是 `memory/project-status.md`「## Black Pool Agent」节
> 2026-08-02 立项至 2026-08-17 首次周更实跑期间累积的**建设轮次编年**，原文逐字迁入，
> 一行未改、一行未删。
>
> **为什么迁**（2026-09-18，照 `sdk-status-chronicle-20260727.md` 先例）：状态档是「每会话必读
> 的状态权威」，行数上限 520 由 `tests/test_claude_md_size.py` 守着，而该测试给的 remedy 明写
> 「历史轮次进 memory/archive/」。本次移 pin 要记的**形态变更**（回归网受控豁免闸门）进不去，
> 正是因为编年条目把额度占满了。迁走的是**已定型、不再变化的建设轮次**；留在状态档的是
> **仍在起作用的形态条**（周更例程形态 / 闭环形态 / 当前 pin 与闸门）。
>
> **逐次移 pin 的唯一权威**始终是 [`projects/black-pool-agent/UPSTREAM.md`](../../projects/black-pool-agent/UPSTREAM.md)
> 的 pin 表与移 pin 史；补丁漏缝看 `gaps.md`；裁定溯源看 `memory/decisions.md`。

---

- **M0 立项（2026-08-02）**：完成——四项配套裁定落档 + 脚手架 + 首钉 `v2026.7.30` 快照 vendor + 上游套件容器内全量实证（22,766 过零真缺陷，报告在 Resource/repo-engineering）。
- **需求 #2 对话成本面板已交付（2026-08-02）**：`conversation-cost-panel.patch`（白名单特性补丁，上下文零品牌词可叠加换装）——网关 4 字段透传 + 前端差分成轮 + 面板挂状态栏 + i18n 五语种，测试三绿。
- **施工边界文书接收（2026-08-02 同日）**：15 条裁定 + 禁止十条即时生效，原文归档 `Public-Info-Pool/Resource/repo-engineering/bpt-hermes-charter-20260802.md`（唯一权威）。核心零侵入 / 切面化「代码公开配置内网」/ idealab 唯一通道；upstream/ 定位 = **银芯开发镜像**（SVN vendor 生产供应链在黑池侧）；patches 白名单 + 骨架完整由 `tests/test_hermes_charter.py` 机械守卫。
- **起手式转黑池侧建议（守密人 2026-08-02 裁定，T79 销案）**：文书 §6 七步银芯不追踪执行；银芯常态职责 = 追官方新版 + gaps.md 值守 + 按需供材料（点名派发另计）。
- **需求 #1 品牌换装已交付（2026-08-02）**：Silver Core 品牌 + 知识层统一称「知识底座」——零侵入套件
  （SOUL.md 模板 / CLI 别名）+ patches/ 白名单制（`build/rebrand.py` 规则引擎生成 388 文件补丁，含
  desktop/web 裸词换装——守密人补充「主要消费面是 desktop」后扩面；四不碰红线，upstream 零修改组装期应用）；台账 `BRANDING.md`。
- **首件便携整包已实证落桶（2026-08-02，三轮迭代绿，run 30750724034）**：`silver-core-win64.zip`（1.04GB，sha256 在册）落 `silver-core-bundle` Release——合箱单目录搬移自愈冒烟全通；前两轮两坑（pyvenv.cfg 绝对路径 / 冒烟 cwd）均修入工作流。
- **上游移 pin `v2026.8.3` / 0.20.0（2026-08-04，守密人派发）**：快照替换 + 哨兵同步 + 补丁重生成/重放
  全绿（`UPSTREAM.md`）；浅色降饱和 12 令牌（`BRANDING.md`）；套件复跑 25,176 过零真缺陷（testrun-20260804）。
- **首次实跑 + 闭环补完（2026-08-16/17）**：移 pin `v2026.8.13` / 0.20.1（1,620 提交）。首轮组装**红**——内网层两条测试对齐规则的锚点被上游改跑、替换静默 no-op（`reportBackendContract(5)→(6)`；onboarding 加了两行 Fireworks 断言），`--check` 与哨兵均未拦（前者只比「补丁==规则输出」，后者只盯实现侧规则）。**根治**：规则引擎加**锚点点火台账**（任一 POST 规则全树零命中即生成期响亮失败，负控已验），次轮组装绿、`black-pool-win64.zip` 371.9 MiB 落桶。
