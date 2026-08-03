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
├── plugins\       # 黑池专属插件 → 拷入 app\plugins\（银芯产 blackpool 记忆插件：从
│                  #   vendor 镜像 projects\black-pool-agent\plugins\ 整拷进来即随装配入包；
│                  #   激活一次即可：launcher.cmd cli config set memory.provider blackpool）
├── skills\        # 内网技能 → 拷入 home\skills\
├── config\        # SOUL.md → home\；env.cmd → 包根；deploy-target.txt = 部署目录地址一行（凭据/端点的唯一的家）
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

1. **组装** `assemble.cmd [zip名]`：验 SHA → 净台解压 → 打补丁（包内 Python 跑
   `apply_patch.py`，无需 git；任一张上下文不匹配即整体失败，绝不半打）→ 注配置
   插件 → 出 `staging\BlackPool\` + `MANIFEST.txt`（用了哪版 zip、哪些补丁，来历三行可查）。
2. **部署** `deploy.cmd [部署目录]`：目标取参数 > 环境变量 BPA_DIR > `config\deploy-target.txt`
   （文件里写一行地址，**支持相对路径、按车间根 bpa-dev\ 解析**——写 `..\black-pool-agent`
   则整棵树搬盘符零改配置；绝对路径如 `E:\BIAV-BP\black-pool-agent` 亦可。写好后**双击即部署**，rollback 同理）：旧 `home\` 用户数据增量并入
   新包（不覆盖注入的配置）→ 旧版让位 `<目录>.old` 回滚位 → 成品上位。
3. **回滚** `rollback.cmd <部署目录>`：一键回切 `.old`，问题版留 `.failed-*` 供取证。
4. **启动**：deploy 会在部署位生成带图标的 **`Black Pool.lnk`**（图标取自主程序，可拷到桌面/任务栏）；
   或双击 `launcher.cmd`；或直接双击**车间里的** `deploy\launcher.cmd`——
   它检测到自己不在包内时，会按 `config\deploy-target.txt` 自动转发到部署位（kit 模式零写入）。

## 纪律（写给将来的自己）

- **补丁射程**：Python 面（agent / hermes_cli / gateway / tools）打完即生效；
  desktop / web UI 是已构建产物，**内网改不动**——UI 需求走银芯补丁入库、CI 装配线出包。
- **补丁登记**：patches\ 里每张补丁在 README 记一行「用途 / 锚点 / 维护人」，学银芯白名单制。
- **换包必经组装**：直接解压 zip 进部署位会丢掉全部内网补丁与配置——永远走 assemble → deploy。
- **用户数据解耦（可选）**：config\env.cmd 里设 `HERMES_HOME` 指向 bpa 之外的固定目录，
  用户数据从此不随包走，deploy 的 home 保全步自动变为空操作。
- **staging 与 *.old / *.failed-* 勿入 SVN**：都是临时态或取证残骸。
