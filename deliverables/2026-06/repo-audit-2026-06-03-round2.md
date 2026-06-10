# 银芯仓库二次复审报告（round2）— 2026-06-03

> 编制：艾瑞卡（弥萨格大学数据库终端）｜方法：5 路并行只读复审，逐条独立验证
> 基线：HEAD `b1e5e566`（上轮 35/36 修复后）｜对照：`repo-audit-2026-06-03.md`（round1）
> 重心：修复回归审查 / ARCH-01 等遗留复核 / 全新全量扫描

---

## 摘要

round1 的 35 条修复推送后，本轮 5 路代理在**修复后基线**上复审，三轴并行：回归审查 + 遗留复核 + 新扫描。

**核心结论**：round1 的绝大多数修复经独立验证**确认 sound**，但 SSRF 修复（SEC-02）暴露两处 High 级缺口——一处漏修、一处修复自身引入回归。另测试覆盖零增量构成最大结构性风险。

### 本轮发现计数（已跨路去重）

| 严重度 | 数量 | 性质 |
|--------|------|------|
| Critical | 0 | — |
| High | 2 | 均与 SEC-02 SSRF 修复相关（1 漏修 + 1 回归）|
| Medium | 2 | TOCTOU / Discord 全文件入内存 |
| Low | 7 | 良性残留 / 边角 / 防御纵深 |
| 运营警告 | 1 | PERF-03 倒排索引未落盘，优化 dormant |
| 高结构风险 | 1 | 测试零增量，高危修复无回归网 |

### round1 修复独立复核结论

| 修复 | 复核结论 |
|------|---------|
| SEC-01 claude.yml 门控 | **气密**（两触发类型全覆盖）|
| SEC-03 workflow env 迁移 | **全清**（run 体内零 inputs 残留）|
| SEC-02 download_media 主路径 | 主路径有效，但有 2 缺口（见 R2-H1/H2）|
| BUG-01~05（采集层）| **全 sound**（UTC+8 分桶统一、核心源先写后退）|
| PERF-01/02/03/05 | **全行为保持**（数学证明 + 800/900 次随机等价测试零分歧）|
| ARCH-02 news_common | **干净**（无循环导入，单一真源）|
| ARCH-01 DEFER | **判断正确**（三平台 spot-check 证实真分歧）|
| ARCH-05/06/09 | 接线准确 |
| SCR-01~13（脚本层 13 条）| **13/13 sound**（lua_parse 真实数据净 +1 块零回归）|

---

## High 级（2 条，均 SEC-02 衍生）

### R2-H1 · SSRF 修复漏修同向量姊妹文件 `backfill_media.py` — High · VERIFIED
- 位置：`projects/news/scripts/backfill_media.py:55-70`（`fetch()`），URL 源 `:104-120`
- 证据：SEC-02 的 `is_safe_url` 只落在 `download_media.py`。`backfill_media.py` 是**另一条媒体下载路径**，从相同 `media_url` 字段 + Discord 附件 URL 取值，经 `urllib.request.urlopen` 直接拉取——无 scheme 校验、无 IP 黑名单、默认跟随重定向。由 `backfill-media.yml`（每小时 cron + dispatch）实际调度。
- 验证：`git diff 7e1d7640 b1e5e566 -- backfill_media.py` 为空，确认本文件零改动；URL 与 SEC-2 同源不可信。
- 修复：把 `is_safe_url` 提到 `news_common.py`，`backfill_media.fetch()` 同样调用，并禁用 urllib 自动重定向。

