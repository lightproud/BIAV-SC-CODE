# 归档数据完整性审计（2026-07-29）

- **审计执行**：艾瑞卡（会话内实测，非引用旧报告）
- **数据层**：全量档案层（BIAV-SC-DATA 数据仓 `fe356be` 浅克隆，经 `BIAV_SC_DATA_ROOT` 挂载）——非输出展示层（§4.1 数据纪律已确认）
- **审计对象**：`Record/Community/` 全量档案（discord 三区服 + 17 平台目录）、冷热分层、频道索引、采集链路 26 个定时工作流
- **总判定**：**已归档数据本体完好（物理层零损坏）；采集链路 26 件中 24 件绿，1 件真停摆（backfill-media，38 天，根因已定位到行）；结构层 3 处待修整**

---

## 一、物理完整性：全绿

| 检查项 | 范围 | 结果 |
|---|---|---|
| 冷层 gzip 完整性（`gzip -t` 全量试解压） | 18,393 个 `.gz` | **0 损坏** |
| 热层 JSONL 逐行解析 | 2,565 文件 / 1,150,452 行 | **0 解析失败** |
| discord 紧凑 schema 六恒留字段（`id`/`channel_id`/`author_id`/`author_name`/`content`/`timestamp`） | 全部热层 discord 行 | **0 缺失** |
| 平台 `.json` 可解析性 | 1,496 文件 | **0 失败** |
| 数据仓规模 | 22,459 文件 / 1.1 GB（浅克隆工作树） | 与预期一致 |

> 比喻：把仓库里每个罐头都开罐验了一遍——没有一罐是坏的，标签也没有一张脱落。

## 二、时序完整性：60 天窗口 247 个日期缺口（15 平台），须分两类看

`repair_gaps.py --dry-run` 实测（默认近 60 天窗口），与仓内 `projects/news/data/gap_report.json`
（16:22 UTC 由 update-news 自动生成）完全一致——断档检测器本身在正常值班。

**甲类：采集停摆（连续大段缺口 / 尾部沉默，须处置或裁定）**

| 源 | 事实 | 定性 |
|---|---|---|
| bahamut | 39 连续日缺（05-31 → 07-08）；目录仅 30 文件，2024 年 2 个零星旧档后直接跳到 2026-07-09 | 采集器 07-09 才上线/复活，此前**本就无采集**——是「望远镜后架的」，不是数据丢了 |
| weixin | 最后归档 07-18，沉默 12 天（降级）；窗口内 33 缺日、尾部渐稀 | 采集侧衰减，需查 weixin 采集路径是否被风控 |
| arca_live | 最后归档 07-11，沉默 19 天（降级）；目录仅 10 个日档 | 同上，采集器疑似停摆 |
| appstore/jp 叶 | 最后 07-23，沉默 7 天（叶级告警阈值 7d） | 观察线上，可能日区评论确实断流 |
| twitter | 审计窗口 1,126 天**零产出**，目录不存在 | 注册了源、从未有采集产出（API 墙），属「注册表挂名」 |

**乙类：低量源的自然空日（当日无内容，非丢数据）**

official（=`steam/global/news` 折叠布局，48 归档日仅 347 条）、appstore（~3 条/日）、note_com、
taptap、taptap_review、ruliweb 等的零散缺日与其内容密度相称；archiver 设计上**不写空日占位文件**
（避免虚增覆盖率），故「缺日期文件」≠「丢数据」。

**总体节拍**：21 注册源中 18 个活跃（最新归档 07-29/07-30）、2 个降级（weixin / arca_live）、1 个从未产出（twitter）。

> 比喻：点名册上有空格，要分清是「学生逃课」（甲类，要管）还是「那天本来就放假」（乙类，不用管）。

## 三、结构完整性：3 处待修整（均有现成工具/明确修法）

1. **discord global 区服 16 个孤儿目录**：目录 587 个，索引在册 641（含 offline），16 个归档目录
   未登记进 `channel_index.json`。`discord_reconcile.py --dry-run` 实测可合并登记 641→657，
   ID 均可从 JSONL 恢复、零不可恢复项。jp / volunteer 零孤儿。
   > 比喻：图书馆多了 16 箱书没录进借书目录——书都在，补录一下就能查到。
2. **平台侧冷压残留 24 待压 + 509 待并轨（合计 1.5 MB）**：`community_cold_compress.py --dry-run` 实测
   （appstore 23+176、google_play 0+287、ruliweb 0+32、weixin 1+10、bahamut 0+4）。discord 侧零残留、
   完全合规。成因是回填/迟到写把旧月份文件落在了月度压缩（每月 2 日 CI）之后，**下一轮 08-02 例行
   CI 会自动收编**——属节拍内滞后，非失灵；唯 8-02 后应回看确认清零。
3. **`unpacked-assets` / `community-data` Release 三张抢救网**：本次为容器内审计，Release 二进制未逐包
   校验（云容器只读 + 体量原因），仅核对 `RELEASES.md` 藏宝图在册。§6.3 三张网的逐包校验建议另派专项。

## 四、采集链路健康：26 个定时工作流，24 绿 2 红——两红是同一件事

死手开关 `status.json`（10:19 UTC）实测 26 件全部可判、无失明，发现 2 项：

