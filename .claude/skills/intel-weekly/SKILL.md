---
name: intel-weekly
description: Generate the Morimens weekly community intelligence report (社区情报周报) from the full archive layer. Use when asked for the weekly report, 周报, community intel digest, or a windowed community summary. Produces a fixed-skeleton Chinese report (trend + role routing + business topics with embedded risk sentinels + bug list + player request list + credited fanart gallery + volume map) rendered as mobile PDF in brand themes.
---

# Morimens 社区情报周报

目的：把一周社区归档压成**同一过程、可复核**的周报。骨架、口径、引用纪律全部固定；
每期只有内容变。骨架范例见 `example-20260712.md`（首期定稿，结构即模板），采掘机制与坑见 `reference.md`，
常设风险哨兵清单见 `sentinels.md`（哨兵增删只改该文件）。

## 硬口径（每条都是门禁）

1. **数据层**：只用全量档案层 `Public-Info-Pool/Record/Community/`，禁用
   `projects/news/output/` 选样层充全量。
2. **双时间轴**：平台条目一律按 `time`（发布时间，换算 UTC+8）统计并按 `url` 去重；
   「窗口内被采集」≠「窗口内发布」，窗外发布的重采旧内容不计入本周信号，仅在多日快照
   可证明「窗口内热度增长」时引用并注明快照日期。Discord 按消息 `timestamp` 切窗。
3. **信度三级**：A 硬事实可复算 / B 多源归纳 / C 推断（单源、需核实——C 必须显式标注原因）。
4. **引用就地**：每条结论附出处·原文短引·可点链接（Discord 消息链接构造法见 reference §3）；
   C 级无原文可锚定即为其含义。
5. **单一出现原则**：每条信息全文只出现一次，其余位置用编号指针（T=话题 / B=故障 / R=需求）。
6. **定稿面貌**：文档内禁止任何版本修订注释（「相对上一版」「rN 修正」）；差异只进对话汇报与
   commit message。
7. 全文 UTC+8；不用 emoji；不提内部代号，说「国际服/日服/国服」。

## 过程

### 1. 定窗与量化骨架
窗口默认上周六至本周六（UTC+8）。产出：三服 Discord 逐日 消息数/发言人数（`activity_daily`）、
热频道排行、15 平台窗口内发布去重条数、Steam 窗口好评率（URL 去重 + 发布在窗）。
**完成判据**：每个数字都能给出「哪个文件、什么口径」的一句话复算路径；归档非全天的日期已标注。

### 2. 趋势对比
近 13 周：Discord 周消息量 + Steam 周好评率（计算法 reference §4）。给出①声量②口碑两条解读，
声量解读必须区分「消息量」与「发言人数」（话少了 vs 人走了）。
**完成判据**：本周相对上周环比与三个月定位各有一句结论。

### 3. 精读与扫描
必读全文：official-q-a、game-announcement、한국어-채팅방、志愿者服全频道、日服 top 频道抽读；
全服关键词扫描组：哨兵各一组 + 故障 + 货币化 + 当期事件词（组内正则见 reference §2）。
命中后**人工读原文剔噪**（error≠terror 类同形词）。
**完成判据**：`sentinels.md` 中每个哨兵都有判定（命中+等级，或明写「无信号」——缺席也是信息）；
官方状态标签（Processing/Resolved/Answered）已逐条过。

### 4. 成文
按 `example-20260712.md` 骨架填充。业务话题固定六类：本体体验 / 内容（剧情美术音乐）与本地化 /
商业化 / 品牌宣传·周边 / 拉新与发现性 / 同人产出与社区生态——哨兵详情内嵌到所属话题小节，
无信号的子项也要一句明写。职能路由表按组织架构：制作人；内容线=战斗/文案/美术/音乐；
工程线=系统/数值/前后端/UX/QA；发行端=运营/投放/社区/周边。
**完成判据**：全文自查无信息出现两次（哨兵素材只在 T 节、清单项只在 B/R 表）；
每个职能行都有编号指针；Bug 表含官方状态列；需求表每项有出处+信度+对口职能。

### 5. 同人图册（署名强制）
Discord 图取当月 Releases `fanart-archive-{YYYY-MM}.tar.gz`；选集规则：同人创作频道来源 +
≥600px 静态原图 + **每作者至多 2 张**；**每张必须署作者名**（附件 id 反查法 reference §5，
查不到用「…id 尾号」并说明）。站外（pixiv/Reddit 等）窗口内新发作品列表格：平台/日期/作者/直链。
异体装饰符号（`˚✧₊` 等）会撞崩字体子集化，入文前清洗（reference §6）。
**完成判据**：嵌入图全部有署名；站外清单覆盖窗口内全部去重新发（或注明截断数量）。

### 6. 渲染与交付
落点：`python scripts/deliverable_path.py path --type intel-weekly --topic morimens-intel --date YYYYMMDD --ext md`。
渲染：`python scripts/report_render.py <md> --mobile --theme dark`（乳白金加 `--theme cream`）。
渲染后像素自检：溢出行=0、冷蓝像素=0、链接数符合预期、抽页目检（不可用时按 style-guide 像素兜底法）。
**完成判据**：md + 双主题 mobile PDF 三件产出且自检全绿；向守密人汇报时附本周「唯一待拍板项」
（若无则明说无）。

## 演进

骨架/口径改动须守密人裁定；哨兵增删直接改 `sentinels.md` 并在对话中报备。
本技能提炼自 2026-07-12 首期周报的两轮实战反馈，方法论细节以 reference.md 为准。
