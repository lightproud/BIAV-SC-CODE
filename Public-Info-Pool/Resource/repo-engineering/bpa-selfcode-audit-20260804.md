# BPA 自写代码动态编排审视报告（2026-08-04）

> **对象**：`projects/black-pool-agent/` 扩展层**自写代码**（`build/` `deploy/` `patches/` `plugins/` `skills/`
> 五目录 + 两条装配 CI），**不含** `upstream/`（8,436 文件官方快照）。
> **方法**：五个审计单元并行编排（build 规则引擎 / deploy Python / Windows 脚本 / 插件与补丁 /
> 红线与守卫横切）+ 艾瑞卡逐条复验。**凡标「实测」者均为本会话沙箱复现，非转述。**
> **范围规模**：自写 Python/C#/cmd/vbs 约 2,720 行 + 三张补丁 2.98 MB + 两条装配工作流 452 行。
> **性质**：只读审计，本报告不含任何修复实施。

---

## 〇 定性

这是一次**对自造工具链的信任度体检**。BPA 扩展层的定位是「核心零侵入」——不碰上游一行，
一切能力靠自写的规则引擎、补丁器、装配线、启动器在**组装期**完成。这意味着：这套自写代码
是黑池侧 20+ 内部用户拿到的整包与官方源码之间的**唯一一道工序**，它的每一个静默失败都会
直接变成出厂缺陷，且因为「零侵入」这条铁律本身不产生任何痕迹，事后极难归因。

体检结论分两面。**架构面是健康的**：MIT 合规三层一致（LICENSE 随包、出身声明入 About、
禁语零违规）、扩展面契约与上游逐项对齐（记忆插件纯子类化、零补丁零核心触碰）、红线在
**结果上**守住（凭据/密钥/内网 IP/UNC 全项零命中）、六个 Python 文件零 `shell=True` 零
`os.system` 无注入面、装配线的 `MANIFEST.txt` 最后写 + deploy 拒收半成品是一个漂亮的不变量。

**机制面则不然**：守卫审的东西和出厂用的东西是两回事，而这条缝隙下面躺着五个已被实测坐实的
静默缺陷——它们不报错、不返回非零、日志里也看不见，只在用户面上显形。本报告的重点不是
「代码写得好不好」，而是**「哪些错误现在没有任何东西能拦住」**。

---

## 一 高危：已实测坐实（五条）

### H-1 · 品牌规则引擎跨运行非幂等，第二遍抹掉 MIT 出身声明

**位置**：`build/rebrand.py:617-641`（逐行品牌规则跑在后置插入规则**之前**）

**实测**（取真实上游三文件建最小树，连跑三遍 `--apply --edition private`）：

| 对象 | 第一遍（正确） | 第二遍 |
|---|---|---|
| `about-settings.tsx:106` | `B.I.A.V. Studio 出品 · 基于 **Hermes Agent** 0.20.0 定制` | `…基于 **Black Pool Agent** 0.20.0 定制` |
| `agent/usage_pricing.py` | 价格表函数出现 2 次 | 4 次 → 第三遍 **6 次**（每遍 +66 行，无上限） |

第一行正是文书裁 10「禁 100% 纯自研」与 MIT 归因的**唯一 UI 承载面**，第二遍跑就把它抹了。
成因：后置规则插入的文本里含 `Hermes Agent`，下一次运行时逐行规则先跑，把自己上次写的
出身声明当成待涂改的旧品牌。同理受害的还有 `gateway/relay/__init__.py` 的旧名抑制守卫
（`("Black Pool Agent", "Hermes Agent")` → 两项变同一个，守卫自我吞噬）。

**触发路径现实存在**：CI 步骤重跑、本地重复 `--apply`、或「先 `git apply` 补丁再跑 `--apply`」
——而 `build/README.md:32-34` 把两条路线并列为「二选一，效果相同」，没有任何东西阻止两条都走。

> 小学生比喻：一台只认「原稿」的复印机——把自己印出来的东西再塞进去，它会把自己刚签上的
> 「原作者：某某」当成需要涂改的旧名字涂掉；而且每印一次就往末尾多贴一页同样的附录。

### H-2 · 补丁器漂移双计，静默打错位置

