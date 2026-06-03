# 银芯仓库全量审计报告 — 2026-06-03

> 编制：艾瑞卡（弥萨格大学数据库终端）｜方法：5 路并行只读审计编排，逐条独立验证
> 范围：85 个 Python 档案 / 29,522 行 + 5 个 shell + 18 个 CI workflow + 数据层 692 MB

---

## 摘要

动态编排工作流派发 5 路并行审计代理，分区无重叠：

| 路 | 关注点 | 区域 | 发现数 |
|----|--------|------|--------|
| 1 | 安全审计 | 全量 Python + shell + workflow | 3 |
| 2 | Bug 排查·采集层 | `projects/news/scripts/` | 6 |
| 3 | Bug 排查·脚本层 | `scripts/` + `projects/wiki/scripts/` | 13 |
| 4 | 性能审计 | 两大脚本层 + 数据层 | 5 |
| 5 | 架构梳理 | 全仓 | 10（含 1 条正向结论）|

**合计 36 条问题（Critical 0 / High 9 / Medium 12 / Low 15）+ 1 条正向印证。**
每条均经独立验证：VERIFIED = 已追踪可复现；SUSPECTED = 路径成立但触发条件未确认。

### 严重度分布

| 严重度 | 数量 | 代表项 |
|--------|------|--------|
| Critical | 0 | — |
| High | 9 | 双采集栈重复 / 每提示加载 35MB 索引 / lua_parse 静默丢字段 / Weibo 回填全失效 |
| Medium | 12 | 时区双桶污染全量层 / 采集器全串行 / 三个死模块 |
| Low | 15 | workflow 注入 / 多处 ID 碰撞 / N+1 |

### 跨路主题（交叉印证后归纳）

1. **记忆索引热路径**（性能 F1+F3 / 脚本 F10 同源）：`UserPromptSubmit` 钩子每次提示同步加载 35 MB 向量索引（实测 4.8s，索引超 24h 时内联重建达 51.3s），是每次交互的最大延迟悬崖。
2. **采集层双重债**（架构 F1+F2 / 性能 F2 / 安全 F3 同域）：两套不共享的采集实现（~160KB），6 平台每小时双采，且全部串行执行——重复 + 慢 + SSRF 面叠加。
3. **静默逻辑错误集群**（脚本 F1/F2/F3 + 采集 BUG-01）：正则截断、编号恒 1、ID 碰撞、元组未解包——共性是无报错可察，被宽 `except` 吞掉，违反 §4.2 R1 精神。

---

## 路 1 — 安全审计（3 条）

### SEC-01 · `claude.yml` 权限门校验的是 issue 作者而非评论者 — High · VERIFIED
- 位置：`.github/workflows/claude.yml:5-14`
- 证据：触发含 `issue_comment: [created]`，但 `if` 仅校验 `github.event.issue.user.login == github.repository_owner`。评论事件中该字段是**开 issue 的人**，非评论者（应为 `github.event.comment.user.login`）。在 owner 开的任意 issue 下，**任何外部用户**的评论都能满足门控，驱动一个带 `contents: write` + `direct_push:"true"` 的 agent。
- 验证：通读 workflow，确认评论者无校验；下游 github-script 仅用 `context.issue.number`，无不可信插值，缺口唯在作者校验。
- 修复：评论事件改用 `github.event.comment.user.login == github.repository_owner`。

### SEC-02 · 媒体下载器 SSRF — Medium · VERIFIED（向量）/ SUSPECTED（影响）
- 位置：`projects/news/scripts/download_media.py:70-101`，源 `media_url` 来自 `global_collectors.py:147,304,372,892`
- 证据：`download_file` 对 `requests.get(url)` 无 scheme/host 白名单，不拦 `file://`/`localhost`/内网 IP，默认跟随重定向。`url` 源自外部平台 API 字段（B 站 pic / YouTube 缩略图 / Pixiv illust url）。
- 验证：全链路追踪 collectors→news.json→`collect_media_urls`→`download_file`，grep 确认无任何校验；写入侧文件名经 sha256 哈希，无路径穿越。影响受限于 CI 无内网可跳板，故影响标 SUSPECTED。
- 修复：限定 http/https，解析并拒绝私有/环回/链路本地 IP，禁用或约束重定向。

