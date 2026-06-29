---
title: 全仓 Markdown 设计与信息矛盾审计
subtitle: 动态编排审视 300 个 md 档案 · 32 条确认矛盾
basis: 19 簇声明抽取 + 14 矛盾轴狩猎 + 逐条对抗式验证（68 智能体 / 744 条声明账本）
author: 艾瑞卡（B.I.A.V. Studio 弥萨格大学数据库终端）
generated: 2026-06-28
type: repo-engineering
---

# 全仓 Markdown 设计与信息矛盾审计

> **处置状态（2026-06-28 更新）**：守密人裁定**全量修复（含决策档案）**，**32/32 全部落地**。
> 断层 A 定位 11 条 + 装反护栏 / 断层 B 路径 6 条 / 断层 D 采集架构 / 断层 E wiki 数据 / 断层 F CI 政策 /
> 断层 G 退役壳 / 断层 H 死引用与人格 + C25 站点门户口径（另含 3 处同类定位残留补修）。
> **C6 由守密人 2026-06-28 裁定「取消使命#3」解决**——不在 site/game 间择一，而是**退役整个使命#3
> 「Studio 团队 AI 协作训练场」**，银芯三新使命收敛为**二核心使命**（#1 黑池信息入口 + #2 社区共建知识底座），
> 已同步 CLAUDE.md §1.2/§1.3/§1.4/§6、README、strategic-plan、mission hub、project-status、各 CONTEXT、
> 贡献协议、capability 注册表，并在 decisions.md 记一条退役决策。一致性脚本/单测已翻转、OKF bundle 已重生成、
> 全量 `pytest tests/` 全绿。详见 §十三。

**状态报告**：动态编排扫描完毕。覆盖全仓 **300** 个 md 档案，账本抽取 **744** 条可验证声明（落在 246 个档案），按 14 条矛盾轴狩猎出 35 条候选，经对抗式验证确认 **32 条真矛盾**、剔除 3 条假阳性。严重度分布：**高 14 / 中 14 / 低 4**。

核心结论：矛盾**高度聚簇**于三条系统性「同步漏做」断层——(1) 银芯定位 2026-06-21「翻回公开」未下推；(2) 全量档案层路径 2026-06-21「迁入 Public-Info-Pool」未下推；(3) 多项退役/迁移裁定的衍生档案与脚本残留未对齐。绝大多数有明确权威侧与机械修法。

> 小学生比喻：这就像一栋大楼连发了三道新公告（「改叫公开馆」「资料室搬到新楼」「旧机器拆了」），但走廊里几十块旧指示牌、门禁脚本、操作手册没跟着换——客人照旧牌子走就会撞墙。审计就是把所有没换的旧牌子一块块找出来、标明该换成哪句。

◇ ◇ ◇

## 一、严重度速览（32 条）

