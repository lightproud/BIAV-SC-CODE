# BRANDING.md — 品牌换装范围台账（需求 #1，守密人 2026-08-02 两项交互裁定）

> **定名与两版体系（守密人 2026-08-03 裁定，覆盖本档此前所有 Silver Core 措辞）**：
> 品牌名**黑池（Black Pool）**，`Hermes Agent` 对应 `Black Pool Agent`；发布版本号 **0.1.0**
> （About 声明与 Release 携带）。补丁两版分层：**公版** = 纯品牌换装
> （`patches/black-pool-rebrand.patch`）；**私有版** = 公版 + 内网/便携适配叠加层
> （`patches/black-pool-intranet.patch`：自更新三入口封堵 + Billing / Cloud / Telegram
> 托管配对等云绑定面摘除）。组装台默认出私有版。
> **本裁定同时覆盖下段 2026-08-02 ②「Black Pool / 黑池字样不出现于任何用户可见文案」条款**
> ——该条款立于黑池尚属隐藏内部层名之时，随产品定名黑池自然作废；「知识层统一称知识底座」
> 部分不受影响、继续有效。本档正文历史行文中的 Silver Core 均为定名前旧称，作史实保留。

裁定（2026-08-02）：① 零侵入套件 + 开 `patches/` 全量抹净并行；② 产品面知识层统一称
**「知识底座」（Knowledge Base）**，~~Black Pool / 黑池字样不出现于任何用户可见文案~~
（②后半句已被 2026-08-03 定名裁定覆盖，见上）。

## 已覆盖面（pin v2026.7.30 实测）

| 面 | 手段 | 量 |
|----|------|----|
| 对话人格自称 | `deploy/SOUL.md.template`（身份槽 #1，原生机制零侵入） | 1 档 |
| 兜底身份句（SOUL.md 缺席时） | 补丁：`You are Hermes Agent, … created by Nous Research.` → `You are Silver Core, …` | 1 处 |
| 运行面显示串 `Hermes Agent` → `Silver Core` | 规则补丁（agent / hermes_cli / gateway / tools / plugins / ui-tui/src / **apps / web**） | 合计 390 文件 / 43,718 行 diff（含二进制 b85 段） |
| `Hermes profile` → `Silver Core profile` | 同上 | 30 处 |
| `hermes-tui` 诊断前缀 → `silver-core-tui` | 同上 | 10 处 |
| **desktop / web / TUI 裸词 `Hermes`**（productName / 窗口标题 / i18n 全语种文案值 / UI 字面量） | 词边界正则（`BARE_WORD_DIRS`：apps · web · ui-tui/src，**守密人 2026-08-02 补充情报「内部主要消费面是 desktop」后扩入**）；标识符免疫实证（i18n 键 `updateHermes` / 类名不触，小写 `hermes` 包名/scheme 永不碰）；**连字符入免疫边界（2026-08-02 生产事故订正，lesson #57）**——`X-Hermes-Session-Token` 头名曾被换成含空格非法头名，desktop 设置页全线 ERR_INVALID_HTTP_TOKEN 崩加载 | 含于上行合计 |
| **大写字标 `HERMES AGENT` → `SILVER CORE`**（对话空态巨幅 wordmark / bootstrap-installer 欢迎页，2026-08-02 补漏 #1） | 通用规则追加（大小写敏感故原三条全部漏它） | 5 处 |
| **窗口标题 `<title>`**（desktop / web / bootstrap-installer 的 index.html——任务栏 / Alt-Tab 显示名实际来源，2026-08-02 补漏 #3） | `.html` 扩入扫描后缀 | 3 档 |
| **应用显示名 APP_NAME**（About 面板 / 菜单标签 / `app.setName`；其兜底行含 `HERMES_` 被跳线保留，2026-08-02 补漏 #3） | 上游官方环境针 `HERMES_DESKTOP_APP_NAME=Silver Core`（launcher.cmd + launch_desktop.py 双设，零侵入） | 2 件 |
| **应用图标 / 品牌图像**（win exe · 任务栏 · 托盘 · 窗口图标 · favicon · About 页 BrandMark，2026-08-02 补漏 #2） | 二进制覆盖 `deploy/brand-assets/`（`gen_brand_assets.py` 单源图生成全套；rebrand.py `ASSET_OVERLAYS` 组装期覆盖 + 补丁 `--binary` 段等效承载）。源图 = 守密人 2026-08-02 正式供图 `deploy/brand-assets/source.png`（白纱人偶 · 256px，经 GitHub 直传落仓）；日后换图 = 换源图重跑两生成器 | 4 件 |
| **About 页出身声明 + 自更新区 / Danger zone 隐藏**（守密人 2026-08-02 三裁：①直接说明「B.I.A.V. Studio 基于 Hermes <版本> 的定制版本」②不再展示自更新区——便携包生产禁用 `hermes update`（文书 §2.4），该区只会报 git checkout 错误误导③Danger zone 整区不必要——便携包无安装器，卸载文案「reopen the installer」失实） | 后置全文规则锚定 about-settings.tsx：插入声明（版本动态渲染）+ `{false && …}` 帘子包裹两区（非删除，移 pin 冲突面最小）；哨兵防静默复活（charter 守卫） | 3 处 |
| CLI 命令名 | `deploy/bin/silver-core` 别名包裹（零侵入） | 1 件 |
| 钉钉显示名 | 钉钉应用后台配置（内网侧） | 部署说明 |
| **改名审计轮（守密人 2026-08-02 派发「查改名 bug + 不再必要功能」）** | 后置规则四条：① APP_NAME 兜底 `'Hermes'`→`'Silver Core'`（productName 已换而兜底未换 = electron userData 按两个名字解析，绕过 launcher 直启 exe 时配置脑裂）② 后台更新轮询整只 no-op（挂载 + 每 30 分钟 + 聚焦触发，便携包里每次注定报「isn't a git checkout」错误噪音）③ Billing 设置入口隐藏（Hermes Cloud 订阅页，内网自有 Providers 无对象）④ 钉钉 relay 默认名抑制两名并收（旧持久化配置存 `Hermes Agent` 时漏抑制、回复前缀泄漏旧名）；哨兵 `test_rebrand_portable_fit_rules_alive` | 4 处 |
| **审计轮二（2026-08-03 Sonnet 七断面动态编排 + 主循环终审）** | 后置规则八条：① `hermes update` 便携硬门禁（无 .git 的 win32 ZIP 兜底会拉未换装上游整树覆盖——字面撤销全部品牌补丁；文书 §2.4 从文档纪律升格代码门禁）② Billing 深路由封死（`?tab=billing` + 计费故障自动跳转两条暗道，从 `SETTINGS_VIEWS` 摘除）③ Help > Check for Updates 菜单整项摘除（三处自更新入口最后一处）④ Gateway Cloud 连接模式卡隐藏（portal.nousresearch.com OAuth 无对象）⑤ Telegram Quick setup 列隐藏（托管 Bot 固定代理 Nous 自营 SaaS，内网不可达却挂 recommended）⑥⑦ AUMID + appId 中性化 `com.biav.silvercore`（全小写躲过裸词规则，Windows 通知设置直接显示原始串）⑧ 唤醒词帮助文案中性化（裸词规则教出 "Hey Silver Core" 但声学模型只认 "hey hermes"）+ CLI `⚕ Hermes` 面板残留收尾；哨兵 `test_rebrand_audit_round2_rules_alive` | 8 条 |