### SEC-03 · 7 个 `workflow_dispatch` 工作流将输入直插 `run:` — Low · VERIFIED
- 位置：`recover-fanart.yml:42,44`、`daily-report.yml:67,69`、`backfill-gap.yml:40-41`、`backfill-news.yml:50,80`、`extract-game-data.yml:39,129`、`backfill-media.yml:45-46`、`discord-archive.yml:45,84`
- 证据：如 `END="${{ github.event.inputs.end_date }}"`，恶意输入可在 runner 内逃逸执行。
- 验证：grep 全部 `${{ }}`→`run:` 插值，确认受影响工作流触发仅 dispatch/schedule/push，无 `pull_request`/`issue_comment`——输入仅来自有写权限者，故 Low（纵深防御）。
- 修复：输入经 `env:` 传递，shell 内引用 `"$VAR"`，勿直插。

### 显式判清（安全）
Python 命令注入、不安全反序列化（无 pickle/eval/yaml.load）、硬编码密钥（全部走 env）、日志泄密、邮件凭据处理、MCP 输入、采集器路径穿越、PR 触发的 workflow——**八类全清**。仓内仅有的 `ghp_` 字符串为 session-digests 中的占位脱敏串。

---

## 路 2 — Bug 排查·采集层（6 条）

### BUG-01 · Weibo 缺口回填因元组未解包而整段失效 — High · VERIFIED
- 位置：`backfill_gap.py:321→326→331`；`global_collectors.py:525-594`
- 证据：`_parse_weibo_time` 恒返回 `(iso, is_approx)` 二元组，但调用处 `time_str = _parse_weibo_time(created)` 后直接 `datetime.fromisoformat(time_str)` → `TypeError`，被 `:331` 宽 `except` 吞掉，`found` 恒 0，**缺口窗口内所有 Weibo 帖被丢弃**。
- 验证：传元组实测复现 `TypeError`，追踪调用点与无条件二元组返回。
- 修复：`time_str, _ = _parse_weibo_time(created)`。

### BUG-02 · 跨归档器时区错配致全量层条目双桶 — Medium · VERIFIED
- 位置：`backfill_gap.py:61`（裸 UTC）vs `backfill_platforms.py:87` / `archive_platforms.py:91`（UTC+8）
- 证据：三者同写 `data/platforms/{source}/YYYY-MM-DD.json`（全量层 §4.1），但日期分桶口径不一。`2026-04-13T20:00:00Z` 经 backfill_gap 落 `04-13`、经另两者落 `04-14`。每文件按 URL 去重，同条存入相邻两日，虚增 `item_count` 并污染 `repair_gaps.py` 缺口检测。
- 验证：手算两口径分桶日期不一致，确认三者目标路径相同。
- 修复：`backfill_gap` 统一采用 UTC+8 偏移。

### BUG-05 · 采集器在 fetcher 崩溃后带残缺数据继续（违 §4.2 R1）— Medium · VERIFIED
- 位置：`aggregator.py:103-123`；同型 `collect_global.py:207-228`
- 证据：每个 fetcher 异常被单独 catch 后流程继续写 news.json，仅当全源为空才失败（`:188`）。单个核心源崩溃会静默缩减数据集而不暴露失败——与 R1「任一子调用失败即整次失败」抵触。
- 验证：追踪 per-fetcher try/except 与「仅全空才失败」门。
- 修复（取决于策略）：追踪 per-source 失败，`CORE_SOURCES` 任一 raise 即非零退出。

### BUG-03 · `download_media` 遇 null media_url 崩溃 — Low · VERIFIED（崩溃）/ SUSPECTED（可达）
- 位置：`download_media.py:118`。`item.get('media_url','').strip()` 在值为 `null` 时 `AttributeError`，无 guard 致整轮中止。正常 news.json 经校验不含 null，故可达性低。修复：`(item.get('media_url') or '').strip()`。