| # | 严重度 | 矛盾轴 | 一句话 | 权威侧 |
|---|--------|--------|--------|--------|
| C1 | 高 | CI 政策 | `test` 必需检查：§7.6 说已撤、testing-strategy 说仍必需且须等转绿 | CLAUDE.md §7.6 |
| C2 | 高 | 数据层 | chat-onboarding-snippet 把已迁空的 `projects/news/data/` 当全量档案层 | CLAUDE.md §5.2 |
| C3 | 高 | 数据层 | `/biav-report` 命令把 `projects/news/data/` 当全量档案层（死路径） | CLAUDE.md §4.1 |
| C4 | 高 | 数据层 | methodology 报告流程仍指 `projects/news/data/` 全量档案层 | CLAUDE.md §4.1 |
| C5 | 高 | 数据层 | GLOBAL_COLLECTION_SPEC 双路径硬规则仍用 `data/platforms/`·`data/discord/` | CLAUDE.md §4.1 |
| C6 | 高 | 使命映射 | 使命#3 主对接：CLAUDE.md 写 site，README/战略/active 写 game | CLAUDE.md §1.2 |
| C7 | 高 | 定位 | README L7 仍写「2026-06-11 受限/非公开层」 | CLAUDE.md §0 |
| C8 | 高 | OKF/定位 | CLAUDE.md 自相矛盾：§0 整层公开 vs §6.1 OKF「受限/不对外」 | CLAUDE.md §0 |
| C9 | 高 | OKF/定位 | okf/README·index 生成物仍写「受限/非公开层·不对外发布」 | CLAUDE.md §0 |
| C10 | 高 | 定位 | README 受限层定位与 §0 公开定位互斥（与 C7 同源） | CLAUDE.md §0 |
| C11 | 高 | 定位 | decisions.md「当前有效」表 L49 残留「受限/非公开层」（与同表 L67 互斥） | decisions.md L67 |
| C12 | 高 | 定位 | active hub silver-blackpool-interface 仍标「受限层/访问受限」 | CLAUDE.md §0 |
| C13 | 高 | 定位 | **一致性校验脚本 C4 反向强制「受限/非公开层」为正确定位** | CLAUDE.md §0 |
| C14 | 高 | wiki 数据 | §5.1 称结构化层「随 #221 退役待重建」vs processed 已 72 角色投产 | processed/README |
| C15 | 中 | 分支政策 | §7.6「按派发用 feature 分支」vs methodology「feature 已废弃·直推 main」 | CLAUDE.md §7.6 |
| C16 | 中 | wiki 数据 | game/CONTEXT 启动清单仍把已清空的 `data/db/characters.json` 当 24/72 | 同文件 L40 |
| C17 | 中 | 采集架构 | COLLECTION_ARCHITECTURE 仍列 `collect_global.py` 独立步（已并入 aggregator） | decisions.md L122 |
| C18 | 中 | 采集架构 | 同档仍指 `report-system/scripts/collector.py`（目录已删除迁移） | pending-discussions |
| C19 | 中 | 数据层 | domain-modeling 技能术语示例把 `projects/news/data/` 钉为全量档案层 | CLAUDE.md §5.2 |
| C20 | 中 | 落点 | methodology 仍指令报告落 `deliverables/{YYYY-MM}/`（月目录已废） | CLAUDE.md §6.2 |
| C21 | 中 | OKF/定位 | okf/README 受限层定位（与 C9 同源，生成器硬编码） | CLAUDE.md §0 |
| C22 | 中 | OKF/定位 | okf/index.md L4 仍标「受限/非公开层」（生成器硬编码） | decisions.md L67 |
| C23 | 中 | 定位 | active hub 受限层标注（与 C12 同源，对 decisions.md L67） | decisions.md L67 |
| C24 | 中 | 退役子系统 | methodology 仍把「双集群+主控台+Code-*」多会话模型当现行 | project-status |
| C25 | 中 | 使命映射 | site/CONTEXT 自相矛盾：L7 称使命#2、L10 称三轴#3 | 同文件 L10 |
| C26 | 中 | 退役子系统 | **`session-end-distill.sh` 等 3 个 shell 壳仍存活** vs「连代码带数据删除」 | CLAUDE.md §1.4 |
| C27 | 中 | 定位 | 一致性校验**单测 fixture** 把「受限/非公开层」编码为合规样本 | CLAUDE.md §0 |
| C28 | 中 | wiki 数据 | project-status 称派生页随清空删除 vs 实测 59 个唤醒体页已生成 | generate_wiki_pages |
| C29 | 低 | 采集落点 | news/CONTEXT discord 落点仍写 `data/discord/` 旧布局 | CLAUDE.md §5.2 |
| C30 | 低 | 落点 | site/CONTEXT + deploy-site.yml 仍把 `deliverables/` 当部署源（死引用） | CLAUDE.md §6.2 |
| C31 | 低 | 人格 | erica.json 准用「您」vs Voice 语音正典只用「你」 | erica-speech-canon |
| C32 | 低 | 定位 | strategic-plan 双系统表仍述「受限信息层/不默认对外开源」 | CLAUDE.md §0 |

◇ ◇ ◇

## 二、断层 A — 银芯定位「公开 vs 受限」未同步翻新（11 条，最大簇）

**根因**：守密人 2026-06-21 裁定银芯**整层翻回「公开信息层」**（CLAUDE.md §0 + decisions.md L67），明确**覆盖** 2026-06-11「受限/非公开层」定位。CLAUDE.md §0 与 decisions.md L67 已更新，但下游 11 处仍停在被覆盖的旧定位，无任一标退役。

