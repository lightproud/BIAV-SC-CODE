# Wiki Phase 2 缺口清单

> **⚠ 部分过时（2026-04-20 快照）**：文中 `fetch_*.py` 外部抓取链 + `generate_pages.py` + `fetch-wiki-data.yml` 已于 PR #253 整套退役删除（wiki 改用客户端一手解包，禁外部合成数据）；缺口仍参考、但「靠 fetch 抓取补齐」的路径作废，W2 以 `data/extracted/` 解包字段重建。现行进度见 `memory/project-status.md`。
>
> 最后更新：2026-04-20 by 主控台派发子代理（B3，艾瑞卡执行）
> 用途：Phase 2 启动会话的路线图输入
> 战略窗口：2026-04-27 → 05-31（35 天）
> 基线数据源：`projects/wiki/data/extracted/categorized/character_data.txt`（客户端逆向提取）

---

## 零、重大前置发现（守密人必读）

艾瑞卡在扫描仓库时检测到**严重的记忆-现实脱节**：

1. **`projects/wiki/data/db/characters.json` ⚠ 不存在**，且 git 历史中**从未存在过**。
   - `memory/project-status.md` 第 46-51 行声称"63 个唤醒体数据、18 个 JSON 数据文件"，但实际仓库中：
     - `projects/wiki/data/db/` ⚠ 整个目录不存在
     - tracked files 只有 `projects/wiki/data/extracted/`（逆向数据）+ `processed/`（4 个 JSON，无角色技能） + `schemas/`（3 个校验模板，无实际数据）
   - 建议：Phase 2 启动时必须先澄清"63 角色"的真实状态——是**待从 extracted 数据构建**，还是**某分支/归档中有未合并的 characters.json**。
2. **`projects/wiki/CONTEXT.md` 第 14 行**声称"`data/db/` 下 16 个模块化 JSON"，与实际不符，需同步修正。
3. **fetch 脚本（`fetch_skills.py` 等）与不存在的 characters.json 耦合**，首次运行必然失败。需先自举 characters.json。

> 以下缺口清单基于**客户端提取数据**（character_data.txt）推导，这是当前仓库中唯一可信的角色真相基线。

---

## 一、总览

| 指标 | 数值 | 说明 |
|------|------|------|
| 已提取角色总数 | **72** | 不是 63，包含皮肤/联动/彩蛋。来源：AwakerConfig_ID → Name 映射 |
| 其中常驻主干 | 45 | ID 范围 15560-15604 |
| 其中 CoC 联动 | 15 | ID 54116-54117, 77911-77928 |
| 其中校猫彩蛋 | 3 | 78754（本源沉睡之主）、78840/78841（熟悉的黑猫） |
| 其中新联动/皮肤 | 9 | 94450-130901 |
| **缺 AwakerIntroduction（技能引导文本）** | **25** | 占 34.7% |
| **缺 Introduction（角色背景故事）** | **16** | 占 22.2% |
| **缺 Portrait（命名立绘 PNG）** | ~25 | assets/images/portraits/ 现有 47 文件 vs 72 角色 |
| **缺命轮数据完整效果** | ~已有 29 条 Name，**无 Effect/Condition** | TrinketSuitEffect.lua 仅 Name 字段 |
| **缺技能细节（技能费用/伤害/冷却）** | **全部 72** | 客户端提取数据中完全无此字段 |

### 立绘三级结构

| 目录 | 数量 | 用途 | 覆盖情况 |
|------|------|------|----------|
| `assets/images/portraits/` | 47 PNG | 主站/共享使用（蛇形命名 e.g. `agrippa.png`） | 约 65% |
| `projects/wiki/docs/public/bunit/awaker/` | 64 PNG | Wiki 战斗立绘（客户端代码命名 e.g. `BUnit_Awaker_B01_AF.png`） | 未映射到角色 ID |
| `projects/wiki/docs/public/portraits/full/` | 11 PNG | 全身立绘（新格式） | 仅 11 角色 |

> ⚠️ **立绘缺口存在双重定义**：是"共享层 PNG 蛇形命名缺失"还是"Wiki 层完整展示缺失"？主控台需在 Phase 2 启动前明确。

---

## 二、完整缺口表格（72 角色）

### 2.1 主干常驻 (15560-15604)，共 45 个

