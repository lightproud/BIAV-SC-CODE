# 向量腿剩余工作交接（chunk2 完成 + chunk3 厚锚）

> 交接自 2026-07-05 §八 向量腿续会话。给接手会话：读完本档 + `memory/decisions.md` 顶部 3 条向量腿决策 + `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`（总设计）即可续推。
> **动手前先跑 `git config core.hooksPath .githooks`**（云容器 pre-push 防 413）。

## 一、已完成（勿重做）

银芯已建向量检索腿（§八「厚锚撑向量」的活体参照实现，守密人 2026-07-05 裁定(A) 解除零 ML 红线，**scoped**：白盒脊柱仍零 ML，只加隔离 ML 向量长尾腿；§1.1-HC 黑池防火墙无涉，只吃银芯自有公开社区档案）。

- **PR #438（已合并 main）**：Phase 0 反转落档（CLAUDE.md §1.4/§5、§八 8.1/8.5/8.6/8.7 v0.7、北极星 §十、decisions）+ Phase 1 向量腿：`scripts/kb_vector.py`（可插拔嵌入 voyage/stub + 余弦 + 缺索引降级）、`scripts/build_kb_vectors.py`（复用 `build_community_index.iter_records` 流式有界取样 + gzip 索引）、MCP `kb_vector_search`（工具 9→10）、`.github/workflows/build-community-vectors.yml`（CI 建真索引，**已实测跑绿**：1500×512 voyage-3-lite）。
- **PR #449（已合并 main）**：correctness 硬化——`write_index` 确定性 gzip（`GzipFile mtime=0`）、`search` 围栏 embed（voyage 索引运行时缺 key/包时就地降级、保脊柱托底）、`build_kb_vectors` 默认 `--out` 迁 gitignored `Public-Info-Pool/Rough/`。
- **PR #450（本会话，状态见下）**：Phase 2 语义铁证 harness `scripts/kb_semantic_ab.py`（paraphrase-recall 四臂 vector/grep/grep_strong/spine，主分 `vector_exclusive_win_rate`；自足黄金现场嵌入）+ `tests/kb_semantic_golden.jsonl`（17 种子）+ `tests/test_kb_semantic_ab.py` + `.github/workflows/kb-semantic-proof.yml`（CI 真 Voyage 门）。经对抗 reviewer 加固（C1 黄金 7→17、C2 `_STUB_DIM` 64→512）。
  - **⚠ 合并状态**：接手前先确认 #450 是否已合并 main（若已合，从最新 main 起；若未合，先跑 `pytest tests/` 全绿后 squash 合，或据守密人指示）。

## 二、守密人 2026-07-05 三裁定（已解锁剩余）

1. **索引落存 = Release `community-assets` + restore**（不入 git，合本仓「二进制→Release、git 留指针」范式，避撞瘦身）。
2. **运行时激活 = 已配**（守密人在会话/远端环境侧加 `VOYAGE_API_KEY` + 装 `voyageai` 包，**对新会话生效**——接手会话应先 `python3 -c "import os,voyageai;print(bool(os.environ.get('VOYAGE_API_KEY')))"` 确认；若真已生效，可**本会话直接跑真 Voyage 索引 + 语义铁证**）。
3. **chunk3 厚锚**：(甲) mention 边**不刻意排除**社区档案（原 `build_okf_bundle.build_graph` 只扫 `_CURATED` 前缀、排除 `Public-Info-Pool/Record/Community/`；改为允许，令真实黑话可成别名边）；(乙) 别名 A/B 铁证**改立关系腿**（kb_neighbors/kb_activate 从只写别名的文档跳到角色概念；**否掉**「grep 找不到别名→角色」稻草人——别名一写进概念正文 grep 同篇逐字命中）。

## 三、chunk2 完成（让真索引运行时可用）

目标：真索引持久化 + 运行时可查（现仅 CI artifact + 运行时降级）。

1. **CI 建真索引传 Release**：改 `build-community-vectors.yml`——build 步后加 `gh release upload community-assets okf/kb_vectors.json.gz --clobber`（授权 `GH_TOKEN: ${{ github.token }}`，照 `fanart-archive.yml`）。索引确定性 gzip 已保证同内容不 churn。
2. **运行时还原**：`kb_vector.load_index` 读 `okf/kb_vectors.json.gz`（DEFAULT_INDEX）；接会话/需要时经 `python3 scripts/restore_release_data.py --tag community-assets --pattern 'kb_vectors.json.gz' --dest okf`（该脚本 api 封时回退 `--months`，见其 CLI）。
3. **查询嵌入**：运行时 key+包已配（裁定 2）后，`kb_vector_search` 不再降级、真跑语义。验证：restore 后 `kb_vector.search("换个说法的查询")` 返回真语义命中（degraded=false）。
4. **落档**：project-status 更新；decisions 若需记「Release 落存路线已实施」由守密人授权代写。