| 项 | 残留位置 | 现写 | 应改为 |
|----|----------|------|--------|
| C7/C10 | `README.md` L7 | 「2026-06-11 受限/非公开层」 | 公开信息层（§0 口径） |
| C11 | `memory/decisions.md` L49 | 「银芯（受限/非公开层）」 | 公开信息层 / 指向同表 L67 |
| C12/C23 | `memory/active/silver-blackpool-interface.md` L14/L24 | 「受限层 / 访问受限（06-11）」 | 公开信息层（06-21，覆盖 06-11） |
| C32 | `memory/strategic-plan-2026.md` L128/L139 | 「受限信息层 / 不默认对外开源」 | 加覆盖标注，指向 §0 |
| C8 | `CLAUDE.md` §6.1 L270 | OKF「银芯受限/非公开层…不对外发布」 | 公开层；分发选择与层定位解耦 |
| C9/C21 | `okf/README.md` L19-21 | 「银芯是受限/非公开层…不对外发布」 | 改生成器后重跑 |
| C22 | `okf/index.md` L4 | 「受限/非公开层，面向内部消费」 | 改生成器后重跑 |
| **C13** | `scripts/check_decisions_consistency.py` C4 L66-71 | **强制 CLAUDE.md 必含「受限/非公开」，否则报错** | 反转为强制「公开层」 |
| **C27** | `tests/test_check_decisions_consistency_unit.py` L42/L123 | **把「受限/非公开层」钉为合规样本** | 改为公开层样本 |

**最危险两条（C13/C27，已亲验源码）**：一致性护栏装反了。`check_decisions_consistency.py` 在 CLAUDE.md 不含「受限/非公开」时报 `C4 CLAUDE.md 未声明『受限/非公开层』定位`，并在 decisions.md 出现「公开层」时报错；其单测把「银芯定位为受限/非公开层」断言为唯一合规文本。后果：**谁把 CLAUDE.md 改成现行正确的「公开层」，反会被这套自检脚本判为违规、CI/自检失败**——护栏在主动 enforce 已被覆盖的旧裁定。

> 小学生比喻：上面发文「楼改名叫公开馆」，但门口的自动检查机器还设着「楼名必须写内部馆，否则报警」——你把牌子换成新名字，机器反而拉警报。修楼名之前得先把检查机器的标准答案一起改了，否则越改越错。OKF 那几处（C9/C21/C22）也别手动改成品，要改 `scripts/build_okf_bundle.py` 的硬编码模板再重跑，否则下次重生成又写回旧定位。

◇ ◇ ◇

## 三、断层 B — 全量档案层路径未随 2026-06-21 BPT 迁移更新（6 条）

**根因**：2026-06-21 社区全量 text 迁入 `Public-Info-Pool/Record/Community/`（discord 全量永驻 git），`projects/news/data/discord/` **已物理删除**（亲验：`No such file or directory`，`data/platforms` 仅剩 youtube_comments stub）。CLAUDE.md §4.1/§5.2 已更新，但 6 处运营入口仍指旧死路径。

| 项 | 残留位置 | 影响 |
|----|----------|------|
| C3 | `.claude/commands/biav-report.md` L5/L8-9 | **运行时**：照此跑报告会在死路径抽取 |
| C4 | `memory/methodology.md` L258-259 | 报告生产流程 SOP 指死路径 |
| C2 | `assets/data/chat-onboarding-snippet.md` L20-49 | 接入开场把死路径当「真实数据」 |
| C5 | `projects/news/GLOBAL_COLLECTION_SPEC.md` §3 L104-107 | 新增数据源「硬规则」登记旧路径 |
| C19 | `.claude/skills/domain-modeling/SKILL.md` L31-32 | 术语锐化范例钉旧路径为规范定义 |
| C29 | `projects/news/CONTEXT.md` L52-53 | discord 落点 `data/discord/` 旧布局 |

统一改法：全量档案层根 `projects/news/data/` → `Public-Info-Pool/Record/Community/`；discord → `Public-Info-Pool/Record/Community/discord/channels/{id_suffix}/{date}.jsonl`（注意紧凑 schema，读取须 `.get(默认)`）；平台 → `Public-Info-Pool/Record/Community/{platform}/`。输出展示层 `projects/news/output/` 不变。

> 小学生比喻：资料室整体搬到了新楼，旧屋子拆了。但「取资料怎么走」的操作手册、快捷指令、新人指南、登记规则里还印着旧屋门牌号——尤其 `/biav-report` 这条是给会话照着跑的，照旧牌子去就扑空。把所有「怎么找全量数据」的说明里的旧门牌统一换成新楼地址即可。

◇ ◇ ◇

## 四、断层 C — 使命#3 主对接子项目 site/game 混乱（2 条）

