# build/ — 品牌换装生产工序（银芯侧原地运行）

> 施工边界：本目录只放**参数化通用件**；端点、凭据、内网路径一律在内网侧部署配置
> （文书裁 5 切面化）。生产禁用 `hermes update`（文书 §2.4），更新只有「换 tag 重测」。

**两类件分区收纳（守密人 2026-08-03 裁定「部署件统一放进 bpa-dev\deploy」）**：
- **deploy/ 根 = 生产工具（原地运行，银芯侧）**：`rebrand.py` / `gen_brand_assets.py` /
  `brand-assets/`——在本仓跑，产补丁与资产。
- **`bpa-dev/deploy/` = 全部拷走型部署件的唯一收纳位（内网侧）**：车间三脚本
  （assemble / deploy / rollback）+ `apply_patch.py` + 启动器家族（`launcher.cmd` /
  `launch_desktop.py` / `fix_venv_path.py`，CI 装配进包）+ `SOUL.md.template` +
  `black-pool-update.cmd` + `bin/black-pool`。内网拿件 = 拷这一个目录进
  `黑池\bpa-dev\deploy\`。部署件在本仓原地双击跑不出正确结果——它们按目的地的相对布局找料。

## bpa-dev/ — 黑池组装车间套件（守密人 2026-08-03 裁定产出）

`assemble.cmd`（验SHA → 解压 → 打内网补丁 → 注配置插件 → 出 staging + MANIFEST）·
`deploy.cmd`（home 保全 → 旧版转 .old 回滚位 → 上新）· `rollback.cmd`（一键回切）·
`apply_patch.py`（纯标准库统一 diff 应用器，内网无 git 也能打补丁，用包内 CPython 跑；
全量 check 通过才落盘，上下文不匹配响亮失败；守卫 `tests/test_bpa_dev_kit.py`，
含对真特性补丁 482 行 / 13 档的实弹 check）。目录约定与纪律见 `bpa-dev/RUNBOOK.md`。

## 品牌换装组装流程（需求 #1，守密人 2026-08-02；2026-08-03 定名黑池 v0.1.0 + 两版体系）

> **品牌与版本**：品牌名**黑池（Black Pool）**，`Hermes Agent` 对应 `Black Pool Agent`，
> 发布版本号 **0.1.0**。**两版体系**：公版 = 纯品牌换装（`black-pool-rebrand.patch`）；
> 私有版 = 公版 + 内网/便携适配层（叠加 `black-pool-intranet.patch`：自更新三入口封堵、
> Billing / Cloud / Telegram 托管配对等云绑定面摘除）。组装台默认出**私有版**。

1. 取纯净源：从生产供应链 vendor 仓（或本仓 `upstream/` 开发镜像）拷出组装副本 `DEST/`。
2. 应用补丁（二选一，效果相同）：
   - `git apply --directory=DEST patches/black-pool-rebrand.patch patches/black-pool-intranet.patch`
     （可审计补丁，按序 = 私有版；只打第一张 = 公版）
   - `python3 build/rebrand.py --apply DEST [--edition public]`（规则引擎直施，缺省私有版）
3. TUI 为 TypeScript 源码：补丁改的是 `ui-tui/src/`，组装后须按上游流程重建 TUI 产物。
4. 身份：`deploy/SOUL.md.template` 拷入 HERMES_HOME 为 `SOUL.md`（身份槽 #1，
   产品自称 Black Pool（黑池）、知识层统一称「知识底座」）。
5. 命令名：`deploy/bin/black-pool` 拷入 PATH（`BLACK_POOL_HERMES_BIN` 可指定入口）。
6. 钉钉显示名：在钉钉应用后台把机器人显示名设为 Black Pool 或 黑池（配置属内网侧，不入本仓）。

## Windows 本机便携分发（守密人 2026-08-02 裁定：不走服务端部署；PowerShell 受限）

> 事实底：`install.ps1`（3,888 行）仅服务「安装器装本机运行时」一条路，PowerShell 受限即废；
> 复刻它是死路。**便携整包（portable bundle）整条绕开安装器**：构建机组装、共享目录分发、
> 复制即用——与 BPT 现状同形（本机运行、无服务端）。

**组装台 = 银芯 CI，产物合箱单目录（守密人 2026-08-02 两裁）**：
`.github/workflows/assemble-black-pool-bundle.yml`（workflow_dispatch，Windows runner——
Windows venv 不可跨平台组装，故必须 Windows 台）单 job 产**唯一资产** `black-pool-win64.zip`
落 [`black-pool-bundle` Release](https://github.com/lightproud/BIAV-SC-CODE/releases/tag/black-pool-bundle)：
解压即一个 `BlackPool\` 目录（运行时 + desktop `--win dir` 免装形态 + launcher，含就地搬移
冒烟测试验 relocatable 与合箱完整性）。**zip 仅为传输载体**（Releases 只能放文件）：
守密人解压一次进内网共享目录，此后团队用户面 = **纯目录复制、双击 launcher.cmd 即用**，
全程零解压零安装零 PowerShell。以下为该工作流所执行工序的等价手工描述：

**整包组装（构建机一次做，产物 = 一个 zip）**：
1. 组装副本 = upstream 快照 + 品牌补丁（本档上节流程）。
2. 便携 Python：`uv python install <pin 版>` 把托管 CPython 装进包内目录（免系统 Python）。
3. 依赖：`uv sync --locked --relocatable`（uv 原生可迁移 venv）从内网 PyPI 镜像装进包内；
   若个别包 relocatable 失灵，回退**固定解压路径约定**（统一解压到同一盘符路径，venv 按该路径构建）。
4. desktop：electron-builder 出 zip/portable 目标（同上游 `dist:mac:zip` 先例，免 NSIS/MSI），
   配 local 模式（运行时同机）。
5. 启动器 `launcher.cmd`（cmd 批处理，非 PowerShell）：设 `HERMES_HOME` 指包内、前置包内
   Python/venv 于 PATH、拉起网关与 desktop。

**分发与升级**：zip 落内网共享目录，用户复制解压即用（免管理员、免安装器、免 PowerShell）；
升级 = 换 tag 重测后重发新 zip、整目录替换（与文书 §2.4「换 tag 重测」唯一更新通道一致，
生产禁 `hermes update` 不变）。

**合规联动（守密人 2026-08-02 交互裁定已闭）**：文书裁 7 报备口径不变（常规迭代不另行申报），
其成立前提修订为「数据面与现状完全一致 + 免安装器便携分发（与 BPT 现状同形）」。

## 品牌图标（2026-08-02 补漏 #2）

- 源：`build/brand-assets/`（icon.png / icon.ico / apple-touch-icon.png / brand-tile.jpg），
  由 `build/gen_brand_assets.py` 从**单一源图**生成；组装期经 rebrand.py `ASSET_OVERLAYS`
  覆盖进树（补丁亦以 `--binary` 段等效承载，两条应用路径效果相同）。
- **换图流程（守密人正式供图后）**：把新图存为 `build/brand-assets/source.png` →
  `python3 build/gen_brand_assets.py` → `python3 build/rebrand.py` → 提交三处产物。
  正式图未落仓前以仓内艾瑞卡立绘占位（2026-08-02 裁定）。
- 应用显示名（About 面板 / 菜单 / 任务管理器）走上游官方环境针
  `HERMES_DESKTOP_APP_NAME=Black Pool`（launcher.cmd 与 launch_desktop.py 已内置）。

## 补丁维护（移 pin 例程的一部分）

- 补丁**不手写**：规则与排除谓词在 `build/rebrand.py`，`patches/black-pool-rebrand.patch`（公版）与
  `patches/black-pool-intranet.patch`（私有版叠加层）是其确定性输出。移 pin 后重跑 `python3 build/rebrand.py` 重生成；
  `--check` 为漂移守卫（补丁与规则输出不一致即红）。
- 红线：LICENSE / 版权行 / URL / `HERMES_*` 环境变量 / `X-Client-Name` 遥测头不碰
  （守卫 `tests/test_hermes_charter.py`）。
- 残留清单与范围理由见 `../BRANDING.md`。