1. **backfill-media.yml：真停摆 38 天（最后成功 2026-06-21，524 次运行史）。根因已定位到行**：
   `.gitignore` 第 76 行 `projects/news/data/media/`（1.3.0 审计第 15/16 波 #876 引入的整目录忽略）
   挡住了工作流末步 `git add projects/news/data/media/backfill_manifest.json`——git 报「路径被忽略」
   退出码 1，`bash -e` 下整个 job 判败。**媒体下载与 Release 上传本体步骤在此之前已跑完**，败在
   台账落档这最后一步；影响是 manifest 不推进 → 每轮重复劳动 + 心跳永远红。
   修法（三选一，见待裁项）：`git add -f`；或 `.gitignore` 加反排除 `!projects/news/data/media/backfill_manifest.json`；
   或 manifest 移出被忽略目录。
   > 比喻：快递员每天照常送完所有包裹，但签收本被锁在柜子里签不了字，于是系统天天记他旷工。
2. **dead-man-switch.yml：4 次运行全红是「警报在响」，不是「警报器坏了」**——设计上有 STALE/NEVER
   发现即 `exit 1`（status.json 在判红前已正常落档）。其中「自己 NEVER」是自指悖论：它把自己也列入
   看守名单，而只要任何发现存在它就 exit 1、永远攒不下第一次 success。backfill-media 修复转绿后，
   下一轮它自身也随之转绿，无需单独处置。
   > 比喻：烟雾报警器一直响是因为厨房真的在冒烟；它顺带把「我从没安静过」也记了自己一笔——烟散了它自然就安静了。

## 五、既有监测器自检（这次审计顺带验了「验数据的工具」本身）

- `repair_gaps.py`：2026-07-02「扫空屋失明」已修复——本次带数据根实测 247 缺口与 CI 落档报告一致，
  且带 SCAN_STATS 防「零缺口 vs 零覆盖」混淆；
- `dead_man_switch.py`：26/26 可判、unknown=0，无失明；
- `discord_reconcile.py`：dry-run 语义正常，孤儿可全量恢复登记；
- `community_cold_compress.py`：幂等 + dry-run 正常，discord/平台双轨均可判。

## 六、待裁项（已按 §2.2.4 逐个交互呈报守密人，2026-07-30 北京时间凌晨全部裁毕）

1. backfill-media 修复 → **守密人裁定改案：manifest 应放数据仓**（高于三个候选案）；
2. discord global 16 孤儿目录 → **裁定执行补录并推数据仓**；
3. weixin / arca_live 降级源 → **裁定派专项排查**；
4. twitter 挂名源 → **裁定从注册表摘除**。

## 七、裁定执行回执（2026-07-30）

1. **manifest 迁数据仓（已落盘）**：`archive_layout.media_manifest_path()` 新增为单一真相源
   （`<pool>/Record/media/backfill_manifest.json`），`backfill_media.py` 改经其解析并保留旧址
   只读回退（一次性迁移兜底）；`backfill-media.yml` 末步改为在 data-repo 内 commit + push
   （同 update-news 已验证的 PAT 推送形态），checkout 不再需要回推密钥。下一轮定时（每日
   北京 16:40）即可验证转绿；转绿后 dead-man-switch 的两项发现将同时消失。
2. **discord 孤儿补录（已执行并推送）**：`discord_reconcile.py` 实跑，global 区服索引
   641→657、16 个孤儿目录全部恢复登记（ID 均从 JSONL 回收、零不可恢复）；复核 dry-run
   报孤儿 0。数据仓提交 `76550792`。
3. **weixin / arca_live 专项排查（已定性）**：
   - **arca_live：GitHub Actions 机房 IP 被封**。最近一轮 CI 实录：HTTP 直采 403
     （`arca.live/b/forgettingeve` best/latest 双模式），Playwright 后备 `.vrow` 选择器
     20 秒超时（挑战页拦截）；而本会话容器出口实测同 URL 返回 **200**——封锁面是
     runner IP 段而非全面反爬。窗口可回补（`backfill_platforms.py` 支持 arca_live，
     帖子持久），修复方向须守密人裁预算：换出口（自托管 runner / 代理）或降频换 IP 池。
   - **weixin：采集器活着，搜狗在喂旧文**。今日轮实采 +20 条且正常归档，但全部条目
     内容日期 ≤2026-07-18——搜狗微信搜索 12 天只回旧结果（风控降级喂缓存的典型形态；
     此前密度 ~134 条/日，骤停为零不像自然断流）。属源站侧软墙，管线无故障；
     可选对策：换检索词组合 / 带登录态 cookie / 接受降级站岗。
   > 比喻：arca 是大楼保安只拦快递公司的车、私家车照进；搜狗是报刊亭还开着门，
   > 但架上摆的全是上周的报纸。
4. **twitter 摘除（已落盘）**：`KNOWN_SOURCES` / `SPARSE_SOURCES` / `REGION_APPS` 三处
   摘除 + `collect_global` 编排拔线；`fetch_twitter` 保留 `global_collectors`（经
   `TWITTER_HANDLES` 环境变量可手动唤起），句柄→区服映射内聚该模块；零条目的
   `twitter-latest.json` 删除，OKF bundle 同 PR 重建（twitter 概念退役、指针不悬空）。
   合并前门禁全绿（默认 + `--sparse`，3,284 项测试通过）。

**新增观察项**：`tests/test_discord_archiver*` 三用例在 `BIAV_SC_DATA_ROOT` 设定时被真实
数据湖顶掉夹具而误红（CI 的 test 作业不设该变量故不触发）——测试隔离缺口，建议后续给
这三用例 monkeypatch 数据根。原观察项（冷压残留待 08-02 收编、appstore/jp 叶沉默）继续站岗。
