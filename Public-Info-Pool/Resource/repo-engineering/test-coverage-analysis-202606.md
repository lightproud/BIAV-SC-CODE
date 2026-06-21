# 测试覆盖率分析与改进提案

> **⚠ 定格交付物（2026-06-10 快照）**：文中文件/脚本路径反映当时仓库状态；其中 `session_inject.py`、`test_wiki_sources.py` 等所属模块已于 2026-06 退役删除，相关引用按历史快照理解，不指向现行文件。
>
> 统计时间：2026-06-10 / 环境：Python 3.11.15, pytest + pytest-cov
> 统计指令：`pytest tests/ --cov=scripts --cov=projects/news/scripts --cov=projects/wiki/scripts`
> 口径说明：覆盖仓内全部三个 Python 脚本层（顶层 scripts / news 采集层 / wiki 数据层）；
> 仓内其余 .py 仅 `assets/data/validate.py` 与 `.claude/skills` 内 1 个辅助脚本，未计入。

## 1. 现状盘点

| 指标 | 数值 |
|------|------|
| 测试档案数 | 5 个（`tests/test_*.py`） |
| 测试用例数 | 49 项，全数通过 |
| 三脚本层语句总数 | 15,315 |
| 未覆盖语句 | 14,507 |
| **总覆盖率** | **5%** |

现有 5 个测试档案分别覆盖：`lua_parse`（95%）、`text_utils`（100%）、
`wiki_sources`（100%，仅 7 语句）、`collect_global`（75%）、
`memory_search`/`fact_store`/`dream` 的部分纯函数（22%/27%/11%）。
其余 70 余个模块覆盖率为 0%。

CI 侧：`test.yml` 仅 `pip install pytest` 后跑 `pytest tests/ -v`，**未安装
pytest-cov、无覆盖率报告**；`test-collectors.yml` 做采集器活体冒烟（联网实测），
不属于单测范畴。

## 2. 分层覆盖画像

| 层 | 代表模块（语句数 / 覆盖率） | 风险 |
|----|------|------|
| news 管线核心 | `aggregator_base`（165/0%）、`news_common`（91/19%）、`data_quality`（156/0%）、`split_output`（91/0%） | 三新使命 #1 的数据净化与校验逻辑完全无回归保护 |
| Discord 归档 | `discord_archiver`（630/0%） | §4.1 全量档案层的写入正确性无验证 |
| 解包解析层 | `parse_awaker_config`（211/0%）、`parse_voice_lines` 等 4 个 parser 全 0%、`generate_wiki_pages`（934/0%） | 使命 #2 wiki 数据源 |
| wiki 数据层 | `validate_data`（123/0%）、`check_version`（130/0%）、`generate_rss`（164/0%）、`build_*_index`（180/0%）、`fetch_*` 6 个采集器（约 1,650/0%） | 整层 3,012 语句仅 `wiki_sources` 7 语句有测试；validate/check_version 是 CI 工作流主体 |
| 会话钩子 | `session_inject`（80/0%）、`session_watch`（82/0%）、`session_distiller`（382/0%） | 每次会话都执行，崩溃即影响所有会话 |
| 记忆层 | `memory_search`（810/22%）、`memory_writeback`（227/0%）、`silver_memory_tools`（219/0%） | 跨档案检索是高频入口 |
| 采集器（联网） | `aggregator_collectors`（959/0%，全仓最大未测模块）、`taptap_collector`、`playwright_collectors` 等 | 已有 test-collectors 活体冒烟兜底，单测优先级低 |

## 3. 改进提案（按优先级）

### P1 news 管线纯函数（使命 #1，最高性价比）

这些函数纯逻辑、零网络依赖，是所有日报输出的守门人：

- `aggregator_base.py`：`sanitize_url` / `sanitize_summary` / `validate_news_item` /
  `validate_all_news` / `generate_summary`——校验逻辑一旦回归，脏数据直接进全量档案层
- `news_common.py`：`strip_html`、`make_item`、**`is_safe_url`（SSRF 防护，安全相关，必须有测试）**
- `data_quality.py`：`normalize_engagement` / `is_hot_normalized` / `SilentPlatformTracker`
- `split_output.py`：`extract_item` / `extract_steam_item` / `_is_recent`（输出展示层变换，§4.1 数据层语义的代码体现）

### P2 解包解析与 wiki 数据校验层（使命 #2 数据源）

`lua_parse` 已有 95% 覆盖，证明 fixture 式 parser 测试在本仓可行，照搬该模式即可：

