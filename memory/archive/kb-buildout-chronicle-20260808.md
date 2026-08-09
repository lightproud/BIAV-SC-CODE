# 知识库建设编年史归档（2026-07-04 / 07-05 两日，截至 2026-08-08）

> **⚠ 归档层，不作运行时约束**（守密人 2026-08-08「撞上限即整理到 50%」裁定的首次执行）：
> 本档是 `memory/project-status.md`「## 知识库运行时动态导航」节在 2026-08-08 之前累积的
> **建设过程编年史**，原文逐字迁入，一行未改、一行未删。
>
> **为什么迁**：状态档是「每会话必读的状态权威」，本次撞上限时全档 47,084 字符，本节独占
> **11,482（24.4%）**——为全档最大一节。而节内**每一项都标着「已落地 / ✅」**：北极星五支柱
> （A 两层结构 / B 治理不变量 / C 覆盖哨兵 / D 扩散激活 / E 减易变）全部收尾、评判四仪器全部
> 建成、向量腿 Phase 0–2 与 chunk2/chunk3 厚锚全部完成。**已完成的建设过程属编年史，不属当前状态。**
>
> 其权威源本就另有其档，且节内逐条自带指针：北极星与改造路线 `memory/knowledge-layer-design.md`、
> 裁定溯源 `memory/decisions.md` 2026-07-04/07-05 各条、设计全文
> `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`、交接档
> `Public-Info-Pool/Resource/repo-engineering/kb-vector-remaining-handoff-20260705.md`，
> 消费路由 CLAUDE.md §5「腿路由」/ §6.1 / §7.1，能力本身则由各 `tests/test_kb_*.py` 守着。
>
> **本档里有那些档没有的东西**，这也是「归档而非删除」的理由：每一轮的**实测数字与诚实注**——
> 定制化前后 A/B 的 Δ 从 +0.10 跳到 +0.24、图驱动 262 题下 KB 0.98 vs grep 0.37、质性 probe
> KB 4/4 而 grep 0/4、真 Voyage 铁证超 chance 地板 0.7059、孤立率 65%→37%，以及「生成的联想题
> 对 KB 是送分题」「hit@k 只测检索类能力」这类**主动标注的自身局限**。
>
> 追溯用；**运行时状态与待办一律以 `memory/project-status.md` 为准**。

---

守密人 2026-07-04 裁定「动态编排根据 OKF 和 LLMwiki 的思想实现银芯知识库」——把静态
OKF bundle 升级为**艾瑞卡运行时可动态导航的知识库**。落地：`scripts/build_kb_index.py`
从 bundle（concept + `graph.json`）造静态导航索引 `okf/kb_index.json`（倒排表 + 邻接表，
词典法零 ML）；MCP `biav-sc-memory` 增 **知识库导航四工具** `kb_search` / `kb_get` /
`kb_neighbors` / `kb_overview`（后端 `scripts/kb_navigator.py`，import-only），MCP 工具
总数 **4→8**。索引随 `build_okf_bundle.py` 末尾自动重生成、随 `--tarball` 单向输出物一起走。
守护 `tests/test_kb_index.py`（索引完整性 + 导航四原语 + MCP 工具）。溯源见
`memory/decisions.md` 2026-07-04 条 + CLAUDE.md §1.4 第 5 条 / §6.1。

**全仓知识组织（2026-07-04 同日，ultracode 多代理编排落地）**：承接上条，OKF bundle 从 4 层
扩到**覆盖全仓知识域**——**12 层 / ~293 概念**：原生 characters(72)/sources(17)/memory(45,扩全层)/
story(11,扩) + 新增 assets(12,事实圣经)/wiki-data(26)/**community(19,归档社区全量档案 7.5M+ 条分析镜头)**/
news-output(23)/unpacked(13)/extracted(4)/resource(34)/projects(17,含 CLAUDE.md/README 入口+CONTEXT+藏宝图+设计文档)。新层由 import-only
库 `scripts/okf_pointer_layers.py` 确定性生成；kb_index 覆盖 294 概念、`kb_*` 导航跨全仓。三条铁律守恒
（归档 2.1G/解包 44M 只指针不复刻、data_layer 标层、无黑池数据）。守护 `tests/test_okf_pointer_layers.py`。
编排溯源：`organize-repo-knowledge`（测绘+合成+批判）+ `verify-repo-knowledge-org`（5 维对抗式核验）工作流。

