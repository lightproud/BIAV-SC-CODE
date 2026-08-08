# gaps.md — 漏缝清单（一等产出）

> 施工边界文书 §2.2 / §6.6（`Public-Info-Pool/Resource/repo-engineering/bpt-hermes-charter-20260802.md`）：
> **扩展点不够、被迫想碰核心之处，一律「即停、记录、不硬闯」落此档。**
> 另收「通用化未遂」记录（文书裁 15 通用化三问不过、归黑池域代码区者，在此留档，
> 随知识保鲜复审评估升格公开）。
> Maestro 概念作废清零不进本档（文书裁 11 / 禁 2）。

## 格式

每条：日期 / 类型（扩展点缺口 | 通用化未遂）/ 场景与被迫触碰面 / 处置（停·绕行·挂账）/ 状态。

## 清单

- **2026-08-02 · 扩展点缺口 · patches/ 启用（守密人需求 #1 裁定）**：品牌换装
  （Hermes → Silver Core）无扩展点可走——身份可由 SOUL.md 原生覆盖，但 159 文件
  的运行面显示串（"Hermes Agent" / "Hermes profile" / "hermes-tui"）为硬编码。
  处置：守密人 2026-08-02 交互裁定「开 patches/ 全量抹净」，`patches/` 由「必须为空」
  转**白名单制**（守卫同 PR 修改，见 `tests/test_hermes_charter.py` ALLOWED_PATCHES）；
  补丁不手写、由 `build/rebrand.py` 规则引擎生成，三红线（LICENSE/版权 · URL/遥测 ·
  功能标识符）机械守卫。范围台账 `BRANDING.md`。状态：已落地。
- **2026-08-02 · 扩展点缺口 · 需求 #2 对话成本面板（`conversation-cost-panel.patch`）**：
  desktop 状态栏/面板无 UI 插件位，成本展示须触改核心（statusbar 项 + 面板组件 + i18n 五语种
  + 网关 `_get_usage` 补 cache/cost 四字段透传 + 事件流一行差分记账）。处置：手维护特性补丁
  482 行 / 13 文件入白名单；**上下文零品牌词**（机械可验：补丁上下文行 grep Hermes = 0），
  故对换装前后基底皆干净适用；移 pin 时 `git apply --check` 守卫响亮报冲突、人工重放。
  验证：desktop typecheck 三配置绿 + 前端 675 测试绿 + 后端网关 533 测试绿。状态：已落地。
  **2026-08-05 扩容（守密人追加「本周 / 本月用量，人民币计价，汇率 6.8」+「价格历史用量」）**：
  原面板是**单会话内存态、美元计价**，round 台账随应用重启清零——周 / 月是跨会话量，
  底子不够。加持久化日台账 `store/usage-ledger.ts`（localStorage 一天一桶，只存聚合
  不留原始轮次；周一为周首、**本地日历日键**——UTC 键会让北京日在 08:00 翻篇；
  保留 400 天后按日滚动淘汰）。喂数据接在既有的每轮差分上，**恰好复用了它「跳过续接
  会话首帧」的既有行为**：续接会话上报的累计量含此前运行已入账的部分，不跳就是重复计费。
  面板加周 / 月合计 + 14 日柱状历史，¥ 按 6.8 折算并**标注估算**（不标注的 ¥ 会被读成
  既成事实）。补丁 482 → 786 行新增 / 15 文件。验证：新增台账单测 20 项（周首 / 月界 /
  跨月回溯 / 脏数据 / 配额失败 / 淘汰窗口）+ desktop 全量 4,308 绿；能力哨兵
  `test_cost_panel_patch_sentinels` 把汇率与周首钉死在测试里——二者是守密人口径裁定，
  改它们应先改裁定。状态：已落地。
- **2026-08-06 · 自伤记录 · 把回归网架在了它永远绿不了的地方**：2026-08-05 给打包工作流
  接上 desktop 单测（初衷成立：换装是 400+ 文件的规则替换，改坏 UI 逻辑一样零报告出包），
  但**接在了 windows 打包 job 上**。整套 desktop 测试里有一批本就假定 POSIX 的用例——
  `update-relaunch` 期望 `release/linux-unpacked`、`windows-hermes-path` 期望
  `/venv/lib/python3.12/site-packages`、`ssh-connection` 要真实 ssh——在 windows runner 上
  必然红。**后果：从接上那天起打包一次都没成功过**，而守密人手上的包始终停在接网前的 08-04。
  2026-08-06 实证（run 31120681988 attempt 3）：换装与特性补丁全部干净落位、前 11 步皆绿，
  唯独测试步红，红的 8 条**无一与换装有关**，却把整个 zip 挡在门外。
  处置：网移出打包 job，单开 `regression-net`（ubuntu）跑同一份换装树的完整套件，
  打包 job 经 `needs:` 依赖它——网红则打包不启动，覆盖面一条不减。
  **教训**：门禁的价值取决于它**能不能通过**。一道永远红的门不叫严格，叫堵死；
  而它堵住的是交付，放过的是它本该拦的东西（那批 POSIX 用例红得太响，反而没人去看
  真正该看的换装回归）。选门禁落点时要先问「这道门在这台机器上有没有可能绿」。