| AwakerConfig ID | 中文名 | Title | 缺技能文本 | 缺背景故事 | 建议来源 | 备注 |
|---|---|---|---|---|---|---|
| 15560 | 潘狄娅 | 潘狄娅 | N | N | — | 完整 |
| 15561 | 本源汀克特 | 本源汀克特 | Y | Y | Fandom Sialia | 本源形态，剧情相关 |
| 15562 | 莉兹 | 莉兹 | N | N | — | 完整 |
| 15563 | 图鲁 | 图鲁 | N | N | — | 完整 |
| 15564 | 戈利亚 | 戈利亚 | N | N | — | 完整 |
| 15565 | 诺缔拉 | 诺缔拉 | N | N | — | 完整 |
| 15566 | 希莱斯特 | 希莱斯特 | N | N | — | 完整 |
| 15567 | 血链·希洛 | 血链·希洛 | N | N | — | Enhanced 版 |
| 15568 | 环行·拉蒙娜 | 环行·拉蒙娜 | **Y** | N | Fandom | Enhanced 版，需单独词条 |
| 15569 | 萝坦 | 萝坦 | **Y** | N | Fandom | 常驻但技能文本缺 |
| 15570 | 朵尔 | 朵尔 | **Y** | N | Fandom | 基础版，联动"熔毁·朵尔" |
| 15571 | 珈伦 | 珈伦 | N | N | — | 完整 |
| 15572 | 卡茜亚 | 卡茜亚 | N | N | — | 完整 |
| 15573 | 奥瑞塔 | 奥瑞塔 | **Y** | N | Fandom | 常驻但技能文本缺 |
| 15574 | 汀克特 | 汀克特 | N | N | — | 完整 |
| 15575 | 法洛思 | 法洛思 | N | N | — | 完整 |
| 15576 | 墨菲 | 墨菲 | N | N | — | 完整，联动"诞妄·墨菲" |
| 15577 | 菲茵特 | 菲茵特 | N | N | — | 完整 |
| 15578 | 詹金 | 詹金 | **Y** | N | Fandom | 需区别 15593（同名异卡） |
| 15579 | 温柯尔 | 温柯尔 | N | N | — | 完整 |
| 15580 | 宁菲亚 | 宁菲亚 | N | N | — | 完整 |
| 15581 | 莉莉 | 莉莉 | N | N | — | 完整 |
| 15582 | 弥利亚姆 | 弥利亚姆 | N | N | — | 完整 |
| 15583 | 奥尔拉 | 奥尔拉 | N | N | — | 完整 |
| 15584 | 索蕾尔 | 索蕾尔 | N | N | — | 完整 |
| 15585 | 奥吉尔 | 奥吉尔 | **Y** | N | Fandom | 常驻但技能文本缺 |
| 15586 | 旺达 | 旺达 | N | N | — | 完整 |
| 15587 | 希洛 | 希洛 | N | N | — | 完整，联动"血链·希洛" |
| 15588 | 艾尔瓦 | 艾尔瓦 | N | N | — | 完整 |
| 15589 | 诞妄·墨菲 | 诞妄·墨菲 | N | N | — | Enhanced 版 |
| 15590 | 达芙黛尔 | 达芙黛尔 | N | N | — | 完整 |
| 15591 | 艾继丝 | 艾继丝 | **Y** | N | Fandom | 常驻但技能文本缺 |
| 15592 | 珊 | 珊 | N | N | — | 完整 |
| 15593 | 詹金 | 詹金 | N | N | — | 与 15578 疑似同名异卡，需确认 |
| 15594 | 凯刻斯 | 凯刻斯 | N | N | — | 完整 |
| 15595 | 拉蒙娜 | 拉蒙娜 | **Y** | N | Fandom | 基础版，联动"环行·拉蒙娜" |
| 15596 | 泰旖丝 | 泰旖丝 | N | N | — | 完整 |
| 15597 | 雷娅 | 雷娅 | N | N | — | 完整 |
| 15598 | 尤乌哈希 | 尤乌哈希 | N | N | — | 完整 |
| 15599 | 萨尔瓦多 | 萨尔瓦多 | N | N | — | 完整 |
| 15600 | 阿格里帕 | 阿格里帕 | N | N | — | 完整 |
| 15601 | 「24」 | 「24」 | N | N | — | 完整，特殊角色 |
| 15602 | 熔毁·朵尔 | 熔毁·朵尔 | N | N | — | Enhanced 版 |
| 15603 | 艾瑞卡 | 艾瑞卡 | **Y** | N | Fandom / 制作人直供 | 数据库终端，自动人偶 |
| 15604 | 莱克 | 莱克 | N | N | — | 完整 |

