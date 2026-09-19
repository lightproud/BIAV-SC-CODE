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
- **2026-09-13 · 回归网环境缺口（周更例程 v2026.9.11 移 pin）· 品牌缺口两处已定点修复
  + 一处环境伪影挂账未销**：Hermes 上游 v2026.8.31 → v2026.9.11（引擎 0.21.0 → 0.21.2）
  移 pin，闭环第二段「审核补丁」经三轮重锚全绿（rebrand.py 七条锚点全树零命中重锚 + 特性补丁
  `conversation-cost-panel.patch` 九处冲突按语义重放），第三段「换装后回归网」首轮 9 红，
  逐条定性后两处已就地修复、一处判定环境伪影挂账：
  ① **品牌缺口（已修复）**：上游新增 `desktop-update-ui.test.mjs` 直接渲染并断言
  `scripts/desktop-update/ui.html` 的用户可见文案——该文件此前从未进任何扫描表
  （`RUNTIME_DIRS`/`BARE_WORD_DIRS` 均未列 `scripts/` 顶层任何子目录），生产桌面端的
  自更新中转窗口因此一直原样显示 "Hermes"，纯属此前无测试盯着才没暴露。处置：只将
  `scripts/desktop-update` 加入 `RUNTIME_DIRS`（未加入 `BARE_WORD_DIRS`——同目录还有
  `windows.ps1`/`posix.sh` 等 Windows/macOS/Linux 自更新脚本，内含大量
  `HermesUpdateJob`/`Invoke-HermesStep`/`$HermesHome` 复合标识符与 `/opt/Hermes/hermes`
  一类 repro 夹具路径，裸词铺开前需要六目录铺开先例同等量级的逐条核验，非本轮回归修复
  射程），改走 `ui.html` 五处字面量的定点 `BRAND_POST_RULES`。**该目录的裸词铺开评估
  仍是缺口**，留待日后另案（若做，比照 2026-08-25 六目录铺开先例逐条核过功能面）。
  ② **测试自伤（已修复）**：上游新增 `venv-holder-select.test.ts` 大小写不敏感回归用例，
  故意配对大小写不同的两个路径字面量（exePath 全小写 `c:\hermes\...` 不入裸词射程，
  venvScriptsDir 首字母大写 `C:\Hermes\...` 被裸词规则换成 `C:\Black Pool\...`），裸词
  规则只误伤其中一个，前缀比较自然对不上——与本档「find-in-page」「data.identity」两案
  同一口径，加 `BRAND_POST_RULES` 定点改回原样，不碰 `hasWindowsPathPrefix` 实现本身。
  ③ **环境伪影（未修复，挂账）**：`src/store/voice-prefs.test.ts` 新增两条用例
  （`keeps the desktop toggle local across config refreshes` / `migrates the legacy
  preference once, not on every refresh`），全程未被任何品牌 / 特性补丁触碰（两文件
  `grep -c Hermes` 均为 0，唯一命中均为小写 `hermes` 免疫裸词）。已用最小复现探针实证
  根因：本装配树 `jsdom@29.1.1` + `vitest@4.1.10` 组合下，`vi.spyOn(localStorage,
  'setItem')` 不拦截随后经 `window.localStorage.setItem(...)` 发起的同一次调用——
  即便 `localStorage === window.localStorage` 恒为 `true`（探针已验证两侧引用相同），
  spy 装在其中一个访问路径上就是拦不住经另一路径发起的调用，疑似 jsdom 该版本
  `Storage` 存取器每次取值返回新代理对象的已知类别问题。`voice-prefs.ts` 的
  `readKey`/`writeKey` 走 `window.localStorage.*`，用例走裸 `localStorage` 起 spy，
  正好撞在这条缝上。**未处置**：既非我们补丁引入（文件从未入任一 patch 射程），
  也非上游实现缺陷（现网真实浏览器里 `localStorage`/`window.localStorage` 是同一对象、
  spy 会正常拦截，只有这套沙箱测试环境的 jsdom/vitest 版本组合会撞上），改测试
  等于替上游背书一个我们没有把握的判断，改 `voice-prefs.ts` 实现更是越界改动未受我们
  补丁覆盖的上游源码。闭环因此停在「换装后回归网」，**pin 未移、台账未动、未推 main**。
  处置建议留守密人裁定：(a) 确认是否为本沙箱专属环境问题（对照 CI
  `hermes-upstream-suite.yml` 异步跑出的基底体检结果）；(b) 若确认环境专属，需要给
  `sync_upstream.py` 的换装后回归网增一条「已知环境缺口」白名单机制（当前该工具是
  纯二元闸门，没有为此类个案放行的口子，这也是本条唯一的真实处置缺口）；(c) 若怀疑
  是上游真缺陷，走 `hermes-upstream-suite.yml` 或社区渠道向上游报告。
- **2026-09-18 · 上条 (b) 项销案：换装后回归网「已知环境缺口」受控豁免闸门落地（守密人
  2026-09-18 交互裁定）**：上条挂的三个处置建议中，(b) 「给回归网增一条白名单机制」经守密人
  裁定采纳并当日实现；(a) 本轮在 v2026.9.14 基底上复核，结论与上周一致——三张补丁
  `grep voice-prefs` 皆 0（从未进任一补丁射程），组装树内最小复现探针再次实证
  `localStorage === window.localStorage` 恒为真、`vi.spyOn(localStorage,'setItem')` 零拦截、
  值真落库，确认为 jsdom 29.1.1 + vitest 4.1.10 的测试环境 API 缺陷；(c) 判定**不向上游报告**
  ——上游实现在真实浏览器里正确，红因在本装配树的测试环境版本组合，不构成上游缺陷。
  **闸门形态**：台账 `build/desktop-env-gaps.json` 逐条具名（精确用例级 nodeid / cluster /
  reason / source / decided_on / decided_by，缺任一字段即响亮失败），判定纯函数
  `verify.evaluate_desktop_net` 放行须**四条同时成立**——全部在册 · 确有用例级失败 ·
  无整档崩 · 解析条数与 vitest 汇总 failed 计数逐个对上；在册者在报告与公告里逐条点名，
  死条目由 stale 字段报出供人工清理，台账只由人工增补。纪律守卫
  `tests/test_hermes_env_gaps.py`（16 例）。首批在册即上条 ③ 的两条 voice-prefs 用例。
  **仍开着的缺口**：上条 ① 的 `scripts/desktop-update` 目录**裸词铺开评估**未做（本轮仍走
  五处字面量定点规则）；两条 voice-prefs 条目待环境或上游升级 jsdom 后自然成死条目，
  届时由 stale 点名清理。
- **2026-09-19 · 判定链断裂：闸门只覆盖会话侧，组装线仍是裸二元（待守密人裁定）**：
  受控豁免闸门落在 `build/verify.py`，只有会话侧 `sync_upstream.py run` 经过它；而组装线
  `.github/workflows/assemble-black-pool-bundle.yml` 的 `regression-net` job 跑的是裸
  `npx vitest run`，退出码直接决定成败。**同一棵换装树、同一套用例，两条链判词可以相反**
  ——闭环放行、组装线卡死，包照样出不来（2026-09-19 本轮移 pin 后首次触发组装即撞上此风险）。
  预备入口 `build/desktop_net_gate.py` 已入库（跑 vitest → 喂同一个
  `verify.evaluate_desktop_net` → 同一本台账 → 退出码据判定），**四条放行前提一条不放宽**；
  但**尚未接进 workflow**——改 CI 行为属守密人裁定范畴，接线与否待裁。未接线期间该脚本
  零消费，`consumption_audit.py` 会把它报成零消费产物，属预期。
