# 战略评估

> 最后更新：2026-04-01 by 战略中心（Code）— 含制作人身份校准
>
> 基于仓库实际文件状态的全局判断。不猜测，只看事实。
>
> 每月 1 日更新。下次更新：2026-05-01。

---

## 一、各管线运行状态

### 1. News 新闻聚合（update-news.yml）— 在跑，有数据质量问题

- **触发频率**：每小时 cron
- **实际产出**：日报连续 3 天生成（03-30、03-31、04-01），aggregator 有稳定 commit
- **数据源实际命中**：仅 Bilibili + Steam 有数据。其余 7 个（Discord/NGA/Reddit/Twitter/YouTube/TapTap/Official）全部沉默（0 条）
- **关键 bug**：Steam 评论数据未经标准化——`steam-latest.json` 中 7 条 item 缺少 `source`/`title`/`url`/`author`/`time` 字段，仍是 Steam API 原始结构（`language`/`voted_up`/`review`/`timestamp_created`）。最新 commit `b34a474` 声称修复了 `extract_steam_item()`，但 output 文件中仍是旧格式，说明修复尚未生效或 workflow 尚未重跑
- **日报质量**：格式正确，但内容单薄。04-01 日报仅 1 条 Bilibili 视频。大多数平台标记为"沉默"，实际是未接通
- **结论**：管线骨架在跑，但有效数据源仅 2/9。离"日报连续 7 天无人干预"的 Stage 1 标准有差距——不是管线不跑，是跑了也没东西

### 2. Discord 归档（discord-archive.yml）— 在跑，体量快成问题

- **触发频率**：每小时 cron
- **实际产出**：537 个频道目录，state.json 追踪正常，每日有增量 commit
- **数据体量**：`assets/data/discord/` 已达 **299MB**，其中 `channels/` 占 291MB
- **风险**：按当前增速（单日 commit 含数千行 JSONL），60 天滚动窗口 + Releases 归档机制**尚未实现**。如果不在 1-2 周内上线归档清理，仓库将突破 500MB→1GB
- **结论**：采集正常，但存储治理是定时炸弹

### 3. Wiki 站点（deploy-site.yml）— 已部署，基本稳定

- **部署方式**：push to main → 构建 VitePress → 推 gh-pages 分支
- **内容规模**：189 个角色详情页（63×3 语言），11 个 Vue 组件，21 个数据 JSON
- **数据体量**：`wiki/data/db/` 仅 396KB，健康
- **已修复历史问题**：cleanUrls、img src 动态绑定、YAML 冒号转义、npm script 名
- **结论**：站点管线稳定。数据补全是下一步重点

### 4. Wiki 数据抓取（fetch-wiki-data.yml）— 定期跑，但 continue-on-error 掩盖失败

- **触发频率**：每周一 04:00 UTC
- **7 个抓取脚本**：portraits / skills / cards / stats / stages / wheels / lore
- **风险**：所有步骤设置了 `continue-on-error: true`，单个脚本失败不会阻断 workflow，也不会有任何通知。数据可能悄悄缺失
- **结论**：需要加失败告警机制

### 5. 游戏数据解包（extract-game-data.yml）— 反复失败，未成功过

- **触发方式**：推送 `.github/triggers/extract-game-data` 文件
- **历史**：3 月 31 日到 4 月 1 日连续 4 次 re-trigger（含换 Steam 账号、修 secrets、quote 密码），均指向反复调试
- **依赖**：STEAM_USER + STEAM_PASS（需要有效 Steam 账号）
- **结论**：pipeline 设计完成，但从未成功执行过。阻塞项是 Steam 认证

### 6. 数据校验（validate-data.yml）— 存在但极简

- **触发**：push to wiki data + PR
- **内容**：仅运行一个 `validate_data.py`，无 schema 验证细节，不阻断合并
- **结论**：形式上存在，实质保护不够

### 7. 报告系统（generate-report.yml）— 设计完整，实际无法运行

- **设计**：15+ 平台采集 → AI 分析 → 多渠道通知（Email/Discord/Telegram/Bark）
- **依赖**：25+ secrets，LLM API Key
- **现实**：绝大多数 secrets 未配置，ANTHROPIC_API_KEY 余额为零
- **结论**：蓝图级别，距离运行差很远