**知识层北极星锚定 + 治理不变量地基（2026-07-04，Pillar B）**：守密人会话把知识层定位结晶为
**神经符号白盒骨架**（`memory/knowledge-layer-design.md`：OKF=有结构的概念网络承载白盒知识，
区别于神经网络黑盒；三命令=白盒只花骨架/测不变量/守覆盖哨兵；改造路线 A 连网络→B 治理→C 覆盖哨兵
→D 扩散激活→E 减易变）。**Pillar B 已落地**：`tests/test_kb_governance.py`——生成器假设绊线
（no domain:misc / unpacked slug / memory·story 白名单⊆实况 / 层非空）+ **结构指纹 keystone**
（`build_okf_bundle.structural_fingerprint`，排易变量的规范哈希；不变量：committed okf/ 结构须恒等于
源重建，抓「改源忘重建」stale commit）。现状基线：约 200/293 概念度数=0（孤立指针群岛）。
**Pillar A 已落地（2026-07-04，守密人边策略裁定「选 1」）**：实测证明选项 1（不造噪声星）下几无可加的
干净高信号边，故 A 从「加边」诚实收束为「**显式声明两层结构**」——skeleton（characters/sources/community/
news-output，连通 76%）vs search（参考层，有意孤立、kb_search 可达）。tier 落 kb_index/graph 节点 +
kb_navigator overview 报告；绊线 `test_skeleton_is_actually_connected`（骨架连通≥60%）锁设计属性。
**Pillar D 扩散激活检索已落地（2026-07-04「再 D」）**：`kb_activate`（MCP 第 9 工具）从种子沿骨架
多跳带衰减扩散、按边类型加权（剪枝即加权），返回被点亮子图=联想召回。实证 `activate("discord")`
跨层点亮全量镜头+输出抽样+分析索引（搜索连不到的结构）。MCP 工具 8→9。
**Pillar C 覆盖哨兵 + E 减易变已落地（2026-07-04「再做 CE」）**：C=`tests/test_kb_coverage_sentinel.py`
扫全仓知识文件断言每个被概念覆盖（守假完备，实测仅 processed/README.md meta 豁免）；E=`_magnitude()`
把 community 每时增长的精确条数→量级桶「百万级（精确值见指针本体）」（杀 churn、锐化白/黑盒边界）。
**至此北极星五支柱全落地**：A 两层结构 / B 治理不变量 / D 扩散激活 / C 覆盖哨兵 / E 减易变，**改造路线收尾完成**。

**知识库有效性评判体系（2026-07-04「如何追踪评判是否有效」派发，逐个推进）**：
- **#1 黄金问题集已落地（v2 定制化，守密人 2026-07-04「应该定制化设计」）**：`scripts/kb_eval.py`（评分器，**按能力分打分**）+ `tests/kb_golden_questions.json`（17 题，每题标 `capability`+`distinctive`）+ `tests/test_kb_golden.py`。**定制化核心洞察**：通用「X 是谁」关键词题测的是 KB=grep 的维度、稀释了 KB 价值；应按 **KB 独门能力**出题（associative/cross_layer/layer_aware/identity），`distinctive=true`（grep 到不了的 token 脱节题）的命中率才是**「KB 作用」的分数**。实测**★distinctive hit@3=1.00（4/4）**、总 0.94、门槛（总 0.62 / distinctive 0.80）。**验证守密人点**：定制化后 A/B 的 Δ 从 +0.10 跳到 **+0.24**（通用集稀释了 KB 优势）。诚实边界：hit@k 只测检索类能力（associative/keyword）；层判定/身份/边界等**质性能力**靠不变量测试与遥测，非黄金集能盖全——「验证 KB 作用」本就是多仪器的事。记分卡 `python3 scripts/kb_eval.py`。
  - **图驱动黄金集扩容（守密人 2026-07-04「黄金集数量太少」）**：洞察=**白盒图每条带类型边本身就是一条标准答案**，故能从图**自动生成**黄金集。`scripts/kb_golden_gen.py`（内存生成、不落 committed 文件防 churn，复用 `kb_eval`/`kb_ab`）从图确定性造四类题（identity/associative 1 跳/associative 2 跳 token 脱节/layer），**262 题、其中 162 distinctive**（手写集仅 4）。规模化 A/B：**KB 0.98 vs grep 0.37（Δ+0.61）**——联想题 176 道 KB 171/grep 11，规模上稳稳复现「联想是 KB 独占、grep 结构上塌」。**诚实注**：生成的联想题对 KB 是「送分题」（activate 顺边走必中），故本集测的是**grep-gap 与覆盖广度在规模上稳不稳**、非刁难 KB；真 held-out 难题靠 #2 遥测零命中回流。守护 `tests/test_kb_golden_generated.py`（规模≥150/distinctive≥80、Δ≥0.30、KB 自生成 distinctive 命中≥0.90）。生成器 `python3 scripts/kb_golden_gen.py`。