### R2-H2 · `allow_redirects=False` + `raise_for_status` 致重定向型图源静默写垃圾文件 — High · VERIFIED（修复引入的回归）
- 位置：`projects/news/scripts/download_media.py:94,98,108`
- 证据：SEC-02 加的 `allow_redirects=False` 与 `resp.raise_for_status()` 交互失当——302/301 不被 `raise_for_status` 视为错误（仅 4xx/5xx 抛）。B站 i0.hdslb.com / YouTube 缩略图 / Pixiv 等 CDN 普遍以 30x 下发资源，此时把重定向空响应体（0 字节 / 微量 HTML）当成功资源写盘，且 302 `Content-Length` 多为 0 不触发尺寸过滤，落盘垃圾文件并报「成功」。
- 验证：`python -c` 实证 `Response(302).raise_for_status()` 不抛；追踪 :94→:98→:108 写盘路径无 3xx 守卫。影响主力图源。
- 修复：SSRF 防护应**保留跟随重定向但对每一跳重新校验** `is_safe_url`（解析 `resp.history` 或 `Session` + 自定义 redirect 校验），而非全禁；或至少对 3xx 显式失败。

> 注：R2-H1 与 R2-H2 共同说明——SSRF 这类「向量散布在多入口」的修复，单文件改法不足；正解是把守卫提到 `news_common` 共享层并覆盖全部 fetch 入口（download_media + backfill_media + 每跳重定向）。

---

## Medium 级（2 条）

### R2-M1 · `is_safe_url` resolve-then-fetch TOCTOU / DNS 重绑定窗口 — Medium · VERIFIED（向量）/ SUSPECTED（CI 可利用性）
- 位置：`download_media.py:81`（`socket.gethostbyname` 一次解析）vs `:94`（`requests.get` 独立二次解析）
- 证据：守卫解析一次得公网 IP 放行，`requests.get` 自行再解析——攻击者控制的 DNS 可在两次解析间返回不同结果（首次公网过校验、二次内网实连），绕过守卫。两路（安全 + 采集层）独立复现同一窗口。
- 缓解：CI runner 无内网元数据敏感面可跳板，实际危害 SUSPECTED；向量 VERIFIED。
- 修复：解析一次得 IP，校验通过后 pin 该 IP 直连（`Host` 头携带原域名），消除二次解析窗口。
- 附带确认：`allow_redirects=False` 与 IPv6（`ipaddress` 覆盖 v6 私有/环回）经验证**不构成绕过**；唯 AAAA-only 主机会被保守误拒（功能性非安全性）。

### R2-M2 · `search_discord_messages` 全文件入内存 + 逐消息子串扫描 — Medium · VERIFIED（代码）/ SUSPECTED（规模触发）
- 位置：`scripts/memory_search.py:1027,1039-1041`
- 证据：`jf.read_text().splitlines()` 整文件入内存，对每条消息 `content.lower()` + 子串扫。规模：2,275 个 jsonl、最大单文件 8.25 MB，`days_back=30` 窗口可达数百 MB / 次查询。O(文件×消息×token)。
- 缓解：Tier-3 路径，仅 CLI `--discord` / 显式社区检索触发，**不在 UserPromptSubmit 热路径**；已按日期早停。
- 修复（若成热点）：逐行流式读取，不 splitlines 整入内存；考虑对 Discord 建轻量倒排。

---

## Low 级（7 条，良性残留 / 边角）

| ID | 位置 | 说明 | 修复 |
|----|------|------|------|
| R2-L1 | `extract-game-data.yml:43` | SEC-03 漏迁 `release.tag_name` 直插 run（仅特权用户，同 SEC-03 等级）| 经 env 传递 |
| R2-L2 | `news_common.py:30-49` | `get_with_retry` 不校验 URL/重定向（当前仅拉硬编码 API 端点，非不可信 sink）| 防御纵深加 host 白名单 |
| R2-L3 | `aggregator.py:128` | 核心源 Playwright 回退「未抛但返回 0 条」仍判 recovered，漏报失败（与 collect_global 语义不一致）| 改 `if pw_items: recovered=True` |
| R2-L4 | `backfill_platforms.py:349` 等 3 处 | BUG-06 修复不完整：curl 200 空体仍致 `json.loads('')` 抛错 | 加 `if not result.stdout.strip(): break` |
| R2-L5 | `collect_global.py:110` | PERF-02 改返回值为二元组，但 ImportError 早退仍 `return items` 裸 list，与 main 解包冲突 | 改 `return items, []` |
| R2-L6 | `parse_collection_hall.py:39` | SCR-09 删 events 分类后遗留死变量 `event_keywords`（自身制造的 orphan）| 删该行 |
| R2-L7 | `memory_search.py:700-706` | `find_related_files` 每 query-term 重建图邻接表（图当前不存在，规模未现）| 邻接表提到循环外按 graph id 缓存 |