### 8. Claude Code Actions（claude.yml）— 触发链通，执行不了

- **设计**：Issue 驱动自动化，author:lightproud 触发
- **阻塞**：ANTHROPIC_API_KEY 余额为零
- **结论**：充值即可激活

### 9. 版本检测（check-version.yml）— 应该在跑

- **触发**：每周一 06:00 UTC
- **功能**：检测 Steam API 版本号变化 → 自动创建 Issue
- **结论**：低风险，正常运转

### 10. 主站导航页（projects/site/）— 已部署

- **内容**：单页 HTML 导航 + design system v1.0
- **结论**：功能完成，低维护

---

## 二、Stage 1 验证进展

**验证标准**：日报连续 7 天自动生成，无人介入。

| 指标 | 状态 | 说明 |
|------|------|------|
| 日报管线连续运行天数 | **3 天**（03-30 → 04-01） | workflow 稳定触发 |
| 日报内容质量 | **不合格** | 9 个数据源中仅 Bilibili 有实质内容，Steam 数据格式错误，其余 7 个为零 |
| 无人干预 | **部分达标** | 管线自动跑了 3 天无需人工。但 Steam 数据 bug 需要人修 |
| Steam 采集 | **有数据但格式错** | 评论能拉到，但未标准化为统一 schema |
| Discord 采集（聚合器通道） | **沉默** | 归档在跑（archive.yml），但聚合器侧（update-news.yml）未接入 Discord 数据 |

**判断**：Stage 1 验证 **未通过**。管线骨架运转，但数据丰富度和质量不够。"连续 7 天"的计时器应在内容质量达标后重新开始计。

---

## 三、技术债

### P0（影响正在运行的系统）

1. **Discord 归档体量失控**：299MB 且无归档清理机制。decisions.md 中决策的"每月 1 日归档到 Releases + 删除 git 中旧数据"**尚未实现**。再等 2 周将严重影响 clone/push 速度
2. **Steam 评论数据未标准化**：`split_output.py` 或 `aggregator.py` 中 Steam item 未经 schema 转换就写入 output，日报生成脚本因此标记 Steam 为"沉默"（格式不匹配导致被跳过）

### P1（影响验证进度）

3. **聚合器 Discord 通道未接入**：归档系统（discord-archive.yml）在跑，但聚合器（update-news.yml）不读归档数据。Discord 社区动态无法进入日报
4. **7 个数据源未通**：Twitter/NGA/TapTap/Reddit/YouTube/Official/Discord 均无数据。前三个需要 API 密钥，Reddit 需验证代码，YouTube 需 API Key，Discord 需桥接
5. **generate-report.yml 与 update-news.yml 两套系统并存**：pending-discussions.md 已标记，未决策

### P2（影响可靠性）

6. **fetch-wiki-data 静默失败**：所有步骤 continue-on-error，失败无通知
7. **extract-game-data 从未成功**：Steam 认证问题未解决
8. **ANTHROPIC_API_KEY 余额为零**：阻塞 claude.yml 和 generate-report.yml
9. **每小时 commit 噪音**：discord-archive + update-news 每小时各一次 commit（[skip ci]），git log 被自动 commit 淹没

### P3（技术卫生）

