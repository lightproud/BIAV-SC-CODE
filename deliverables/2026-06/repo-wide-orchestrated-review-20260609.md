# 银芯全仓动态编排审查报告

> **⚠ 定格交付物（2026-06-09 快照）**：文中文件/脚本路径反映当时仓库状态；其中自造记忆/做梦子系统（dream / memory_writeback 等）、`memory/dispatch-brief-*`、`data/db/` 结构化层等已于 2026-06 退役删除，相关引用按历史快照理解，不指向现行文件。

- **日期**：2026-06-09
- **执行方式**：5 个并行审查单元（动态编排），全程只读，未修正任何档案
- **覆盖范围**：83 个 Python 档案（约 23,300 行实读）、656 个 Markdown 档案（核心文档全读 + 生成层抽样 + 全仓程序化扫描）、19 个 CI workflow、.claude 钩子层
- **发现总数**：73 项（去重后归并为下表），其中高严重度 9 项

---

## 一、总体结论

代码层整体健康度中上：共享模块收敛良好（io_utils / text_utils / lua_parse 均带回归测试）、防御性异常处理普遍、workflow 脚本引用零断链、wiki frontmatter 与仓内链接零错误。但存在三类系统性问题：

1. **两条流水线处于「必然失败」状态**（check-version 每周必挂、dream 深睡因缺失导入必崩），且都在健康监控盲区之外
2. **数据完整性隐患集中在采集与统计层**（密钥可泄漏日志、4 个采集源时间戳失真、Discord 统计可重复累加、meta.json 误删）
3. **文档层 2026-04-26 后大面积漂移**（project-status / VERSION / 各 CONTEXT 与实际状态多点矛盾，active hub 卡引用的 CLAUDE.md 章节号全部失效）

---

## 二、高严重度发现（建议优先派单，按危害排序）

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| H1 | `scripts/dream.py:120,166` | 使用 `write_text_atomic` 但从未导入（AST 验证）。深睡 CI（dream.yml:269 无 continue-on-error）在 Phase 3 直接以 NameError 崩溃；boot-snapshot.md 实际从不更新（异常被静默吞掉） | 补 `from io_utils import write_text_atomic`（同 fact_store.py:28 写法） |
| H2 | `scripts/memory_writeback.py:348-350` | 清理 glob `*.json` 误匹配 `.meta.json` 记忆飞轮数据（memrl / dream_rem 核心输入），超 50 个即 unlink。gitignore 运行时数据，删了无法恢复 | glob 排除 `*.meta.json`，并补一个 glob 断言测试 |
| H3 | `projects/news/.../aggregator_collectors.py:1364`、`global_collectors.py:356`、`backfill_gap.py:229` | YouTube API key 在 URL 查询参数中，requests 异常字符串含完整 URL 被 logger 原样打印进**公开仓库的 Actions 日志**；data_quality.py:215 还把 error 片段写入会提交进 git 的 source-health.json | 统一异常脱敏函数（正则掩码 key/token/cookie）后再记日志 |
| H4 | `projects/news/.../global_collectors.py:706,655,1042,1089` | arca/naver/zhihu/bahamut 四源写入非 ISO 时间戳 → `_is_recent` 解析失败**永久静默丢弃**（HTTP 路径全灭），归档层回落「今天」造成全量档案日期失真（违反 §4.1） | 将 playwright_collectors 已有的 `_parse_relative_time` 提入 news_common 统一复用 |
| H5 | `projects/news/.../discord_archiver.py:309-321,764-787` | 消息写入有按 ID 去重，但 activity_daily 统计无条件累加且与既有文件做加法合并——任何重复抓取都使计数膨胀。该文件是 §5.2 钦定的每日纯统计消费源 | `_write_msg` 返回「是否新写入」，仅新消息计入统计 |
| H6 | `projects/wiki/scripts/check_version.py:139,145` + `generate_rss.py:35` | 裸 `open()` 读取从未入库的 `data/db/versions.json` / `meta.json` → check-version.yml 每周一排程**从未可能成功**，且不在 dream 健康监控名单内（长期不可见） | 补齐种子 JSON 或缺档软降级；监控名单补入 |
| H7 | `.github/workflows/dream.yml:284,377` | deep/rem 层 `needs: shallow-sleep`，手动 dispatch `layer=deep/rem` 时 shallow 被 skip → 依赖 job 连带 skip。只有 all/shallow 实际可跑 | if 条件加 `!cancelled() &&` 前缀或去掉 needs |
| H8 | wiki 生成层（`projects/wiki/docs/{zh,en,ja}/awakeners/*.md` 约 69 页） | characters.json 中 23/24 角色 realm/role/name_en 为 null，模板回退输出「混沌属性输出角色」假事实 + 「卡茜亚（卡茜亚）」式复读；en/ja 页全用中文名且为无导航孤儿页 | 模板对 null 省略输出；译名补齐前 en/ja 暂缓发布 |
| H9 | `projects/news/.../aggregator.py:217,246` + update-news.yml | 失败 `SystemExit(1)` 使后续归档/提交步骤全部跳过——成功源数据随 runner 销毁丢失。§4.2 R1「暴露失败」与「保全数据」互斥 | 失败写哨兵文件，由 workflow 末尾独立步骤标红 |

