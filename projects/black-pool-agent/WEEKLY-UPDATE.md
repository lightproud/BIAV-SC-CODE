# Hermes 周更例程手册（例程会话的唯一权威）

> **起跑**：每周一 00:00 北京时间（= 周日 16:00 UTC，Routine cron `0 16 * * 0`），
> 由 Claude Routine 拉起一个**全新会话**执行本手册。守密人 2026-08-09 四项裁定确立形态：
> **会话例程载体** · **全绿即自动直推 main** · **合并后自动触发组装** · **只出私有版**。
>
> 本手册是给「那个还没有任何上下文的未来会话」写的——它开机时只有 CLAUDE.md 与本档。
> 因此这里把**每一步该敲什么、绿了怎么走、红了怎么停**全写死，不留「凭经验判断」的缝。

## 0. 例程要交付什么（守密人的原话拆成四件）

| # | 交付件 | 落点 |
|---|--------|------|
| 1 | 更新 Hermes 源码 | `projects/black-pool-agent/upstream/` 快照移 pin，直推 main |
| 2 | 重新核对补丁 | 品牌两张规则引擎重出；特性补丁逐张核对，冲突则人工重放 |
| 3 | 更新的新内容公告 | `Public-Info-Pool/Resource/repo-engineering/hermes-weekly-update-<YYYYMMDD>.md` |
| 4 | zip 下载链接 + BPA 更新指南 | 同上档第三、四节（组装线出包后回填 run 链接） |

上游无新版时**四件全部不做**，只回一句「本周上游无新版，pin 保持 `<tag>`」——
不留空转提交，不发空公告。

## 1. 探版（先问要不要动）

```bash
cd <银芯克隆根>
python3 projects/black-pool-agent/build/sync_upstream.py probe
```

- 报「已是最新，无事可做」→ 跳到第 8 步汇报，例程结束。
- 报「须移 pin → vX」→ 继续。**探不到任何 tag 会响亮失败**（退出码 2），
  那是网络/代理问题，不是「没更新」——此时报障，不得当成无更新收工。

## 2. 换装（一步跑完机械活）

```bash
WORK=$(mktemp -d)   # 必须在仓外：临时克隆落进仓内会被 git add 卷进快照
python3 projects/black-pool-agent/build/sync_upstream.py sync \
        --work "$WORK" --report "$WORK/sync-report.json"
echo "exit=$?"
```

引擎一步做完：仓外浅克隆目标 tag → 清空并重铺 `upstream/` 快照（`git archive` 取 tracked
全集 + 清 `__pycache__`/`.pyc`）→ 同步 `build/rebrand.py` 的 `UPSTREAM_VERSION` 与
`tests/test_hermes_charter.py` 出身行哨兵 → 跑 `rebrand.py` 重出两张品牌补丁 →
特性补丁逐张 `git apply --check` → `git add -f` 暂存并算文件级变更账 →
取两 pin 间提交史并分类 → 改 `UPSTREAM.md` 的 pin 表与移 pin 史。

**退出码即分流**：`0` = 全干净，去第 4 步；`3` = 特性补丁冲突，去第 3 步；`2` = 环境/台账
出错，**停手报障**（别硬闯，`upstream/` 此时可能是半态，用 `git checkout -- ` 回滚干净）。

## 3. 特性补丁人工重放（只有退出码 3 才走）

这一步是**整条例程唯一需要判断力的地方**，也正是守密人选会话例程而非纯 CI 的理由。

1. 看报告里 `feature_patches[].detail`，定位冲突的文件与 hunk
2. 在 `upstream/` 上手工把该补丁的意图重放一遍（改的是**语义**不是行号——
   上游重构过就照新结构重写，别硬塞旧上下文）
3. 重出 diff 覆盖原补丁：`git diff -- <改动文件> > patches/<名>.patch`，
   然后 `git checkout -- <改动文件>` 把 `upstream/` 恢复零修改
4. `git apply --check --directory=projects/black-pool-agent/upstream patches/<名>.patch` 复核

**红线**：`upstream/` 本体永远零修改（施工边界文书禁 1），补丁只在组装期应用。
重放不成功、或上游已把该特性做进主干 → **停手挂 `gaps.md` 并在汇报里点名**，
不得为了让例程「跑完」而丢掉补丁。

## 4. 守卫（判定门，不许跳）

```bash
pytest tests/test_hermes_charter.py -v     # 补丁白名单 + 干净应用 + 三红线 + 哨兵
python3 projects/black-pool-agent/build/rebrand.py --check   # 补丁与规则输出零漂移
python3 scripts/premerge_gate.py           # CI 会跑的全套（required 检查 = test）
```

任一红 → **停手报障，不推**。CLAUDE.md §7.6 已实测钉死：required 检查**从未真正挡下过**
合并，全部安全性落在合并前这一道门上——这里放水没有第二道网接着。

哨兵失配（`公版规则从补丁消失`）几乎必然意味着上游改了锚点结构：按 `rebrand.py`
的规则表逐条对新结构修锚，修不动的挂 `gaps.md`。

## 5. 直推 main（守密人 2026-08-09 裁定）

