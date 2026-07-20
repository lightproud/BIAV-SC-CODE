# Claude Desktop UI 全结构设计文档（黑箱观察规格，r2）

- **日期**：2026-07-04；**r2 修订 2026-07-05**（自洽审视回填：§7 模式 1 补「起步形态 vs
  演进方向」调和句、§8 增 auto 模式落差行、§8 许可证表述补核验标签）
- **对象版本**：Claude Desktop 三标签形态（Chat / Cowork / Code），官方文档标注部分能力需 v1.2581.0+
- **定位**：银芯 → 黑池单向输出物，供 BPT Desktop 前端参考。姊妹档案：
  `bpt-desktop-ui-reference-20260704-r2.md`（开源许可证红绿灯 + UI↔SDK 消息流对接表）
- **方法与净室声明**：本档案为**自然语言黑箱观察规格**——全部内容来自公开文档 / 官方教程 /
  帮助中心 / 训练期公开知识的转写，**不含任何逆向代码、资产、提示词文本**。BPT 据此独立实现，
  法律路径与 bpt-agent-sdk 净室纪律（Compaq 金标准）完全一致。
- **证据分级**（每节标注）：
  - 【官方文档】= `code.claude.com/docs/en/desktop` 2026-07-04 全文取证（Code 标签的唯一权威，本档案最重部分）
  - 【官方教程】= `claude.com/resources/tutorials/navigating-the-claude-desktop-app`（三标签导航）
  - 【帮助中心】= `support.claude.com` Cowork / Dispatch / Artifacts 条目
  - 【产品页】= `claude.com/product/cowork`
  - 【训练期】= 截至 2026-01 的公开知识，细节可能已漂移，落地前建议实机比对

---

## §1 应用总体架构【官方文档 + 官方教程】

| 维度 | 事实 |
|------|------|
| 形态 | 桌面应用（Electron 系），macOS（Universal dmg）/ Windows（x64 + ARM64 setup，另有企业 MSIX）/ Linux beta（apt / .deb） |
| 顶层结构 | **三标签**：**Chat**（对话）/ **Cowork**（Dispatch 与长时 agent 工作）/ **Code**（软件开发）。标签是应用的最高层导航，三者共用账号与登录态。另有 **Claude Design**（Labs 研究预览）经侧栏入口进入独立工作区（详见 §6，其导航割裂是社区公认反面教材） |
| 账号 | 启动即登录（订阅制 Pro / Max / Team / Enterprise；Code 标签必须付费订阅）；企业可强制 SSO（SAML / OIDC） |
| 更新 | macOS / Windows 启动自更新 + 菜单「Check for Updates」（macOS 在 Claude 菜单、Windows 在 Help 菜单）；About 页版本号点击即复制 |
| 通知 | OS 级桌面通知：Code 会话完成任务且用户不在看该会话时发；CI 结束时发；Dispatch 完成 / 需审批时推手机 |
| 企业管控 | 管理台四开关（Code in desktop / Code in web / Remote Control / 禁 Bypass）+ managed settings 文件 + MDM（macOS `com.anthropic.claudefordesktop` / Windows 注册表 `SOFTWARE\Policies\Claude`） |

设计要点（对 BPT 的启示）：三个标签本质是**三种工作模型**共存于一壳——同步对话（Chat）、
异步任务委托（Cowork）、并行工程会话（Code）。壳只管账号 / 更新 / 通知 / 设置，各标签自带
完整的侧栏 + 主区结构，互不复用布局。

## §2 全局壳层元素【官方教程 + 训练期】

- **标签切换器**：窗口顶部 Chat / Cowork / Code 三选一（教程称 mode selector）。
- **快速入口浮窗**【官方教程】：macOS **双击 Option** 唤出置顶小窗（quick entry overlay），
  随处发起提问；带截图 / 窗口分享拖拽区与语音输入控件。