### BUG-04 · `aggregator.run()` 恒返 True/raise，空跑分支为死代码 — Low · VERIFIED
- 位置：`aggregator.py:234` vs `:205,:230`。`run() is False` 恒假，`sys.exit` 空跑分支不可达（空跑失败靠 `raise SystemExit(1)` 另路生效）。属误导性而非功能性。

### BUG-06 · Steam 评论回填忽略 curl 失败 — Low · VERIFIED
- 位置：`backfill_platforms.py:345-349`。不查 returncode 直接 `json.loads(result.stdout)`，curl 失败时空串 → `JSONDecodeError` 被宽 except `break`。状态未标 done，下轮可恢复，故 Low。修复：`json.loads` 前加 `if result.returncode != 0: break`。

---

## 路 3 — Bug 排查·脚本层（13 条）

### SCR-01 · `lua_parse` 块正则遇字段值含 `}` 即截断整块 — High · VERIFIED
- 位置：`scripts/lua_parse.py:10`。`_BLOCK = re.compile(r'\[(\d+)\]\s*=\s*\{(.*?)\}', re.DOTALL)` 的非贪婪 `(.*?)\}` 在首个 `}` 停止。字段值含 `}`（剧情文本/表情）会使块体截断、字段全失，被下游 `if 'X' not in fields: continue` 静默丢弃。**牵连 `parse_voice_lines`/`parse_item_stories`/`parse_collection_hall` 三个解析器。**
- 验证：构造 `{ Name="a}b", Desc="hello" }` 实测块体仅捕获 `' Name="a'`，fields 为空。
- 修复：改用括号配对扫描或匹配固定缩进闭合 `\n\}`。

### SCR-02 · `dream_rem` 教训编号恒为 1 且破坏标题层级 — High · VERIFIED
- 位置：`scripts/dream_rem.py:437,446`。读编号用 `^(\d+)\.` 但 `lessons-learned.md` 实为 `## N.` 格式，对 34 条既有匹配 0 次 → `next_num` 恒 1，写入 `\n{next_num}. **[REM]**`（无 `##`）。另两个写入者（reflexion/silver_memory_tools）正则正确。
- 验证：对真实文件跑该正则得 0 匹配；另两者得 max=33→34。
- 修复：正则改 `^##\s+(\d+)\.`，写入用 `## {next_num}.`。

### SCR-03 · `fact_store` 事实 ID 在触顶裁剪后永久碰撞 — High · VERIFIED
- 位置：`scripts/fact_store.py:164,177-180`。`id=f"f-{len(facts)+1:04d}"`，存量达 500 触发 `facts[-500:]` 后 `len` 恒 500，后续每次 add 都生成 `f-0501` 与幸存条目重复；`mark_obsolete` 线性查找只命中首个。
- 验证：构造 501 条触发裁剪后 `len==500`，下一 ID `f-0501` 已存在。
- 修复：用持久化单调计数器或 `max(已用编号)+1`。

### SCR-04 · `mcp_server` 的 dry_run 经 sys.argv 传参不可靠 — High · VERIFIED
- 位置：`scripts/mcp_server.py:349-356`；`memory_writeback.py:33`。MCP 临时 `argv.append("--dry-run")` 驱动模块级全局 `DRY_RUN`（导入期冻结），后续 argv 变更无效，`dry_run=True` 多被忽略可能误写盘；`run_writeback` 抛错时 `argv.remove` 不执行，`--dry-run` 永久污染进程。
- 验证：grep 确认 DRY_RUN 为模块级全局且 3 处写路径读取；Python 模块缓存致仅首次导入 argv 生效。
- 修复：`run_writeback(dry_run: bool)` 显式传参，去除 argv 副作用。

### SCR-05 · `dream_rem` 拓扑回退用未导入的 `sys`，静默吞回退 — Medium · VERIFIED
- 位置：`scripts/dream_rem.py:97`（模块未 import sys）。回退分支 `sys.path.insert` 抛 `NameError` 被 `:100` `except (ImportError, Exception)` 吞掉，旧会话场景话题统计静默归零。修复：模块头 `import sys`，except 收窄为 `(ImportError,)`。

