# 银芯测试策略 — 分层质量护栏

> 状态：2026-06-21 起生效。守密人裁定「覆盖率 100% 持续推进 + 四条加固建议全部落地」。
> 本档是测试层的运行时参照（弱约束，运行权威仍以 CLAUDE.md 自动加载层 + CI 为准）。

银芯的测试不靠单一数字护城。三层护栏各管一件事，互相补盲：

| 层 | 工具 | 守什么 | 在哪 |
|----|------|--------|------|
| 1. 行覆盖率门控 | pytest-cov | 「代码有没有被跑到」 | `.github/workflows/test.yml`（`--cov-fail-under=85`）|
| 2. 变异测试 | mutmut | 「断言有没有真的钉住行为」 | `.github/workflows/mutation-test.yml`（手动）+ `setup.cfg` |
| 3. 真集成测试 | pytest（真依赖）| 「真库/真文件路径有没有被验」 | `tests/test_integration_*.py` |
| 4. 数据纪律测试 | pytest（语义断言）| 「全量层 vs 输出层有没有被混用」 | `tests/test_data_discipline.py` |

> 小学生比喻：行覆盖率是「每个房间都进去过」，变异测试是「进去后真的检查了东西、不是走个过场」，
> 集成测试是「用真钥匙真锁验过门」，数据纪律测试是「没把样品柜当成总仓库」。

---

## 1. 行覆盖率门控：85，不是 90

2026-06-21 的动态编排测试扫荡把全仓覆盖率从 43% 抬到约 94%（CI 口径）。门控随之
**从 90 回调到 85**，刻意留余量：

- news 采集层是网络绑定的，本质难单测。门控顶在 90 会逼着未来新采集器写**过度 mock 的
  凑数测试**来凑分——劣化质量、自欺欺人。
- 85 锁住扫荡成果，又给采集层留呼吸空间。90+ 作为**长期目标**，不作硬闸。

唯一显著低于 80 的模块是 `report_render.py`（`render()` 需 weasyprint/markdown 重依赖，
按 CLAUDE.md「渲染依赖按需装」立场刻意排除出 CI，CI 内约 56%、本地约 98%）。

## 2. 变异测试：断言质量的体检

行覆盖率会骗人——一行被执行≠它的结果被断言。变异测试故意改源码（翻操作符、换常量、
删语句），好的测试必须让这些「变异体」变红；**存活的变异体 = 断言盲点**。

- 配置：`setup.cfg [mutmut]`，刻意只锁**核心纯模块**（确定性、零网络），存活体能明确归因为
  测试缺口而非环境噪声。当前锁定 `scripts/silver_tokenizer.py`（两条分析主线共用的分词地基）。
- 跑法：本地 `mutmut run && mutmut results`；CI 手动触发 `mutation-test.yml`。
- 专用孪生测试档 `tests/test_mut_silver_tokenizer.py` 用**包路径导入**（`scripts.silver_tokenizer`），
  让 mutmut 运行时记录的 key 与按文件路径推导的 key 对齐（兄弟档 `test_silver_tokenizer.py`
  用裸模块名导入，mutmut 对不上）。

### 首跑战果（silver_tokenizer，64 变异体）

- 初版：56 杀 + 3 超时，**5 存活**。
- 变异测试暴露 2 个**真盲点**——100% 行覆盖都没抓到：
  1. 词典命中落在非零偏移时 `i += len(hit)` 的推进（`i = len(hit)` 会死循环）。
  2. 2 字词典词作长串前缀时必须整词吃掉、不得回落 overlapping bigram。
- 补两条测试后：**存活 5 → 3**，检出率约 95%。

### 已登记的等价变异体（survivor 白名单）

以下 3 个存活体经人工判定为**等价变异体**（改了源码但行为无可观测差异，数学上不可杀），
triage 时视为可接受，不当回归：

| 变异 | 为何等价 |
|------|---------|
| `hit = None` → `hit = ""` | 二者皆为假值，`if hit:` 行为一致 |
| `while i < n` → `while i <= n` | i==n 时切片为空、内层循环空转、随即越界退出，无差异 |
| `min(maxlen, n - i)` → `min(maxlen, n + i)` | Python 切片对越界长度自动截断，产出 token 一致 |

新增存活体若不在此表，按断言盲点处理：补测试杀掉，或论证等价后入表。

## 3. 真集成测试：治「假绿」

扫荡期大量 mock，真依赖路径（jsonschema 校验、记忆写盘、UnityPy 解包）反而没被端到端验过。
补三档真依赖测试：

- `test_integration_jsonschema.py`：真装 jsonschema，对真实 `data/schemas/*.schema.json` 跑
  合法→PASS / 非法→FAIL。CI 显式 `pip install jsonschema`（不拖 wiki 全量依赖的 UnityPy/Pillow），
  确保这条分支在 CI 真跑而非 importorskip 跳过。
- `test_integration_memory_roundtrip.py`：真文件 IO 往返记忆写入函数（路径重定向到 tmp，
  跑后断言真实 `memory/*.md` 字节未变）。
- `test_integration_unitpy_optional.py`：`importorskip("UnityPy")` 守门——缺则干净 skip 把缺口
  登记在册，绝不靠 stub 蒙混假绿。

## 4. 数据纪律测试：治 lesson #30 同类语义错

CLAUDE.md §4 的「全量档案层 vs 输出展示层不可互换」是**语义**约束，高行覆盖抓不住。
`tests/test_data_discipline.py`（10 测）驱动真实 builder 断言：

- OKF 源指针带 `data_layer:full_archive`、绝不指向 `output/`；
- `build_community_index` 自报 `_meta.data_layer == "full_archive"`；
- `split_output` 产出对输入是**严格子集/抽样**（count ≤ 档案、每条 url 可溯源），直接编码 lesson #30 护栏。

### ⚠ 已知未设防缺口（守密人留意）

数据纪律测试过程中发现一处**约定靠人记、代码不设防**的地带：

> **`split_output` 的输出文件 payload 不携带任何 `data_layer` 戳记**。输出层「我是抽样」这一
> 身份在产物里没有机器可读标记，纯靠约定——正是 lesson #30 当年踩坑的同类未设防地带。
> 子集关系目前只能靠结构（count、url 溯源）间接断言。

建议（未实施，待守密人裁定）：在 `split_output.write_source_file` 的 payload 补一个
`data_layer: "output"` 字段，让输出文件像 `community_index` 那样自带机器可读戳记，把这条
纪律从「约定」升级为「代码设防」。