- **#2 MCP 工具埋点已落地**（追踪的地基）：`scripts/kb_telemetry.py`（`log_call` best-effort 埋点 + `summarize` 使用报告）；`mcp_server` 的 5 个 `kb_*` 工具在消费边界接入埋点（只记真实消费、不记测试/CLI）。日志落 **gitignored** `Public-Info-Pool/Rough/kb_usage.jsonl`（瞬态、不 churn）。报告 `python3 scripts/kb_telemetry.py` 暴露：调用分布 / 触达概念率 / **死概念**（从未导航到=剪枝候选）/ **零命中查询**（覆盖哨兵看不见的需求缺口）。守护 `tests/test_kb_telemetry.py`。
  - **零命中回流（2026-07-04 推进，闭合 #1↔#2）**：`harvest_gaps()` 把「用户真的问了、KB 却零命中」的查询抽成 **held-out 难题候选**（`capability=held_out`、`expect` 待人工分诊）。补上评判 #1 的诚实缺口——图驱动生成的黄金集对 KB 是「送分题」（顺边必中），**真难题只能来自需求侧现实**。两条腿：生成集管够多够全、遥测回流管够难够真。`python3 scripts/kb_telemetry.py --harvest`。
- **#3 反事实 A/B 已落地**（检索层确定性半）：`scripts/kb_ab.py` 比 KB 结构化检索 vs 朴素 grep（同语料 okf 概念、同黄金目标）。**实测 KB 0.80 vs grep 0.70（Δ+0.10）**——**分模式铁证「OKF ≠ 搜索」**：关键词题 KB=grep=13（打平，纯查串 grep 就够）、联想题 KB=3/grep=1（KB 胜，grep 无从遍历 token 脱节 lore 边，如「萝坦→奥吉尔」零共享字）。守护 `tests/test_kb_ab.py`（KB 不劣于 grep + 联想题严格胜）。
  - **最强 grep 基线（2026-07-04 推进，反稻草人）**：`grep_baseline_strong` 把朴素 grep 一切能占的便宜给足（整串短语命中 ×10 + id/标题字段命中 ×5 + 逐 token TF）。实测**联想题上 KB=6 而最强 grep 仍只 2**——证明 KB 的联想优势是**结构**（顺关系边遍历），非拿弱基线凑的假象。新增回归 `test_kb_wins_associative_even_vs_strongest_grep`，彻底堵死「你的 grep 是稻草人」。
  - **全量 LLM 答题反事实（人工协议·金标准偶检）**：检索层 A/B 测的是喂给 LLM 的检索，非最终答案质量（后者需 LLM+裁判在环，做不成 pytest）。人工偶检协议：取黄金集问题，令艾瑞卡各答两遍——一遍允许 `kb_*` 工具、一遍只 ripgrep，由守密人/独立会话对「正确性/落地率/是否脑补」打分对比。题库复用 `tests/kb_golden_questions.json`。
