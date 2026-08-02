# upstream/ 快照台账（唯一权威）

> **形态（守密人 2026-08-02 裁定「快照 vendor」，否决指针式 / submodule / subtree 全历史）**：
> `upstream/` 是 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
> 在 pin 点的**工作树快照**（`git archive` 的 tracked 文件全集，不带上游 .git 历史——
> 上游全历史 422MB / 20,095 提交刻意不并入，与 T62 压扁纪律同向）。

## pin 策略（守密人 2026-08-02 裁定）

**release tag 优先**：pin 一律取上游 release tag（上游自己盖章的稳定切面），不取任意 HEAD——
实测上游 tag→HEAD 三天可差 464 提交，HEAD 是任意切点。仅当急需某个未发版修复时，
经守密人裁定方可临时钉 HEAD/commit。首钉曾短暂取当日 HEAD `f86693c2`，同日按本策略
换轨至 tag。

## 当前 pin

| 项 | 值 |
|----|----|
| 上游仓库 | `NousResearch/hermes-agent`（MIT） |
| pin tag | **`v2026.7.30`**（commit `cc4cab2f592e60a197e796506de9168f74baf3ea`，2026-07-30） |
| 快照规模 | 8,071 文件 / 151MB |
| 入仓日 | 2026-08-02 |

## 同步例程（移 pin 时照此执行）

1. 仓外浅克隆目标 ref：`git clone --depth 1 [--branch <tag>] https://github.com/NousResearch/hermes-agent.git`
2. 全量替换快照：清空 `upstream/` → `git -C <clone> archive HEAD | tar -x -C upstream/`
   （用 archive 取 tracked 全集，绕过双方 .gitignore 差异；入库用 `git add -f`）。
   **add 前必清生成物**：`find upstream -name __pycache__ -type d -prune -exec rm -rf {} +`
   ——`git add -f` 会连生成物一起强制入库；实测教训：在树内跑过测试后未清 `.pyc` 就 add，
   上游脱敏测试 .pyc 里的假 Slack token 样本直接触发 GitHub 推送保护拒推（2026-08-02）
3. **逐条重放 `DEVIATIONS.md` 补丁**（首条偏离出现时建档；每条须核对上游同位是否已变）
4. 更新本档 pin 表 → 跑全量守卫 → 单提交入库（`vendor: hermes-agent @<short-sha>`）

## 纪律

- 改造面定式 = **插件 + 补丁**（CONTEXT.md 铁律 1）：`upstream/` 内的任何直接改动都是
  **补丁**，必须同步登记 `DEVIATIONS.md`；未登记的 upstream 内 diff = 违纪，同步时会被
  全量替换无声吞掉。
- 上游嵌套的 `.github/workflows/` 不在仓根，GitHub 不会执行，属快照惰性内容，勿搬仓根。
- MIT 合规：`upstream/LICENSE` 随快照保留；再分发衍生物须保留版权与许可声明。