**位置**：`deploy/apply_patch.py:147` — `drift += (pos - (old_start-1)) + delta`

`pos` 本身已含此前累积漂移，再累加即**重复计入**；正确写法是赋值而非累加。

**实测**（自建最小反例：三 hunk 补丁，首 hunk 净增 5 行，文件后段为 5 行周期的重复块）：
第三个 hunk 应改**第 36 行**（`git apply` 的答案），`apply_patch.py` 打到了**第 41 行**，
返回码 **0**，输出 `[applied] M f.txt`。

该文件 docstring 第 5-6 行写着「**刻意响亮失败**：上下文对不上就整张拒绝并报出行号，
**绝不静默错打**」。这正是它的反面。缓解因素是 ±50 行搜索窗——偏差超窗时会整张拒绝
（响亮，可接受）；危险的恰是偏差在窗内且上下文在错误位置也能匹配的情形，如上例。

> 小学生比喻：量身高时每次把上一次已经垫过的鞋跟又垫一遍，量到第三个人时尺子已经错了
> 两只鞋——而它还盖章说「测量完毕」。

### H-3 · 补丁器可写出 `--root` 之外（路径穿越）

**位置**：`deploy/apply_patch.py:116/126/133` — `dest = root / fp.new_path`，`new_path` 直取补丁
`+++ b/…` 行，**零 containment 校验**。

**实测**：补丁写 `+++ b/../../pwned.txt` → 文件确实落在 `--root` 的**上两级**，rc=0，
输出 `[applied] A ../../pwned.txt`。`Path / 绝对路径` 语义使 `b//abs/path` 形态可覆写任意绝对路径。

射程：`deploy/assemble_inject.py:172` 把 `--root` 指到 `<bundle>/app`，一张手滑或恶意补丁
即可写到 bundle 外、组装机任意位置。白名单管的是「哪张补丁」，不管「这张补丁往哪写」。

> 小学生比喻：门卫只查来客名单，不查客人进门后往哪个房间走——名单上的人可以直接走进邻居家。

### H-4 · 零上下文 hunk 首次即错位，且可无限叠加

**位置**：`deploy/apply_patch.py:102/104` — `match_at` 对空 `old_block` 恒返回 True，
且按 `old_start-1` 定位（0 长度 hunk 应为 `old_start`）。

**实测**：`a/b/c` 三行文件 + `@@ -2,0 +3 @@ +INSERTED`（`git diff --unified=0` 的标准形态）
→ 期望 `a,b,INSERTED,c`，实得 **`a,INSERTED,b,c`**；连打三次得**三行** INSERTED，次次 rc=0。
幂等性彻底缺失。

### H-5 · 中文记忆插件把英文数字检索能力砍掉了（净回归）

**位置**：`plugins/memory/blackpool/zh_seg.py:22`（正则 `[a-z][a-z0-9']+` 要求首字符为字母）
+ `plugins/memory/blackpool/__init__.py:146`（查询固定 `facts_fts_zh MATCH ?`，**完全绕开**上游原索引）

**实测**：

| 输入 | 实际词元 | 丢失 |
|---|---|---|
| `网关端口定为 8443` | `['网关','关端','端口','口定','定为','为']` | **8443 整个消失** |
| `Rust 1.75 release` | `['rust','release']` | 版本号 |
| `v0.1.0` | `['v0']` | 后半截 |
| `3f9a2b` | `['f9a2b']` | 首位数字被啃掉 |

该模块 docstring 自称「fully **replaces** (not merely supplements) the stock index」——正是这句
自我定位使它成为净回归：事实「网关端口定为 8443」入库后，查「8443」**永远零命中**。
版本号 / 端口 / 金额 / commit SHA / 日期全部沦陷。

附带（同源，中危）：每个未命中词典的字串尾部多吐一个冗余单字（`版本 1.75 发布` →
`['版本','本','发布','布']`），这些单字只进索引不进查询（查询侧被上游 `len<2` 规则丢弃），
两侧不再对称——而该模块自称「索引侧与查询侧跑同一个分词器」。

> 小学生比喻：给图书馆加了中文索引卡，结果新卡箱把旧卡箱整个搬走了——中文书能找到了，
> 但所有带编号的书从此查无此书。

---

