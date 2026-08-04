# bpa-dev 车间手册（银芯单向输出件，零内网值）

> 本目录 = **全部拷走型部署件的统一收纳位**（守密人 2026-08-03 裁定「统一放进
> bpa-dev\deploy」；2026-08-03 终编：仓库侧本目录即部署件全集，生产工具另居 build/）：车间三脚本 + 补丁应用器 + 启动器家族（launcher / 监督器 /
> venv 自愈）+ SOUL 模板 + 整包更新器 + CLI 别名，一目录拿全。整目录拷入
> `黑池\bpa-dev\deploy\` 即可用；凭据、端点、内网参数一律只活在
> `bpa-dev` 的兄弟目录里，**永不回流银芯**（§1.1-HC）。

## 目录约定（脚本按此找料，缺哪个跳哪步）

```
E:\BIAV-BP\bpa-dev\   （内部开发目录；部署目录 = E:\BIAV-BP\black-pool-agent）
├── releases\      # 进料：银芯 black-pool-bundle Release 下载的 zip（只进不改，留最近 2-3 版）
│   └── CHECKSUMS.txt   # 每行含官方 SHA-256（Release 页 digest 可复制）；存在则强制验货
├── patches\       # 内网自持补丁（*.patch，git diff 格式，按文件名序应用）
├── plugins\       # 黑池专属插件 → 拷入 app\plugins\（银芯 vendor 镜像
│                  #   projects\black-pool-agent\plugins\ 整拷进来即随装配入包；
│                  #   插件各自的激活方式见其 README。2026-08-04 起该镜像为空：
│                  #   blackpool 记忆插件已退役，原因见 gaps.md）
├── skills\        # 内网技能 → 拷入 home\skills\
├── config\        # SOUL.md → home\；env.cmd → 包根；deploy-target.txt = 部署目录地址一行（凭据/端点的唯一的家）
│                  #   git-root.txt = 银芯克隆根一行（可选，供 update.cmd 第①步；缺省自动探测）
│                  #   assembly.txt = 选装表（可选，缺省全拼）：五节 patches/plugins/skills/config/overlay
│                  #     逐条 name = on/off，"* = on/off" 定节内缺省；样例见 deploy\assembly.sample.txt
│                  #   env.cmd 由 launcher 启动时 call——企业根证书/代理等在此注入，例：
│                  #     set "SSL_CERT_FILE=%~dp0home\corp-ca.pem"
│                  #     set "REQUESTS_CA_BUNDLE=%SSL_CERT_FILE%"
│                  #     set "HTTPS_PROXY=..."（按内网实际；真值只写在内网这份文件里）
│                  #   model-prices.json → home\：成本面板自定义价格表（每百万 token 四价），例：
│                  #     {"models": {"qwen": {"input": 4, "output": 12, "cache_read": 0.4}}}
│                  #     模型名最长子串匹配；改档热生效；面板货币符号当前固定 $（数值口径自定）
├── overlay\       # 万能覆盖层：内容原样覆盖到包根（以上四类盖不住的任意路径用它）
├── staging\       # 组装工作台（脚本自建自清，勿入 SVN）
└── deploy\        # 本目录：部署件统一收纳（车间脚本 + 启动器家族 + 模板）
```

## 取件两式（守密人 2026-08-03 问答定式）

- **映射式（推荐）**：`黑池\bpa-dev\deploy` 经 `svn:externals` 挂到银芯 vendor 镜像内
  `projects/black-pool-agent/deploy`（源与挂载同名，一层不多）——脚本随 `svn update` 自动保鲜。
  脚本全部按**挂载点**相对定位（`%~dp0..` = 车间根），日志与运行痕迹只写车间根，
  vendor 映射目录保持零写入（只读纪律不破）。
- **手拷式（兜底）**：镜像不便外链时，整目录拷入 `黑池\bpa-dev\deploy\`，银芯更新后手动重拷。

## 三步操作

0. **一键更新 `update.cmd`（守密人 2026-08-04 裁定，日常推荐入口）**：六步流水线
   ① 银芯克隆 `git pull --ff-only`（克隆根自动探测；探不到时在 `config\git-root.txt`
   写一行路径启用，没 git 就跳过）→ ② 车间根 `svn update`（顺带保鲜 deploy\ 外链；
   没 svn 命令行就跳过）→ ③ 下载最新整包进 `releases\`（SHA-256 实测比对 Release
   官方 digest，通过即登记 CHECKSUMS.txt；下载失败可选用现存最新包继续；
   `update.cmd nodl` 显式跳过下载）→ ④⑤⑥ 依次调 assemble → deploy → 启动部署位。
   底下三件照旧可单跑（诊断 / 只重部署 / 回滚排障）。脚本开跑先自拷 TEMP 再执行——
   ①② 会改写 update.cmd 自身，cmd 边读边跑，不自拷会解析错乱；日志 `车间根\update.log`，
   套件目录保持零写入。
1. **组装** `assemble.cmd [zip名]`：验 SHA → 净台解压 → 注入阶段整体交
   `assemble_inject.py`（包内 Python）：按**选装表** `config\assembly.txt` 决定
   拼哪些补丁 / 插件 / 技能 / 配置 / 覆盖层（表不存在 = 全拼；样例
   `deploy\assembly.sample.txt` 拷去改名即用；补丁走 `apply_patch.py`，任一张
   上下文不匹配即整体失败绝不半打）→ 出 `staging\BlackPool\` + 两份地面真相文档：
   **`ASSEMBLY.md`**（人读装配清单：进料指纹 / 补丁逐张增删行数 / 插件带版本 /
   注入配置**只记指纹绝不记内容** / 跳过项逐条点名）+ `MANIFEST.txt`（机读短块）。
2. **部署** `deploy.cmd [部署目录]`：目标取参数 > 环境变量 BPA_DIR > `config\deploy-target.txt`
   （文件里写一行地址，**支持相对路径、按车间根 bpa-dev\ 解析**——写 `..\black-pool-agent`
   则整棵树搬盘符零改配置；绝对路径如 `E:\BIAV-BP\black-pool-agent` 亦可。写好后**双击即部署**，rollback 同理）：旧 `home\` 用户数据增量并入
   新包（不覆盖注入的配置）→ 旧版让位 `<目录>.old` 回滚位 → 成品上位。
3. **回滚** `rollback.cmd <部署目录>`：一键回切 `.old`，问题版留 `.failed-*` 供取证。
4. **启动**：deploy 会在部署位生成带图标的 **`Black Pool.lnk`**（图标取自主程序，可拷到桌面/任务栏）；
   或双击 `launcher.cmd`；或直接双击**车间里的** `deploy\launcher.cmd`——
   它检测到自己不在包内时，会按 `config\deploy-target.txt` 自动转发到部署位（kit 模式零写入）。

## 卡顿分诊（2026-08-04「界面交互 5-10 秒」现场反馈后置备）

界面整体迟缓时双击 `deploy\diagnose.cmd`（车间里跑会自动按 `config\deploy-target.txt`
定位部署位，无需重新组装）：分诊器逐层实测**部署位盘型（网络盘/本地盘）→ 进程普查 →
网关回环往返（含 localhost vs 127.0.0.1 的 IPv6 回退比对）→ 散文件读采样（杀软/SMB
放大器）→ 子进程冷启采样（杀软 spawn 拦截）→ MOTW 普查 → 日志取证（网关早夭重启循环）**，
末尾给判读提示，全文落部署位 `lag-report.txt`——把这份报告回传银芯即可远程续查。
常见判读速记：网络盘 = 整拷回本地；散文件读 >20ms/件或 python 复启 >3s = 给部署目录加
杀软排除项；MOTW 命中 = zip 解锁后重解压；日志见反复 attempt/respawn = 网关早夭，
主进程被同步探针钉住（单针可达 10 秒级），把 `home\logs\` 一并回传。

### 第 8 节：应用内延迟埋点（2026-08-04 起随包烧入）

前 7 节量的是**环境**；第 8 节读**应用自己记的账**，把「慢在哪一层」从猜升级为读：

| 埋点 | 落点 | 说明 |
|---|---|---|
| 网关逐 RPC 计时 | `home\logs\gateway.log` 的 `slow rpc method=… lane=… ms=…` | `lane=inline` = 该处理器执行期间 WS 读循环停摆，**后面每个请求都跟着等**；`queue_ms` 高 = 线程池被占满 |
| 渲染端往返计时 | `home\logs\desktop.log` 的 `[lag] gateway rpc …` | `outcome=reconnected` = 这次交互先重连再完成（掉线风暴的指纹）|
| 渲染端主线程阻塞 | 同上，`[lag] renderer main thread blocked ms=…` | 界面层自己卡住（绘制 / JS 长任务 / 软渲染），与网关无关 |
| 渲染模式 | `home\logs\render-mode.txt` | `mode=software` = 本次经 `--disable-gpu` 回退起飞，界面必然慢 |

- 阈值旋钮：网关侧 `HERMES_RPC_SLOW_MS`（默认 800，设 0 关闭）；渲染端固定 1.5 秒 / 1 秒。
  **一切埋点只在超阈时出声**，跑得顺的机器日志里一个字都不多。
- 软渲染验证旋钮：`set BLACK_POOL_FORCE_GPU=1` 后启动——**能开 = 回退没在生效**（卡顿另有其因），
  **开不了 = 平时就在软渲染上跑**（先治首试早夭，别治卡顿）。
- 取证姿势：正常用 3-5 分钟、把卡的操作各做几次，**然后**跑 `diagnose.cmd`，回传 `lag-report.txt`
  （必要时加 `home\logs\`）。埋点是滚动日志，先跑分诊再用软件反而什么也抓不到。

### 已实测的秒级放大器：端点「被丢」而非「被拒」（2026-08-04 银芯台架实证）

同一份代码、同一台机器，只改一个变量——目标端点是**静默丢包**还是**立刻拒绝**：

| provider 端点形态 | model.options（首次） | 首轮交互突发合计 |
|---|---|---|
| 丢包（防火墙 DROP，不回 RST）| **4058–6267 ms** | **9.7 s** |
| 立刻拒绝（RST）| **232 ms** | **1.05 s** |
| 目录已缓存（热态）| ~30 ms | ~0.83 s |

差 12 倍以上，量级正是现场报的「5-10 秒」。机制：应用**首次触碰**某个外部端点
（模型选择器 / 目录 / 定价 / 账户探测）时要等满整个超时；被拒是毫秒，被丢是秒级。
缓存落 `home/` 后不再探测，所以症状表现为「用着用着某个操作忽然卡一下」而非稳定慢。

处置按可行性排序：① 让防火墙对这些主机回 **REJECT** 而非 DROP（改一条策略即可）；
② `config\env.cmd` 里把代理配对（含 `set NO_PROXY=127.0.0.1,localhost`）；
③ 首次部署时短暂放行一次出网，把目录/定价缓存喂热。
分诊器第 9 节会逐个端点报 OK / REFUSED / DROPPED 并点名。

## 纪律（写给将来的自己）

- **补丁射程**：Python 面（agent / hermes_cli / gateway / tools）打完即生效；
  desktop / web UI 是已构建产物，**内网改不动**——UI 需求走银芯补丁入库、CI 装配线出包。
- **补丁登记**：patches\ 里每张补丁在 README 记一行「用途 / 锚点 / 维护人」，学银芯白名单制。
- **换包必经组装**：直接解压 zip 进部署位会丢掉全部内网补丁与配置——永远走 assemble → deploy。
- **整包不载测试套件（2026-08-04 野战案）**：出厂清场已裁掉 `app\tests`，且整包 venv 刻意
  不带 pytest——在部署位跑 `scripts\run_tests.sh` 结构上不可能成功，这不是环境坏了。
  运行器已在出厂时换成直说真相的存根（跑它会明说原因并指路）。真要跑套件：场地是银芯
  克隆的 `projects\black-pool-agent\upstream\`，配方见同目录 `CONTEXT.md` 验证清单
  （uv sync 带 dev extras + 设 `HERMES_PYTHON`）；当前整包引擎版本已在银芯容器全量
  复现过（零真缺陷报告在 `Public-Info-Pool\Resource\repo-engineering\`），本地重跑无增量。
- **绿色版二次拷贝纪律（2026-08-04 实机断料案）**：包本身是绿色版，但把部署位拷去
  另一位置/另一台机时，**必须用不过滤目录的整拷方式**（`robocopy <源> <目标> /e` 或
  Explorer 整目录复制后核对件数）——部分同步/备份工具默认跳过 `node_modules` 目录，
  会把 `desktop\resources\app.asar.unpacked\dist\node_modules\node-pty` 拷丢，桌面端
  启动即弹「A JavaScript error occurred in the main process / Cannot find package」。
  监督器（launch_desktop.py）起飞前有关键件预检，缺料会点名并拒绝起飞；见到预检报缺 =
  重新整拷或在目标机走一遍 assemble → deploy。
- **用户数据解耦（可选）**：config\env.cmd 里设 `HERMES_HOME` 指向 bpa 之外的固定目录，
  用户数据从此不随包走，deploy 的 home 保全步自动变为空操作。
- **staging 与 *.old / *.failed-* 勿入 SVN**：都是临时态或取证残骸。
- **目录占用的两级处置（2026-08-04 野战第三案后）**：deploy 先试常规轮换（清障 3 轮：
  TSVNCache / 旧桌面 exe / 按路径杀进程），仍占用则自动降级**就地覆盖模式**（robocopy /mir
  把成品镜像进原目录）——因为最常见的顽固占用者是「当前目录停在部署位里的 cmd / 资源管理器
  窗口」，这种锁只挡目录改名、不挡文件覆盖，杀又不能杀（程序本体在系统目录）。就地模式
  **不刷新回滚位**，脚本会明说；想要干净轮换，把停在部署位里的窗口关掉再跑即可。
- **cmd 脚本 65001 三案纪律**：rem 行 ASCII 短行（守卫在测）；goto 标签后的失败/回退块
  **整块 ASCII**——块内 UTF-8 echo 会让解析器字节错位、把半截汉字当命令执行。
- **cmd 括号块禁展开 `%~f0` / `%~dp0` / `%*`（2026-08-04 update.cmd 首战案）**：路径或
  参数一旦含 ASCII 括号（Explorer 重名自动改 "xxx (1)"、带括号目录名），括号块内展开出的
  `)` 提前闭块、语法错乱、**双击窗口秒关零留痕**。开窗/自拷引导块一律 goto 式（守卫在测）；
  update.cmd 每次启动在 `%TEMP%\black-pool-update-boot.log` 落面包屑，闪退后先看它。