## 四、chunk3 厚锚（别名 AI 自动识别 + 先锚后扩）

**下游于向量腿降级契约（已在 #449 落：`kb_vector.search` 内部降级）。** 按设计工作流 spec（见 proposal 档 + 本会话 decisions 条）+ 对抗 critique 修正实现：

- **别名侧表** `projects/wiki/data/processed/aliases.json`（sibling，不改 characters.json）：每条 `{concept_id, alias, provenance:{message_id/source, 推断依据}, confirmed:bool, added}`——守 §八 8.2 三墙（出身牌/可撤回/确认态）。
- **`scripts/silver_aliases.py`**（import-only）：`load()` 对**缺失/空表优雅返空**（否则文件建前所有 build bundle 测试 import 期炸——**必做防御**）。
- **AI 自动识别** `scripts/extract_aliases.py`：**生成期**（一次 subagent/会话抽取，非运行时黑盒）从社区语料 + 概念提别名候选 → 落 `未确认` 态；消费失败（§8.4 锚不到）自动喂新候选。本会话可先落**少量 manual-seed**（从社区档案 grep 真 quote，**严禁伪造 provenance**）端到端验证。
- **先锚后扩合流** `scripts/kb_anchor.py` `anchor_expand(query)`：先脊柱锚定（search/activate 取概念 + 其别名）→ 别名扩词 → 向量在锚周边捞 + 据锚去杂。**关键（critique 致命洞）**：扩腿 embed 调用必须**函数内** try/except 吞全异常（含 ImportError/无 key），保**锚+别名照常返回**（不能只在 MCP 边界降级，否则「有真索引+运行时无 key」场景把脊柱托底一起带崩）。新增测试须含「有索引 backend=voyage + 无 key」用例。
- **别名流经白盒**：`silver_tokenizer.domain_dict` 只吸收 `confirmed` 且纯 CJK 别名（混合英数别名拿不到 FMM 整词，claim 收窄为「纯 CJK 已确认别名」）；`build_graph` mention 边按裁定 3-甲纳入社区档案扫描。
- **别名 A/B 铁证**：立关系腿（kb_neighbors/kb_activate），**删** kb_ab/kb_golden_gen 里「别名 search 题 KB 严格胜 grep」的 distinctive 断言（稻草人）。
- **勿动** `test_kb_governance` 的 structural_fingerprint（哈希的是 bundle，别名经 build_characters 已被指纹传递覆盖，不存在独立「哈希源集」要改）。

## 五、通用纪律（踩坑防护）

- **测试零网络**：向量/别名相关测试一律用 stub 后端 / monkeypatch，绝不触 Voyage（`kb_vector.embed_stub`、`_STUB_DIM=512`）。
- **改 memory/*.md 或 CLAUDE.md 后必 `python3 scripts/build_okf_bundle.py` 重建 bundle**，否则 `tests/test_kb_governance.py` 红。
- **自查自合**（§7.6）：改代码/测试/数据必跑 `pytest tests/`（当前基线 2573 passed）贴结果全绿再合；纯文档可免。
- **decisions.md 仅守密人权限**，授权代写时才动 + 更头部计数行。
- **push 分支舞**：pre-push 钩子会 rebase 到最新 main → 常需 `git push --force-with-lease`（rebase 致本人工作分叉，非覆盖他人）；合并的 PR 是终态、follow-up 从 main 重起同名分支。
- **落存路线**：向量索引本体 `okf/kb_vectors.json.gz` 已 gitignore，走 Release（裁定 1）；本地/桩构建默认落 gitignored `Public-Info-Pool/Rough/`。

## 六、关键文件 + 命令速查

- 后端 `scripts/kb_vector.py` · 构建 `scripts/build_kb_vectors.py` · 语义 harness `scripts/kb_semantic_ab.py` · 黄金 `tests/kb_semantic_golden.jsonl`
- CI：`build-community-vectors.yml`（建真索引，dispatch）· `kb-semantic-proof.yml`（语义铁证，dispatch，需 Voyage）
- 设计全文 `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`；决策 `memory/decisions.md`（顶部 3 条向量腿）；进度 `memory/project-status.md`（向量腿段）
- 自测：`python3 scripts/kb_semantic_ab.py --backend stub`（grep/脊柱应恒 0、stub 贴 chance 地板）；`pytest tests/test_kb_vector.py tests/test_kb_semantic_ab.py -v`
- 真铁证：CI dispatch `kb-semantic-proof.yml`（或运行时 key 已配的会话 `python3 scripts/kb_semantic_ab.py --backend voyage`）