### SCR-06 · `dream_rem` insight ID 同日重跑碰撞 — Medium · VERIFIED
- 位置：`scripts/dream_rem.py:346,360,381`。`rem-{date}-{len+1:03d}`，`_save_insights` append-only 无去重，同日多跑生成相同 ID 系列。修复：ID 加时间戳或写前按 ID 去重。

### SCR-07 · `check_version` 版本正则过宽污染 versions.json — Medium · VERIFIED
- 位置：`projects/wiki/scripts/check_version.py:122`。`v?(\d+\.\d+(?:\.\d+)?)` 会匹配标题中任意小数（"5.5 星"/"2.0 万"/日期）并落盘持久化。修复：加单词边界与版本语境约束。

### SCR-08~13 · Low（6 条）· 均 VERIFIED
- **SCR-08** `knowledge_graph.py:879` CLI 全局过滤把等于 depth 值的查询词剔除（同型 `context_manager.py:216`）。
- **SCR-09** `parse_collection_hall.py:28-36` 声明 7 分类但 `characters/items/events` 永远为空（死输出）。
- **SCR-10** `memory_search.py:782-787` 缓存命中先于 `needs_build` 判断，过期但已缓存时返回陈旧索引、跳过重建（与性能 F1 同源）。
- **SCR-11** `memrl.py:78-79` `count` 与 `sessions` 恒等冗余。
- **SCR-12** `memrl.py:395` 校准输出 `engagement` 键与 reranker 实际 `access` 键不匹配（仅打印不落盘）。
- **SCR-13** `session_distiller.py:264,304` `break` 仅跳内层循环，列表可略超 10 上限。

---

## 路 4 — 性能审计（5 条）

> 实测基线：`projects/news/data/` 692 MB（2,275 jsonl + 2,630 json）；记忆语料 62 MB / 436 md；向量索引 35 MB gzip / 143,580 向量。

### PERF-01 · 每次用户提示同步加载 35MB 向量索引（4.8s 税；陈旧时达 51s）— High · VERIFIED
- 位置：`session_inject.py:125`（UserPromptSubmit 钩子）→ `silver_memory_tools.py:85` → `memory_search.py:765,789-792`
- 实测：`session_inject.py` 端到端 4.59s；隔离 `gzip+json.load`（35MB/143,580 向量）4.77s——索引加载几乎是全部成本。索引龄 >24h 时 `load_index` 在查询路径**内联**调 `build_index`：实测 51.3s。每次提示新进程，进程内缓存无法跨提示存活。
- 修复：(1) 查询路径不再内联重建，超龄直接服务陈旧文件、重建交给 CI cron；(2) 钩子按提示长度/关键词门控 recall，或读精简摘要索引，或让记忆层常驻于现有 MCP 进程，4.8s 解压每会话只付一次。

### PERF-02 · `collect_global` ~20 个采集器严格串行，内部再串行 — High · VERIFIED
- 位置：`collect_global.py:181-228`（单串行 for）；内部 `global_collectors.py:815`（25 国）`:989`（22 locale）及多处 per-keyword
- 证据：20 个互相独立的网络采集器逐个执行，仅 TapTap 内部异步；其余全是阻塞 `requests.get` + retry/限速 `time.sleep`。App Store 串行 25 国、Google Play 串行 22 locale。
- 验证：清点 COUNTRIES=25/LOCALES=22；grep 确认采集层唯一并发原语是 TapTap 的 `asyncio.run`。属易并行（采集前无共享状态）。
- 修复：`all_fetchers` 套 `ThreadPoolExecutor`（阻塞 requests 用线程即可），保留 per-collector 限速 sleep；CI 墙钟从「延迟之和」降为「延迟之最」。

### PERF-03 · 每查询对全部 143,580 向量做线性余弦 — Medium · VERIFIED
- 位置：`memory_search.py:830-839` → `cosine_similarity:529-536`。实测线性扫描 0.322s。查询向量仅数项却对每个存储向量算键交集。修复：建索引期建倒排（token→chunk_ids），查询期只评分共享 ≥1 词的候选，候选集从 143k 降至数千，结果不变。

