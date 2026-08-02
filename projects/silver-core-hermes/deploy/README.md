# deploy/ — 通用部署与品牌组装（零内网值）

> 施工边界：本目录只放**参数化通用件**；端点、凭据、内网路径一律在内网侧部署配置
> （文书裁 5 切面化）。生产禁用 `hermes update`（文书 §2.4），更新只有「换 tag 重测」。

## 品牌换装组装流程（需求 #1，守密人 2026-08-02）

1. 取纯净源：从生产供应链 vendor 仓（或本仓 `upstream/` 开发镜像）拷出组装副本 `DEST/`。
2. 应用品牌补丁（二选一，效果相同）：
   - `git apply --directory=DEST patches/silver-core-rebrand.patch`（可审计补丁）
   - `python3 deploy/rebrand.py --apply DEST`（规则引擎直施）
3. TUI 为 TypeScript 源码：补丁改的是 `ui-tui/src/`，组装后须按上游流程重建 TUI 产物。
4. 身份：`deploy/SOUL.md.template` 拷入 HERMES_HOME 为 `SOUL.md`（身份槽 #1，
   产品自称 Silver Core、知识层统一称「知识底座」）。
5. 命令名：`deploy/bin/silver-core` 拷入 PATH（`SILVER_CORE_HERMES_BIN` 可指定入口）。
6. 钉钉显示名：在钉钉应用后台把机器人显示名设为 Silver Core（配置属内网侧，不入本仓）。

## Windows 本机便携分发（守密人 2026-08-02 裁定：不走服务端部署；PowerShell 受限）

> 事实底：`install.ps1`（3,888 行）仅服务「安装器装本机运行时」一条路，PowerShell 受限即废；
> 复刻它是死路。**便携整包（portable bundle）整条绕开安装器**：构建机组装、共享目录分发、
> 复制即用——与 BPT 现状同形（本机运行、无服务端）。

**组装台 = 银芯 CI，产物合箱单目录（守密人 2026-08-02 两裁）**：
`.github/workflows/assemble-silver-core-bundle.yml`（workflow_dispatch，Windows runner——
Windows venv 不可跨平台组装，故必须 Windows 台）单 job 产**唯一资产** `silver-core-win64.zip`
落 [`silver-core-bundle` Release](https://github.com/lightproud/BIAV-SC-CODE/releases/tag/silver-core-bundle)：
解压即一个 `SilverCore\` 目录（运行时 + desktop `--win dir` 免装形态 + launcher，含就地搬移
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

- 源：`deploy/brand-assets/`（icon.png / icon.ico / apple-touch-icon.png / brand-tile.jpg），
  由 `deploy/gen_brand_assets.py` 从**单一源图**生成；组装期经 rebrand.py `ASSET_OVERLAYS`
  覆盖进树（补丁亦以 `--binary` 段等效承载，两条应用路径效果相同）。
- **换图流程（守密人正式供图后）**：把新图存为 `deploy/brand-assets/source.png` →
  `python3 deploy/gen_brand_assets.py` → `python3 deploy/rebrand.py` → 提交三处产物。
  正式图未落仓前以仓内艾瑞卡立绘占位（2026-08-02 裁定）。
- 应用显示名（About 面板 / 菜单 / 任务管理器）走上游官方环境针
  `HERMES_DESKTOP_APP_NAME=Silver Core`（launcher.cmd 与 launch_desktop.py 已内置）。

## 补丁维护（移 pin 例程的一部分）

- 补丁**不手写**：规则与排除谓词在 `deploy/rebrand.py`，`patches/silver-core-rebrand.patch`
  是其确定性输出。移 pin 后重跑 `python3 deploy/rebrand.py` 重生成；
  `--check` 为漂移守卫（补丁与规则输出不一致即红）。
- 红线：LICENSE / 版权行 / URL / `HERMES_*` 环境变量 / `X-Client-Name` 遥测头不碰
  （守卫 `tests/test_hermes_charter.py`）。
- 残留清单与范围理由见 `../BRANDING.md`。