> 另两条信息性非缺陷：lua_parse 单引号字符串边角（真实数据零触发，`_FIELD` 只读双引号）；`memory_search` `allow_rebuild=True` 无调用方（PERF-01 意图更彻底达成，预留接口非缺陷）。

---

## 运营警告

### OPS-01 · PERF-03 倒排索引未落盘，优化在生产态 dormant
- 当前磁盘索引 `assets/data/vectors.json.gz`（39 MB，06-03 04:19 构建）**不含 `inverted` 键**。代码逻辑正确（缺键时安全回退全扫描），但提速收益须等下次 `python scripts/memory_search.py --build`（CI cron / dream / mcp rebuild）重建后才落地。在此之前查询仍付 0.389s 全扫描税。
- 处置：触发一次 `--build` 让倒排键落盘。

---

## 高结构性风险

### RISK-01 · 测试零增量，全部高危逻辑修复无回归网 — VERIFIED（最大残留风险）
- `tests/` 仍 5 文件 / 40 通过，与修复前**同数**；`git show --stat b1e5e566` 无任何 `test_*.py` 改动。
- 本次修改的高危逻辑均无对应回归测试守护：

| 改动模块 | 修复 | 测试守护 | 未测风险 |
|------|------|---------|---------|
| `lua_parse.py` | 括号配对扫描器（SCR-01）| 部分（未覆盖 `}`-in-value 回归）| 高（牵连 3 解析器）|
| `memory_search.py` | 倒排索引 + 停内联重建 | 无 | 高（结果等价性 / 缓存路径）|
| `collect_global.py` | ThreadPoolExecutor + 核心源失败退出 | 部分（仅 item 构造）| 中高（并行失败聚合）|
| `fact_store.py` | 单调 ID | 无 | 中 |
| `download_media.py` + 7 workflows | SSRF / 注入 | 无 | 中（安全修复无回归测试）|

- 建议至少补 3 个针对性回归测试：SCR-01（`}` in value）、PERF-03（倒排结果等价性）、collect_global 失败聚合。违 §6.4「loop until verified」精神的唯一处。

---

## 处置优先级建议

1. **R2-H1 + R2-H2 + R2-M1 合并处置**：把 `is_safe_url` 提至 `news_common.py`，覆盖 `download_media` + `backfill_media` 双入口，改为「跟随重定向 + 每跳重校验 + IP pin」，一次性闭合 2 High + 1 Medium。
2. **R2-L3/L4/L5 三条采集层边角**：均一行修复，顺手清理（recovered 语义、curl 空体、返回值形状）。
3. **OPS-01**：触发 `--build` 让倒排索引落盘，兑现 PERF-03 收益。
4. **RISK-01**：补 3 个回归测试，给高危修复铺网。
5. **R2-L1/L2/L6/L7**：低优先良性清理。

---

## 方法论备注

- 5 路并行复审，每路区分「Fix 回归 / 不完整」vs「新发现」，每条独立验证（VERIFIED / SUSPECTED）。
- 跨路交叉印证去重：TOCTOU（安全 + 采集层）→ R2-M1；返回值形状（性能 + 采集层）→ R2-L5。
- 引用纪律（§4.2）：行号 / 等价性 / 计时均来自直接产出该事实的工具（ast / grep / 随机化等价测试 / 实测计时 / 活体索引检视），无外推。
- 本轮纯只读，未改任何源码。全部为复审建议（建议 vs 已落盘，§4.2 R3）。