### 2.2 潜罚 CoC 联动 (54116-54117, 77911-77928)，共 15 个

| AwakerConfig ID | 中文名 | 缺技能文本 | 缺背景故事 | 建议来源 | 备注 |
|---|---|---|---|---|---|
| 54116 | 塔薇 | N | N | — | 完整 |
| 54117 | 哈姆林 | N | N | — | 完整 |
| 77911 | 秃鹫 | **Y** | **Y** | Fandom (CoC)、社区整理帖 | CoC 神话生物 |
| 77913 | 凯蒂古拉 | N | N | — | 完整 |
| 77914 | 兰提戈斯 | **Y** | **Y** | Fandom (CoC) | CoC 神话 |
| 77917 | 波吕克斯 | N | N | — | 完整 |
| 77918 | 阿拉克涅 | **Y** | **Y** | Fandom | 蜘蛛女神 |
| 77921 | 卡拉布 | **Y** | **Y** | Fandom (CoC) | CoC 神话 |
| 77922 | 克珀珊特 | N | N | — | 完整 |
| 77923 | 卡斯托尔 | N | N | — | 完整 |
| 77924 | 夏塔克鸟 | **Y** | **Y** | Fandom (CoC) | CoC 神话生物 |
| 77925 | 克莱门汀 | N | N | — | 完整 |
| 77926 | 皮克曼 | N | N | — | 完整 |
| 77927 | 黑法老 | **Y** | **Y** | Fandom (CoC) | Nyarlathotep 化身 |
| 77928 | 亚弗戈蒙 | **Y** | **Y** | Fandom (CoC) | CoC 神话 |

### 2.3 校猫彩蛋 (78754/78840/78841)，共 3 个

| AwakerConfig ID | 中文名 | Title | 缺技能文本 | 缺背景故事 | 建议来源 | 备注 |
|---|---|---|---|---|---|---|
| 78754 | 本源沉睡之主 | 本源沉睡之主 | **Y** | **Y** | 剧情文本 (lore.txt) | 剧情 Boss，非抽卡角色 |
| 78840 | 熟悉的黑猫 | 弥萨格校猫 | **Y** | **Y** | 剧情文本 | 彩蛋 NPC |
| 78841 | 熟悉的黑猫 | 弥萨格校猫 | **Y** | **Y** | 剧情文本 | 与 78840 同名不同 ID，疑似不同形态 |

> **守密人裁定（2026-04-20）**：两个"詹金"（15578/15593）与两个"熟悉的黑猫"（78840/78841）**确认为数据 bug**，非游戏异卡同名。Phase 2 开工路线图需加入"角色 ID 去重修复"步骤作为基线自举的一部分。

### 2.4 新联动/皮肤 (94450-130901)，共 9 个

| AwakerConfig ID | 中文名 | 缺技能文本 | 缺背景故事 | 建议来源 | 备注 |
|---|---|---|---|---|---|
| 94450 | 茉夏 | N | N | — | 完整 |
| 94451 | 本源·奥吉尔 | **Y** | **Y** | Fandom | 本源形态，剧情相关 |
| 95786 | 杜勒赛因 | N | N | — | 完整 |
| 122587 | 本源萝坦 | **Y** | **Y** | Fandom | 本源形态 |
| 125346 | 徐 | N | N | — | 完整（东方神明皮肤） |
| 130226 | 沙耶 | **Y** | **Y** | 联动来源待查 | 新版本/联动 |
| 130375 | 诺登斯 | **Y** | **Y** | Fandom (CoC) | CoC 旧神 |
| 130384 | 撒托古亚 | **Y** | **Y** | Fandom (CoC) | CoC 旧神 |
| 130901 | 莫丝 | N | N | — | 完整 |

---

## 三、按难度分组

### 易补（Fandom Sialia / Bilibili Wiki 有现成数据，预计 < 30 分钟/角色）