- **C6（高）**：CLAUDE.md §1.2（自动加载最高权威）把使命#3「Studio 团队 AI 协作训练场」主对接子项目改为 **site / 全局**；但 `README.md`、`strategic-plan-2026.md` L34、`active/mission-v2.0-three-pillars.md` L26 三处仍写 **game（备扩展位）/ 全局**。同一 v2.0 决策在权威入口与衍生档案间映射相反。
- **C25（中）**：`projects/site/CONTEXT.md` **同文件自相矛盾**——L7 称「site = 使命#2 社区共建知识底座对外门户」，L10 称「核心主线 #3（site/news/wiki 三轴之一）」。而使命#2 权威归属是 wiki。

权威侧：CLAUDE.md §1.2（site / 全局承使命#3）。建议把三处衍生档案的「game（备扩展位）」改为「site / 全局」，并厘清 site 的「门户/发现入口」语义 vs「使命#3 载体」语义。

> 小学生比喻：花名册第三栏，总册写「这格归小 site」，三本分册却都还写「归小 game」；而小 site 自己的简历上第一行写「我是二号项目」、第二行又写「我是三号主线」——自己都没记清自己是几号。

◇ ◇ ◇

## 五、断层 D — 采集架构陈述滞后（2 条）

- **C17（中）**：`projects/news/COLLECTION_ARCHITECTURE.md` L16/L54 仍把 `collect_global.py` 列为 workflow 独立步；2026-06-20「统一采集入口」裁定（decisions.md L122）已把它并入 `aggregator.py` 单入口（内部调 `collect_global.main()`），并删除独立步防重复采集。
- **C18（中）**：同档 L14/L75-76 仍指 `report-system/scripts/collector.py`；该目录 2026-04-11 已下线，采集器迁至 `projects/news/scripts/global_collectors.py`（pending-discussions L16）。

权威侧：decisions.md / pending-discussions（迁移裁定）。`COLLECTION_ARCHITECTURE.md` 整篇执行链需按现行单入口重述。

> 小学生比喻：工厂流水线图还画着两台独立机器和一间老车间，可老车间早拆了、两台机器也合成一台了。照旧图找设备会找不到。

◇ ◇ ◇

## 六、断层 E — wiki 数据状态陈述滞后（3 条）

2026-06-15 清空的是 **旧** `data/db/` 占位结构化层；新的 `data/processed/characters.json`（72 真实角色、一手解包字段、`confirmed_by` 分类）已落地投产，`generate_wiki_pages.py` 据此已生成 **59 个**唤醒体详情页（亲验目录存在）。但多处现行入口仍把整层描述为「待重建/已删除」。

- **C14（高）**：`CLAUDE.md` §5.1 L195 称「原结构化角色数据层随 #221 退役、待 W2 重建」——与 `processed/README.md`「72 唤醒体基线（已分类）」+ OKF 72 角色投产冲突。建议改为「旧 db/ 占位层已退役，新可信基线已在 processed/ 落地，W2 仅余收尾」。
- **C16（中）**：`projects/game/CONTEXT.md` L59 启动清单仍把已清空的 `data/db/characters.json` 当「24/72」资产——与同文件 L40 口径互斥。
- **C28（中）**：`memory/project-status.md` L92 称派生角色页随清空大幅缩减/仅 1 fixture——与实测 59 页生成冲突。

权威侧：`memory/project-status.md`（状态唯一权威）应先据实更新，CLAUDE.md §5.1 随之对齐。

> 小学生比喻：旧仓库（db/）的假样品全清掉了没错，但新仓库（processed/）已经摆满 72 件真货、还据此印了 59 张说明卡。可门口的告示还写着「角色资料已清空、正在重建」——把好消息瞒下了。

◇ ◇ ◇

## 七、断层 F — CI / 分支政策内部冲突（2 条）

- **C1（高）**：`CLAUDE.md` §7.6（2026-06-21）称「必需 CI `test` 检查**已撤**、改自查自合」；`docs/testing-strategy.md` §5（亲验 L121-145）仍称「2026-06-21 对 main **启用** ruleset 强制 `test`、合并须等 required check 转绿」，且反过来要求 §7.6 补「须等转绿」注脚。同日同事实、方向相反。权威侧 CLAUDE.md §7.6（自动加载层 + 后续撤检查裁定）。`testing-strategy.md` §5 整节需翻转为「required check 已撤、自查自合」。
- **C15（中）**：§7.6 称「本会话按派发用指定 feature 分支」，`memory/methodology.md` L84-85 称「feature 分支**已废弃**、所有会话直推 main」。需放宽 methodology 为「默认直推 main；守密人派发时可指定 feature 分支」，并请守密人对 `active/policy-direct-push-main.md` 自标的「待裁定」张力下达正式裁定。

