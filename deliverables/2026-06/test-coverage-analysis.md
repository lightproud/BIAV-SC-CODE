# 测试覆盖率分析与改进提案

> 统计时间：2026-06-09 / 环境：Python 3.11.15, pytest + pytest-cov
> 统计指令：`pytest tests/ --cov=scripts --cov=projects/news/scripts`

## 1. 现状盘点

| 指标 | 数值 |
|------|------|
| 测试档案数 | 5 个（`tests/test_*.py`） |
| 测试用例数 | 49 项，全数通过，耗时 0.58 秒 |
| 全仓语句总数 | 12,303 |
| 未覆盖语句 | 11,502 |
| **总覆盖率** | **7%** |

现有 5 个测试档案分别覆盖：`lua_parse`（95%）、`text_utils`（100%）、
`collect_global`（75%）、`wiki_sources`、`memory_search`/`fact_store`/`dream`
的部分纯函数（22%/27%/11%）。其余 50+ 模块覆盖率为 0%。

CI 侧：`test.yml` 跑 `pytest tests/`，但**未安装 pytest-cov、无覆盖率报告**；
`test-collectors.yml` 做采集器活体冒烟（联网实测），不属于单测范畴。

## 2. 分层覆盖画像

| 层 | 代表模块（语句数 / 覆盖率） | 风险 |
|----|------|------|
| news 管线核心 | `aggregator_base`（165/0%）、`news_common`（91/19%）、`data_quality`（156/0%）、`split_output`（91/0%） | 三新使命 #1 的数据净化与校验逻辑完全无回归保护 |
| Discord 归档 | `discord_archiver`（630/0%） | §4.1 全量档案层的写入正确性无验证 |
| 解包解析层 | `parse_awaker_config`（211/0%）、`parse_voice_lines` 等 4 个 parser 全 0%、`generate_wiki_pages`（934/0%） | 使命 #2 wiki 数据源；全仓最大单一未测模块 |
| 会话钩子 | `session_inject`（80/0%）、`session_watch`（82/0%）、`session_distiller`（382/0%） | 每次会话都执行，崩溃即影响所有会话 |
| 记忆层 | `memory_search`（810/22%）、`memory_writeback`（227/0%）、`silver_memory_tools`（219/0%） | 跨档案检索是高频入口 |
| 采集器（联网） | `aggregator_collectors`（959/0%）、`taptap_collector`、`playwright_collectors` 等 | 已有 test-collectors 活体冒烟兜底，单测优先级低 |

## 3. 改进提案（按优先级）

### P1 news 管线纯函数（使命 #1，最高性价比）

这些函数纯逻辑、零网络依赖，是所有日报输出的守门人：

- `aggregator_base.py`：`sanitize_url` / `sanitize_summary` / `validate_news_item` /
  `validate_all_news` / `generate_summary`——校验逻辑一旦回归，脏数据直接进全量档案层
- `news_common.py`：`strip_html`、`make_item`、**`is_safe_url`（SSRF 防护，安全相关，必须有测试）**
- `data_quality.py`：`normalize_engagement` / `is_hot_normalized` / `SilentPlatformTracker`
- `split_output.py`：`extract_item` / `extract_steam_item` / `_is_recent`（输出展示层变换，§4.1 数据层语义的代码体现）

### P2 解包解析层（使命 #2 数据源）

`lua_parse` 已有 95% 覆盖，证明 fixture 式 parser 测试在本仓可行，照搬该模式即可：

- `parse_awaker_config.py`：`parse_lua_table` / `_unescape_lua_string` / `clean_markup`
- `parse_voice_lines` / `parse_item_stories` / `parse_cg_gallery` / `parse_collection_hall`（各 40-60 语句，小成本）
- `generate_wiki_pages.py`（934 语句，全仓最大未测模块）：先测纯函数 `_voice_category`，再用小型 fixture 对 1-2 个 generator 做快照测试

### P3 Discord 归档纯助手函数

`discord_archiver.py` 顶部 5 个纯函数是雪花 ID 与时间换算的根基：
`_sf_from_dt` / `_dt_from_sf` / `_month_bounds` / `_prev_month` / `_mstr`。
换算错误会导致归档落错月份目录——全量档案层完整性问题，且测试成本极低。

### P4 会话钩子防崩溃测试

`session_inject.py`（UserPromptSubmit 钩子）每次提问都执行，0% 覆盖。
建议最低限度的「不抛异常」冒烟测试：空输入 / 缺失档案 / 损坏 JSON 三种场景。

### P5 CI 增补覆盖率报告

`test.yml` 加装 `pytest-cov`，输出覆盖率到 job summary；可设 `--cov-fail-under`
起步线（如 7%）并随测试扩充逐步上调（棘轮策略），防止覆盖率回退。

## 4. 不建议投入的方向

- 联网采集器（`aggregator_collectors` / `taptap_collector` / `playwright_collectors`）的
  mock 式单测：维护成本高、mock 与真实 API 漂移快，现有 test-collectors 活体冒烟更有效
- `game/` 子项目（已退主线）
- 为单次性脚本（`backfill_*` 系列）补测：一次性回填工具，跑完即弃
