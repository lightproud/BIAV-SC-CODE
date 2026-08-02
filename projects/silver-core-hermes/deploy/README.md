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

## Windows 受限环境分发（PowerShell 受限 / 安装器不可用时）

> 源码实证（pin v2026.7.30）：`install.ps1` 仅被 bootstrap-installer（装完整本机运行时）
> 驱动；desktop 为 electron-builder 打包且 remote 模式原生在（`$connection.mode='remote'`
> + baseUrl + 远程 pool profile）。据此**零 PowerShell 分发形态**：

1. **运行时不上 Windows**：Hermes 运行时集中部署内网 Linux 服务器（uv + 内网 PyPI 镜像，
   文书 §2.1 离线可重建），Windows 端零运行时。
2. **终端三选接入**（均零安装器）：
   - 钉钉网关（文书首战入口）；
   - 浏览器直开 web dashboard（`web_server.py` 静态托管 web/ 产物）；
   - **desktop portable 包 + remote 模式**：组装期以 electron-builder 出 zip/portable 目标
     （CLI 加 `--win zip`，同上游 `dist:mac:zip` 先例，免 NSIS/MSI 免 PowerShell、
     通常免管理员），共享目录分发、解压即用，首启配置 remote 连接指向内网服务端。
3. 备选：若环境仅限 PowerShell 脚本、不限 exe——NSIS per-user 安装器本身不依赖
   PowerShell，可直接使用（须实测目标环境策略后再采）。

## 补丁维护（移 pin 例程的一部分）

- 补丁**不手写**：规则与排除谓词在 `deploy/rebrand.py`，`patches/silver-core-rebrand.patch`
  是其确定性输出。移 pin 后重跑 `python3 deploy/rebrand.py` 重生成；
  `--check` 为漂移守卫（补丁与规则输出不一致即红）。
- 红线：LICENSE / 版权行 / URL / `HERMES_*` 环境变量 / `X-Client-Name` 遥测头不碰
  （守卫 `tests/test_hermes_charter.py`）。
- 残留清单与范围理由见 `../BRANDING.md`。