> 小学生比喻：C1 像同一天贴了两张相反的门规——一张「考试取消、自己判卷合格就放行」，另一张「考试照旧、必须等成绩单出来才放行」；得认准新规（取消考试），把旧门规揭掉。

◇ ◇ ◇

## 八、断层 G — 退役子系统残留（2 条）

- **C26（中，已亲验）**：CLAUDE.md §1.4/§7.4 宣称蒸馏链「连代码带数据一并删除」「当前无任何会话生命周期钩子」，但工作树仍存活 `scripts/session-end-distill.sh`（4974B，6-28 仍在）+ `silver-mem-install.sh` + `silver-mem-deploy.sh`。Python 链已删、shell 壳未删——同步漏做。建议删除这 3 个惰性壳使文件系统与规范对齐。
- **C24（中）**：`memory/methodology.md` 行 25-40/186-196 仍把「双集群 + 主控台 + Code-* 多会话编排」与「按会话角色分派 Opus/Sonnet」当现行；现状已收归平台原生单会话（CLAUDE.md §1.4 第 3 条 / project-status）。建议在档首加退役横幅（参照 strategic-plan 行 3 做法）。

> 小学生比喻：通知说「旧机器连线带电源全拆了」，可墙角还挂着三根没拆的旧开关线壳；操作手册第一章也还在教「怎么调度那一排早就拆掉的机器」。线壳要剪掉、手册要标「本章已废」。

◇ ◇ ◇

## 九、断层 H — 死引用与人格细节（3 条）

- **C20（中）**：`memory/methodology.md` 行 261 仍指令报告落 `deliverables/{YYYY-MM}/`；§6.2 已废月目录、迁 `Public-Info-Pool/`。
- **C30（低）**：`projects/site/CONTEXT.md` L68/L93-95 + `deploy-site.yml` 仍把 `deliverables/**` 当部署源/触发路径（死引用）。
- **C31（低）**：`erica.json` L147 准用「您」，但 CLAUDE.md §2 钦定唯一权威 `erica-speech-canon.md`（一手 Voice.lua）对守密人统一用「你」，§2.1.2 也只列「守密人」。建议 erica.json 改「你」对齐正典。

> 小学生比喻：搬家后还有两张快递单写着旧地址（会寄丢），以及角色台词卡上称呼写得跟官方原声对不上（一个用「您」一个用「你」）——都是小修小补，但不改会偶尔出岔。

◇ ◇ ◇

## 十、已核验为「非缺陷」的 3 条（剔除，留档透明）

对抗式验证阶段拦下 3 条假阳性，确认**不是**矛盾：

1. **两个同名 `characters.json` 混淆**：狩猎手把 `data/db/`（已清空）与 `data/processed/`（72 真角色，实测 55KB）当同一文件，实为不同文件、不互斥。
2. **OKF 角色画师统一「巴拉巴拉」**：被疑为占位，但 72 文件 + processed 全体一致，「占位误导」一说指的是旧 db/ 层，与这些一手字段无关。
3. **72 基线 vs 58 可玩**：OKF `index.md` 已显式分层标注「全基线 72 / 正式可玩 58 / 未上线 14」，是分层语义而非矛盾。

此外，所有 Public-Info-Pool dated 快照、`memory/archive/`、`decisions-archive.md` 与现状不符之处，均按「点时快照/归档与现状不符属预期」规则正确归类为**非缺陷**，未计入 32 条（如归档层 MCP「9/11 工具」历史漂移、`black-pool-design.md` 旧方向描述等——除非被现行入口引用）。

> 小学生比喻：杠精环节专门防「把旧照片当成记错了」——这 3 条就是被正确识破的「其实没错」，留档是为了让守密人看清审计没乱报，连噪声都标清楚了。

◇ ◇ ◇

## 十一、审计方法论（可复现）