- **#4 质性能力 probe 已落地**（守密人「针对专有能力 grep 还是好用」逼出）：真相=hit@k 是 grep 主场（只测找文本），KB 真价值在检索之后的结构化知识（层/身份/边界），grep 结构上给不了、hit@k 测不出。`scripts/kb_qual.py` 四 probe（2026-07-04 从三扩到四）：层判定（16 平台 KB 区分 16/grep 0，防 lesson #30）、身份消歧（唯一 type=character 规范，KB 5/grep 0）、边界枚举（KB 可枚举 72 角色/59 全量、grep 给不了）、**类型化关系**（KB 对 312 条边给出关系类型 mention/cross/cv/variant/lore——『A 与 B 是什么关系』，grep 只给共现给不了类型，是白盒图最本质、grep 结构上永远给不了的维度）。**实测 KB 4/4、grep 0/4**。守护 `tests/test_kb_qual.py`。
- **评判体系四仪器齐 + 逐个加固（2026-07-04）**：#1 黄金集（检索 hit@k，**图驱动扩容 262 题**）/ #2 使用遥测（追踪，**零命中回流 held-out 难题**）/ #3 反事实 A/B（对照 grep，**最强 grep 反稻草人**）/ #4 质性 probe（层/身份/边界/**关系类型**，测 hit@k 测不出的 KB 真价值）。四项各获一轮深化，评判体系闭环加固。

**Pillar A+ 提及边 + OKF vs 向量定位（2026-07-04 守密人两问）**：Q1 定位——向量=黑盒联想（需 ML/不可审计），
OKF=白盒联想（带类型/零 ML/可单测），银芯选 OKF 因零 ML 红线；二者互补（向量更好的搜索、OKF 可解释结构层）。
Q2 修正 Pillar A「参考层几无边」当时太保守——**关系在正文里**：`build_graph` 提及边抽取（领域词典 72 角色名扫
策展正文源，字面点名建 `mention` 带类型边）。**孤立率 65%→37%**（+214 提及边），search-tier 96%→44%，
golden MRR 0.775→0.80。守护 `tests/test_kb_governance.py`（高信号+连回角色+岛屿<50%）。北极星 §十。

