# 银芯向量检索腿设计（厚锚撑向量的银芯参照实现）

> 状态：**设计待守密人拍板规模岔口**（2026-07-05 §八 续拷问会话产出）
> 定位：银芯公开信息层工程产物；本设计为 §八「厚锚撑向量」的**银芯侧活体参照实现**，经通道① 供 BPT 照抄。
> 硬约束：**§1.1-HC 黑池防火墙不受影响**——银芯嵌入的是自己**已公开**的社区档案（早已永驻 git），非黑池数据，方向红线不破。

## Context（为什么做这个）

守密人 2026-07-05 裁定 **(A)**：银芯**解除「零 ML 红线」**、自建一条向量检索腿，嵌入源选 **Voyage API**。

- **动因**：§八 8.6 说「银芯照做当参照给 BPT 抄」，但**唯独向量这条腿 BPT 抄不到**——而「厚锚撑向量」恰是本轮设计核心。参照实现在最关键处开了天窗。银芯自建向量，把天窗补上，BPT 唯一自建收窄到「换上真向量」一步。
- **反转的是什么**：解除「零 ML」纯度线（定位选择），推翻 decisions #85 Q1、北极星「白盒骨架 vs 黑盒神经」的一条基线、以及本会话刚写的 §八 8.1/8.5「向量归 BPT 侧、银芯不建」。
- **不反转的是什么**：§1.1-HC 黑池→银芯防火墙（黑池数据/转录永不进银芯）**原封不动**。银芯向量腿只吃自己的公开社区档案。

## 探查确立的接入点（复用现成，勿新造）

| 环节 | 复用/照抄对象 | 要点 |
|------|--------------|------|
| 后端库 | 仿 `scripts/kb_navigator.py`（import-only、无 `__main__`） | 新 `scripts/kb_vector.py`，结果产出与 `kb_navigator._summary()` **同形 dict**，便于合流 |
| 索引构建 | `scripts/build_community_index.py` 流式范式（generator + `PRUNE_EVERY`/有界内存） | 新 `scripts/build_kb_vectors.py`；语料遍历非 discord 用 `archive_layout.iter_source_files`，discord 照 `_emit_discord` 的 `rglob("*.jsonl")` 逐行读 |
| 嵌入源 | Voyage API（`voyageai>=0.3.0` 坑位已在 `requirements.txt:14`；退役代码不可恢复，从零写） | key 走 CI secret `VOYAGE_API_KEY`（先例 `update-news.yml` 的 `LLM_API_KEY`） |
| 索引落存 | Release `community-assets` + git 只留小 manifest（`.gitignore:48-52` 已排除 `vectors.json` 类） | **云容器不能写 Release**，构建+上传只能在 CI（`gh release upload --clobber`）；还原照 `scripts/restore_release_data.py`（urllib+tarfile，api 封禁回退 `--months`） |
| MCP 工具 | `mcp_server.py` 的 `@mcp.tool()` 模式（延迟 import + `_log()` 埋点） | 新 `kb_vector_search`；缺 key → 优雅降级回退关键词检索（沿用既有降级约定） |
| CI | `.github/workflows/build-analysis-index.yml`（schedule+dispatch、`[skip ci]` retry-push） | 新 `build-community-vectors.yml`，非 path-push（语料由采集 CI 带 `[skip ci]` 提交） |
| 评判 | `kb_ab.py`（三臂→四臂）、`kb_golden_gen.py`（加语义题类）、`kb_eval._result_ids`（加 vector mode 分支）、`kb_telemetry.harvest_gaps`（held-out 靶） | 向量独占价值 = **语义近但无边、无共享 token** 的题（白盒与 grep 都到不了）——这是四臂 A/B 里唯一让向量独胜的类别，是有效性铁证 |

## 分期计划（推荐）

- **Phase 0 — 反转落档 + 权威源扫改**：decisions.md 记反转裁定；扫改「零 ML」语义权威源（§八 8.1/8.5、CLAUDE.md:202、北极星 #96-97、#85）——**与 Phase 1 代码同批落**，避免「文档说建了、代码还没有」的前向漂移。脚本/测试注释与 `okf/` 产物随实现同步/重生成。
- **Phase 1 — 向量腿 MVP**：`build_kb_vectors.py`（有界语料）+ `kb_vector.py` 后端 + `kb_vector_search` MCP 工具 + 缺 key 降级。小语料可 numpy 暴力余弦、免 ANN 库。
- **Phase 2 — 证实有效**：`kb_ab` 扩四臂 + `kb_golden_gen` 加「语义近无边」题类 + 回归测试（向量在该题类严格胜 白盒/grep）。
- **Phase 3 — 厚锚（独立子工程）**：别名 AI 自动识别（`characters.json` 加 `aliases` 字段流经 `domain_dict`/`build_characters`/mention 边）+ 先锚后扩合流。守 §八 8.2 节 5 三墙（出身牌/可撤回/惰性确认）。**风险最高、宜独立推进**。

## 两个待拍板的规模岔口

1. **首次落地语料规模**：**有界原型切片（推荐）** vs 全量 757 万条。
   - 有界（~5万–10万条，如近期 discord 时间窗）：索引小、numpy 暴力免 ANN 库、成本极低、开发快，先证「跑得通且有独占价值」。
   - 全量：索引 4–31GB（必落 Release、必上 faiss/hnswlib + 量化）、CI 慢、成本高，未先小范围验证就押大。
2. **厚锚这轮做否**：**分期、先落向量腿+评判（推荐）** vs 一步到位含厚锚（别名自动识别是独立子工程，战线长、别名质量难自动保证）。

## Verification（落地后怎么验）

- `python3 scripts/build_kb_vectors.py --max-files N`（抽样自检，仿 build_community_index 的 `--max-files`）建小索引。
- `python3 scripts/kb_ab.py` 四臂对照：语义题类**向量严格胜** 白盒/grep、关键词题仍打平——把「向量独占价值在语义召回」锁成数据事实。
- 缺 `VOYAGE_API_KEY` 时 `kb_vector_search` **优雅降级**回退关键词、不报错（回归测试断言）。
- 全量 `pytest tests/` 绿（含新 `test_kb_vector.py` + 扩后的 `test_kb_ab.py`）；对账三卫 + 决策一致性通过。