```bash
git add -f -A projects/black-pool-agent/upstream
git add projects/black-pool-agent/UPSTREAM.md projects/black-pool-agent/patches \
        projects/black-pool-agent/build/rebrand.py tests/test_hermes_charter.py
git commit -m "vendor: hermes-agent @<short-sha> (<old-tag> -> <new-tag>, engine <old> -> <new>)"
git push -u origin main
```

- 推送前 `git status` 确认**临时克隆没混进暂存区**（`$WORK` 在仓外就不会，核一眼不亏）。
- 网络失败按 2s/4s/8s/16s 退避重试至多 4 次。
- 若所在环境强制 feature 分支不许直推 main：开 PR → 门禁绿 → 立即 squash 合并，
  **不停留等待逐项确认**（§7.6 合并默认规则）。裁定的实质是「不为这次移 pin 排队等人裁」。

## 6. 触发组装线并备好 zip 链接

合并进 main 后立刻触发**私有版**组装（只出私有版，公版按需手动）：

- 工具：`mcp__github__actions_run_trigger`，workflow = `assemble-black-pool-bundle.yml`，
  ref = `main`（没有 MCP 工具时退回 `gh workflow run assemble-black-pool-bundle.yml --ref main`）
- 组装线含回归网前置 job（ubuntu 跑 desktop 全量 vitest），全程约 60–90 分钟
- **不要原地干等**：用 `send_later` 约 50 分钟后叫醒自己回查 run 状态，本轮先去做第 7 步

回查时确认三件：run 结论为 success · Release 桶 `black-pool-bundle` 的
`black-pool-win64.zip` 更新时间是本次 · 该 run 日志里 `BUILD.md` 的上游 pin 行是新 tag。
组装红 → 在公告第五节如实写明「zip 未出，下载链接仍指向上一版」并报障，
**绝不**把红的 run 写成绿。

下载链接（恒定，内容滚动）：

- 直链 `https://github.com/lightproud/biav-sc-code/releases/download/black-pool-bundle/black-pool-win64.zip`
- Release 页（含 SHA-256 digest）`https://github.com/lightproud/biav-sc-code/releases/tag/black-pool-bundle`

## 7. 公告 + 更新指南落档

```bash
python3 projects/black-pool-agent/build/sync_upstream.py announce --report "$WORK/sync-report.json"
```

引擎渲出三合一档（新内容公告 / 下载 / BPA 更新指南），路径经 `scripts/deliverable_path.py`
算出，形如 `Public-Info-Pool/Resource/repo-engineering/hermes-weekly-update-<YYYYMMDD>.md`。

**会话必须补两处**，机器刻意留空（它数得清 900 条提交，数不清哪条对用户重要）：

- 第一节末的注释块 → 一段人话：本周对黑池用户**实际可感知**的变化是什么。
  素材取自第二节「撞补丁面高风险条目」+ feat/fix 清单 + 上游 release 页
  （`https://github.com/NousResearch/hermes-agent/releases/tag/<tag>`，可用 WebFetch 取）
- 第五节「需要守密人注意的」→ 补丁重放了哪几处 / 高风险条目哪条真撞了 / 组装线绿否 /
  有没有该挂 `gaps.md` 的漏缝。**没有就写「无」，不留空注释块**

补完连同组装 run 链接一起提交推送（`docs: hermes weekly update announcement <YYYYMMDD>`）。

## 8. 汇报（CLAUDE.md §2.2 三条硬规则照常适用）

按合并后总结体：⓪工作定性开篇 → ①本次归账 → ②累计总账（精确数字）→ ③关键产物可点击链接
→ ④守密人侧余项清单。链接至少给：公告档 blob 链接 · 移 pin 提交链接 · 组装 run 链接 · zip 直链。

无更新周的汇报压到一句：「本周上游无新版，pin 保持 `<tag>`（引擎 `<ver>`），例程空转正常。」

## 9. 停手清单（撞上任一条即停，报障不硬闯）

| 情形 | 处置 |
|------|------|
| 探不到 tag（退出码 2） | 报网络/代理障，**不得**当成「无更新」 |
| 特性补丁重放不成功 | 挂 `gaps.md`，停在第 3 步，不丢补丁不硬推 |
| 守卫任一红 | 停在第 4 步不推；哨兵失配优先怀疑上游改锚点 |
| 上游一周跨了多个大版本 / 引擎主版本号跳变 | 移 pin 但**不自动推**，交守密人裁定 |
| `upstream/` 出现非快照改动 | 违纪（禁 1），停手报告，绝不 `git add` 掩盖 |
| 黑池数据以任何形式出现在待推内容里 | §1.1-HC 硬约束，**拒绝并报告** |

## 10. 例程本身的维护

- Routine 定义在守密人账户侧（cron `0 16 * * 0`，每次起新会话）。改节拍 / 停跑用
  `list_triggers` 找到 trigger id 后 `update_trigger`（改 cron 或 `enabled: false`），
  删除用 `delete_trigger`。
- 引擎行为的地面真相是 `UPSTREAM.md`「同步例程」四步——手办与自动跑必须是同一条例程，
  出入即 bug。改引擎须同步改那节。
- 守卫：`pytest tests/test_hermes_weekly_update.py -v`（台账形态 / 引擎契约 / 本手册指针）。