- **编排**：动态工作流 `md-consistency-audit`，68 智能体、621 工具调用、约 314 万 token、约 40 分钟。
- **Phase 1 抽取**：19 个读取智能体并行分簇，覆盖全部 300 个 md（数据巨档只取头部/计数/版本/数据层归属，dated 报告标记快照），产出 **744 条声明账本**（file + locus + topic + kind + as_of）。
- **Phase 2 狩猎**：14 条受控矛盾轴各派 1 狩猎手，审账本 + 自行 Grep 补漏，附逐字引用。
- **Phase 3 验证**：每条候选派对抗式验证者回读双方源行，按「日期新者为准 / 自动加载层为运行时权威 / 快照与归档非缺陷」规则裁定 `is_real`，默认怀疑。**35 候选 → 32 真 + 3 假**。
- **二次亲验**：5 条最高影响断言（C1/C2-C3/C7/C13-C27/C26）由艾瑞卡用 grep/ls 直接核源，全部属实（§4.2 R2：关键事实只从直接产出该事实的工具引用）。

> 小学生比喻：先派 19 人把所有文件里「写死的规矩和数字」抄成卡片，再派 14 个专项检查员各盯一条易出岔的规矩挑打架，最后每条打架派个杠精回原文逐字对、确认真打架还是看花眼；最关键那几条我自己又亲手翻了一遍原文。

◇ ◇ ◇

## 十二、建议处置

按可操作性与权限分两档（CLAUDE.md §3.1：决策档案仅守密人权限）：

**第一档 — 运营/工具层机械修（艾瑞卡可代办，待守密人放行）**：断层 B 全部路径更新（C2/C3/C4/C5/C19/C29）、采集架构重述（C17/C18）、死引用（C20/C30）、OKF 生成器硬编码 + 重跑（C8/C9/C21/C22）、shell 壳删除（C26）、一致性脚本/单测反转（C13/C27）、人格称谓（C31）、README 定位（C7/C10）。

**第二档 — 治理/决策档案（须守密人裁定或亲改）**：CLAUDE.md §1.2/§5.1/§6.1（C6/C14/C8）、`memory/decisions.md` L49（C11）、`strategic-plan-2026.md`（C32/C6）、`methodology.md`（C4/C15/C20/C24）、`project-status.md`（C28）、使命映射裁定（C6/C25）、分支政策裁定（C15）。

**优先级建议**：先处置 **C13/C27**（护栏装反，会阻断一切定位修正）→ **断层 B**（运行时死路径，影响报告生产）→ **断层 A 其余**（定位口径统一）→ 其余。

> 小学生比喻：修之前先把「装反的检查机器」调正，否则你改对了它还报警；再修「会让人撞墙的死路标」；最后统一换完所有旧门牌。

◇ ◇ ◇

## 十三、C6 处置：守密人裁定「取消使命#3」（2026-06-28）

C6 原为真值分叉：使命#3「Studio 团队 AI 协作训练场」主对接子项目，CLAUDE.md §1.2 写 **site/全局**、v2.0 决策 M4 + strategic-plan + mission hub 写 **game（备扩展位）/全局**。征询方向时**守密人裁定：取消这个使命**——不在 site/game 间择一，而是**退役整个使命#3**。

**落地（三新使命 → 二核心使命）**：

- **decisions.md**：新增「使命#3 退役 — 守密人 2026-06-28 裁定」当前有效决策，覆盖 v2.0 使命#3 及 M4 ⓐ 训练场定位（保留 game 为个人兴趣）。
- **CLAUDE.md**：§1.2 表头改「二核心使命」、删使命#3 行 + 退役注；§1.3「使命建设期」；§1.4 记忆层改「AI 协作底座」；§6 site 注释去「使命#3」。
- **README**：定位行去「AI 协作训练场」、使命列表收敛为二 + 退役注。
- **strategic-plan / mission hub（active）/ project-status / 各 CONTEXT / 贡献协议 / capability 注册表**：使命表、验收项、phase 标签、子项目自述全部同步为二核心；历史快照/版本日志/已完成工作记录按审计规则留存（hub 顶加退役横幅统辖）。

**C25**（site/CONTEXT L7 原误称「site=使命#2 载体」）已并修为「对外门户/三轴发现入口」（使命#2 载体权威为 wiki）。

> 小学生比喻：花名册第三栏「这活归谁」三本对不上——管事的（守密人）没在小 site / 小 game 里挑一个，而是直接说「这第三项活动取消」。于是整本花名册从「三项使命」改成「两项核心使命」，所有册子统一口径，那一栏的矛盾从根上消失了。