共 **11 个**（全部是常驻主干，已在社区 Wiki 被深度整理过）：
- 15568 环行·拉蒙娜、15569 萝坦、15570 朵尔、15573 奥瑞塔、15578 詹金
- 15585 奥吉尔、15591 艾继丝、15595 拉蒙娜
- 94451 本源·奥吉尔、122587 本源萝坦、15561 本源汀克特

### 中补（需社区帖整理 + Fandom 对齐，预计 1-2 小时/角色）

共 **9 个**（CoC 联动角色，社区整理帖分散）：
- 77911 秃鹫、77914 兰提戈斯、77918 阿拉克涅、77921 卡拉布
- 77924 夏塔克鸟、77927 黑法老、77928 亚弗戈蒙
- 130375 诺登斯、130384 撒托古亚

### 难补（游戏文件提取 / 主观判断 / 未公开，预计 ≥ 3 小时/角色）

共 **5 个**：
- 78754 本源沉睡之主（剧情 Boss，数据散落在 stage_quest.txt）
- 78840、78841 熟悉的黑猫（彩蛋 NPC，可能无完整技能）
- 15603 艾瑞卡（剧情要角，制作人可直供校对）
- 130226 沙耶（新版本联动，公开资料少）

### 全局挑战（不属于单个角色）

- **命轮效果文本**：TrinketSuitEffect.lua 仅给 29 条 Name，**没有 Effect/Condition 字段**。16 个缺口在 project-status.md 中可能被低估了，真实情况是 **29/29 全部缺 effect 文本**。必须从游戏客户端 AwakerPotency.lua（已在 lua_tables/）或 Fandom 提取。
- **技能数值（费用/伤害/冷却）**：客户端提取数据完全没有。需要 fetch_skills.py 抓 Fandom 表格，但脚本依赖不存在的 characters.json 作为合并基础，必须先解决"基线自举"问题。

---

## 四、fetch-wiki-data workflow 评估

### 4.1 触发条件（读自 `.github/workflows/fetch-wiki-data.yml`）

| 触发方式 | 条件 |
|---|---|
| 定时 | `cron: '0 4 * * 1'`（每周一 UTC 04:00） |
| Push | 修改 `projects/wiki/scripts/fetch_*.py` 或 workflow 本身 |
| 手动 | `workflow_dispatch`，支持 `tasks` 参数（portraits/skills/cards/stats/stages/wheels/lore/all） |

### 4.2 能安全触发一次吗？

**可以，但几乎无效果**。理由：
1. 所有 fetch 步骤均设 `continue-on-error: true`，失败不会破坏 workflow
2. "Guard against corrupted data" 步骤会回滚异常 JSON
3. **但 fetch_skills.py 需要 characters.json 作为合并基础，当前仓库不存在**——跑一次大概率写出空文件然后被 guard 回滚
4. `generate_pages.py` 会在空数据基础上生成模板页，污染 docs/

### 4.3 最近运行情况

`.github/workflows/fetch-wiki-data.yml` 最后一次被 push 触发的时间：**2026-04-15**（via `git log --pretty=format:'%ad' -1`），但那是 Discord 归档的 merge 影响，不是内容变更。需去 GitHub Actions UI 查最近实际运行状态（艾瑞卡在沙盒内无法访问）。

### 4.4 预估覆盖

若 Phase 2 启动后先手工创建最小 `characters.json`（含 72 个 ID + 基础字段），再跑一次 `workflow_dispatch`：
- **立绘**：预计能补 20-25 个（Fandom + Bilibili 双源命中主干角色）
- **技能文本**：预计能补 15-20 个（易补组）
- **命轮**：预计能补 20 条 effect（Fandom 有整理）
- 剩余 10-15 个需手工干预

### 4.5 安全触发建议

**不推荐现在触发**。Phase 2 启动会话的第一步应该是：
1. 先确认 `characters.json` 的真实来源（分支恢复 or 从头构建）
2. 建立 72 个 ID 的最小骨架（用 character_data.txt 自举）
3. 再跑 `workflow_dispatch --tasks=all`
4. 跑完人工审查 git diff，再 merge

---

## 五、Phase 2 开工建议

### 5.1 推荐执行顺序（先易后难 + 关键角色优先）