## 二 高危：机制已确认，后果待 Windows 侧实测（三条）

### H-6 · 一键更新器的四重连环（`deploy/black-pool-update.cmd`，全档 17 行）

面向桌面用户双击。执行顺序 = 下载 → **删上一代回滚** → **现役让位** → 解压 → 迁 home。

1. `curl.exe -L -o … || goto :fail` **缺 `--fail`**（同仓较新的 `update.cmd:93` 有）→ HTTP 404/500
   时 curl 返回 0，错误页 HTML 被存成 `.zip`；
2. **先毁后验**：第 10 行 `rd /s /q BlackPool.old`、11 行现役改名，第 12 行才 `tar -xf` 发现包是假的
   → 现役没了、回滚也没了，只给一句「更新失败，请检查网络后重试」；
3. `cd /d %USERPROFILE%\Desktop` **无失败检查且未加引号** → 企业 OneDrive 桌面重定向下 cd 失败、
   脚本照跑，于是在脚本自己所在目录 `rd /s /q` 同名目录并解压 1GB；
4. 全程**零 SHA 校验**；且 `xcopy /e /i /y` 让旧 home **覆盖**新包 home（`deploy.cmd:38` 用的是
   `robocopy /xc /xn /xo`，语义正好相反）。

此档还有两处治理缺口：中文 `rem` 位于 `chcp 65001` **之前**（2-5 行 rem，6 行 chcp），
且它**不在** `tests/test_bpa_dev_kit.py:163` 的 rem-ASCII 守卫名单内（该名单五档，独漏此档）。

> 小学生比喻：先把旧课本扔进碎纸机、再拆新课本的包裹，结果包裹里是一张「查无此书」的纸条
> ——顺序反了，而且送错楼层也没人核对门牌。

### H-7 · 验货章是自己刻的（`deploy/update.cmd:99-107`）

第 106 行把本地实测 SHA-256 **无条件**追加进 `CHECKSUMS.txt`，**不受** `SHAOK` 判断约束；
而 `assemble.cmd:39-48` 的「强制验货」正是拿这张 `CHECKSUMS.txt` 比对 → 自己登记的哈希
验自己算的哈希，恒过。更兼哈希不符（篡改/截断）与 API 不可达**共用同一句安抚话**
「未能对上官方 digest（离线或 API 不可达），按 TLS 下载信任」。

附带：`assemble.cmd:43` 的 `findstr /i /c:"!SHA!" CHECKSUMS.txt` 是**全文匹配、不绑定文件名**
——为另一个包登记的哈希也能让本包通过验货。

> 小学生比喻：海关比不上官方清单，就自己抄一张贴在箱子上，下一道关卡照着这张自抄的清单查
> ——当然次次放行。

### H-8 · CLI 退出码在进考场前就印好了（`deploy/launcher.cmd:85-89`）

该档只有 `setlocal EnableExtensions`（第 14 行）、**无 EnableDelayedExpansion**，而
`exit /b %errorlevel%` 位于 `( )` 块内——cmd 在解析整块时就把它展开成块执行**之前**的值。
后果：`launcher.cmd cli …` 无论引擎成败一律返回 0，`build/black-pool-launcher.cs:39` 的
`p.ExitCode != 0` 失败判据在 CLI 路径上完全失效，出错对话框永不弹出。