- **2026-08-06 · 自伤记录 · 报错通道自己是失败源（内网组装野战）**：守密人跑第二级组装
  （bpa-dev `assemble.cmd`）时，一张内网补丁应用失败——**但真实原因一个字都没露出来**，
  屏幕上只有两串 traceback 加一句 `'详情见' is not recognized`。三个缺陷叠在一起：
  ① **编码两端相反**：`assemble.cmd` 设 `PYTHONIOENCODING=utf-8` 让子进程吐 UTF-8，
  而 `assemble_inject.py` 的 `subprocess.run(text=True)` 走**系统默认**编码——中文
  Windows 上是 GBK。子进程一吐中文即 `UnicodeDecodeError`（报错字节 `0x97` 正是 UTF-8
  续字节），读取线程死掉。② **崩溃补刀**：线程死后 `r.stderr` 变 `None`，紧接着的
  `r.stderr.strip()` 抛 `AttributeError`——**这行代码的唯一职责就是打印失败原因**。
  ③ **cmd 65001 错位**：`echo 详情见 %LOG% & pause & exit /b 1` 被切进 `echo ` 里，
  中文当成命令名。同块上一行的纯中文 echo **打印正常**，差别只有一个 `&`。
  处置：四处 `subprocess.run` 全部显式钉 `encoding="utf-8", errors="replace"`
  （含监督器 `launch_desktop.py`——它崩掉等于桌面端起不来、诊断器 `diagnose_lag.py`——
  它崩掉等于现场没人取证；`UnicodeDecodeError` 不是 `OSError` 子类，原 except 接不住）；
  失败分支改读 `(r.stderr or "") + (r.stdout or "")` 并在皆空时明说；8 处非 ASCII 的
  `&` 串接行拆成多行，新守卫 `test_cmd_non_ascii_lines_never_chain_with_ampersand`
  钉死（已做负控，串回去即红）。
  **教训**：诊断路径必须比它诊断的东西更结实。一个只在出错时才走的分支，恰恰最少被执行、
  最容易腐坏——而它坏掉的代价是**故障现场被抹掉**，比原故障本身更贵。凡「打印错误」
  「写日志」「收集诊断」的代码，都要按「任何输入都不许崩」的标准写。
- **2026-08-03 · 扩展点走通（正面记录）· blackpool 记忆插件 → 2026-08-04 已退役**：
  中文记忆召回缺口（stock holographic 的 FTS5 unicode61 把连续汉字当单一词元，
  中文事实近乎不可检索）**全程走官方扩展面解决、零补丁零核心触碰**——MemoryProvider
  ABC 纯子类，兄弟插件位 `plugins/memory/blackpool/` 自动发现，确定性 FMM+bigram
  分词器修 FTS 索引/查询、Jaccard 双侧、CJK 引号实体四咬合点。**扩展点结论仍成立
  且是本档保留此条的理由**：官方扩展面确实够用，这条路走得通。
  **退役原因（守密人 2026-08-04 裁定「整只撤下」）**：分词器是**净回归**。
  `zh_seg` 的词元正则 `[a-z][a-z0-9']+` 要求首字符为字母，纯数字串整体落地不成词元；
  而 `ZhFactRetriever._fts_candidates` 固定 MATCH `facts_fts_zh`，按设计**完全取代**
  而非补充上游原索引。合起来即：端口号 / 错误码 / 版本号 / CVE 编号在本 provider 下
  永远零命中，而上游原版查得到。实测 `网关端口定为 8443` → `网关 关端 端口 口定 定为 为`
  （`8443` 消失）；`GPT-4o 模型` → `gpt 模型 型`；`CVE-2024-1234` → `cve`。
  中文可检索性买不起「拉丁数字不可检索」这个价，故整只撤下而非就地修正则——
  同时令公版回到名副其实的纯品牌换装。守卫 `tests/test_black_pool_memory.py`
  随之退役。中文记忆召回**重回缺口态**，留待日后另案（若重开，索引侧须
  UNION 两表而非取代，且词元正则须收数字起头串）。
