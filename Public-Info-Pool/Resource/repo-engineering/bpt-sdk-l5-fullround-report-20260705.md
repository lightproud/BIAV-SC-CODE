# BPT Agent SDK — 全量真 L5 验收报告(首次全 18 任务 gate B 正向)

> **一句话**:thinking 模型感知修复(v0.8.1)后的**首个全量真 L5 双臂轮**——180/180 全跑、gate B **bpt 88/90 (97.8%) vs 官方 76/90 (84.4%),delta +13.3pp PASS**;并首次真正跑到 code-01,回答守密人「E7-01 自适应思考是否移动 code-01 的 0/3 残余」——**残余从 0/3 移动到 3/5**。

- **run**:[Actions run 28759190419](https://github.com/lightproud/brain-in-a-vat/actions/runs/28759190419)(conformance-l5 job)
- **配置**:model=`claude-haiku-4-5-20251001`,repeat=5,`l5_budget=$5`(全量不截断),各臂自身默认思考
- **实况**:180/180 runs 全跑,实花 **$2.2064**,`content-blind self-audit: PASS`
- **机读工件**:`conformance-l5.json`(Artifact 8097178352,含逐 run 明细)

---

## Gate B 是什么

**Gate B 是一致性套件蓝图(L5)里唯一的端到端验收门禁。** 定义(`run-l5.mjs`):

- **口径**:把**所有任务 × 所有 repeat** 的通过数聚合成一个**总通过率**,分臂算。
- **判据**:**我方总通过率 ≥ 官方总通过率 − 5 个百分点**(容差 −5pp)即 PASS。
- **只看总盘、不看单题**:单个任务可以互有输赢(我方某题输、官方某题输都允许),只要聚合不落后官方 5pp 以上。
- **效率轴只报告不设门**:turns / cost / wall(轮数 / 花费 / 墙钟)三轴**只报告、不作门禁**(run #74 证明墙钟差是 API 延迟噪声,不是能力信号)。

> 小学生比喻:Gate B 不比「每道题谁对」,只比「整张卷子的总分」——我方总分只要不比官方低 5 分以上就算过关;至于谁答得快、谁花的墨水少,只记在成绩单备注里,不影响过不过。

本轮:bpt 88/90 = 97.8%,官方 76/90 = 84.4%,差 +13.3pp(我方**高于**官方 13.3 个百分点)→ 远超「不低于官方 −5pp」→ **PASS**,且是全量轮首次正向大胜。

---

## 逐任务全表

`pass` = 我方通过/5 · 官方通过/5;`turns`/`cost$`/`wall ms` = 我方/官方中位数。

| 任务 | 维度 | zh | pass 我·官 | turns 我/官 | cost$ 我/官 | wall ms 我/官 |
|---|---|:--:|---|---|---|---|
| chat-01 | chat | | 5·5 | 1/1 | 0.0037/0.0035 | 1540/2707 |
| chat-02 | chat | zh | 5·5 | 1/1 | 0.0034/0.0033 | 1433/2233 |
| chat-03 | chat | | 5·5 | 1/1 | 0.0036/0.0031 | 1670/2556 |
| retrieval-01 | retrieval | | 5·5 | 2/6 | 0.0058/0.0291 | 2394/14451 |
| retrieval-02 | retrieval | | 5·5 | 2/2 | 0.0064/0.0055 | 2794/4838 |
| retrieval-03 | retrieval | zh | 5·5 | 3/8 | 0.0096/0.0149 | 4107/9422 |
| retrieval-04 | retrieval | | 5·5 | 2/2 | 0.0058/0.0055 | 1954/4307 |
| document-01 | document | | 5·5 | 3/5 | 0.0094/0.0140 | 3559/8334 |
| document-02 | document | | 5·5 | 3/5 | 0.0090/0.0138 | 3786/9040 |
| document-03 | document | zh | 5·5 | 4/6 | 0.0134/0.0175 | 5336/10906 |
| document-04 | document | | 5·5 | 5/8 | 0.0161/0.0188 | 6960/13307 |
| **code-01** | code | | **3·5** | 3/7 | 0.0108/0.0266 | 6098/19168 |
| code-02 | code | | 5·4 | 2/5 | 0.0081/0.0175 | 4056/14179 |
| code-03 | code | | 5·0 | 3/3 | 0.0112/0.0119 | 5526/8559 |
| code-04 | code | zh | 5·5 | 5/11 | 0.0181/0.0314 | 8984/19521 |
| code-05 | code | | 5·3 | 3/3 | 0.0097/0.0094 | 4916/6900 |
| longconv-01 | long-conversation | | 5·1 | 5/6 | 0.0139/0.0152 | 5675/9953 |
| longconv-02 | long-conversation | zh | 5·3 | 4/5 | 0.0114/0.0147 | 5029/10009 |
| **合计** | | | **88·76** | — | — | — |

**缓存诊断**:`[bpt] writes=96421 reads=5380813`(缓存正常,scenario a 设计点);`[official] writes=153068 reads=6824224`(同)。

---

## 关键读点

1. **code-01:我方 3/5 vs 官方 5/5——守密人最初问题的答案**。历史上 code-01 我方长期 **0/3**(KD-L5-03「中位数偶数长度取均值」的 diligence 残余)。本轮思考开 + 更大预算(preset 默认在 haiku 上经 v0.8.1 fork 走 `enabled+budget`,预算大于 E1 的 4096),code-01 **移动到 3/5**——从全败到多数通过,**但未全解**(官方仍 5/5)。剩 2/5 是 diligence 概率残余,非思考开关位。
   > 比喻:发了草稿纸,最难那题从「五次全错」变「五次对三次」——有帮助,但还没到官方那种稳对。

2. **官方 84.4% 主要被 KD-L5-01 拉低,非真能力差**。官方 CLI 自身会往 tmpdir 根留散落物(`/tmp/note.txt`、`/tmp/sum.txt`),harness 判 `FAIL(success)`——longconv-01 官方 1/5、longconv-02 官方 3/5 全栽在这。官方本轮真失分是 code-03 0/5、code-02 4/5、code-05 3/5。我方对应全 5/5(不留散落物)。
   > 比喻:官方答案其实写对了,但「考完不擦桌子、留了纸屑」被扣分;我方桌面干净,故 88/90。

3. **econ:我方多数题更省更快**(效率轴只报告不设门,但方向一致)。code-01 $0.0108 vs 官方 $0.0266(省 2.5×)、retrieval-01 $0.0058 vs $0.0291(省 5×)、code-04 $0.0181 vs $0.0314;turns 普遍更少(retrieval-01 2 vs 6、code-04 5 vs 11)。

---

## 这轮为何重要(回归 → 修复 → 实证 的完整弧)

1. **暴露**:守密人「dispatch 真 L5」的**首轮**(run 28753349435,v0.7)跑在 haiku,**我方臂 40/40 全 `error_during_execution`、turns=0、cost=$0**——E7-01 让 preset 默认无条件发 `thinking:{type:"adaptive"}`,但 adaptive 仅 4.6+ 代合法,haiku-4.5 直接 400。keyless 单测 stub 传输故照不到。
2. **修复**:v0.8.1 `computeThinking` 逐轮按 live model 分叉线form(4.6+ adaptive / pre-4.6 `enabled+budget`,PR #489)。
3. **实证**:修复轮(run 28754264349)我方臂 40/40 恢复运行、gate B bpt 40/40==官方 39/39;本全量轮(run 28759190419,`l5_budget=$5`,PR #490)进一步 gate B **+13.3pp PASS** 且触达 code-01。

> 教训沉淀:keyless 单测(stub 传输)照不到「真实 API 才校验的字段」(如 thinking 按模型代的合法性)——真 L5 是唯一能逮到这类回归的关卡。已加 `thinking-model` 单测 + conformance-l2 逐 tier 线form 锁作机器守卫。

---

## 链接

- run(unit/conformance/live-smoke/conformance-l5 均绿):https://github.com/lightproud/brain-in-a-vat/actions/runs/28759190419
- 机读工件 `conformance-l5.json`:Artifact 8097178352(逐 run 明细,从 run 页下载)
- 修复 PR #489(v0.8.1 thinking 模型感知 fork)· PR #490(`l5_budget` 输入 + 结果回填)
- 状态权威:`memory/project-status.md` 「## BPT Agent SDK」段