同类：`deploy/kill_by_path.py:28` 无最小深度/系统目录护栏（`C:\` 类参数会按前缀杀全盘进程）、
`deploy/deploy.cmd` 部署目标**零范围校验**且三轮轮换失败后落到第 98 行 `robocopy … /mir`
（`/mir` 删除目标里源没有的一切，而 `releases\ patches\ plugins\ config\` 均为内网独有资产）。
两者的「配置档写坏 → 目标退化到哪」需 Windows 侧实测方能定论，**标待证**；但「无范围校验 +
`/mir` 兜底」「无深度护栏 + 前缀杀」这两个组合本身是硬事实。

---

## 三 合规与归因（中危，涉 MIT 与第三方署名）

### C-1 · 补丁改写了含真实第三方姓名的 `author:` 归属行（已确认，4 处）

`build/rebrand.py:86-89` 的 `LINE_SKIP_MARKERS` 只挡 `Copyright` / `copyright` / `SPDX-License-Identifier`，
**不挡 `author:`**。补丁实测四行：

```
-author: Alex Jestin Taylor (@alex-fireworks) + Hermes Agent
+author: Alex Jestin Taylor (@alex-fireworks) + Black Pool Agent
-author: Steve Lawton (@slawt), Hermes Agent
+author: Steve Lawton (@slawt), Black Pool Agent
-author: Hermes Agent            → +author: Black Pool Agent
-author: Hermes Agent contributors → +author: Black Pool Agent contributors
```

署名属**归属事实**，与版权行同类。改后等于对上游插件宣称我方共同作者身份。

> 小学生比喻：论文的版权页没动，但每章末尾的「本章作者」全改成了自己的名字。

### C-2 · 对外归属头改了名、没改域（已确认，6 处）

`X-Title: "Hermes Agent"` → `"Black Pool Agent"`（4 处，OpenRouter / Vercel AI Gateway 的应用名归属头）、
`User-Agent: codex_cli_rs/0.0.0 (Black Pool Agent)`、`'black-pool-tui-weather'`。
而**同一个 headers 字典里**紧邻的 `"HTTP-Referer": "https://hermes-agent.nousresearch.com"`
因含 `https://` 被跳线保留 → 对外自报成「应用名黑池 + 来源域 nousresearch」的自相矛盾组合。
`BRANDING.md` 红线只点名保护 `X-Client-Name`（「对上游服务如实自报，不冒充」），
同性质的 `X-Title` / `User-Agent` 无保护。

> 小学生比喻：给对方公司寄件时，寄件人姓名换成了自己，回邮地址却还印着对方的。

### C-3 · 上游测试基线「逐字节同判」红线名存实亡（已确认，61–67 档）

`build/rebrand.py:612` 的排除谓词只认 Python 命名法（`/tests/`、`test_*`、`*_test.py`），
**不认 JS/TS 惯例**（`*.test.ts(x)` / `*.spec.ts` / `e2e/`）。实测公版补丁改了 **61+ 个** TS 测试档，
例如把 `/Applications/Hermes.app` 断言改成 `/Applications/Black Pool.app`。
`BRANDING.md:59` 在「刻意不碰（红线）」表里明写「上游测试与文档：测试基线须与官方逐字节同判」
——Python 侧确实 0 命中，TS 侧已分叉。

**更硬的后果是单向分叉**：`hermes_cli/main.py:2306` 的临时档前缀被换成 `black-pool-tui-active-session-`，
而断言它的 `tests/hermes_cli/test_tui_resume_flow.py:250` 因在排除名单内**保持旧串** →
换装树上该测试必红。

### C-4 · 「公版 = 纯品牌换装」措辞与实际不符（已确认）

公版补丁除品牌串外还含四类**产品行为变更**：默认语言 `DEFAULT_LOCALE = 'zh'`、
默认皮肤 `DEFAULT_SKIN_NAME = 'black-pool'` + 24 令牌新主题、产品版本 `__version__ = "0.1.0"`
（`pyproject.toml` 仍 `0.20.0`，刻意脱节）、CSS 字体路径重定向。
这几项 `BRANDING.md` 第 39/47/48 行**均有守密人裁定记录，不是偷改**；问题在于「纯品牌换装」
这个措辞会让日后拿公版当「行为等同上游」的对照基线者得出被污染的结论。

---

## 四 守卫盲区：为什么上面这些至今没被拦住

现有守卫共 69 例（`test_hermes_charter.py` 8 + `test_bpa_dev_kit.py` 33 + `test_black_pool_memory.py` 11
+ `test_launch_desktop.py` 17），**本次复跑全绿**。绿得不等于安全，缺口如下：