- **截图 / 窗口共享**【官方教程】：Chat 可直接截取屏幕或指定窗口作为附件。
- **语音输入**【官方教程】：composer 内语音激活控件（听写）。
- **主题**【训练期】：浅色 / 深色，跟随系统。
- **设置入口**：侧栏底部账号菜单进入设置；设置分页详见 §3.5。

## §3 Chat 标签（经典对话面）

### §3.1 布局【训练期，与 claude.ai Web 同构】

三区：左侧栏（可折叠）+ 中央对话流 + 右侧 Artifacts 面板（有 artifact 时滑出，可与对话并排）。

### §3.2 侧栏【训练期】

- **New chat** 按钮（顶部）
- **Chats**：近期会话列表（按时间倒序），会话项悬停出现改名 / 删除 / 星标类操作
- **Projects**：项目列表——每个项目自带知识库（上传文件）+ 自定义指令 + 项目内会话组
- 搜索：跨会话检索
- 底部：账号菜单（设置 / 登出 / 计划信息）

### §3.3 对话流与 Composer【训练期 + 官方教程】

- 消息流：用户消息（可编辑重发）/ 助手消息（markdown 渲染、代码块带复制、
  扩展思考块默认折叠可展开、工具调用块显示调用与结果）
- **MCP 工具权限弹窗**【训练期】：本地 MCP 工具首次调用弹出确认（本次允许 / 本会话始终允许 /
  拒绝三档语义），弹窗内展示工具名与入参
- Composer：附件按钮（文件 / 图片 / 截图 / 窗口共享）、连接器与工具菜单（各连接器 /
  MCP server 可单独开关）、样式（styles）选择、**模型选择器**、扩展思考开关、发送 / 停止
- 流式输出 + 停止按钮 + 重试 / 复制消息操作

### §3.4 Artifacts 面板【帮助中心 + 训练期】

- 触发：助手产出 artifact（代码 / 文档 / HTML / SVG / React 组件等）时在消息内出现卡片，
  点击在右侧面板打开
- 面板结构:**Preview / Code 双视图切换**、多版本（同一 artifact 迭代可回看历史版本）、
  复制 / 下载、发布分享（生成可分享链接）
- 面板与对话并排（分栏），可关闭回到纯对话

### §3.5 设置页群【训练期 + 官方文档印证】

设置为独立多页结构（各页名称以实机为准，训练期记忆）：

- **Profile / General**：账号、语言；**Desktop app 小节**含 Computer use 开关、Denied apps、
  「Unhide apps when Claude finishes」【官方文档】
- **Appearance**：主题
- **Capabilities / Features**：功能开关（artifacts、分析工具、Claude 联网权限等）
- **Connectors**：远程 MCP 连接器的添加 / 管理 / 断开【官方文档印证：Settings → Connectors】
- **Extensions**：桌面扩展（一键安装的本地 MCP 打包，`.dxt` / MCPB 格式；Team / Enterprise
  有企业级 MCPB 分发）【官方工程博客 + claude.com/docs】
- **Developer**：本地 MCP server 手工配置，编辑 `claude_desktop_config.json`【官方文档印证：
  该文件的 server 同时进 Chat 面与 Code 标签】
- **Cowork**：全局与文件夹级指令【帮助中心】
- **Claude Code**：Code 标签专属开关集（见 §5.11）【官方文档】

## §4 Cowork 标签（异步任务委托面）【帮助中心 + 产品页 + 官方教程】

### §4.1 心智模型

「描述任务 → 审查计划 → 放手执行 → 交付成品」。与 Chat 的区别：Cowork 交付**完成的工作成果**
（直接落用户文件系统的文档 / 表格 / 演示），而非逐步对话回复。

### §4.2 结构

- **左侧栏**：任务列表（Active 等状态分组）+ **Scheduled**（定时任务管理入口）+
  **Projects**（相关任务组成独立工作空间，带独立文件 / 上下文 / 记忆）