**向量检索腿（§八「厚锚撑向量」参照实现，2026-07-05 守密人裁定(A) 解除零 ML 红线）**：
- **反转 scoped**：白盒脊柱（kb_index/community_index/tokenizer）**仍确定性零 ML、不动**；只新增**隔离的** ML 向量长尾腿。§1.1-HC 防火墙无涉（吃银芯自有公开社区档案）。
- **Phase 0+1 已落地**（PR #438）：`scripts/kb_vector.py`（可插拔嵌入=生产 Voyage / 离线确定性桩；纯 Python 余弦；缺索引优雅降级）+ `scripts/build_kb_vectors.py`（复用 `build_community_index.iter_records` 流式有界取样 `--limit`，gzip 索引 `okf/kb_vectors.json.gz`，放指针不放本体）+ MCP `kb_vector_search`（**工具 9→10**）+ `tests/test_kb_vector.py`（桩后端 8 测全绿、零网络）。索引本体 `.gitignore` 排除、CI 建后传 Release、运行时 `restore_release_data.py` 还原。
- **✅ key 已验证 + 首个真索引已建（2026-07-05）**：守密人配好 `VOYAGE_API_KEY` secret + Voyage 绑支付方式（免费 200M token 额度仍在、有界原型 ≈ $0，仅放开限流）。`build-community-vectors.yml`（workflow_dispatch）跑绿：guard 过 → Voyage 真嵌入 1500 条有界切片（`voyage-3-lite` 512 维）→ artifact `kb-vectors-bounded`。向量腿从「桩验管线」升级到「真语义可跑」。
- **correctness 硬化已落（2026-07-05，设计工作流对抗核验揪出 2 真 bug + reviewer 复核无残留）**：① `kb_vector.write_index` 改**确定性 gzip**（`GzipFile mtime=0`——原裸 gzip 含 mtime，同内容字节不同，入 git 必 churn）；② `kb_vector.search` **围栏 embed 调用**（voyage 索引在运行时缺包/缺 key 时 embed 抛 ImportError，原未捕获会穿透、把「脊柱托底」带崩——§八 8.3 合流依赖此处就地降级；窄捕获不吞 cosine 真 bug）；③ `build_kb_vectors` 默认 `--out` 迁 gitignored `Public-Info-Pool/Rough/`（防本地桩索引污染 okf/，CI 建生产索引显式传 `--out okf/ --backend voyage`）。守护 `tests/test_kb_vector.py`（10 测：+确定性字节相同 +「voyage 索引+运行时无 key」降级）。全量 pytest 2562 passed。
- **守密人 2026-07-05 三裁定（解锁剩余）**：(a) 索引落存 = **Release community-assets + restore**（合本仓「二进制→Release、git 留指针」范式，不入 git 免撞瘦身）；(b) 运行时激活 = 守密人已配环境侧 `VOYAGE_API_KEY` + `voyageai`（**对新会话生效**，本会话实测仍缺、走降级）；(c) chunk3 厚锚：mention 边**不刻意排除**社区档案（令真实黑话可成别名边）+ 别名 A/B 铁证**改立关系腿**（kb_neighbors/kb_activate，非「grep 找不到别名→角色」稻草人）。
- **✅ Phase 2 语义铁证 harness 已落（2026-07-05，经对抗 reviewer C1/C2 加固）**：`scripts/kb_semantic_ab.py`（paraphrase-recall 四臂 vector/grep/grep_strong/spine，主分 `vector_exclusive_win_rate`；自足黄金现场嵌入、不依赖已建索引）+ `tests/kb_semantic_golden.jsonl`（**17 条种子**，query=真社区消息零共享-token 语义改写，出身牌+防火墙齐；ratchet 只增不减、向百条量级长）+ `tests/test_kb_semantic_ab.py`（诚实性不变量=grep/脊柱恒 0 + stub 贴 chance 地板负控 + 确定性 + 防火墙，7 测零网络）+ `.github/workflows/kb-semantic-proof.yml`（CI 真 Voyage 门：voyage 绝对胜率 + 超 chance 地板 margin，不以飘 stub 为减数）。**reviewer 加固**：C1 黄金 7→17（功效↑，文档「百余条」订正为真实数）；C2 `_STUB_DIM` 64→512 压碰撞（stub 底噪 0.29→0.0588=chance 地板）。**stub 实测**：grep/grep_strong/spine 全 0（黄金真不可达）、stub vector 贴地板（证词法袋赢不了语义）。**真胜负数字待 CI dispatch `kb-semantic-proof.yml`**（需 Voyage，本会话取不到 key）。
- **✅ chunk2 已落（2026-07-05 接手会话）**：`build-community-vectors.yml` build 步补显式 `--out okf/kb_vectors.json.gz`（修 #449 默认迁 Rough/ 后 artifact 步断链）+ 新增 `gh release upload community-assets --clobber` 步（`permissions: contents: write`，照 fanart-archive.yml）；`restore_release_data.py` 扩展**非 tar 资产平拷贝**（`kb_vectors.json.gz` 是纯 gzip JSON、原 tarfile 解包必炸 ReadError——交接档还原命令现逐字可用）。桩端到端实测：建索引 200×512 → `kb_vector.search` degraded=false。**真索引传 Release 待本轮合并 main 后 dispatch**（workflow_dispatch 只认默认分支）；运行时查询嵌入待有 key 的会话验证（本会话环境实测仍无 `VOYAGE_API_KEY`/`voyageai`）。
- **✅ chunk3 厚锚已落（2026-07-05 接手会话，按 (c) 裁定 3-甲/3-乙）**：
  - **别名侧表** `projects/wiki/data/processed/aliases.json`（sibling 不改 characters.json；三墙=出身牌/可撤回/惰性确认态）：manual-seed 7 条全带真实社区引文（融朵/熔朵→熔毁·朵尔 bilibili 17/10 档、Ramona/Pandia/Saya discord 讨论正文、潘迪娅/菲英特单档未确认压权重）。读取层 `scripts/silver_aliases.py`（import-only，缺表/损坏优雅返空）；生成期工作面 `scripts/extract_aliases.py`（grep-evidence 核证据 / add 默认未确认 / confirm / revoke 删条撤回 / harvest 收割零锚喂料——AI 自动识别、人只留否决）。
  - **别名流经白盒**：`silver_tokenizer.domain_dict` 只吸收 confirmed 纯 CJK 别名（融朵整词切出）；`build_okf_bundle.build_graph` mention 边纳入社区档案（3-甲：目录指针有界确定性抽样 ≤3 文件×500KB，文件指针直读 text 后缀）+ **已确认别名边**（拉丁整词边界防子串误连）——mention 边 223→290，`提及:Saya/Pandia/Ramona` 等真实黑话边从社区档案长出；角色概念页浮出「社区别名」行（未确认显式标注）。
  - **先锚后扩合流** `scripts/kb_anchor.py` `anchor_expand()`：脊柱锚定（附侧表别名）→ 已确认别名扩词 → 向量捞长尾 + 据锚去杂（anchored 标记排前、不删召回）；**扩腿函数内吞全异常**（critique 致命洞：「有真 voyage 索引+运行时无 key」绝不带崩脊柱托底，测试专项覆盖）；零锚查询自动喂 `Rough/alias_gaps.jsonl` 闭环。MCP 注册 `kb_anchor`（**工具 10→11**）。
  - **别名 A/B 立关系腿**（3-乙）：`tests/test_kb_alias_relation.py`——「提及:{别名}」标签边存在即证「只写别名的档案→角色」pair 非本名可达（本名扫描在先+pair 去重）；kb_neighbors/kb_activate 顺边可达；未确认别名绝不进图。kb_ab/kb_golden_gen 经查**本无**「别名 search 题」稻草人断言，无需删。守护另有 `tests/test_silver_aliases.py`（三墙+防御）+ `tests/test_kb_anchor.py`（降级契约 8 测）。