| 编号 | 盲区 | 后果 |
|---|---|---|
| **G-1** | **守卫审补丁产物，CI 出厂用规则引擎直施，两者一致性无人校验**。`rebrand.py` **自带** `--check` 漂移检测（`:759-772`），但 `tests/` 与 `.github/workflows/` 内**零调用**；CI 只跑 `--apply` | 改规则不重生成补丁 → 全绿，而出厂包里是**没有任何测试见过的**产物。反向亦成立：手改补丁塞进任意内容，哨兵照过。堵它只需一条 5 行 pytest |
| **G-2** | **白名单只认名字**。`conversation-cost-panel.patch`（手维护，482 行 / 13 文件）是 CI 里**唯一真正 `git apply` 进出厂包**的补丁，而唯一扫它内容的测试只查「删除行是否含 copyright」 | 在这张补丁里加硬编码端点或读凭据的逻辑，8 例全绿，直接烧进分发给 20+ 人的整包。`gaps.md` 声称的「机械可验：补丁上下文行 grep Hermes = 0」**没有对应测试** |
| **G-3** | **红线扫描按点名册查、只认 5 个词**。唯一实体在 `test_bpa_dev_kit.py:109-116`，覆盖 6 个文件、查 `http:// https:// idealab api_key token=`。五目录 39 个文件中被任一红线断言扫到的仅 **10 个**；`build/` `patches/` `skills/` 整目录零覆盖 | **活证**：`deploy/assemble.cmd:94` 写着 `E:\BIAV-BP\black-pool-agent`，该文件**就在名单上**，5 个词一个不沾，至今全绿。路径 / UNC / IP / 密钥前缀 / 内网域这一整类全盲。且 `https://` 这条使断言**结构上无法推广**到含合法公开 URL 的档（`update.cmd` 因此被排除在外） |
| **G-4** | **铁律「upstream 零修改」零直接守卫**。`UPSTREAM.md:27` 记着 pin commit SHA，但**无人拿它比对**；`test_charter_skeleton_present` 甚至不检查 `upstream/` 是否存在 | 改任意一个补丁没碰过的上游文件（8,436 中补丁只覆盖 414 个）并提交 → 全绿，下次移 pin 时被无声吞掉 |
| **G-5** | **版权守卫方向装反**。`test_hermes_charter.py:66-78`：`"LICENSE" not in line` **大小写敏感**（`COPYING`/`NOTICE`/`license.txt` 畅通）、只查**删除**行（补丁**新增**一行伪造版权完全不触发）、词表只有两个词。同一大小写盲区在源头 `rebrand.py:608` 复现 | 两层防护栽在同一个坑上 |
| **G-6** | **补丁应用顺序与生产不一致**。生产序 = 规则引擎 → cost-panel；测试只验「cost-panel 对纯净 upstream」+「公版→私有版二连」，**三方全序从未被验过**——而三张补丁都改 `use-statusbar-items.tsx` | 品牌规则改到 cost-panel 上下文 → 测试全绿、装配当天炸；两条装配工作流均为 `workflow_dispatch`、不进 required 检查 |
| **G-7** | **rebrand.py 777 行零行为测试**。它是自写代码里最大的一块、两条装配 CI 的执行体（`--apply` 直接跑在货上），全仓无一条行为用例 | 对照之下 `apply_patch` / `assemble_inject` / `fix_venv_path` / `kill_by_path` 都有实打实的用例 |

> 小学生比喻（合）：这套防护像一栋只在两个房间装了探测器的房子，探测器只认金属；而真正的
> 大门——那台每天开工的机器——旁边连开关都没装，尽管它自己出厂时就带着一个没接线的检修按钮。

---

## 五 中危其余（择要，全部已确认）

**扫描覆盖面**：`build/rebrand.py:55-56` 的 `RUNTIME_DIRS` 只含 8 个目录，**漏掉仓根运行面**——
`upstream/cli.py`（**859 KB**、含 10 处 `Hermes Agent`、且是活代码：`hermes_cli/main.py:2705`
`from cli import main as cli_main`）从未被扫。其中 `cli.py:3972` `version_line = f"Hermes Agent v{_version}…"`
配上已被换成 `0.1.0` 的版本号，产出 **`Hermes Agent v0.1.0`** 这样的杂交横幅。
`BRANDING.md:63` 的残留清单只声明「website / docs 未扫」，未披露此运行面。

**静默成功**：`rebrand.py --apply /nonexistent/xyz` → **实测**输出 `applied private edition …: 0 files changed`、
rc=0。CI 路径写错或上游改目录名 → 该步骤绿灯，产出一个完全未换装的上游整包并直接进 Release。

