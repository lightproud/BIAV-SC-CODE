# upstream/ 快照台账（唯一权威）

> **形态（守密人 2026-08-02 裁定「快照 vendor」，否决指针式 / submodule / subtree 全历史）**：
> `upstream/` 是 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> 在 pin 点的**工作树快照**（`git archive` 的 tracked 文件全集，不带上游 .git 历史——
> 上游全历史 422MB / 20,095 提交刻意不并入，与 T62 压扁纪律同向）。
>
> **定位（守密人同日交互澄清 + 施工边界文书 §2.1/§2.4）**：本快照是**银芯开发镜像**——供
> 开发、测试、追官方新版（升级链条「外网机追 tag 先行体验」一环）；黑池侧另有 SVN vendor 仓
> 作**生产供应链**（整包零修改、离线可重建），两者并存。**零修改纪律与 SVN vendor 同款**：
> `upstream/` 内不落任何改动，扩展走 `plugins/`，被迫改核心的补丁落 `patches/`（当前必须为空，
> 守卫 `tests/test_hermes_charter.py`）并挂 `gaps.md`。**生产禁用 `hermes update`**，
> 更新只有「换 tag 重测」一条路。

## pin 策略（守密人 2026-08-02 裁定）

**release tag 优先**：pin 一律取上游 release tag（上游自己盖章的稳定切面），不取任意 HEAD——
实测上游 tag→HEAD 三天可差 464 提交，HEAD 是任意切点。仅当急需某个未发版修复时，
经守密人裁定方可临时钉 HEAD/commit。首钉曾短暂取当日 HEAD `f86693c2`，同日按本策略
换轨至 tag。

## 当前 pin

| 项 | 值 |
|----|----|
| 上游仓库 | `NousResearch/hermes-agent`（MIT） |
| pin tag | **`v2026.8.27`**（commit `5fc308a70719a83cccdbba4c0e39c23f5a8239d5`，2026-08-27，引擎版本 0.20.6） |
| 快照规模 | 10,488 文件 / 182MB |
| 入仓日 | 2026-08-28 |

## 移 pin 史

<!-- 机器追加区：build/sync_upstream.py 只在表尾 append 一行，既有行一字不改。
     人工补注写进「备注」列，不会被后续自动移 pin 覆盖。改表头形态即断同步引擎。 -->

| 日期 | tag | 引擎版本 | 备注 |
|------|-----|---------|------|
| 2026-08-02 | `v2026.7.30` | 0.19.1 | 首钉（曾短暂取当日 HEAD `f86693c2`，同日按 release tag 策略换轨至 tag） |
| 2026-08-04 | `v2026.8.3` | 0.20.0 | 守密人「HERMES 更新 0.20」派发；特性补丁 conversation-cost-panel 于 use-statusbar-items.tsx import 区人工重放一处，其余 hunk 带偏移干净落位 |
| 2026-08-16 | `v2026.8.13` | 0.20.1 | 周更例程自动移 pin |
| 2026-08-24 | `v2026.8.19` | 0.20.5 | 周更例程自动移 pin（闭环全绿） |
| 2026-08-28 | `v2026.8.27` | 0.20.6 | 守密人派发「拉下最新版本」（非周更例程档期）。两处人工接手：① 特性补丁 conversation-cost-panel 在 use-statusbar-items.tsx import 区撞车——上游把相邻的 runtime-readiness 改成具名+type 混合导入，挤歪了 hunk #2 的上下文；按语义重放后新旧补丁增删行逐字相同（各 802 增 / 16 删）。② 上游新增 themes/presets.test.ts 用例断言默认皮肤仍是 nous，撞上 2026-08-03 配色裁定的 black-pool 强制值；按 2026-08-24 先例翻面成收口哨兵（不豁免、不删用例）。第三轮闭环全绿 |

## 同步例程（移 pin 时照此执行）

**日常走自动化**：周更例程每周一 00:00（北京，UTC 周日 16:00）自动跑完下述四步，
手册见 [`WEEKLY-UPDATE.md`](WEEKLY-UPDATE.md)，机械腿是 `build/sync_upstream.py`
（`probe` 探版 / `sync` 一步换装 / `changelog` 出变更清单 / `announce` 出公告）。
本节保留为**引擎行为的地面真相**——手办与自动跑的是同一条例程，出入即 bug。

1. 仓外浅克隆目标 ref：`git clone --depth 1 [--branch <tag>] https://github.com/NousResearch/hermes-agent.git`
2. 全量替换快照：清空 `upstream/` → `git -C <clone> archive HEAD | tar -x -C upstream/`
   （用 archive 取 tracked 全集，绕过双方 .gitignore 差异；入库用 `git add -f`）。
   **add 前必清生成物**：`find upstream -name __pycache__ -type d -prune -exec rm -rf {} +`
   ——`git add -f` 会连生成物一起强制入库；实测教训：在树内跑过测试后未清 `.pyc` 就 add，
   上游脱敏测试 .pyc 里的假 Slack token 样本直接触发 GitHub 推送保护拒推（2026-08-02）
3. **重生成品牌补丁 + 重放特性补丁**：先同步 `build/rebrand.py` 的 `UPSTREAM_VERSION` 常量与
   `tests/test_hermes_charter.py` 出身行哨兵，再 `python3 build/rebrand.py`（规则引擎重出
   `patches/black-pool-rebrand.patch` + `black-pool-intranet.patch` 两张）；特性补丁（如 `conversation-cost-panel.patch`）逐个
   `git apply --check` 核对新基底，冲突则人工重放后重出 diff（守卫核干净应用 + 三红线）
4. 更新本档 pin 表与移 pin 史 → 跑全量守卫 → 单提交入库（`vendor: hermes-agent @<short-sha>`）

> 自动化的射程边界：步 1、2、4 与步 3 的**前半句**（同步常量 + 重生成品牌补丁）由引擎
> 确定性完成；步 3 **后半句的人工重放**引擎只做 `--check` 并以退出码 3 上报，绝不代劳——
> 重放是判断题不是填空题，交给例程会话（这正是守密人 2026-08-09 选「会话例程」而非纯 CI 的理由）。

## 纪律

- **upstream/ 零修改**（施工边界文书禁 1，核心零侵入）：任何 upstream 内 diff = 违纪，
  同步时会被全量替换无声吞掉；扩展走 `plugins/`，缺口记 `gaps.md`。
- 上游嵌套的 `.github/workflows/` 不在仓根，GitHub 不会执行，属快照惰性内容，勿搬仓根。
- MIT 合规：`upstream/LICENSE` 随快照保留；再分发衍生物须保留版权与许可声明；
  对外口径禁「100% 纯自研」（文书裁 10）。