- **新任务**：prompt 输入框 + 附件区 + 工作文件夹选择（只在用户连接过的文件夹内活动）
- **计划审批面板**：执行前展示计划（"Show me the plan before making changes"），批准后开跑
- **进度视图**：逐步进度指示 + 推理透明化展示；复杂任务可见**多子代理并行**工作流
- **产出**：成品直接写入用户指定的文件系统位置；源文件与输出文件在进度区可见
- **权限双模式**：**Ask before acting**（每步暂停待批）/ **Act without asking**（不打断执行）；
  永久删除文件**始终**需显式许可（硬底线不随模式放松）
- **定时任务**：输入 `/schedule` 或侧栏 Scheduled 入口，配置周期任务
- **Dispatch**【官方文档 + 帮助中心】：Cowork 内的常驻对话，手机（iOS / Android）可远程派单；
  Dispatch 判定为开发类任务时自动 spawn 一个 Code 会话（该会话在 Code 侧栏带 **Dispatch 徽章**，
  完成 / 需审批时推手机通知；computer use 审批在此类会话 30 分钟过期重询）
- 扩展入口：插件添加、Chrome 浏览器集成控件、连接器（routines 在创建时配置连接器）

## §5 Code 标签（并行工程会话面）【官方文档 2026-07-04 全文取证——本节为最高置信】

### §5.1 会话模型

- 每个对话 = 一个 **session**：自带聊天历史 + 项目文件夹 + 代码变更，彼此独立
- Git 仓库的会话默认获得**独立 worktree 副本**（存于 `<project-root>/.claude/worktrees/`，
  位置与分支前缀可在 Settings → Claude Code 改），一个会话的改动不影响其他会话
- 上下文满时自动摘要压缩继续干（`/compact` 可手动提前触发）

### §5.2 侧栏（会话管理）

- **+ New session**（Cmd/Ctrl+N）；Ctrl+Tab / Ctrl+Shift+Tab 轮换会话
- 顶部控制条：按**状态 / 项目 / 环境**过滤会话，按项目分组
- 会话项：悬停出归档图标（删 worktree）；Dispatch 徽章；自动归档开关
  （Auto-archive after PR merge or close，仅本地已跑完会话）
- **双会话分屏**：Cmd/Ctrl+点击侧栏会话 → 第二 pane 并排打开；分屏时点击第三个会话替换
  焦点 pane；Cmd+\ 关闭焦点 pane 回单会话
- 改名：点击会话顶部工具栏的标题

### §5.3 开始会话（prompt 区四要素）

1. **Environment**：Local / Remote（Anthropic 云，关机也继续跑，可从 claude.ai/code 或 iOS 监控）/
   SSH 连接（添加对话框四字段：Name / SSH Host / SSH Port / Identity File；管理员可用
   `sshConfigs` 预置、`sshHostAllowlist` 限制可连主机）
2. **项目文件夹**：本地选目录；云会话可 **+** 加多仓库（每仓独立分支选择器）
3. **模型**：发送键旁下拉，会话中可换；旁边有**用量环**（本会话上下文用量 + 全平台计划用量）
4. **权限模式**：发送键旁模式选择器，会话中可换

### §5.4 权限模式五档【逐字契约级事实】

| 模式 | settings 键 | 行为 |
|------|------------|------|
| Ask permissions | `default` | 改文件 / 跑命令前都问，出 diff 逐个接受或拒绝 |
| Auto accept edits | `acceptEdits` | 自动接受文件编辑与常规文件系统命令（mkdir/touch/mv），其他终端命令仍问 |
| Plan mode | `plan` | 只读探索后提出计划，不改源码 |
| Auto | `auto` | 全自动执行 + 后台安全校验（研究预览，需 Settings → Claude Code 开启，模型有门槛） |
| Bypass permissions | `bypassPermissions` | 除显式 ask 规则外不再询问；Settings 开关控制，企业可禁 |

`dontAsk` 仅 CLI 有。云会话选择器显示 Accept edits / Plan / Auto（云内预批文件编辑、无 Bypass）。