---

## 三、中严重度发现（按扇区归并）

### 3.1 顶层脚本（scripts/）

- `parse_awaker_config.py:30-38` 未迁移共享 lua_parse，仍含 SCR-01 同类正则缺陷（不支持转义引号、依赖 4 空格缩进），是三个姊妹脚本迁移后的遗漏项
- `session_briefing.py:113-115` 哨兵告警窗口注释 48 小时、实际只取当天——UTC 凌晨开会话漏报昨晚 red/orange 告警
- `boot_snapshot.py:104-117,136-144` 生成模板硬编码过期事实（Phase 1 表述、780 行、直推 main 政策），每 6 小时重新生成却永远过期
- `extract_art.py:76-82` 死代码（`if False` 恒假分支 + 空循环）
- `dream_ai.ai_trend_analysis` 为空 stub，dream.py:198-209 调用分支永不可达且打印误导信息
- `knowledge_graph.py:642-644` 注释断言错误，`_name_index` 存在被持久化为陈旧索引的隐患
- `mcp_server.py` fallback 工具清单 8/16 漂移、dedup 阈值文案 75% vs 实际 0.65

### 3.2 news 采集层

- `taptap_collector.py:643-655` 增量游标条件恒假，永不前进；两套 TapTap 采集器 APP_ID 互相矛盾（364992 vs 233553），且 taptap_post 同时被 sources.py 标为 LEGACY——单一真相源与产线行为自相矛盾
- data/platforms 写入路径三套实现、去重键互不兼容（archive_platforms / backfill_platforms / backfill_gap）→ 跨工具重复条目
- `backfill_platforms.py` 多 keyword 共用分页游标 → 漏页
- `collect_fanart.py:51-64` 裸 urllib 下载绕过 SSRF 守卫（SEC-02 收敛漏网）
- `archive_platforms.py:75` news-raw 缺失时回退读窗口化 news.json 当全量源（混层）；source-health.json 写进 output/ 展示层（语义混层）

### 3.3 wiki 与自动化

- `fetch-wiki-data.yml:140` 与 `check-version.yml:60` 收尾裸 push 无 rebase 重试（仓库有 4 个每小时推 main 的机器人，non-fast-forward 必现）
- `fetch-wiki-data.yml:108` 防腐守卫核对的三个 JSON（skills/equipment/combat）根本不存在，真实存在的六件反而不在名单——防腐形同虚设
- `[skip ci]` 政策双向矛盾：check-version 提交无 skip 连带触发部署，fetch-wiki-data 带 skip 反而使新页面延迟部署
- 18:00 UTC 三个 workflow 同分起跑同推 main，建议错峰
- `update-notices.md`（2.1 MB）含 121 处未剥离的原始 JSON 元数据 + 字节级乱码截断，提取管线需重跑并加 UTF-8 校验
- `jenkin_duplicate_15593` 内部数据 bug 标记泄漏为三语公开页面 slug，立绘必然 404

### 3.4 文档层（核心档案漂移）