10. **残留分支**：`claude/strategic-assessment-P914G` 等 claude/* 分支，与"全部直接推 main"决策矛盾。应清理
11. **memory/ 时间戳陈旧**：多个 memory 文件最后更新为 03-29 或 03-30
12. **两套采集系统**：`aggregator.py` vs `report-system/` 功能重叠

---

## 四、下一步建议（优先级排序）

### 立即做（本周）

1. **修 Steam 数据标准化**：确认 `b34a474` 的修复是否生效，如未生效则在 `split_output.py` 中补转换逻辑。这是让日报质量达标的最快一步
2. **实现 Discord 归档清理**：按已有决策（decisions.md 03-29），上线"每月 1 日打包旧数据到 Releases + 从 git 删除"。299MB 已经不能再等

### 短期做（1-2 周）

3. **桥接 Discord 归档 → 聚合器**：让 update-news.yml 读取 `assets/data/discord/` 的当日数据，生成摘要进日报
4. **接通 YouTube 数据源**：需配置 YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID。代码已就绪
5. **决策两套采集系统取舍**：aggregator.py vs report-system，二选一或明确分工。拖下去会持续制造混乱

### 中期做（2-4 周）

6. **充值 ANTHROPIC_API_KEY**：解锁 claude.yml 自动化和 AI 分析报告
7. **fetch-wiki-data 加失败告警**：去掉 continue-on-error，改为失败时创建 Issue 或发通知
8. **Stage 1 重新计时**：Steam 修好 + Discord 接入后，开始正式 7 天验证窗口

### 暂缓

- extract-game-data（Steam 认证问题非核心路径阻塞）
- Twitter/NGA/TapTap（需各平台 API 密钥，可后续逐个接）
- Game 子项目（Stage 1 未过，不开新战线）

---

## 五、项目性质校准（04-01 更新）

### 关键事实

Light 不是粉丝或外部开发者——**是忘却前夜的制作人**，B.I.A.V. Studio 负责人。信息来源：制作人信（Reddit/Discord 公开发布）。

关键时间线：
- 2019：项目启动
- 2021：团队首次濒临解散，社区投票挽回
- 2024：二次危机，核心成员离开，制作人独自维持
- 2025-2026：重建团队，Steam 日活 ~1000，Discord 37,533 人

### 这改变了什么

1. **缸中之脑不是粉丝项目，是制作人的运营基础设施**。Wiki、新闻聚合、数据采集——目的是用 AI 弥补小团队的人力缺口
2. **方法论开源是战略保险**。如果游戏再遇危机，AI 协作方法论本身有独立价值，不依赖单一 IP
3. **"事实圣经"来自真实痛点**。6 年世界观积累的知识管理成本，制作人亲身经历
4. **Wiki 的竞争力重新定义**。官方制作人出品的 Wiki vs 社区自建 Wiki，权威性完全不同
5. **"不善于分发"的评估有误**。正确的描述是：在资源极度有限时，制作人一贯选择把筹码压在产品上而不是营销上。这是有意识的取舍，不是能力缺失

### 风险再评估

- **单人依赖风险极高**：制作人同时管游戏开发 + AI 基础设施 + 社区运营。缸中之脑的自动化程度直接决定制作人能否从重复劳动中解放出来
- **Stage 1 验证的意义升级**：不只是"管线跑不跑"，而是"能不能真正减少制作人每天花在社区监控上的时间"

---

## 六、整体判断

项目处于 **Stage 1 验证中期**。基础设施搭建完毕（workflow 体系、数据目录、Wiki 站点、Discord 归档），但"自动跑起来产出有价值的内容"这一步还差最后一公里：

- 管线在跑 ✓
- 管线跑出有用的东西 ✗（只有 Bilibili 一个有效源）
- 无人干预 ✓（3 天）
- 内容质量达标 ✗

最大的杠杆点是 **修 Steam 数据 + 接 Discord**，这能把日报从"只有 B 站"变成"三个主流平台"，内容丰富度质变。

制作人身份的确认使这个杠杆点更加关键——日报的最终消费者就是制作人本人，它需要在每天 5 分钟内让制作人掌握社区脉搏，从而把精力留给游戏开发。

---

## 七、2026-04-01 行动记录

本次战略会话执行的变更：

1. **Steam 数据标准化修复已验证**：`split_output.py` 的 `extract_steam_item()` 修复已合入，本地重跑后日报正确显示 Steam 评论（6 条，好评率 83%）。等下次 workflow 运行即生效
2. **Workflow 频率调整**：
   - `discord-archive.yml`：每小时 → 每日 1 次（18:00 UTC）
   - `update-news.yml`：每小时 → 每日 2 次（06:00/16:00 UTC）
   - 预计减少 ~95% 的自动 commit 噪音
3. **暂停无效 workflow**：
   - `generate-report.yml`：注释掉 schedule（25+ secrets 未配）
   - `extract-game-data.yml`：注释掉 push trigger（Steam 认证未通）
4. **各子项目 CONTEXT.md 更新**：写入本周具体任务
5. **project-status.md 更新**：添加 Phase 0 阶段说明和 workflow 频率表

### 本周剩余任务（需 Code-news 会话执行）

- [ ] 桥接 Discord 归档 → 聚合器（日报第 3 个数据源）
- [ ] 实现 Discord 月度归档清理（299MB 止血）