### §5.5 Prompt box 交互

- Enter 发送；运行中可**直接输入纠正并发送**——不打断当前动作，当前动作完成后 Claude 读到
  纠正即调整（与 stop 按钮立即打断是两条路径，这个「不停机追加转向」是关键交互设计）
- **+ 按钮**：文件附件 / **Skills**（也可输 `/` 唤出斜杠菜单）/ **Connectors** / **Plugins**
  （浏览 marketplace、启停卸载）；云会话无 + 按钮
- **@mention 文件**：`@文件名` 带自动补全，把文件加入上下文（云会话不可用）
- 附件：图片 / PDF 拖拽或按钮；Esc 停止响应

### §5.6 Pane 系统（工作区布局）

**八种 pane：chat / diff / preview / terminal / file / plan / tasks / subagent。**
拖 pane 头重排、拖边缘调宽、Cmd+\ 关焦点 pane、Views 菜单开新 pane。

- **diff**：改动后出现 `+12 -1` 式统计指示器，点开 diff 视图（左文件列表 + 右逐文件变更）；
  点任意行开评论框，Enter 加评论，多行评论后 Cmd/Ctrl+Enter 一次性提交，Claude 按评论改出新
  diff 再审；右上 **Review code** 按钮让 Claude 先自评（只报编译错 / 确定逻辑错 / 安全洞 /
  明显 bug，不报风格）
- **preview**：内嵌浏览器跑 dev server；Claude 编辑后**自动验证**（截图、查 DOM、点元素、
  填表单、自己修发现的问题，`autoVerify` 默认开）；也能打开静态 HTML / PDF / 图片 / 视频
  （聊天中点这类路径直接进 preview）；工具栏 Preview 下拉：启停服务器 / Persist sessions
  （跨重启留 cookie 免重复登录）/ Edit configuration；服务器配置在 `.claude/launch.json`
  （字段：name / runtimeExecutable / runtimeArgs / port / cwd / env / autoPort / program / args；
  autoPort 三态：true 自动找空闲口、false 严格报错、未设则询问后记住；多配置支持前后端双服务器）
- **terminal**：Ctrl+` 开关；开在会话工作目录、与 Claude 同环境；pane 头 **+** 开第二标签，
  或右键聊天中的文件夹「Open in terminal」；仅本地会话
- **file**：点聊天 / diff 里的文件路径打开；可做点状编辑 + Save 写回；磁盘上文件已变则警告
  覆盖或放弃；点 pane 头路径复制绝对路径；本地与 SSH 会话可用
- **plan**：Plan mode 的计划查看器
- **tasks**：当前会话的后台工作台账——子代理、后台 shell 命令、动态工作流；点条目看输出或停止
- **subagent**：子代理输出细览
- 文件路径右键菜单（聊天 / diff / file pane 通用）：**Attach as context / Open in**（VS Code、
  Cursor、Zed 等已装编辑器）/ **Show in Finder(Explorer) / Copy path**

### §5.7 视图模式（转录密度三档）

Transcript view 下拉或 Ctrl+O 轮换：**Normal**（工具调用折叠成摘要 + 完整正文）/
**Verbose**（每个工具调用与中间步骤全展开）/ **Summary**（只看最终回复与改动）。
多会话并行时用 Summary 扫结果，调试时用 Verbose。

### §5.8 PR 监控与 side chat

- 开 PR 后会话内出 **CI 状态条**（走 GitHub CLI 轮询）：**Auto-fix**（CI 挂了自动读失败输出
  迭代修）与 **Auto-merge**（全绿自动 squash 合并，需仓库侧开 auto-merge）两开关；CI 结束发
  桌面通知；可配 PR 合并 / 关闭后自动归档会话
- **Side chat**（Cmd+; 或 `/btw`）：借用会话上下文问旁支问题，**不回写主对话**——防跑题设计；
  本地与 SSH 会话可用

### §5.9 Computer use（屏幕控制，研究预览）

- 默认关；Settings → General（Desktop app 小节）开启；macOS 另需辅助功能 + 屏幕录制两系统权限
  （设置页显示各权限状态，点徽章直达系统设置）
- 工具选择优先级（精确优先）：connector > Bash > Claude in Chrome > computer use 兜底
- **按 app 类别的固定权限三档**：View only（浏览器、交易平台）/ Click only（终端、IDE）/
  Full control（其余）；高危 app（终端 / 文件管理器 / 系统设置）弹窗带额外警告
- 首次用某 app 弹窗「Allow for this session / Deny」；常规会话批准持续整会话，
  Dispatch-spawn 会话 30 分钟过期
- 设置：Denied apps 名单（免弹窗直接拒）+ 工作时隐藏其他窗口、完毕恢复（可关）

### §5.10 快捷键（Code 标签，官方全表）

Cmd+/ 唤出全表；Windows 用 Ctrl 代 Cmd（会话轮换 / 终端 / 视图模式在所有平台用 Ctrl）：

| 键 | 动作 |
|----|------|
| Cmd+/ | 显示快捷键表 |
| Cmd+N / Cmd+W | 新建 / 关闭会话 |
| Ctrl+Tab、Cmd+Shift+] [ | 会话轮换 |
| Esc | 停止响应 |
| Cmd+Shift+D / P | 切换 diff / preview pane |
| Cmd+Shift+S | preview 内选元素 |
| Ctrl+` | 切换终端 |
| Cmd+\ | 关闭焦点 pane |
| Cmd+; | 开 side chat |
| Ctrl+O | 轮换视图模式 |
| Cmd+Shift+M / I / E | 权限模式 / 模型 / effort 菜单 |
| 1–9 | 菜单内快速选项 |