**公版补丁引用了自己没携带的图标**：`rebrand.py:644` 用 `shutil.copyfile` **新建**
`nous-portal-icon.png`，而 `:720` 的 `git diff --binary` 只看已跟踪文件。**实测**：整张
`black-pool-rebrand.patch` 的新建 hunk 数 = **0**，`nous-portal-icon` 全文只出现 **1 次**（引用它的那行 `+`）。
`rebrand.py:730` 恰恰承诺「git apply 路径与 `--apply` 路径保持效果等同」。

**行尾随平台漂移**：`rebrand.py:688/694` 均用默认 `newline=None` → 组装台（`windows-latest`）
上 LF 档被静默转 CRLF。而 CI 紧接着 `git apply conversation-cost-panel.patch`，两者有 8 个文件重叠。

**分词器与插件**：词典 `read_text(encoding="utf-8")` 遇非 UTF-8 抛 `UnicodeDecodeError`（`ValueError` 子类，
**不被 `except OSError` 接住**）→ 穿透到 `initialize()` → 上游只 `logger.warning` 后返回 None →
**整个记忆功能静默消失**；BOM 会静默吃掉词典首词（上游读 yaml 用的是 `utf-8-sig`）；
CJK 字符类漏扩展区（Ext-A/B 汉字整块蒸发）；回填无事务批量（2 万条事实 = 4 万次 fsync，
首启阻塞）；`plugin.yaml` **没有 `kind` 字段**是它能被 memory 发现器捡到的前提，
一旦有人「补全」该字段即 AttributeError——建议加注释钉死。

**装配器**：`assemble_inject.py:82` 的 `_truthy` 在「关」的方向 **fail-open**（`foo.patch = off ; 停用`
带行内注释 → 判定为 **ON**）；选装表点名的条目零校验（键名拼错静默无效）；
`copy_tree` 无排除表 → 仓内**已实际存在**的 `plugins/memory/blackpool/__pycache__/`
（`.pyc` 内嵌银芯开发机绝对路径）会随包发货；补丁按**文件名排序**应用，而 ASCII 序下
`intranet` < `rebrand`，与实际依赖顺序（rebrand 必须在前）相反。

**诊断器**：`diagnose_lag.py` 产出的 `lag-report.txt` 汇集代理环境变量**原值**、部署位绝对路径、
**全机回环监听端口 + 属主映像名**、launcher/desktop 日志正文最多 24 行，**无脱敏层**；
而 `RUNBOOK.md:77` 写「把这份报告回传银芯即可远程续查」——银芯是**整层公开**。
另 `urlopen` 默认吃 `HTTP_PROXY`，使「本机回环延迟」实测的是代理链路（讽刺的是这正是本器
第 1 节亲自告警的那种配置）。

**其余静默项**：`fix_venv_path.py:92` 的 `bundle-root.txt` 印章**无条件**写成新根（哪怕本轮 0 命中）
→ 大小写不一致时第一轮 0 命中、印章已改，第二轮 `old==new` 直通，**包永久坏死**且全程报成功；
`launch_desktop.py:130` 按**全机映像名**判存活（旧路径同名进程在跑 → 假绿）；
`:91` `sorted(glob("*.exe"))[0]` 选主程序，当前靠品牌名首字母 `B` < `c`（crashpad handler）侥幸正确。

---

## 六 正面确认（照实记录，建议保留）

1. **MIT 合规三层一致**：`upstream/LICENSE` 在位且出厂清场未删；禁语（`自研`/`100%`/`from scratch`）
   扩展层 4 处命中**全部是禁令本身的引用**；补丁删除行 `Copyright`/`SPDX` **零命中**；
   `deploy/SOUL.md.template:17-18` 主动写入合规口径。
2. **红线在结果上守住**：私网 IP / UNC / `sk-`·`ghp_`·`AKIA` / `password=` / 真实机器名——**全项零命中**。
   `intranet` 补丁的价格表走 `HERMES_HOME/model-prices.json` 参数化读取，真值不进银芯。
   `dict.txt` 138 条全为公开游戏术语。
3. **扩展面契约逐项对齐**：记忆插件 `register(ctx)` 签名、8192 字节扫描启发式、`plugin.yaml` schema、
   四个必需方法签名、返回类型——与官方 holographic 示例逐项同形，纯子类化，零补丁零核心触碰。
   `gaps.md` 那条「扩展点走通」的正面记录属实。
