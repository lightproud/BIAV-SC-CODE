# Silver Core SDK 更名评审（PR #560）与修复记录

- 日期：2026-07-10
- 评审对象：[PR #560](https://github.com/lightproud/brain-in-a-vat/pull/560)
  `rename: bpt-agent-sdk -> silver-core-sdk`（squash 合并 main `287ea40f`）
- 评审人：艾瑞卡（守密人指令「审视代码和设计」）；修复经守密人「全部修复」裁定
- 修复落地：0.41.1（见 `projects/silver-core-sdk/CHANGELOG.md`）

## 一、评审范围与总评

PR #560 共 265 文件（+1228/−1202；229 重命名 / 17 内容修改 / 9 删 9 增为
OKF 概念换代）。设计主轴「活表面全换新、历史零改写」贯彻完整：

- SDK 本体（目录 / 包名 / UA / clientInfo name / 日志前缀 / 错误前缀，0.41.0）
- CI（`silver-core-sdk.yml` + `conformance-drift.yml` / `build-okf-bundle.yml` 路径）
- OKF（`project-silver-core-sdk` / `silver-core-sdk-doc-*` 概念，同 PR 重建，lesson #46）
- 记忆层（决策落档 + 活文档「原名」标注 + capability registry 重生成）
- 历史不追溯（0.41.0 前 CHANGELOG / 决策档历史行 / `Resource/**/bpt-*` 归档保留旧名）

验证链：本地 pytest 2676 绿 + vitest 1634 绿 + tsc exit 0；合并后 main
`287ea40f` 上 Silver Core SDK / Run Tests / Build OKF Bundle /
Build Capability Registry 四条 CI 全部 success。

已取证的无缺陷面：版本守卫路径正则同步且实跑通过；全仓零活指针残留；
`kb_search` 实测 `silver-core-sdk` 与「银芯」两个词面互不污染；
运行时持久化路径不含包名（更名不失联既有会话存档）。

## 二、发现与处置（均低危）

| # | 发现 | 处置 |
|---|------|------|
| 1 | MCP 握手 `clientInfo.version` 在 `src/mcp/http.ts` / `src/mcp/stdio.ts` 硬编码 `'0.1.0'`——D9 单一版本源审计（2026-07-10）修了 UA 与 init 消息、漏了 MCP 两处；更名 PR 换了 name、version 仍失真 | **已修（0.41.1）**：两处改引 `SDK_VERSION` |
| 2 | 棘轮钉基线 `tests/conformance/baseline.json` 的 `generated_for` 描述标签被 sed 直改而非重新生成。判定安全：greens 清单一字未动、`conformance-ratchet.test.ts` 全绿证明键派生不依赖该前缀；但「绝不自动改基线」纪律精神要求留痕 | **本档案即正式留痕**：改动仅限封皮标签，基线数据未动；后续任何触基线的改动仍须走 `ratchet --update` 正道 |
| 3 | 包名即 import 名，黑池消费方需同步改依赖名与 tarball pin（`bpt-agent-sdk-*.tgz` → `silver-core-sdk-*.tgz`），但迁移提示只落在 CHANGELOG；银芯→黑池单向输出、无自动通知渠道 | **已修**：`docs/MIGRATION.md` 顶部加更名迁移注；另建议守密人经通道②（对话搬运）向黑池侧口头带到一次 |

## 三、设计评估结论（存档）

- 更名分界线（活表面 vs 历史）与仓库纪律同构（决策档只追加、归档只追溯），
  反向选择（全量追溯 sed）会伪造历史证据链，不可取。
- minor 升版（0.41.0）定级合理：UA / clientInfo 是消费者可见身份面。
- 已知可接受代价：GitHub 旧工作流运行历史仍挂旧名（平台行为）；历史归档文档
  内部的 `projects/bpt-agent-sdk/...` 旧路径按裁定不修，读档以
  `memory/project-status.md` 专节更名注为路标。