### §5.11 Settings → Claude Code 开关集（散见全文的收拢）

Worktree location / 分支前缀、Auto-archive after PR merge or close、Allow bypass permissions
mode、Auto mode 开关、Preview 总开关、Persist preview sessions。

### §5.12 配置与 CLI 关系

- Desktop 与 CLI 同引擎可并行跑同项目，共享 CLAUDE.md / MCP 配置（`~/.claude.json`、`.mcp.json`、
  **`claude_desktop_config.json` 三源都进 Code 会话**）/ hooks / skills / settings；会话历史各自独立
- CLI 会话可 `/desktop` 一键转进 Desktop
- Desktop 不做的事：`--print` 脚本化 / 无 headless、inline 补全、agent teams（CLI 专属）、
  终端对话框类命令（/permissions、/config、/doctor 在 Code 标签回「不可用」）

## §6 Claude Design（Labs 视觉工作区）【官方公告 + 产品页 + 帮助中心 + 社区来源】

2026-04-17 发布的 Anthropic Labs 研究预览产品，视觉设计协作工作区（Opus 4.7 驱动）；
Web 端在 `claude.ai/design`，桌面应用经**侧栏入口**进入。Pro / Max / Team / Enterprise 可用
（Enterprise 默认关、管理员在组织设置启用）；**无独立额度**——与 Chat / Code / Cowork
共享同一计划用量池（与 Code 标签用量环的「plan usage 全平台共享」同一设计）。

### §6.1 入口画面【社区来源（带截图的第三方评测）】

进入即选起点：**Prototype / Slide deck / From template / Other** 四选一，
并选保真度档位：**rough wireframes**（粗线框）或 **high-fidelity mockups**（高保真、带真实品牌元素）。

### §6.2 工作区布局【帮助中心】

**双区结构：左侧聊天区 + 右侧画布（canvas）**——对话驱动生成，画布承载结果并可直接编辑。
与 Chat 标签的 Artifacts 面板是同族范式（对话 + 并排产物面板），但这里产物面板升级为
可操作的编辑器而非只读预览。

### §6.3 画布编辑能力【帮助中心】

