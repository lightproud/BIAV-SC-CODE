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

2026-06-21 的动态编排测试扫荡把全仓覆盖率从 43% 抬到约 94%，续凿采集器尾部后达约 **97%**
（CI 口径）。门控**从 90 回调到 85**，刻意留余量：

- news 采集层是网络绑定的，本质难单测。门控顶在 90 会逼着未来新采集器写**过度 mock 的
  凑数测试**来凑分——劣化质量、自欺欺人。
- 85 锁住扫荡成果，又给采集层留呼吸空间。当前实测 97% 远在闸上；门控保持 85 作为防回落底线，
  90+ 是**长期目标**而非硬闸（即便已达 97%，仍不上调，以免逼出凑数测试——见上）。

唯一显著低于 80 的模块是 `report_render.py`（`render()` 需 weasyprint/markdown 重依赖，
按 CLAUDE.md「渲染依赖按需装」立场刻意排除出 CI，CI 内约 56%、本地约 98%）。

## 2. 变异测试：断言质量的体检

行覆盖率会骗人——一行被执行≠它的结果被断言。变异测试故意改源码（翻操作符、换常量、
删语句），好的测试必须让这些「变异体」变红；**存活的变异体 = 断言盲点**。

- 配置：`setup.cfg [mutmut]`，刻意只锁**逻辑密集、常量表噪声低**的核心模块，存活体能明确
  归因为测试缺口（或已登记等价体），而非数据表 churn。当前锁定三个：
  - `scripts/silver_tokenizer.py`（两条分析主线共用的分词地基：领域词典 FMM）
  - `scripts/lua_parse.py`（花括号深度扫描 + 字符串状态机 + `\"`/`\n` 还原）
  - `scripts/parse_voice_lines.py`（id 间隙分组 + `·` 分类切分；基于 lua_parse）
- 跑法：本地 `mutmut run && mutmut results`；CI 手动触发 `mutation-test.yml`。
- 每个被测模块配**包路径导入**的专用孪生档（`tests/test_mut_*.py`，如 `scripts.silver_tokenizer`），
  让 mutmut 运行时记录的 key 与按文件路径推导的 key 对齐（兄弟单测用裸模块名导入，mutmut 对不上）。
- **刻意不纳入变异、改用常规强测试守护的模块**（两类噪声源）：
  - `data_quality` / `split_output`：含 class / 文件 IO / 兄弟导入，mutmut 的 `only_mutate` 是文件粒度
    无法只锁单函数 → 整文件变异喷噪声。由 `test_data_quality_math.py` / `test_split_output_logic.py`
    精确数值断言守护。
  - `parse_cg_gallery` / `parse_collection_hall` / `parse_item_stories`：含大段**常量表**（章节名字典、
    关键词列表），其字符串变异要穷举断言每个常量才能杀——那是钉数据不是钉逻辑。由
    `test_parse_*_logic.py` 守护。

### 战果

**silver_tokenizer（64 变异体）**：初版 5 存活，揪出 2 个 100% 行覆盖都没抓到的**真盲点**
（词典命中落在非零偏移时 `i += len(hit)` 的推进；2 字词典词作前缀必须整词吃掉），补测试后存活 5→3。

**lua_parse**：初版 9 存活，揪出 2 类**真盲点**——(1) 字符串内「转义引号紧跟 `}`」的状态机处理；
(2) 未闭合块的 body 边界切片（`content[start+1:]` 的 ±1）。补两条精准测试后存活 9→5。

**parse_voice_lines**：7 存活，经判定**全为等价体**（见下表的通用类）——非等价变异体首跑即 100% 杀光，
是干净的优质靶。`parse_cg_gallery` 转常规测试时另补了 2 条真盲点（缺 `files`/`path` 键的默认值处理）。

### 已登记的等价变异体（survivor 白名单）

以下存活体经人工判定为**等价变异体**（改了源码但行为无可观测差异，不可杀），triage 视为可接受。
当前 gate 共 15 个存活，全部落在此表内：