- `parse_awaker_config.py`：`parse_lua_table` / `_unescape_lua_string` / `clean_markup`
- `parse_voice_lines` / `parse_item_stories` / `parse_cg_gallery` / `parse_collection_hall`（各 40-60 语句，小成本）
- `generate_wiki_pages.py`（934 语句，「建议测试」范围内最大模块）：先测纯函数
  `_voice_category`，再用小型 fixture 对 1-2 个 generator 做快照测试
- `projects/wiki/scripts/validate_data.py`（slash 命令 `/validate-data` 与 CI
  validate-data 工作流的主体）与 `check_version.py`（CI check-version 主体）：
  校验器自身无测试，等于守门人无人看守
- `build_banner_character_index.py` / `build_drop_index.py` / `generate_rss.py`：
  纯数据变换，fixture 测试成本低

### P3 Discord 归档纯助手函数

`discord_archiver.py` 顶部 5 个纯函数是雪花 ID 与时间换算的根基：
`_sf_from_dt` / `_dt_from_sf` / `_month_bounds` / `_prev_month` / `_mstr`。
换算错误会导致归档落错月份目录——全量档案层完整性问题，且测试成本极低。

### P4 会话钩子防崩溃测试

`session_inject.py`（UserPromptSubmit 钩子）每次提问都执行，0% 覆盖。
建议最低限度的「不抛异常」冒烟测试：空输入 / 缺失档案 / 损坏 JSON 三种场景。

### P5 CI 增补覆盖率报告

`test.yml` 加装 `pytest-cov`，输出覆盖率到 job summary；可设 `--cov-fail-under`
起步线（如 5%）并随测试扩充逐步上调（棘轮策略），防止覆盖率回退。

## 4. 不建议投入的方向

- 联网采集器（news 层 `aggregator_collectors` / `taptap_collector` /
  `playwright_collectors`，wiki 层 `fetch_*` 6 个）的 mock 式单测：维护成本高、
  mock 与真实 API 漂移快，现有 test-collectors 活体冒烟更有效
- 解包工具 `decrypt_and_extract` / `extract_client_data`：依赖客户端资源包，
  一次性运行，fixture 难以构造
- `game/` 子项目（已退主线）
- 为单次性脚本（`backfill_*` 系列）补测：一次性回填工具，跑完即弃

## 5. 勘误记录

初版（commit cf258d1）存在三处偏差，本版已修正：

1. **统计口径遗漏**：初版未纳入 `projects/wiki/scripts/`（3,012 语句，含被
   `test_wiki_sources.py` 直接测试的模块），却自称「全仓」。修正后总数
   12,303 → 15,315，总覆盖率 7% → **5%**
2. **「全仓最大未测模块」归属错误**：实为 `aggregator_collectors`（959 语句），
   `generate_wiki_pages`（934）仅是「建议测试」范围内最大
3. **统计日期笔误**：2026-06-09 → 2026-06-10

## 6. 落地记录（2026-06-10 同分支实施）

P1-P5 全部提案已在本分支落地：新增 10 个测试档案，用例 49 → **221**（+14 子测试），
三层总覆盖率 5% → **11%**；`test.yml` 加装 pytest-cov，棘轮线设为 10。

| 提案 | 落地档案 | 关键覆盖提升 |
|------|------|------|
| P1 | `test_aggregator_base` / `test_news_common` / `test_data_quality` / `test_split_output` | aggregator_base 0→73%、data_quality 0→69%、split_output 0→53%、news_common 19→47%（含 is_safe_url SSRF 全分支） |
| P2 | `test_parse_awaker_config` / `test_parse_misc` / `test_generate_wiki_pages` / `test_wiki_data_tools` | 4 个小 parser 0→73-88%、validate_data 0→61%、build_* 0→46-51% |
| P3 | `test_discord_archiver` | 雪花/月界换算助手全覆盖（模块 0→11%） |
| P4 | `test_session_inject` | 5 项 subprocess 冒烟（覆盖率表仍显示 0%——子进程执行不计入 cov，属统计盲区而非未测） |
| P5 | `test.yml` | pytest-cov + `--cov-fail-under=10` 棘轮 |

测试过程发现并钉住的真实异常（未改源码，待守密人裁定）：
**`generate_rss.py` 的 feed 写出在 Python 3.8+ 必然抛 `TypeError`**（二进制句柄配
`encoding="unicode"`），即 RSS/Atom 生成当前不可用；另有 `generate_summary` 降级
路径不对称、`parse_item_stories` 占位符过滤不可达等 7 项行为特征已记录在对应测试注释。