- 直接操作：拖拽元素、调整大小、对齐
- **rich layout controls**：间距 / 颜色 / 布局的实时调整旋钮；文字可直接改
- **行内评论**：点画布任意部位留评论请求定向修改（已知缺陷：评论偶尔未被读取，
  官方兜底建议是把评论粘回聊天框——「画布批注回灌对话」链路尚不可靠）
- 版本：对话指令式保存（"Save what we have and try a completely different approach"），
  无独立版本树 UI（与 Artifacts 的版本切换器不同）

### §6.4 输入与品牌系统【官方公告 + 产品页】

- 输入四路：文本提示 / 上传图片与文档（DOCX / PPTX / XLSX）/ 指向代码库 / 网页元素捕获工具
- **设计系统集成**：扫描代码库与设计文件自动构建组织设计系统（颜色 / 排版 / 组件），
  后续项目自动套用——「品牌一次导入、处处生效」
- 产出谱系：交互原型、线框与高保真 mockup、幻灯片 / pitch deck、单页、营销素材，
  以及代码驱动原型（语音 / 视频 / 着色器 / 3D / 内嵌 AI）

### §6.5 导出与交接【帮助中心】

右上角 **Export** 按钮：.zip / PDF / PPTX / 独立 HTML，及 Canva、Adobe、Base44、Gamma、
Lovable、Miro、Replit、Vercel、Wix 等集成导出；**交接 Claude Code**（本地或 Web）——
Code 侧有 `/design-sync` 命令同步设计交付包。分享走组织内链接，
**查看 / 评论 / 编辑**三档权限，支持群组对话协作。

### §6.6 桌面集成的反面教材【社区来源，2026-06】

Design 并入桌面应用后的社区批评（r/claude，高热帖）：入口**藏两层深**，进入后是
「完全另一个世界」，**无法直接回到 Chat / Cowork / Code**——顶层导航在 Design 内消失。
这与三标签「一壳三模式、随时切换」的骨架相悖，是「新表面硬塞进成熟壳」的典型集成失败。
对 BPT 的教训：**新增工作面必须挂在顶层导航同级，进得去也要一步出得来**；
宁可标签多一个，不可让用户掉进无返回键的子世界。

## §7 可提炼的设计模式（给 BPT 的结构性启示）

1. **会话 = 一等资源**：会话自带环境 + 工作区 + 变更集 + 上下文，侧栏是资源管理器而非聊天历史。
   比 BPT 现有「单对话窗」模型高一个维度，是 Code 标签一切并行能力的地基。
   （与姊妹档案 §4 骨架**不矛盾**：那是起步形态——单活动会话 + 会话列表；本模式是演进方向，
   起步骨架的 ConversationList 天然可升级为会话资源管理器，非两个互斥方案。）
2. **权限渐进阶梯**：五档模式 + 会话中随时换挡 + 企业可锁档。BPT 有 SDK `permissionMode`
   现成对接（default/acceptEdits/plan/dontAsk/bypassPermissions 已实现，见姊妹档案对接表）。
3. **计划先行**：Plan mode / Cowork 计划审批把「先给我看你要干嘛」做成一档模式而非一句提示词。
4. **转录密度可调**：Normal / Verbose / Summary 三档——同一消息流三种渲染密度，纯前端过滤，
   BPT 拿 `SDKMessage` union 的 type 字段就能实现，成本极低收益极高。
5. **副线隔离**：side chat 借上下文不回写主线。BPT 可用 SDK `forkSession` 支撑。
6. **不停机转向**：运行中追加输入不打断当前动作、完成后再调整——与 stop 双轨。
   BPT 对接 SDK `streamInput()`（流式输入模式已 FULL）。
7. **自动验证闭环**：编辑后自动截图 / 查 DOM / 自修——「改完自己看一眼」产品化。
8. **通知节制**：只在「完成且用户没在看」时发系统通知。
9. **渐进披露**：工具调用默认折叠摘要、点击展开；子代理进 tasks pane 不刷屏主流。
10. **失败兜底分级**：computer use 的「精确工具优先、屏控兜底」+ 按 app 类别封顶权限——
    能力越广、默认权限越窄。
