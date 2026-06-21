# 银芯仓库代码健康度评估报告

> **⚠ 定格交付物（2026-06-02 快照）**：文中文件/脚本路径反映当时仓库状态；其中自造记忆/做梦子系统（dream* / memory_search / knowledge_graph / embed_query 等）已于 2026-06 退役删除，相关引用按历史快照理解，不指向现行文件。
>
> 生成日期：2026-06-02 · 评估方法：动态编排（四单元并行探查 + 交叉验证）
> 评估范围：`brain-in-a-vat` 全仓（Python 工具层 12,489 行 / news 管线约 10,829 行 / wiki·site 前端约 8,400 行 / 14 个 CI workflow / 5 个测试文件）

---

## 一、综合健康度：6.8 / 10

代码工程质量本身扎实——防御式错误处理、原子写、单一真相源、共享 helper 抽取、CI 自愈/防腐机制成熟。系统性扣分集中在三处结构性落差：

1. **「宣传架构」与「实跑架构」名实不符**：news 三层（日报+哨兵+做梦）实测仅日报层活跃，哨兵/做梦层代码完备但无落盘产物、自 2026-04-26 起无运行痕迹。
2. **数据深度远低于进度表述**：wiki「24/72 自举」实为 23 空壳 stub + 1 合成假数据，0 条经核验的完整角色。
3. **测试与仓库卫生**：83 个 Python 文件仅 5 个测试且完全不进 CI；`.git` 膨胀至 189M、近 200 提交中 59% 为自动归档噪音。

各单元评分：scripts 核心 **7** · news 管线 **6.5** · wiki/site/game **7** · 工程化 **7**。

---

## 二、分单元评估

### 单元 A — scripts 核心工具层（7/10）

记忆系统 / 做梦 Agent / RL / MCP server / Lua 解析，38 个顶层 .py（12,489 行）。

| 子系统 | 用途/价值 | 状态 |
|------|------|------|
| 记忆检索 `memory_search.py`(1351) | TF-IDF 检索+4 维重排，零 API 成本，被 9 脚本引用，系统基座 | 活跃 |
| 知识图谱 `knowledge_graph.py`(906) | 实体-关系图，被 9 脚本引用 | 活跃 |
| 记忆写回 `memory_writeback`+`fact_store` | 读写闭环写半边，TF-IDF 去重 | 活跃 |
| 银芯记忆增强 `silver_memory_tools.py`(482) | 5 自建 MCP 工具，错误处理标杆 | 活跃 |
| 做梦 Agent `dream*.py`(8 模块) | 4 阶段记忆固化，模块化优良 | 活跃（代码） |
| RL/反思 `memrl`/`reflexion` | EMA 效用追踪（作者自述非真 RL） | 实验性 |
| MCP server `mcp_server.py`(534) | 16 工具统一门面 | 活跃 |
| Lua 解析 `parse_*.py` | 客户端解包→JSON | 实验/手动 |
| BPE 索引 `bpe_indexer.py`(557)+`embed_query.py` | 原 Phase 0.5 向量索引 | **疑似废弃** |

**关键问题**：
- 孤儿脚本 `bpe_indexer.py`+`embed_query.py`（约 608 行）零活跃引用，仅历史 digest 提及。
- `memory_search.py:865/907` 反 idiom `except (ImportError, Exception)`，吞错（上次审计已点名未修）。
- `memory_search.py:669` 函数内重复 `import re`（顶层 `:23` 已导）。
- `parse_cg_gallery.py`/`parse_awaker_config.py` 未复用已抽出的 `lua_parse.py`。
- `generate_wiki_pages.py:953/1026` 残留 leading-slash img（lesson #7，未清零）。

**优点**：共享 helper 抽取扎实（消除历史复制债）；全 38 文件零裸 `except`，错误处理纪律严明；注释诚实标注局限（符合 §6.1）。

### 单元 B — news 新闻管线（6.5/10）

| 层 | 状态 | 证据 |
|---|---|---|
| 日报采集层 | **活跃** | `output/news.json` 今日更新，179 条 |
| 哨兵层 | **疑停摆** | 代码在 `dream_sentinel.py`，但 `output/alerts.json`、`sentinel-baseline.json` 磁盘不存在 |
| 做梦层 | **疑停摆** | cron 已配，`memory/dreams/` 最新日志停在 2026-04-26（36 天前），`git log --author=dream` 零提交 |

**数据源实况**：活跃约 11 源（reddit/pixiv/ruliweb/steam/weibo/youtube/stopgame/appstore/google_play/official/bilibili/discord）；**9 源长期零产出**（nga/taptap/bahamut/naver_cafe/fivech/arca_live/zhihu/note_com/steam_discussion，total=0 却仍标活跃源）。

**关键问题**：
- 三层架构实为一层（哨兵/做梦写了代码没在跑）。
- 两套并行采集器 `aggregator_collectors.py` vs `global_collectors.py` 重复实现同名 fetcher 且逻辑漂移，维护成本翻倍。
- cron 配置与文档漂移：`update-news.yml:6` 实为每小时，`CONTEXT.md:41` 称已降为每日 2 次；且该段落重复粘贴两次。
- 9 个零产出源永不被降级（沉默计数器逻辑漏洞），持续空耗 CI。
- 10,147 行采集代码近乎零单测。