| 模块 | 变异 | 为何等价 |
|------|------|---------|
| 通用（任何读文件模块） | `open(p,'r',encoding='utf-8')` → `encoding=None`/`'UTF-8'`/省略 mode | ASCII/UTF-8 测试输入下读取结果一致 |
| 通用（`if key not in d: continue` 之后） | `d.get(key, '')` → 默认值改 `None`/`'XXXX'`/省略 | 前置守卫保证 key 必在，默认值不可达 |
| silver_tokenizer | `hit = None` → `hit = ""` | 二者皆假值，`if hit:` 行为一致 |
| silver_tokenizer | `while i < n` → `while i <= n` | i==n 时切片空、内层空转、随即越界退出 |
| silver_tokenizer | `min(maxlen, n - i)` → `n + i` | Python 切片对越界长度自动截断，产出一致 |
| lua_parse | `in_str = False` → `None`（×2） | 二者皆假值，`if in_str:` 行为一致 |
| lua_parse | `i += 2` → `i += 3`（转义跳过） | 字符串内多跳 1 字符不改变 `}` 匹配结果 |
| lua_parse | `depth += 1` → `depth = 1` | 引号字段语法不产生二级结构嵌套，深度恒 0/1 |
| lua_parse | `m.end() - 1` → `m.end() - 2` | body 多一个前导字符，字段正则不受影响 |

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

### ✓ 已闭合缺口：split_output 输出层戳记（2026-06-21）

数据纪律测试曾发现一处**约定靠人记、代码不设防**的地带——现已设防：

> 此前 **`split_output` 的输出文件 payload 不携带任何 `data_layer` 戳记**，输出层「我是抽样」
> 这一身份在产物里没有机器可读标记，纯靠约定（lesson #30 同类未设防地带）。

**处置（已落盘）**：`split_output.py` 新增模块常量 `DATA_LAYER = 'output'`，每个 `{source}-latest.json`
与合并的 `all-latest.json` payload 现都带 `data_layer: "output"` 字段。消费端可程序化拒绝把抽样
当全量。`tests/test_data_discipline.py::test_every_output_file_stamps_data_layer_output` 守护此不变量。
该纪律从「人记」升级为「代码设防」，与 `community_index` 的 `_meta.data_layer=full_archive` 对称。

> 小学生比喻：以前样品柜上没贴「样品」标签全靠管理员记性，现在每个样品瓶都印死了「样品」二字——
> 谁再想把它当总库存，瓶身就先拦住他。

## 5. 合并门：自查自合（2026-06-21 起，撤必需 `test` 检查）

四层护栏只在「测试真被跑且红了能拦住合并」时才有意义。其落地方式经历了同日（2026-06-21）一次反转：

**先**：守密人曾在 GitHub 设置侧对 **main** 启用分支保护规则集（ruleset），把必需检查 `test`
（`.github/workflows/test.yml`）+「合并前对齐最新 main」设为机器强制。

> 触发它的连环事件（均为 #333「数据迁入 Public-Info-Pool」迁移后未同步的连锁）：
> (1) PR #333 基于旧 main、合并前未对齐最新代码重跑 CI，把 #335 新增的 `build_community_index`
> 测试撞红 11 个仍合进主线；(2) 同源迁移后 OKF bundle 未重生成，`okf/sources/*.md` 15 个指针
> 仍指向迁走的旧路径，再红 15 个。两批共 26 个红测试在主线长期未被拦截。
> 小学生比喻：施工队改了管网却没人对着新图复检——闸门此前根本没装，旧合格证一路放行。

**后（现行）**：守密人 2026-06-21 **撤销**了必需 `test` 状态检查（main Ruleset 不再要求 `test`
通过才可合），改为 **自查自合**。背景：迁移后 repo 变大，CI checkout 慢且 required check 常卡在
"expected" 不上报，反成合并堵点。验证责任由 CI 平台**移交给会话本身**：

- **改了代码 / 测试 / 数据的 PR**：合并前**自跑 `pytest tests/`**，全绿才 squash 合并（贴结果）。
- **纯文档 / 纯注释改动**：可免跑直接合。
- `test.yml` 仍在每个 PR 上运行（**非必需**，供参考）；其 `pull_request` 触发不设 paths 过滤，
  对每个到 main 的 PR 都跑（suite ~5s）。`mutation-test.yml` 仍是手动 `workflow_dispatch`。
- **绝不**把「没有 CI 拦」当成「免验证」——验证只是从平台移到会话，标准不降。

> 与 CLAUDE.md §7.6 一致：§7.6（自动加载层，运行时权威）即载「必需 CI `test` 检查已撤、改自查自合」。
> 本节先前「main 已启用 required check、合并须等转绿」的旧表述已随此撤销反转——正是这类文档与实际
> 脱节酿成上述 26 个红测试，故此处同步留痕。