### PERF-04 · 重排 N+1：评分函数每候选重读文件 — Low · VERIFIED
- 位置：`memory_search.py:723-746` → `_load_access_log:584-598` / `utility_score:614-625`。每候选（pool=40）重 glob 读 access-log 与 utility 文件。当前 8 文件/36KB 实测 0.002s 可忽略，随 access-log 增长成隐患。修复：循环外加载一次传入。

### PERF-05 · `get_neighbors` 每前沿节点遍历全部边 — Low · VERIFIED（代码）/ SUSPECTED（规模）
- 位置：`knowledge_graph.py:716-719`，经 `memory_search.py:679,794` 到达。O(depth×frontier×|edges|)；同文件 `graph_distance:761-766` 已建邻接索引却未给 `get_neighbors`（优化不一致）。当前 `knowledge-graph.json` 不存在故短路为 0.5，规模未现。**与历史会话档案 `20260526` 既有结论吻合。** 修复：给 `get_neighbors` 同样的邻接索引构建。

---

## 路 5 — 架构梳理（9 条 + 1 正向）

### ARCH-01 · 双平行采集栈（6 平台重叠）— High · VERIFIED
- 位置：`aggregator_collectors.py`（69KB）、`global_collectors.py`（67KB）、`playwright_collectors.py`（25KB）
- 证据：两模块各自定义 `fetch_reddit/bilibili/youtube/nga/taptap/discord`（6 重叠）。`update-news.yml` 每小时**同时**跑 `aggregator.py` 与 `collect_global.py`。两栈不共享 helper：`global_collectors` 自带 `_get/_get_cf/_post/_strip_html/_make_item`，从不 import `aggregator_base`（grep 0 命中）。
- 验证：grep 印证 import 图 + workflow 步骤 + helper 定义位置。先前内部 `news-collector-merge-plan.md` 已标记但结论「无安全改法」仅出研究。
- 建议：收敛到单一采集接口，抽 `BaseCollector`（HTTP+retry+item+校验）；至少去重 6 平台每小时双采。

### ARCH-02 · HTTP/解析/item 构造跨采集器重复实现 — Medium · VERIFIED
- 三套 HTTP 包装（`aggregator_base._get_with_retry` / `global_collectors._get,_get_cf` / `collect_video_comments._get`）、两套 HTML strip、手搓 item dict vs `_make_item`、`normalize_source` 仅半数模块用。建议：提升 `aggregator_base`（或新建 `news/common.py`）为单一归属，删重复。

### ARCH-03 · 死模块 `scripts/svn_identity.py`（兼内部层气味）— Medium · VERIFIED
- 零引用（grep 全仓仅自引）。docstring 称「面向黑池需求 1」并探测 **SVN 工作副本**身份——既无用又指向 §1.1 禁止触碰的内部层。当前无激活路径故非活跃违规，但是架构隐患。建议：移除或迁出公开层。

### ARCH-04 · 死模块 `projects/wiki/scripts/extract_game_data.py` — Low · VERIFIED
- `extract-game-data.yml:133` 实调 `extract_client_data.py`，29KB 的 `extract_game_data.py` 仅自引、被取代。建议：删除（且其冗余引入 UnityPy）。

### ARCH-05 · 两个 VitePress 页面生成器数据源分歧 — Medium · VERIFIED
- `scripts/generate_wiki_pages.py`（51KB，读 `data/processed/characters.json`）vs `projects/wiki/scripts/generate_pages.py`（8KB，读 `data/db/characters.json`）。写不同文件不互踩，但「生成 VitePress 页」被劈成两脚本/两目录/两 characters.json 源，易漂移。建议：归并同目录，文档化单一真源（`data/db/`）。

### ARCH-06 · 三个每小时采集工作流同分钟触发 — Medium · VERIFIED
- `update-news.yml` / `backfill-news.yml` / `backfill-media.yml` 均 `cron: '0 * * * *'`，同分触发、同推仓库、push 竞态，无 concurrency 组。建议：错峰（:00/:20/:40）或共享 `concurrency:` 键。