**优点**：单一真相源 `sources.py` 治理到位；数据层/输出层隔离符合 §4.1；网络层防御达生产级（重试+Playwright 兜底+空数据保护）。

### 单元 C — wiki/site/game 展示层（7/10）

| 子项目 | 状态 | 证据 |
|------|------|------|
| wiki | 结构完成度高·数据完成度低 | VitePress 三语 + 12 Vue 组件就绪 |
| site | 完成稳定 | 零依赖手写静态站，完整 SEO/OG/多语言 |
| game | 有意冻结占位 | 仅 CONTEXT.md + .gitkeep，治理透明 |

**wiki 数据完整性核实**：`characters.json` 24 条 = stub 23 + fixture 1，complete **0**。skills 23/24 pending，trinkets/commune/background_story **24/24 全 pending**。唯一有内容的 `pandia` 是 schema 自述「NOT canonical」的合成假数据。准确说法应为「24 角色已建占位记录，内容待填充」。

**关键问题**：合成假数据 `pandia` 混在生产库有混入正式输出风险；`validate_data.py` 因 `jsonschema` 未装导致 schema 校验整段跳过；支撑表（realms/items/trinkets）近乎空壳致外键无处可指。

**优点**：生成产物治理规范（源数据+模板，重型资产走 Release）；schema 前瞻诚实（多阶段渐进填充建模）；site 工程质量高。

### 单元 D — 工程化健康度（7/10）

**测试覆盖**：5 文件约 262 行，质量本身高（行为驱动+回归注释），但**无任何 workflow 运行 `tests/`**——PR 零回归门控。覆盖率极低：`collect_global.py`(375 行)仅测 1 函数，`global_collectors.py`(1648 行)零单测。

**14 个 workflow**：11 个健康（采集/部署/版本/校验/清理），3 个有风险（`claude.yml`/`test-collectors.yml`/`dream.yml`）。

**CI/CD 风险**：
- 测试套件不进 CI（最大工程化漏洞）。
- `dream.yml:100` 监控不存在的 `generate-report.yml`，每次抛异常注入虚假告警。
- 多个 Claude 驱动 workflow `direct_push:true` 直推 main，自动化代理对主干写权限缺护栏。
- `test-collectors.yml` 测 `global_collectors` 而线上跑 `collect_global.py`，测试与生产漂移。
- `.git` 膨胀 189M，`vectors.json.gz`(35MB) 二进制频繁覆写为主因。

**依赖与卫生**：Python 仅 `projects/news/requirements.txt`（`>=` 下界 pin，无 lock，不可复现构建）；Node 有 `package-lock.json` + `npm ci`（规范）；有 dependabot；`.gitignore` 合理（实际 tracked 的 news/data 仅约 6.4MB，大数据未误提交）。README 与实际配置多处对不上（`docs:dev` 脚本不存在、踩坑数 30 vs 32）。

**优点**：采集 workflow 工程细节扎实（concurrency/timeout/退避重试）；数据自愈防腐（损坏 JSON 自动回滚）；密钥管理与最小权限规范。

---

## 三、交叉验证（独立硬证据）

- **仓库膨胀**：`.git` 189M，工作区含数据 789M。最大被追踪文件 `assets/data/vectors.json.gz`(34MB)。
- **数据三重冗余**：`update_notices` 以 `.lua`(14MB)/`.txt`(13MB)/`.json`(14MB) 三形态各存一份。
- **历史噪音**：近 200 提交中 118 次为 `[skip ci]` 自动归档（59%）。
- **依赖治理缺口**：12,489 行 Python（`scripts/`）无依赖声明文件。

---

## 四、用途与价值总评

银芯是黑池（Studio 内部层）的「公开信息采集 + 社区共建知识 + AI 协作训练」三位一体公开层。

- **真实在产出价值的部分**：news 日报采集层（每日真实社区情报）、site 公开门户（已部署稳定）、scripts 记忆系统（零成本 TF-IDF 检索基座，AI 协作训练场的实际载体）。
- **价值已建框架但未兑现的部分**：wiki 知识底座（脚手架就绪、数据待填）、news 哨兵/做梦层（代码完备、未在跑）。
- **有意冻结**：game（治理透明，不计扣分）。

整体定位清晰、工程基线高于多数同规模个人/小团队项目，核心瓶颈不在代码质量而在**「宣传进度」与「落盘实况」的对账**——多处文档表述领先于实际运行状态。

## 五、优先整改建议（按性价比排序）

1. **将 `tests/` 接入 CI**（新增 pytest workflow 门控 PR）——最高性价比，当前零回归保护。
2. **修复 `dream.yml` 虚假告警 + 复活或下线哨兵/做梦层**——消除「写了不跑」的架构空转。
3. **对账文档与实况**：CONTEXT.md cron 描述、README `docs:dev`/踩坑数、wiki「24/72」表述。
4. **清理孤儿代码**：确认后删除 `bpe_indexer.py`/`embed_query.py`（约 608 行）。
5. **收敛两套采集器**为单一实现，消除逻辑漂移。
6. **修 `memory_search.py:865/907` 吞错 idiom** + 补 `requirements.txt` + 为 `vectors.json.gz` 考虑 Git LFS 或移出版本控制。

---

*本报告由动态编排四单元并行探查生成，所有事实主张均附文件路径证据。审计仅读取分析，未修改任何业务代码。*
