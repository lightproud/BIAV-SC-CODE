# Silver Core SDK — 真 L5 一致性轮诊断（2026-07-11，T4 点火）

> 类型：`data-diagnostics` ｜ 主题：`silver-core-sdk-l5-round` ｜ 日期：2026-07-11
> 路径由 `scripts/deliverable_path.py` 强约定生成。银芯公开信息层产物，§1.1-HC 同向（银芯自有工程产物，无黑池数据）。

## 0. 一句话结论

守密人已裁「点火」的这一轮真 L5（run [29134399453](https://github.com/lightproud/brain-in-a-vat/actions/runs/29134399453)）**技术上干净成功、两臂零背离**，但**主目标 code-01 残余复验未达成**——`$1.5` 预算帽在 `repeat=5` 下跑到第 8 个任务（document-01）即因「照此速度做完会超帽」被预算守卫干净中止（79/180 runs，实花 $0.59），code 维度整段没轮到。**门禁非破线**（INCONCLUSIVE-PARTIAL，exit 0），**非基建故障**，是**预算射程不足**。

> 小学生比喻：体检项目排了 18 项、每项做 5 遍，做到第 8 项时机器一算「照这速度做完要超预算」就自动喊停——做过的每一项两边都满分、完全一致；可守密人最想复查的那项（code-01）排在后半段，根本没轮到就下班了。不是没做好，是没排到。

## 1. Run 元数据

| 项 | 值 |
|----|-----|
| Run | [29134399453](https://github.com/lightproud/brain-in-a-vat/actions/runs/29134399453)（workflow `Silver Core SDK` / `silver-core-sdk.yml`）|
| 触发 | `workflow_dispatch`，ref=main，输入只勾 `conformance_l5=true`（余默认）|
| 被测 head | `1783b0dc`（main，**v0.43.0**：含 i18n 0.28 / SendMessage+coordinator 0.42 / 断线韧性 0.43 全部变更）|
| 模型 | `claude-haiku-4-5-20251001` ｜ repeat=5 ｜ 预算帽 $1.5 ｜ thinking 各臂默认 ｜ econ off ｜ taskFilter 无 |
| 官方臂 pin | `@anthropic-ai/claude-agent-sdk@0.3.201` + `@anthropic-ai/claude-code@2.1.201`（`tests/conformance/pins.json`）|
| 作业结论 | 全绿：`conformance-l5` success / `conformance`（L1–L4+棘轮）success / `unit` success / `live-smoke` success；`ab-benchmark`·`vs-official`·`prompt-ab`·`cache-probe` 正确 skipped |
| 净室自审 | content-blind self-audit：**PASS** |
| 报告 artifact | `conformance-l5-report`（id 8243141795，含 `conformance-l5.json` + 39 条官方 L6 迹）|

> 预算核对：本轮**只有**真 L5（$0.59）+ 陪跑 live-smoke（几分钱）花钱；四个费预算作业全 skipped。实花远低于 $1.5 帽（因预算守卫按**投影**提前止损，非实花触顶）。

## 2. 门禁与两臂结果（跑到的 8 任务）

**Gate B（乙门禁）判定：`INCONCLUSIVE-PARTIAL`**——规则为「全任务重复聚合 pass 率：bpt ≥ official − 5pp」；本轮因预算中止，证据不完整，**明示非破线（NOT a breach，exit 0）**。

| 指标 | bpt | official | delta |
|------|-----|----------|-------|
| 聚合 pass | 40/40（100.0%）| 39/39（100.0%）| **0.0pp**（容差 −5pp）|
| 缓存诊断 | writes 32117 / reads 1614903 → scenario a（设计点）| writes 55634 / reads 1593634 → scenario a | 两臂缓存均正常 |
| L6 迹留存 | 0（按设计，L6 只留官方公开流）| 39 | —— |

> 小学生比喻：门禁不是「红灯」也不是「绿灯」，是「灯没亮完就停电了」——已经点亮的那几盏（8 个任务）两边一模一样、全过；但灯没点全，不能盖章「整场通过」。这套设计本就如此：宁可诚实说「证据不全」，也不拿半场当全场。

### 2.1 逐任务（8 触达 + 10 未触达）

| 任务 | 维度 | zh | pass bpt/official | 中位 turns b/o | 中位 cost$ b/o |
|------|------|----|-------------------|----------------|----------------|
| chat-01 | chat | | 5/5 · 5/5 | 1/1 | 0.0037/0.0036 |
| chat-02 | chat | zh | 5/5 · 5/5 | 1/1 | 0.0034/0.0032 |
| chat-03 | chat | | 5/5 · 5/5 | 1/1 | 0.0034/0.0032 |
| retrieval-01 | retrieval | | 5/5 · 5/5 | 2/3 | 0.0061/0.0135 |
| retrieval-02 | retrieval | | 5/5 · 5/5 | 2/2 | 0.0065/0.0067 |
| retrieval-03 | retrieval | zh | 5/5 · 5/5 | 3/6 | 0.0099/0.0133 |
| retrieval-04 | retrieval | | 5/5 · 5/5 | 2/2 | 0.0060/0.0056 |
| document-01 | document | | 5/5 · 4/4 | 3/5 | 0.0097/0.0144 |
| document-02/03/04 | document | | **未触达**（预算中止）| — | — |
| **code-01** | code | | **未触达**（预算中止；主目标）| — | — |
| code-02/03/04/05 | code | | **未触达** | — | — |
| longconv-01/02 | long-conversation | | **未触达** | — | — |

> official document-01 只完成 4 遍（第 5 遍前预算已止），故 4/4。

## 3. 主目标为何未达成：$1.5 帽在 repeat=5 下够不到 code 维度

- 预算守卫在**投影**（`$0.59 实花 → 投影全程 $1.56 > $1.5`）时干净中止，`aborted=true`、`runsDone=79/180`。
- 历史**能跑到 code-01 的全量干净轮都用 `$5` 帽、实花 $2.19–$3.28、跑满 180/180**：v0.18.2（run 28888199011，$2.19）、v0.28.0（$3.28）。**`$1.5` 结构上到不了 code 维度**——task 库前排是 chat/retrieval/document，code/longconv 在后半段。
- 故 T4 账目里「验 code-01」与「$1.5 帽」在 `repeat=5` 下**互斥**：要复验 code-01，必须放宽预算或改采样。

> 小学生比喻：想检查排在队尾的那位同学，可门口只发了够前 8 位的号，队尾的号没发到。要么多发号（涨预算），要么让每人少排几次（降 repeat），要么单独把队尾那位拎出来单检（定向 shard）。

**code-01 是什么**（历史背景，采信 `project-status.md`）：已知的 **diligence 概率残余**（只排序不处理偶数长度），**非思考开关位**。历轮浮动：off 基线 0/3 → 3/5 → 1/5 → 0/5 → v0.18.2 **3/5** → v0.28.0 **2/5**。守密人本次想要的是在**当前 v0.43.0**（历经 i18n/韧性/SendMessage 大批变更后）重采一轮确认它没回归——**这个确认本轮没拿到**。

## 4. 能采信的部分（部分覆盖的正向信号）

- **前 8 任务在 v0.43.0 上零回归**：chat×3 + retrieval×4 + document-01，bpt 与 official **全 100%**、delta 0.0pp。即 chat/retrieval/document 前排在 0.28→0.43 的全部变更后**未见退化**。
- **效率旁证**（reported-only，蓝图 §二 明示**永不门禁**）：bpt 在多轮/检索/文档任务上**更省 token + 更少 turns**——retrieval-01 bpt $0.0061/2turns vs official $0.0135/3turns、retrieval-03 bpt $0.0099/3turns vs official $0.0133/6turns、document-01 bpt $0.0097/3turns vs official $0.0144/5turns。与历轮 econ 结论同向。
- **L1–L4 差分 + 棘轮 GATE 亦 success**（同 run `conformance` 作业）：白盒一致性网 + 棘轮基线在真实双臂下门禁全绿，无退化。

## 5. 判定归类与纪律声明

- **非基建故障**：所有作业 exit 0、真 API 冒烟 success、账户有额度、无 `Credit balance` 类耗尽（对比 v0.14 那轮的账户跑空无效轮）。
- **非行为回归**：门禁明示非破线；跑到的任务两臂一致。
- **是预算射程不足**：`$1.5` 帽 + `repeat=5` 的组合决定只能覆盖前 8 任务。
- **红行不遮蔽已执行**：本报告不把「8 任务全过」粉饰成「轮次通过」，不把「code-01 未触达」写成「code-01 已复验」。棘轮只许 improvement 方向，本轮**未动任何基线**。

## 6. 后续（属新预算 / 新接线，留守密人裁）

要真拿到 code-01 在 v0.43.0 的复验，三条路（均超出本次授权的 $1.5 单轮，故不自作主张，挂新账 T17）：

1. **涨帽全量轮**：`l5_budget=5` 重新 dispatch，跑满 180/180（历史成本 $2.2–3.3）——最直接，能同时复验 code/longconv 全尾部。
2. **降 repeat 换广度**：`l5_repeat` 降到 1–2，$1.5 内够到更多任务——但丢失中位统计强度，code-01 概率残余需多遍才看得准，不推荐。
3. **定向 shard**：给 `conformance-l5` 作业加 `l5_tasks` 输入透传 `run-l5.mjs --tasks=code-01,...`——**当前 workflow 无此输入**（L5 job 只透传 model/repeat/budget/thinking），需先加一行接线；加后可用极小预算单检 code 尾部（最省，但要改 CI）。

## 附：run-l35 双臂封印（KD-L35-02）另账

任务附带交代：run-l35 子代理生命周期事件双臂封印（KD-L35-02，编码差：我方顶层 type vs 官方 system 子类型）**仍无 CI 入口**，本地脚本 `run-l35.mjs` 需真钥、须接线或本地跑。**不糊进本轮 L5 账**，另立挂账 T16（见 `memory/todo.md`）。

---

*产出：艾瑞卡会话（T4 点火执行）。run 链接与 artifact 见 §1；账目见 `memory/todo.md` T4→已清 + 新账 T16/T17；状态摘要见 `memory/project-status.md`「Silver Core SDK」节。*