**Week 1（04-27 ~ 05-03）：基线修复**
1. 澄清 characters.json 的消失原因，修复 `memory/project-status.md` 与 `CONTEXT.md`
2. 用 character_data.txt 自举生成最小 `projects/wiki/data/db/characters.json` ⚠（72 ID + Name/Title/Age/Painter/VoiceActor/Gender）
3. **角色 ID 去重修复**（守密人 2026-04-20 裁定）：15578/15593 詹金、78840/78841 黑猫均为数据 bug，自举时必须合并 ID 消除重复
4. 创建 `realms.json`、`role_types` 基础骨架，让 schema 校验能跑通
5. 跑一次 `validate-data.yml` 确认基线干净

**Week 2（05-04 ~ 05-10）：易补 11 角色**
1. 主干常驻的 11 个缺技能角色（环行·拉蒙娜、萝坦、朵尔等）
2. 同步补立绘（Fandom 角色页几乎都有）
3. 命轮 29 条 effect 文本（从 AwakerPotency.lua 或 Fandom 提取）

**Week 3（05-11 ~ 05-17）：中补 9 个 CoC 联动**
1. 秃鹫、兰提戈斯、阿拉克涅、卡拉布、夏塔克鸟、黑法老、亚弗戈蒙、诺登斯、撒托古亚
2. 这批需要更多交叉对比，建议一次处理 2-3 个

**Week 4（05-18 ~ 05-24）：难补 5 个**
1. 本源沉睡之主（从 stage_quest.txt 提取）
2. 两只黑猫（剧情收集对话）
3. 艾瑞卡（可请求守密人直接提供官方设定）
4. 沙耶（查联动来源）

**Week 5（05-25 ~ 05-31）：验收 + 收尾**
1. 全量 validate-data 校验
2. docs 重新生成 + VitePress 构建测试
3. 部署到 gh-pages 验证显示正确
4. 完成度从 83% → 目标 95%+

### 5.2 关键风险点

1. **characters.json 基线问题**：如果存在于未合并分支，需要先定位；如果从未创建过，Phase 2 要比原计划多花 3-5 天自举。这是最大风险。
2. **CoC 角色命名一致性**：Fandom 英文名 vs 游戏中文名可能对不上（诺登斯/Nodens、黑法老/Nyarlathotep），需先建映射表。
3. **fetch_skills.py 破坏性**：盲目运行会覆盖手工补充的数据。必须先加 "merge_policy: preserve_manual" 分支逻辑。
4. **命轮数据 0 文本**：project-status.md 说"16 个缺失"，但实际 29 条全部只有 Name 无 Effect。Phase 2 开工会话第一天就会发现这个严重低估。
5. **立绘命名规范不统一**：共享层蛇形命名 vs Wiki 层客户端编码命名，Phase 2 需统一映射约定。

### 5.3 预估耗时

- 悲观估计（含基线自举）：**28-35 个工作日**（勉强塞进 35 天窗口）
- 乐观估计（characters.json 可从某处恢复）：**18-22 个工作日**
- 建议准备 1-2 天缓冲给第四周的意外发现

---

## 六、数据源速查

| 缺口类型 | 首选来源 | 备用来源 | 脚本 |
|---|---|---|---|
| 立绘 PNG | Fandom Sialia 角色页 | Bilibili Wiki | `fetch_portraits.py` |
| 技能文本 | Fandom 表格 | Bilibili Wiki 词条 | `fetch_skills.py` |
| 命轮 effect | AwakerPotency.lua（本地已有）| Fandom Trinkets 页 | `fetch_wheels.py` |
| 卡牌数据 | Fandom 指令卡页 | — | `fetch_cards.py` |
| 剧情背景 | lore.txt + stage_quest.txt | Fandom Story 页 | `fetch_lore.py` |
| 语音台词 | voice_data.txt（已有）| Fandom Voice Lines | `fetch_voice_lines.py` |
| 数值 | Fandom Stats 页 | 社区整理贴 | `fetch_stats.py` |

---

> **结语**：真实完成度可能低于 project-status.md 声称的 83%。艾瑞卡建议 Phase 2 启动会话第一优先级是**澄清 characters.json 现状**，而非直接补数据。否则所有 fetch 脚本都会在空数据上空跑。