### ARCH-07 · `fetch_voice_lines.py` 从 workflow 脱钩 — Low · VERIFIED
- `fetch-wiki-data.yml` 跑了 portraits/skills/cards 等却从不跑 `fetch_voice_lines.py`，模块仅自引。建议：接入 workflow 或删除，并消解与 `scripts/parse_voice_lines.py` 的同名混淆。

### ARCH-08 · 巨файл职责过宽 — Medium · VERIFIED
- `aggregator_collectors.py`（1500+ 行 24 函数）、`global_collectors.py`（29 函数 20 平台）、`generate_wiki_pages.py`（18 函数）、`memory_search.py`（38 defs）。建议：per-platform 采集器拆为包 + 注册表（同时解锁 ARCH-01/02 去重）。记忆类巨файл非紧急。

### ARCH-09 · 依赖卫生 — Low · VERIFIED
- `projects/wiki/scripts/` 无 requirements.txt 却用 yaml/UnityPy（workflow 内联 `pip install` 掩盖）；全部 `>=` 浮动无 `==` 钉版，复现漂移风险。建议：补 `projects/wiki/requirements.txt`，CI 运行的采集器考虑 `==`/`~=` 钉版。

### ARCH-10 · 数据层纪律（§4.1）代码层正确 — 正向 · VERIFIED
- `split_output.py` 仅写 `output/`；`archive_platforms.py` 另写 `data/platforms/` 全量层；`boot_snapshot.py:176` 显式标注输出层选样 vs 全量。无任何路径把输出层当全量。单向 银芯→黑池 规则除死模块 `svn_identity.py`（ARCH-03）外均守。

### 测试覆盖图

| 模块 / 区域 | 测试 | 来源 |
|------|------|------|
| `lua_parse` / `text_utils` | 有 | test_lua_parse(4) / test_text_utils(9) |
| `dream` / `fact_store` / `knowledge_graph` / `memrl` | 有 | test_memory_functions(18) |
| `collect_global` | 部分 | test_collect_global(4) |
| `wiki_sources` | 有 | test_wiki_sources(5) |
| 采集器三巨файл / `aggregator_base` / `discord_archiver` / `backfill_*` | **无单测** | 仅手动 live smoke |
| `generate_wiki_pages` / `memory_search` / `mcp_server` / `session_*` | **无** | — |
| wiki `fetch_*` / `extract_*` | **无** | — |

78 源档案 vs 5 测试档案（~6% 文件级覆盖），且最易因上游 API 漂移而静默损坏的采集层零单测。

---

## 优先处置建议（按杠杆排序）

1. **SEC-01** 立即修 `claude.yml` 评论者门控——唯一的 High 安全外暴面，改一行即闭。
2. **PERF-01** 记忆索引热路径——查询路径停止内联重建（消除 51s 悬崖），记忆层常驻 MCP。
3. **SCR-01 + BUG-01** 两个静默逻辑致命项——lua_parse 块正则（牵连 3 解析器）+ Weibo 回填元组解包。
4. **ARCH-01 + PERF-02** 采集层双栈收敛 + 并行化——最大维护债与最大 CI 墙钟项同域，一次重构两收。
5. **ARCH-03/04/07** 清理 3 个死模块（含内部层气味的 `svn_identity.py`）。

---

## 审计方法论备注

- 5 路并行编排，每路独立验证后再汇总，符合 §6.4 目标驱动（VERIFIED/SUSPECTED 双态）。
- 本次为**只读审计**，未修改任何源码档案。所有 Location 为仓内相对路径（绝对前缀 `/home/user/brain-in-a-vat/`）。
- 引用纪律（§4.2）：行号/复现结论均来自直接产出该事实的工具（实测计时 / grep / ast），无外推。SUSPECTED 项均显式标注触发条件未确认。
- 「建议」非「已实施」：本报告全部条目为审计建议，尚无任何代码改动落盘。