4. **无注入面**：六个 deploy Python 文件中 `shell=True` / `os.system` / `os.popen` / `eval` / `exec` **零出现**。
5. **两个漂亮的不变量**：`assemble_inject.py:328` 最后才写 `MANIFEST.txt` + `deploy.cmd:31` 拒收无
   MANIFEST 的 staging → 组装中途断电的半成品不会被部署；`update.cmd:93` 下载先落 `.part` 再改名 →
   断电不产生冒充成品的 zip。
6. **`deploy/bin/black-pool`**：6 行 shell 别名，`set -euo pipefail` + `:-` 空值回落 + `"$@"` 完整引用 + `exec`
   不留壳进程——本次审计中唯一挑不出毛病的档。
7. **并发与幂等**（插件侧）：`_zh_index` 三处调用全在锁内、DELETE-then-INSERT by rowid 幂等、
   词典有 `lru_cache` 不重载、18 万字分词 0.159 秒无病态复杂度。

---

## 七 最省力的补强（按性价比，仅建议不实施）

| 序 | 动作 | 成本 | 堵住 |
|---|---|---|---|
| 1 | 把 `rebrand.py --check` 加成一个 pytest 用例 | **约 5 行** | G-1（最高危缺口，且工具已现成） |
| 2 | `apply_patch.py` 三处：`drift +=` 改 `drift =`；入口加 `dest.resolve().is_relative_to(root)` 断言；空 `old_block` 拒绝 | 各 1–3 行 | H-2 / H-3 / H-4 |
| 3 | `rebrand.py`：`--apply` 校验 `dest.is_dir()` 且拒绝 `dest == UPSTREAM`；`transform_*` 入口加已换装指纹检测 | 各 1–3 行 | H-1 / 静默成功 / 上游污染 |
| 4 | 红线扫描改为「遍历五目录全部文本档 + 正则族（UNC/IP/盘符/密钥前缀/内网域）+ 显式豁免自有公开 URL」 | 一次性重写 | G-3（26% → 全覆盖） |
| 5 | `black-pool-update.cmd`：`curl --fail` + 先验后毁 + `cd` 检查 + 补进两套 cmd 守卫名单 | 4 行 | H-6 |
| 6 | `update.cmd:106` 登记改为受 `SHAOK` 约束；`assemble.cmd:43` 验货绑定文件名 | 2 行 | H-7 |
| 7 | `zh_seg` 正则改 `[a-z0-9][a-z0-9._'-]*`，或 `_fts_candidates` 改 UNION 两表 | 一行/小改 | H-5 |
| 8 | 上游快照 SHA-256 台账 + 一例比对测试；子进程设 `PYTHONDONTWRITEBYTECODE=1` | 一次性 | G-4 / `__pycache__` 污染 |

---

## 八 待守密人裁定项

1. **`E:\BIAV-BP\…` 内网路径字面量 3 处**（`assemble.cmd:94`、`RUNBOOK.md:12/64`）——按文书红线
   字面属「内网路径」，危害极低（无主机名无凭据，`BIAV-BP` 一词本就写在公开 CLAUDE.md §1.1 里），
   但它证明了路径类值不过安检。改占位符 / 维持现状？
2. **`author:` 归属行改写 4 处（含两位真实第三方贡献者姓名）**——回退并加 `author:` 跳线 /
   维持现状并在 BRANDING 残留清单登记？
3. **`diagnose_lag.py` 报告回传口径**——报告含代理原值 / 全机端口清单 / 日志正文，而 RUNBOOK
   写「回传银芯」而银芯整层公开。加脱敏层 / 改口径为「人工审阅后回传」？
4. **「公版 = 纯品牌换装」措辞**——实际含默认语言 / 皮肤 / 版本三项行为变更（均有裁定在册）。
   修订措辞 / 维持现状？
5. **修复实施的优先级与批次**——本报告只审不修，是否派发修复、先修哪一批？

---

**审计纪律声明**：全程只读，未修改 `projects/black-pool-agent/` 任何档案；实测均在会话
scratchpad 的临时副本上进行。凡未实测者已按「已确认（静态可证）／待证（需 Windows 侧实机）」
分档标注，不含推测性结论。