- `memory/project-status.md`（停在 04-26）：同文件自相矛盾（55 行 vs 21 行 characters.json 基线）、update-news 频率口径错误、引用不存在的 generate-report.yml、列出 3 个不存在的 wiki 脚本——建议整文件按 sync-memory 流程重写
- `assets/data/VERSION.md`：死链接 task-wiki-data-audit、「~63 角色」与全仓 72 口径矛盾、v0.9 自述与 project-status「v1.0 完成」互斥
- `projects/wiki/CONTEXT.md`：前后自相矛盾（顶部说批 1 完成、69/83/154 行仍说 data/db 未建立）+ 2 处死引用（content_db.py 不存在、character_data.txt 路径错误）
- `memory/active/` hub 卡引用的 CLAUDE.md 章节号在 05-19 入口架构反转后**全部失效**（policy-direct-push-main 引用的「§1 直推 main」条文已不存在）——lesson #29 同款模式
- `decisions.md`（最高权威）缺 2026-05-10 卡帕西 4 原则采纳条目——决策日志与执行档案脱节
- CLAUDE.md §8.2「18 个 workflow」实际 19 个（漏 collect-comments、recover-fanart）；§5.2「17 目录」实际 18；README「32 条踩坑」实际 33（且 lessons-learned 存在两个「## 21.」重复编号）
- `projects/news/CONTEXT.md`：脚本清单 7/24、「29 个采集器」实际注册 20、M1 已完成项仍列待办；site/game CONTEXT 同样停在 04-26

---

## 四、横切问题

### 4.1 emoji 禁令（§2.4 硬约束）执行情况

全仓扫描（排除 session-digests 与 extracted_lua）检出约 14 个文件含图形类 emoji：

- **明确违例**：`memory/morimens-context.md`、`memory/dispatch-brief-D-fix.md`、`.claude/commands/biav-report.md`、`scripts/dream.py:362`（月亮符号打印）、5 个 workflow 的 `name:` 字段、claude.yml 失败评论模板
- **待守密人裁定**：deliverables 中社区评论转录内的 emoji（saya-collab 报告 60+ 处）是否豁免；memory 工作档案约 50 个文件的 ✅❌⚠ 类符号是否按字面禁令执行；wiki 数据页 ☆♪ 来自游戏原文建议视同 extracted_lua 豁免并在 style-guide 注明

### 4.2 测试覆盖缺口

已覆盖良好：text_utils / lua_parse / dream 纯函数 / collect_global 编排（§4.2 R1 回归）/ wiki 页面映射。

完全无测试的高危模块（按补测优先级）：

1. `dream.py` 编排层——一次 `--full` 冒烟测试即可拦截 H1
2. `silver_memory_tools.py`——直接改写 decisions.md（最高权威档案）的插入逻辑，最该有测试而完全没有
3. `memory_writeback.py`——一个 glob 断言测试即可拦截 H2
4. `parse_awaker_config.py`——迁移 lua_parse 后自动复用现有回归测试

### 4.3 重复逻辑收敛点

- 相对时间解析 4 处复制（playwright / weibo / yt / taptap）→ 应入 news_common（与 H4 同一次修复）
- `refresh_discord` 在 backfill_media 与 collect_fanart 几乎逐字重复
- 路径锚定两套约定并存（`__file__` 锚定 vs CWD 相对），解包/生成脚本必须从仓库根运行否则静默写错位置
- config.mts nav 与 sidebar 五组条目逐字重复

---

## 五、通过项（无需动作）

- workflow 引用的 29 个脚本/记忆档案逐一核对全部存在，零断链
- wiki 159 页 frontmatter YAML 解析 0 错误；仓内绝对路径 md 链接 0 断裂
- memory/research + strategy 10 份档案结构完整，0 处 TODO/TBD 残留
- 钩子层核验通过：session-end-distill 有递归防护、session-start-sync 硬重置前有备份、session_watch 异常静默不阻塞
- `validate_data.py` 三段式校验逻辑正确且缺档软降级；16 个 wiki Python 档案全部通过编译
- news 双层数据分离总体合格：data/ 与 output/ 写入职责清晰，news-raw 未过滤产物符合 §4.1

---

## 六、建议派单顺序

1. **本周内**：H1（一行导入）、H2（glob 修正）、H3（密钥脱敏）——均为小改动高危害
2. **下一派发**：H4+时间解析收敛（news_common 统一）、H5（统计去重）、H6（check-version 解封 + 监控名单补入）
3. **第三批**：H7-H9 + wiki 生成模板 null 处理
4. **文档同步专项**：project-status / VERSION / 三个 CONTEXT / active hub 卡一次性按 sync-memory 流程重写（对应第三节 3.4 全部条目）
5. **守密人裁定项**：emoji 豁免范围（4.1 节三类）、TapTap APP_ID 哪个是真、en/ja 页面是否暂缓发布