11. **对话 + 可编辑画布双平面**（Claude Design）：产物面板从只读预览（Artifacts）进化为
    直接编辑器（画布拖拽 / 旋钮微调 / 行内批注回灌对话）。BPT 若做 artifact 面板，
    该演进方向值得预留——先只读，但布局上给「产物侧可交互」留位。
12. **反模式——子世界无返回**（Design 集成失败，§6.6）：新表面不进顶层导航 = 用户迷路。
    顶层导航必须全程可达。

## §8 与 BPT/SDK 的落差清单（结构性差异，非逐件映射）

逐件 UI↔SDK 对接表见姊妹档案 `bpt-desktop-ui-reference-20260704-r2.md` §5。本节只列
Code 标签新观察到、上一档未覆盖的映射：

| Claude Desktop 结构 | BPT 对接可行性 |
|--------------------|---------------|
| pane 化工作区（八 pane 拖拽） | 纯前端工程（react-mosaic / dockview 类，MIT——训练期知识，装前复核 LICENSE）；SDK 无涉 |
| diff 视图 + 行级评论回灌 | SDK 侧文件检查点 + Read/Edit 已有；评论回灌 = 把评论拼成下一条 user 消息，纯前端 |
| tasks pane | `task_started/progress/updated/notification`（v0.4 真发射）直接驱动 |
| terminal pane | SDK v0.5 ShellManager（后台 shell + BashOutput/KillShell）是数据源，前端接 xterm.js（MIT——训练期知识，装前复核） |
| 权限模式 **auto**（分类器，研究预览） | SDK 不提供（COMPAT：`auto` not offered）——BPT 选择器做 SDK 实有的五档（default / acceptEdits / plan / dontAsk / bypassPermissions），勿照抄 Desktop 含 auto 的六种形态 |
| 视图模式三档 | `SDKMessage.type` 前端过滤即得 |
| CI 状态条 / Auto-fix | SDK 无此内建；BPT 若要，走宿主层轮询 gh + 自动派新 query |
| 用量环 | `result.metrics`（SDKRunMetrics）现成 |
| Computer use | SDK 不含屏控工具；属宿主自定义工具线（canUseTool + 自注册工具可承载） |
| 云会话 / SSH 环境切换 | SDK 是进程内库，无远程执行面；BPT 如需要属宿主架构议题 |
| Design 画布（对话 + 可编辑产物双平面） | SDK 无涉（产物生成走普通 assistant 输出）；画布编辑器属纯前端重投资，BPT 近期建议只做 Artifacts 级只读预览 + 按模式 11 留位 |

## §9 残余盲区（本档案没拿到实锤的）

- Chat 标签侧栏与设置页的**逐像素级**现状（§3 大半为训练期知识，2026 年内可能已改版）
- Claude Design 桌面入口的精确位置与层级（§6.6 只有社区「藏两层深」定性描述，无官方导航文档）
- Cowork 移动端（iOS/Android）界面
- 各弹窗的精确文案与空态 / 错误态插画

补法：守密人在实机上按本档案逐节比对截图，偏差处回填修订版（`-r2`）。

---

*来源清单：code.claude.com/docs/en/desktop（全文）；claude.com/resources/tutorials/navigating-the-claude-desktop-app；support.claude.com articles 13345190（Cowork 入门）/ 13947068（Dispatch)/ 9487310（Artifacts）/ 14604416（Claude Design 入门）；claude.com/product/cowork；claude.com/product/design；anthropic.com/news/claude-design-anthropic-labs（2026-04-17 发布公告）；anthropic.com/engineering/desktop-extensions；claude.com/blog/claude-code-desktop-redesign（2026-04-14 重设计公告）；r/claude Design 桌面集成讨论（2026-06，仅 §6.6 定性引用）。*