**审计轮二观察项（未处理，供守密人裁夺）**：`hermes uninstall` 的桌面产物探测硬编码 `Hermes` 目录名、换装后找不到 `Silver Core` 实际产物（便携形态卸载 = 删目录，实害近零）；Remote/SSH 报错文案四语种引导 `hermes-agent.nousresearch.com/install.sh`（内网不可达，正确措辞需产品口径，暂记账）；pet 精灵素材仍为上游吉祥物（前轮已记）。

## 刻意不碰（红线，守卫 `tests/test_hermes_charter.py`）

- **LICENSE / 版权行 / SPDX**：MIT 硬要求 + 文书裁 10（禁「100% 纯自研」口径）。
- **URL**（github.com/NousResearch/… 等）：来源事实，不伪装。
- **`HERMES_*` 环境变量名 / 配置键 / `~/.hermes` 路径 / 模块与包名**：功能标识符，
  改之即 fork 级侵入且破坏上游测试基线。
- **`X-Client-Name: hermes-agent` 遥测头**：对上游服务如实自报，不冒充。
- **上游测试与文档**（tests/ · *.md）：测试基线须与官方逐字节同判；文档非部署运行面。

## 已知残留（照实记录，随移 pin 复测）

- 非白名单目录（website / docs 等纯站点面）的品牌串未扫——不进部署产物。
  ~~apps / web 原列此处~~：守密人 2026-08-02 补充「内部主要消费面是 desktop」后已扩入扫描面（误判订正照实记录）。
- 含 URL / `HERMES_*` 的行内伴生显示词因跳线谓词整行保留（保护优先于净度）。
- 安装器 `install.sh` / `hermes update` 路径的品牌串未处理——生产禁用该路径（文书 §2.4）。
- **连字复合显示词**（德/荷/匈 i18n 的 `Hermes-Plugins` 类、UA 值 `Hermes-Desktop`、
  artifactName `Hermes-<版本>`）随连字符免疫边界一并保留（2026-08-02 头名事故的代价面：
  保护功能标识符优先于这些次要语种/内部名的净度；团队用户面为中文，不受影响）。
- mac 图标 `assets/icon.icns` 未覆盖（便携包只出 win）；`public/hermes.png` /
  `hermes-sprite.png` / `hermes-frames/`（宠物动画帧素材）未覆盖。

维护：补丁由 `deploy/rebrand.py` 规则引擎确定性生成，移 pin 重生成、`--check` 防漂移；
残留升格诉求出现时改规则不改补丁。