- **✅ 真索引已传 Release + 真 Voyage 铁证已过（2026-07-05 合并后 dispatch 双绿）**：`build-community-vectors.yml` run 28738986075 建 1500×512 voyage-3-lite 并上传 Release `community-assets`（本会话经 `--months` 回退还原实测成功，meta 对上）；`kb-semantic-proof.yml` run 28738986658 **语义铁证通过**——voyage 超 chance 地板 **0.7059**（阈 0.5/0.3），paraphrase_recall 14 题独胜率 **0.7857** / cross_lingual 3 题 0.6667，grep/grep_strong/spine 恒 0、stub 负控 0.0588 贴地板。「只有语义能赢」从 stub 推定升格为真 Voyage 数据事实。
- **✅ 索引扩到架构上限（守密人 2026-07-05「完全生成」裁定→AskUserQuestion 选「架构上限」档）**：默认规模 1500→**60000**（实测水位：gz≈92MB 单 Release 资产 / 全表扫描≈1.9s / 加载一次≈27s / `load_index` 加 `array('f')` 常驻压缩 ~944MB→~140MB）。**采样修正**：v1「取前 N 条」在语料极端偏斜下（discord 753 万=99.5%、其余 16 平台合计 ~3.4 万）是前缀失真（lesson #30 同源）——v2 两遍流式**分层采样**（`_quotas` 水填：小源全收、大源吃剩余；源内确定性跨步，跨全频道全时间落点），meta 落 `sampling/per_source` 可审计。真语料实测 14 源全进样。全量 757 万=量产子工程（量化+分片+ANN），未裁定不动。守护 `tests/test_build_kb_vectors_sampling.py`（10 测）。
- **待办**：`extract_aliases.py` 生成期批量抽取跑第一轮（manual-seed 之外喂大侧表，本轮守密人未勾选、留后续）；带 key 会话验运行时真语义查询。设计全文 `Public-Info-Pool/Resource/proposal/silver-core-vector-leg-design-20260705.md`，交接档 `Public-Info-Pool/Resource/repo-engineering/kb-vector-remaining-handoff-20260705.md`，决策见 `memory/decisions.md`。
