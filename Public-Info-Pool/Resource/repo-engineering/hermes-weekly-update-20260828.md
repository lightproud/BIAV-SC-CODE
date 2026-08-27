# Black Pool 周更公告 · 上游 v2026.8.27（引擎 0.20.6）

> 银芯周更例程自动产出（每周一 00:00 北京时间 / 周日 16:00 UTC 起跑）。
> 本档三合一：**新内容公告** + **zip 下载链接** + **BPA 更新指南**。
> 上游 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)（MIT）——
> 黑池为其品牌换装 + 内网适配的二次开发衍生物，非纯自研。

## 一、本次更新是什么

| 项 | 值 |
|----|----|
| 上游 pin | `v2026.8.19` → **`v2026.8.27`**（commit `5fc308a70719`，2026-08-27） |
| 引擎版本 | 0.20.5 → **0.20.6** |
| 黑池版本 | 0.1.0（品牌版本号不随上游走） |
| 上游提交 | 1376 个 |
| 快照变更 | 541 新增 / 987 修改 / 29 删除文件 |
| 快照规模 | 10,488 文件 / 182MB |
| 补丁核对 | 三张补丁全部干净落位（品牌两张规则引擎重出，特性补丁 `--check` 通过） |

**对黑池用户实际可感知的变化**（据本档第二节一手变更清单归纳，非上游 release 页转述）：

1,376 个提交里，**绝大多数黑池用户碰不到**——824 条修复中大半是云侧、模型目录、自更新路径的事，而私有版早已封堵自更新、走内网服务商，那些改动对便携包是空转。真正会在守密人眼前发生的是这几件：

- **对话压缩默认变「瘦」了**（`feat(compression)`，最该留意的一条）：压缩时保留的逐字尾部从 100–240K **降到 10–25K**。换来的是上下文余量更宽裕，代价是压缩后对刚才细节的记忆更短。这是行为默认值的改变，不是 bug；若守密人觉得压缩后「忘性变大」，是这条所致，可在内网侧调回。
- **群聊轮次现在能真正中断**：desktop 加了群聊轮的停止按钮，且底层补了真正的停止原语（此前是「按了没用」）。
- **多档案会话不再串台**：会话行改按「档案 + id」双键标识，两个档案里的同名会话不再被折叠成一条、也不再路由到错的那个。
- **更新后白屏改为可见报错 + 自动重载**：原先失败是一片白屏无从下手。
- **远程 / SSH 连接稳一截**：WSL2 IPC 卡顿窗口放宽、一轮对话进行中不再被网关存活检查强行掐断、SSH 切换后保留本机启动档案。
- **新增舰队档案条**（fleet profile rail）：所有已注册网关的智能体排成一条，桌面端多网关场景下少切几次。

**黑池自有的对话成本面板不受影响**——它所在的 15 个文件被 69 个上游提交撞面，但撞的几乎全是 i18n 六档的批量格式化与新增文案键，补丁自动吸收；真正需要人工重放的只有一行 import（详见第五节）。

> 小学生比喻：上游这周搬进来 1,376 箱东西，其中一千多箱是给楼上住户的（云服务、自更新），我们连箱子都不用拆；真正搬进自家客厅的就上面这六件，而「压缩变瘦」那件相当于把随手笔记本从两百页换成二十页——桌子宽敞了，但翻旧账翻不了那么远。

## 二、变更清单

上游区间 `v2026.8.19` → `v2026.8.27`，共 **1376** 个提交。

| 类别 | 条数 |
|------|------|
| 新增能力（feat） | 116 |
| 缺陷修复（fix） | 824 |
| 性能（perf） | 5 |
| 重构（refactor） | 47 |
| CI（ci） | 2 |
| 测试（test） | 124 |
| 文档（docs） | 26 |
| 样式（style） | 13 |
| 杂务（chore） | 90 |
| 回退（revert） | 4 |
| 未分类（other） | 125 |

### 新增能力（feat，116 条）

- **models** feat(models): add GLM-5.3-Flash to z.ai and OpenCode Go pickers  `a9611f3c`
- **desktop** feat(desktop): Stop button for a running group-chat round (#94570)  `c5e0def7`
- **models** feat(models): add Inkling free models to OpenRouter catalog  `51df117d`
- **models** feat(models): add minimax/minimax-m3:free to OpenRouter picker (#96234)  `6607f706`
- **desktop** feat(desktop): read-only stored-transcript resume + legacy owner-backfill trigger (#94724)  `9faa6853`
- **sessions** feat(sessions): one-shot single-match owner backfill for legacy NULL-profile rows (#94724)  `01f7ce5b`
- **desktop** feat(desktop): browser_exec rows use the leading # comment as their title, matching CLI/TUI (#96093)  `65974a3e`
- **relay** feat(relay): stamp slack unfurl_links/unfurl_media onto outbound frame metadata (gateway-directed)  `cc2fb462`
- **slack** feat(slack): add link unfurl controls  `aeaa0c78`
- **desktop** feat(desktop): Managed updates section drives per-connection SSH updates  `bc4eea77`
- **browser** feat(browser): close-with-approval flow for Windows real-profile (toggle arms, agent asks, blocked if still locked) [proof do-not-merge]  `e4451ec6`
- **browser** feat(browser): consented auto-close of a running browser for Windows real-profile [proof workflow do-not-merge]  `9e9e1b22`
- **browser** feat(browser): real-profile browsing via agent-browser copy + browser-use CDP  `1f4d095f`
- **browser** feat(browser): consent-gated real default-Chromium profile for local browsing + local_browser arg  `830e4a29`
- **desktop** feat(desktop): wire managed SSH update engine into main process  `65335549`
- **desktop** feat(desktop): managed SSH remote update engine — extracted from #93042  `6170fff1`
- feat: MiniMax H3 Max joins the FAL video picker (t2v + i2v)  `b0563d5a`
- **update** feat(update): image/package-managed installs refuse in-place updates through one shared gate (#91277 Phase 3)  `48609781`
- **update** feat(update): bake authoritative image provenance into the Docker image  `82a702bf`
- **kanban** feat(kanban): carry the review handoff summary into the wake turn  `1f92c5d4`
- **agent** feat(agent): fold an agent-as-provider's own tool work back into the turn  `07200e9c`
- **gateway** feat(gateway): updaters pause gateways over the control socket instead of tree-killing them (#92091 step 2)  `03537d69`
- **desktop** feat(desktop): fleet profile rail — every registered gateway's agents on one strip  `fd565c80`
- **update** feat(update): network-bound serve backends survive hermes update on their recorded endpoints (#63206)  `27385e58`
- **models** feat(models): add z-ai/glm-5.3-flash to OpenRouter and Nous Portal catalogs  `64424a16`
- **compression** feat(compression): lean tail retention is the default — compaction keeps 10-25K verbatim, not 100-240K  `6e541384`
- **macos** feat(macos): one-switch Full Disk Access guidance in doctor and setup  `be859032`
- **deadline** feat(deadline): SuspectableBackend protocol — mark timed-out backends suspect  `7a3aaf01`
- **cron** feat(cron): import-error cron failures now name gateway code skew and the one-command fix (#95294 part 3)  `1fe0f2f3`
- **openviking** feat(openviking): identify Hermes requests  `3db52670`
- **desktop** feat(desktop): add NSScreenCaptureUsageDescription to macOS bundle  `fc323ced`
- **update** feat(update): unattended-safe cua-driver refresh with fail-fast preflights  `23c3f508`
- **tool-search** feat(tool-search): multi-query search, batched describe, Snowball stemming  `e455e4af`
- **desktop** feat(desktop): add --setup-tcc-identity to keep macOS TCC grants across rebuilds  `eeb391d0`
- **desktop** feat(desktop): hide the docked Browser tab while it is popped out  `e8df4017`
- **desktop** feat(desktop): give the in-app Browser its own OS window  `a6087996`
- **mcp-catalog** feat(mcp-catalog): add Grafana Cloud MCP server  `56f94faa`
- **desktop** feat(desktop): open a Browser tab in the default browser from its context menu  `26777a41`
- **desktop** feat(desktop): let a pane prefix the zone tab menu  `b9513f2e`
- **chat-plane** feat(chat-plane): trace_id + turn telemetry, transient-delta split, seq-namespace epoch  `874fab0c`
- **desktop** feat(desktop): OS-keychain encryption for stored secrets is now opt-in — no more macOS Keychain password prompt on every launch  `6a6e16fa`
- **cron** feat(cron): acked failure signatures stop re-pinging — durable incidents + ack CLI (salvage #94692) (#95017)  `9de5460c`
- **web** feat(web): cache_exempt_hosts — always-live fetches for staging/tunnel sites  `ba9fc55e`
- **web** feat(web): TTL result caching for web_search + web_extract  `04603fc0`
- **mcp** feat(mcp): add 18 more live-verified remote MCPs from the final sweep  `9a373257`
- **mcp** feat(mcp): add Better Stack and Railway remote MCPs (OAuth+DCR, live-verified)  `99f5aec7`
- **mcp** feat(mcp): add 34 official vendor-hosted remote MCP servers to the catalog  `753f362a`
- **mcp** feat(mcp): curated exclude list for cloudflare + glob tool filters + default_excluded manifests  `3a1a3a1c`
- **mcp** feat(mcp): pin ?codemode=false so tool_search sees the full endpoint surface  `53015d3e`
- **mcp** feat(mcp): add Cloudflare's official API MCP server to the catalog  `90fd9a83`
- **terminal** feat(terminal): wire shared-container key into profile-scoped resolver and MEDIA delivery  `82b32f32`
- **docker** feat(docker): support shared container identities  `7a67bd07`
- **memory** feat(memory): opt-in fail-closed pre-compress checkpoint contract (API v1)  `1104ffe0`
- **computer_use** feat(computer_use): guide models from full-screen grabs to interactive lanes  `ce9b9a63`
- **gateway** feat(gateway): slim WS-only server — remove FastAPI/uvicorn from desktop boot path  `434ea57e`
- **gateway** feat(gateway): warn when a Docker sandbox MEDIA path fails translation  `a15533b6`
- **browser** feat(browser): make snapshot threshold configurable  `6ce7ab8b`
- feat: browser snapshots drop LLM summarization — truncate-and-store like web_extract; auxiliary.web_extract slot removed  `a75ea37d`
- **terminal** feat(terminal): pluggable terminal environment backends via plugin registry  `04849107`
- **desktop** feat(desktop): add Settings toggle for vibe hearts  `93acc22a`
- **tui-gateway** feat(tui-gateway): seq-stamped event replay for lossless desktop reconnect  `87631bd8`
- **desktop** feat(desktop): let the in-app browser hold more than one tab  `8a8f74e7`
- **desktop** feat(desktop): make Cmd/Ctrl+L focus the composer from anywhere  `28b758d5`
- **shared** feat(shared): heartbeat and socket-generation invalidation in JsonRpcGatewayClient  `9153be2a`
- **gateway** feat(gateway): add gateway.ping heartbeat wire contract  `9a71cb95`
- **cron** feat(cron): add explicit one-shot re-arm  `a0ca7c19`
- **desktop** feat(desktop): HUD game-overlay mode  `3c196444`
- **bots** feat(bots): typed failure reasons reach the sending agent on A2A calls (#93091)  `c584d15c`
- **bots** feat(bots): retry session policy — resume transient turns, compress-and-resume on context overflow (#93091 item 5)  `b274b346`
- feat: every subagent's prompt embeds the workspace's project context files  `7526bd39`
- feat: /review briefing embeds the workspace's project context files  `23fb949f`
- feat: /review briefing carries the parent's loaded skills  `22381edc`
- feat: review slot appears in every aux-model picker (desktop, dashboard, CLI)  `65c58651`
- **desktop** feat(desktop): OAuth sign-in for registry connections; keep profile picks on the browsed source (#92194)  `3dc77acd`
- feat: /review command — independent reviewer subagent on every surface  `12395e57`
- **desktop** feat(desktop): bring the old Nous palette back as Nous Alt  `253dde4b`
- **bot-mode** feat(bot-mode): per-profile turn lock — concurrent deliveries queue instead of racing (#93091)  `ac3f9a2d`
- **bot-mode** feat(bot-mode): push-notified relay drain with poll backstop (#93091)  `9c829f96`
- **bot-mode** feat(bot-mode): envelope TTL + offline fast-fail for bot relay (#93091 item 2)  `b9636921`
- **bot-mode** feat(bot-mode): typed failure-reason codes for bot turns and relay replies (#93091 item 1)  `64eb6bb7`
- **desktop** feat(desktop): needs-attention badge for background bot failures (#93091 item 3)  `d4f42679`
- **bot-mode** feat(bot-mode): a reclaimed bot chat re-resumes itself — no stale-id error on the next send  `d5281f59`
- **update** feat(update): sibling profiles' configs migrate with the fleet — no more silent version drift (#20438/#54926/#79048)  `706f33d4`
- **update** feat(update): the plan is now the restart worklist — every planned runtime must be accounted for (#91277 Phase 2)  `18b7fc82`
- **desktop** feat(desktop): retain Bot group drafts by room  `b42d8279`
- **desktop** feat(desktop): make new Bot tabs owner-aware  `9b36c2d4`
- **desktop** feat(desktop): define workspace-scoped pane ownership  `b8b6f432`
- **desktop** feat(desktop): organize the global bot roster  `613244cb`
- **desktop** feat(desktop): configure per-profile remote overrides from the profile rail  `1ad47333`
- **desktop** feat(desktop): client-direct voice — use the active profile's STT/TTS keys from the desktop, no audio relay  `10f0d227`
- **bot-mode** feat(bot-mode): bots on every Desktop connection can message each other  `d3e087fd`
- **model** feat(model): Codex GPT slugs default back to 272K; explicit -900k picker variants opt into the verified large window  `63a9c26f`
- **dashboard** feat(dashboard): Desktop and dashboard read the update receipt instead of inferring success (#91277 Phase-1 bullet 3)  `8804e783`
- **gateway** feat(gateway): gateway-owned control socket — identify/status verbs, fleet consumers prefer it over scans (#92091 step 1)  `60b62691`
- **desktop** feat(desktop): Send Diagnostics — one-click redacted debug-bundle upload from the error card  `8f30e9c7`
- **bot-mode** feat(bot-mode): @mention middleware identifies, never delivers — the agent owns messaging  `729782d0`
- **desktop** feat(desktop): error card offers Nous support link on Portal-auth sessions  `e3d46bb5`
- **desktop** feat(desktop): failed turns name the failing layer with recovery actions  `98f6fc54`
- **bot-mode** feat(bot-mode): message_agent tool — structured, Bot-Chat-only agent-to-agent DMs  `e26d91dc`
- **update** feat(update): updates.parked_branch_strategy gates the in-place merge; switch stays the default  `70151dd5`
- **update** feat(update): --switch-branch opts an unmerged branch out of the in-place merge  `4fad27a1`
- **update** feat(update): update branches carrying unmerged commits in place instead of skipping  `91096bb2`
- **bedrock** feat(bedrock): add OpenAI GPT-5.6 family (Sol/Terra/Luna) to Mantle Responses routing  `16476fad`
- **bedrock** feat(bedrock): support OpenAI Responses models  `e5b96fcb`
- **models** feat(models): free models show star + -100% in the model picker discount column  `bd93a5f3`
- **models** feat(models): glm-5.3 replaces glm-5.1 in the OpenRouter and Nous Portal catalogs  `907da145`
- **models** feat(models): 'ox alpha' now finds x-preview-f-free in every model picker  `1bf8bd2c`
- **nix** feat(nix): give Home Manager a programs module and the desktop app  `76f6ba37`
- **models** feat(models): stealth/ox-alpha free model in the Nous Portal catalog  `67af79d7`
- **cron** feat(cron): bot-chat delivery target — cron output lands in a bot's canonical Bot Chat and the bot responds  `a2da0ab7`
- **nix** feat(nix): wait for the backend bind target before it starts  `fd3a783a`
- **desktop** feat(desktop): give hiding the tab strip a command, and a way back  `272b007f`
- **browser** feat(browser): add scoped artifact endpoints, broker permission gates, and companion journal  `1977c3d2`
- **browser** feat(browser): enable extension controller actions  `c9fd5223`
- **browser** feat(browser): add authenticated control broker  `5df1d0e1`
- **desktop** feat(desktop): route remote bot actions by connection  `9b7ab9d6`

### 缺陷修复（fix，824 条）

- **deadline** fix(deadline): remove the dead second SuspectableBackend class shadowing the Phase 3a Protocol  `08b4875f`
- **gateway** fix(gateway): preserve exception type when error string is empty (#78183)  `6cbb7b61`
- **serve** fix(serve): review follow-ups — never-raise sentinel fallback, DEVNULL stderr in split-stream test  `8d95ab1b`
- **serve** fix(serve): widen fd-1 sentinel write to BACKEND_PORT_IN_USE sibling site  `42e1aa39`
- **serve** fix(serve): announce READY sentinel on fd 1, not the redirected sys.stdout  `f2dd32d3`
- **agent** fix(agent): honor explicit free OpenRouter models  `a65ad156`
- **models** fix(models): delist openrouter/elephant-alpha (no longer served by OpenRouter)  `ab80a385`
- **desktop,bots** fix(desktop,bots): render "(empty)" sentinel as a friendly message in group chat  `f05fec35`
- **desktop/bots** fix(desktop/bots): keep a substantive group reply after a synthetic (pass)  `8d412e67`
- **desktop** fix(desktop): real stop primitive for group-chat rounds (#91868, #94569)  `1b575c65`
- **hermes_cli** fix(hermes_cli): scope hook timeouts and fail closed on pre_tool_call  `091cc0e8`
- **browser** fix(browser): inline windows-footgun annotation for os.kill(pid, 0) (#85125 CI)  `86221181`
- **browser** fix(browser): psutil.pid_exists liveness probe — Windows footgun (#85125 CI)  `011b2cf4`
- **browser** fix(browser): suspect-session recycle + wedged-daemon tree-kill on timeout (#85125 3b-browser/4c)  `3a941015`
- **browser** fix(browser): reset sessions after command timeout  `0be9b7cd`
- **cron** fix(cron): widen the lock-first liveness check to 'hermes cron status'  `1e5fb70f`
- **cron** fix(cron): trust the gateway runtime lock for builtin-ticker liveness  `b71c3cc1`
- fix: follow-up for salvaged PRs #93250 + #96234  `9b44273c`
- **bots** fix(bots): label cap-forced drive exits distinctly from consensus settle (#94478)  `1ae2c2b1`
- **bots** fix(bots): bound continuation rounds + index-order mention tracking (#94755 review)  `411f9c2f`
- **bots** fix(bots): drive cited member after an unanswered @mention handoff  `24a5b6ec`
- **tui-gateway** fix(tui-gateway): unset semantics for every live-adopted compression/model key  `ca753b96`
- **serve** fix(serve): bounded flush-on-SIGTERM + periodic incremental session flush  `6d4e851d`
- **approval** fix(approval): enforce explicit timeout on smart-approval guardian call and log its outcome  `349e6611`
- **cron** fix(cron): tree-kill script timeout descendants via agent.deadline.kill_process_tree  `2f0f0119`
- **mcp** fix(mcp): un-invert the stdio children liveness check (#94335)  `98fce8e5`
- **hermes_cli** fix(hermes_cli): surface fail-closed config write refusals cleanly  `93a29d11`
- **hermes_cli** fix(hermes_cli): stop config set/unset from wiping user overrides on invalid YAML  `77d4d23f`
- **compression** fix(compression): preserve terminal lifecycle for lock skips  `36ae3252`
- **compression** fix(compression): suppress duplicate completion notices  `7a21bfe6`
- **config** fix(config): preserve lossy decimal values as strings  `6defe7eb`
- **relay** fix(relay): fall back to descriptor platform for unfurl stamping  `be5c7516`
- **slack** fix(slack): coerce string unfurl knobs on the native plane  `5521265d`
- **relay** fix(relay): coerce string unfurl knobs and disable Slack draft streaming  `634d9c3f`
- **slack** fix(slack): preserve unfurl controls during streaming  `91dbd7a6`
- **slack** fix(slack): honor unfurl controls for media captions  `b91845c2`
- **relay** fix(relay): restore voice-note STT — wire media[] MIMEs, message_type "voice", and a User-Agent for CDN downloads (#95274)  `29033a3f`
- **desktop** fix(desktop): preserve group turn reason codes  `a8169f3e`
- **desktop** fix(desktop): Bots-mode picker routes guarded model switches through the shared confirm handler  `61b6788d`
- **desktop** fix(desktop): switch model after refresh when it leaves the catalog  `0fa98d6a`
- **desktop** fix(desktop): Bot Mode model picker always settles and stops remount churn (#95279)  `911978da`
- **desktop** fix(desktop): widen pool keepalive-fresh window to absorb WSL2 IPC stalls (#95189)  `00988f3b`
- **cli** fix(cli): repair interrupted update fleet restart  `8246c4f9`
- **compaction** fix(compaction): exclude operational notifications from tail anchor and auto-focus (#92703)  `1341dfbd`
- **tui** fix(tui): adopt live compression config on the next Desktop/TUI turn  `11cf59d9`
- **gateway** fix(gateway): isolate control routes from default executor  `cb54576b`
- **desktop** fix(desktop): hide unreachable same-name Bot Mode roster twins  `21054b75`
- **desktop** fix(desktop): retain local startup profile across SSH switches  `ac2ec568`
- **desktop** fix(desktop): claim-guard every remaining ensureRegistryBackend()/ensureBackend() call in Electron main  `1e732816`
- **desktop** fix(desktop): defer gateway liveness force-close while a turn is in flight (#95327)  `b1f133d4`
- **desktop** fix(desktop): bound the onActiveConnectionInvalidated fallback getConnection() call  `fbe51fa7`
- fix: restore the default resolving dial mock in the salvaged #95343 probe test  `2a41f9b6`
- **desktop** fix(desktop): bound getConnection()/resolveGatewayWsUrl() on every remaining route  `d81b801f`
- **tui** fix(tui): _init_session cwd hydration must not fall back to the launch DB  `4896cab0`
- **tui** fix(tui): fail closed when a named profile's state.db won't open  `0a4d3aba`
- **desktop** fix(desktop): preserve bounded bot hydration budget  `77b5bb39`
- **browser** fix(browser): Windows real-profile fails fast when the browser is running  `931bf613`
- **browser** fix(browser): copy real-profile auth DBs lock-aware (Windows 'file in use')  `42046b45`
- **browser** fix(browser): real-profile review round 3 — overlay-ordering race, torn-copy marker, consent cleanup, active-only copy  `6e854595`
- **browser** fix(browser): real-profile review round 2 — last_used profile, sidecar isolation, macOS26 parser, perms, lightpanda  `7fb52c14`
- **browser** fix(browser): real-profile snapshot is a first-class secret store + preserve channel identity  `f1d05ce7`
- **browser** fix(browser): keep local_browser inside the private-URL policy and the existing local session  `0f56937c`
- **browser** fix(browser): resolve snap and Flatpak Chromium profiles on Linux  `7e2c2b1b`
- **browser** fix(browser): read the macOS https handler per entry and drop the installed-browser fallback  `f5e60284`
- **browser** fix(browser): pass encoding to detector subprocesses and accept local_browser in test spies  `c41562cf`
- **update** fix(update): raise the step-idle watchdog default to 10 minutes  `7a1aafb4`
- fix: delete-path drops every scope of a removed id; legacy purge latches on success only  `3b672a68`
- **desktop** fix(desktop): scope durable transcript-tail cache by owning profile/connection  `03f5302a`
- **update** fix(update): normalize windows.ps1 to LF and keep fixture here-string braces off column 0  `266d8ce2`
- **update** fix(update): stop counting the Windows resume token as a fleet runtime  `71823be9`
- **update** fix(update): count logs/update.log growth as watchdog progress  `50d3c53f`
- **update** fix(update): assign Windows steps before execution  `91c475bf`
- **update** fix(update): quiesce stalled Windows updater trees  `dc91b6b5`
- **update** fix(update): recover stalled Windows desktop handoffs  `80be4890`
- **mcp** fix(mcp): register stdio MCP helper children in the spawn ledger and reap orphans (#61514)  `e1e72f10`
- **update** fix(update): run config migration on the 'Already up to date' repair path (#91360)  `53057f2b`
- **update** fix(update): check and apply config migrations on current checkout / retry paths (#91360)  `bf5ff510`
- **update** fix(update): pause SCM-supervised Windows gateway services before venv mutation  `790e1eb6`
- **update** fix(update): conservative outcomes + serve-ledger coverage for fresh restart recovery  `b2c01136`
- **update** fix(update): persist fresh recovery outcome  `f9135c18`
- **update** fix(update): persist per-profile recovery outcomes  `ccdd7f41`
- **update** fix(update): verify fresh restart recovery results  `f0045c53`
- **update** fix(update): recover aborted gateway restart in a fresh process  `5609ccbe`
- **update** fix(update): sweep aborted-fetch tmp_pack debris before it corrupts the pack directory (#93732)  `df3d41ee`
- **deps** fix(deps): bump the nanoid@^3 override past GHSA-2v37-7h3g-55p8 (#91931)  `8fdda828`
- **cli** fix(cli): note pre_restart_pids' per-PID data model gap, pin the matching-start_time path  `2812d612`
- **cli** fix(cli): guard the post-update fleet check against PID reuse  `5d7ed70e`
- **update** fix(update): feed Windows gateway relaunch outcome into fleet reconciliation  `de2a9de7`
- fix: harden claim-release guard for bare test doubles; repoint source-pinning test at the impl  `7a7a371c`
- **slack** fix(slack): release a failed handler's fresh ts claim so the turn isn't swallowed  `39a5838f`
- **slack** fix(slack): claim message ts before enrichment so link unfurls can't duplicate a turn  `708f84c4`
- **desktop** fix(desktop): session rows are identified by (profile, id) — twins in two profiles stop collapsing and mis-routing (#92454)  `db127f75`
- **desktop** fix(desktop): SSH orphan reaper fails CLOSED on remote lockfile schema/ownership skew  `3ee0c622`
- **serve** fix(serve): serve Desktop token page at / in headless mode (#94227)  `39a5aa91`
- **desktop** fix(desktop): escape reloadUrl in error page inline script (script-tag breakout)  `c9d7b22e`
- **desktop** fix(desktop): replace white screen after update with visible error + auto-reload (#95575)  `4bc84d04`
- **memory-setup** fix(memory-setup): route .env writer through save_env_value's validation gate  `67667326`
- **i18n** fix(i18n): changes_requested + review_detail wake keys in all 17 locales  `2f8d6b55`
- **kanban** fix(kanban): wake controllers on review changes  `a699234f`
- **update** fix(update): wait for resumed Windows gateway before failing fleet check  `b3e477f3`
- **desktop** fix(desktop): put attachment close and code copy back on hover-reveal  `a2c3b549`
- **desktop** fix(desktop): don't gate hover-reveal on the hover media query  `2f87fa66`
- **desktop** fix(desktop): restore scroll on the capped thinking preview  `be7eefec`
- **desktop** fix(desktop): fail closed when onboarding hits a model guard  `19f9d1ba`
- **desktop** fix(desktop): confirm guarded Settings model applies  `8fe4816e`
- **desktop** fix(desktop): restore the typecheck by completing the typing-sync harness  `15b673d1`
- **desktop** fix(desktop): hold the sessions list refresh for the whole typing burst  `68518c1f`
- **desktop** fix(desktop): defer heavy sessions.changed list refresh while typing  `01e9b9ab`
- **desktop** fix(desktop): decode-probe app icon candidates instead of existence-only (#94806)  `f0187332`
- **tui_gateway** fix(tui_gateway): ask before queueing a guarded model picked mid-turn (#91043)  `25525799`
- **desktop** fix(desktop): keep attachment close and code copy icons visible (#95611)  `b519ce29`
- **desktop** fix(desktop): show repo-root-only sessions in project drill-in (#94552)  `d0fdbfd6`
- **slack** fix(slack): keep the resolved proxy on bolt's per-request client  `2e80d7fa`
- **slack** fix(slack): stop injecting thread roots as reply context  `bac960e2`
- **kanban** fix(kanban): wake the origin on review handoffs and triage escalations  `7700d3a0`
- **slack** fix(slack): prevent duplicate rich-text message content  `5538bd1f`
- **acp** fix(acp): key the ACP runtime exclusions on the scheme, not on one vendor  `613164da`
- **background-review** fix(background-review): skip the fork when the provider can't emit tool calls  `37fd61d1`
- **config** fix(config): block generic Copilot ACP controls  `c4f376c1`
- **config** fix(config): harden MCP env policy on Windows  `5425ba14`
- **mcp** fix(mcp): restrict catalog environment writes  `08cf4fea`
- **desktop** fix(desktop): guard setPrimaryGatewayConnectionId against non-primary active scopes  `1a5547c5`
- **desktop** fix(desktop): preserve primary gateway identity across source switches  `10746a53`
- **desktop** fix(desktop): route clarify responses through session owner  `7eb11cab`
- **desktop** fix(desktop): resolve session owners from the cron and messaging sidebar slices  `6fdaef6a`
- fix: adapt salvaged staleness-probe tests to the kickoff option-object signature  `bdbb41b6`
- **desktop** fix(desktop): snapshot Close All pane ids before persist-close  `0ecbf1ce`
- **desktop** fix(desktop): persist Bot Mode Close All session tiles  `f1755cc1`
- **desktop** fix(desktop): restore live group after bot open failure  `9ea7a37c`
- **desktop** fix(desktop): close group main tab when opening a local bot chat  `f72786f7`
- **desktop** fix(desktop): SIGKILL-escalate the owned SSH backend when it survives the graceful quit wait (#91668 remainder)  `697087f2`
- **desktop** fix(desktop): stop spawning loopback serve children when the registry primary is remote (#91564, #90316)  `1e9a12a7`
- **desktop** fix(desktop): quarantine malformed connections.json entries per-entry instead of dropping or nuking the registry (#94246)  `62e2d6e1`
- **desktop** fix(desktop): key cookie-auth session partitions on connection identity, not auth mode (#92183)  `31250da5`
- **tests** fix(tests): set _ever_connected in reconnect-scenario test mocks  `e8dc0af5`
- **tools** fix(tools): stop treating a post-registration reconnect drop as an initial-connect failure  `c7673f32`
- **desktop** fix(desktop): paint stored Bot Chat history immediately instead of stranding the wake on an unsatisfiable profile gate  `dd0aae41`
- **desktop** fix(desktop): address review — staleness guard, neutral confirm fallback, clarify pending return  `a72d6d63`
- **desktop** fix(desktop): confirm guarded model switches instead of snapping back  `7450266a`
- **update** fix(update): never respawn backends from a foreign HERMES_HOME (#94030)  `57309c0c`
- **update** fix(update): preserve SSH ownership only during updates  `858916ac`
- **update** fix(update): preserve SSH-owned backends during cleanup  `1676c614`
- **installer** fix(installer): target Windows updater shim kills  `b3a2065f`
- **desktop** fix(desktop): re-bind open pane to rebuilt runtime after model switch  `ec8ca8f2`
- **desktop** fix(desktop): satisfy lint — read busy atom directly in tile reconcile  `3669fa30`
- **desktop** fix(desktop): reconcile workspace-tile transcripts on sessions.changed  `db8ff4eb`
- **desktop** fix(desktop): refresh hidden Bot Chat transcripts  `ef2710d1`
- **desktop** fix(desktop): force session.resume on explicit bot-switch open so Bot Chat never paints a stale cached transcript (#93604)  `254af557`
- **state** fix(state): fail closed when a live process still holds state.db during destructive restore (#90950)  `7125e839`
- **update** fix(update): clear stale SQLite sidecars before auto-restoring state.db  `86d71906`
- **backup** fix(backup): clear stale SQLite sidecars on snapshot restore  `a7988b83`
- **backup** fix(backup): restore state.db through SQLite backup API so live connections see restored data (#65942)  `88d55f31`
- **desktop** fix(desktop): legacy group members stored under display names seat their real bot once, not as ghosts (#92794)  `bc21808e`
- **search** fix(search): path-scoped grep pruning + execution-backend gating for macOS TCC exclusions  `979b7d14`
- fix: avoid macOS privacy prompts during broad searches  `5fd6811d`
- **web_server** fix(web_server): detect replaced venvs with a marker file — inode snapshots miss ext4 inode reuse  `cddb908a`
- **desktop** fix(desktop): reject SSH backends with replaced runtimes  `8624c1e8`
- **checkpoints** fix(checkpoints): display failed deletes to users and stabilize result keys  `d0351e32`
- **checkpoints** fix(checkpoints): surface failed_deletes and make skipped_oversize unconditional  `37200847`
- **deadline** fix(deadline): document the inline-mark contract; pin the ordering invariants (Phase 3a salvage round)  `dcfdc8de`
- **deadline** fix(deadline): Phase 3a review round — mark ordering, loop offload, annotation  `9ee27440`
- **desktop** fix(desktop): skip macOS TCC-protected media dirs in git repo scan  `1bd5da3a`
- **terminal** fix(terminal): tolerate macOS TCC PermissionError in _safe_getcwd  `9eb13d07`
- **computer_use** fix(computer_use): pitch background-FIRST (not background-only) in schema, prompt block, and skill  `65605d4a`
- **desktop** fix(desktop): single-owner backend dial claim in Electron main (#90812)  `bb3421bf`
- **desktop** fix(desktop): revalidate pooled remote/SSH backends on power resume (#93910)  `3123624c`
- **gateway** fix(gateway): redeliver transient failures after reconnect  `8e1db410`
- **desktop** fix(desktop): poll-guard reset is fire-and-forget off the redial path  `b455abe0`
- **desktop** fix(desktop): isolate the poll-guard reset import + sort-imports lint  `62534e2b`
- **desktop** fix(desktop): republish the connections registry to renderers after every successful save (#95393)  `fe615a00`
- **desktop** fix(desktop): release reconnect-orphaned warm transcripts once their authoritative state settles  `06be6cff`
- **desktop** fix(desktop): harden the dead-session poll guard per #94950 review  `a7ea1564`
- **desktop** fix(desktop): stop the status-stack poll storming a dead session with 4001s  `c19849cd`
- **desktop** fix(desktop): unify boot-class getConnection() budgets on one shared 45s constant  `574bd717`
- **desktop** fix(desktop): bound getConnection() on the boot and soft-switch paths (#93454)  `31f3de1f`
- **web_server** fix(web_server): a dashboard started without a build recovers the moment one appears (#82614)  `20d33e38`
- **web_server** fix(web_server): recheck WEB_DIST existence dynamically in mount_spa  `3dea11d7`
- **cli** fix(cli): preserve stale positive behind-count on fetch failure (#92578)  `98e87ac8`
- **cli** fix(cli): don't serve stale update-check results after fetch failure (#82166)  `55d50d5c`
- **checkpoints** fix(checkpoints): surface skipped_oversize to users and stop misreporting failed deletes as restored  `d62a05e9`
- **checkpoints** fix(checkpoints): stop safe restore deleting files the size cap excluded  `d28bf799`
- **macos** fix(macos): keep the TCC anchor alive across CVE-repair rotations + sign anchor copies  `9f8cdf89`
- fix: preserve macOS TCC identity for managed Python  `8d6c0a30`
- **desktop** fix(desktop): a canonical-title race adopts the winner instead of forking the forever chat (#92473, part 2)  `d22e2b9f`
- **dashboard** fix(dashboard): compare and spawn the venv interpreter by UNRESOLVED path  `19fde8a4`
- **dashboard** fix(dashboard): spawn detached actions from the install's venv interpreter  `ad8f995b`
- **cron** fix(cron): forward attach_to_session through cronjob handler  `5e9adc9e`
- **cron** fix(cron): unify in_channel flatten and seed behind one continuable gate  `83131854`
- **cron** fix(cron): mirror continuable-cron briefs for origin-fallback and opted-in explicit targets  `580daa7b`
- **desktop** fix(desktop): stamp remote list rows with their owning connection; retry one transient projects.tree loss  `fb393ee0`
- **desktop** fix(desktop): bound the boot descriptor wait so a dead primary cannot strand the registry restore  `b2a58dbb`
- **desktop** fix(desktop): prove registry-primary backend ownership electron-side; wait for the primary descriptor before boot restore  `fd031488`
- **desktop** fix(desktop): fail closed through registry boot and drain owner holds  `d6e323bd`
- **desktop** fix(desktop): retain primary gateway registry identity after reload  `c662e1be`
- **desktop** fix(desktop): serialize profile switches and drain edit redials  `6fdf8734`
- **desktop** fix(desktop): require exact owners in registry topology  `962b308b`
- **desktop** fix(desktop): profile-rail fresh chats keep one exact session owner from create through every later RPC  `07b87f14`
- **desktop** fix(desktop): profile-rail fresh chats keep their registry source as the exact owner  `cb75983a`
- **desktop** fix(desktop): routed fresh chat keeps its exact owner after session.create  `77edf1b4`
- **state** fix(state): renaming a bot's canonical Bot Chat is refused — the title IS the identity (#92473)  `ad7b7255`
- **computer-use** fix(computer-use): fail closed on unverified CuaDriver.app + background launch  `45db70a8`
- **computer-use** fix(computer-use): preserve macOS TCC daemon identity  `4746f614`
- **computer_use** fix(computer_use): disable embedded daemon overlay  `1a7f83a7`
- **desktop** fix(desktop): clicking a bot no longer burns a model turn on a fake user prompt  `4faa721d`
- **desktop** fix(desktop): drop unused registryGatewayWsUrl import left by the header-binding refactor rebase  `25d46c78`
- **desktop** fix(desktop): recover remote sessions after gateway restart  `21f34794`
- **desktop** fix(desktop): log when Windows remote SSH skip teardown  `8085614f`
- **desktop** fix(desktop): terminate owned SSH serve backends on quit  `0c69cac4`
- **desktop** fix(desktop): clarify primary SSH reuse failures  `14d16c25`
- **desktop** fix(desktop): reuse migrated primary SSH backend  `3263ca2a`
- **desktop** fix(desktop): scope registered ssh primary gateway  `1b8f3eda`
- **desktop** fix(desktop): treat ticket 401 as sign-in when native tokens are unreadable  `949f5169`
- **desktop** fix(desktop): refresh remote WebSocket header cache recency  `024b9c05`
- **desktop** fix(desktop): bind headers to scoped WebSocket URL  `b4162de3`
- **compressor** fix(compressor): widen empty-content abort to sibling no-response shapes + snapshot state field  `4ba26085`
- **compressor** fix(compressor): abort compression on empty-content provider degradation to prevent context loss (#94448)  `fa210e5a`
- **codex** fix(codex): canonicalize fc_-only tool-result ids to match the call side  `635232ec`
- **codex** fix(codex): sanitize replayed function_call.name to Responses API pattern (#31666)  `31485d50`
- fix: update on macos referenced nonexisting variable  `34c5fcb2`
- **desktop** fix(desktop): restore stale-branch-reverted main.ts/update files; detach post-switch profile refresh from switch completion  `5a285d34`
- **desktop** fix(desktop): drop duplicate knownSessionOwner re-landed by rebase (main's richer variant wins)  `b722177f`
- **desktop** fix(desktop): SSH/reconnect owner continuity, attachment routing, transport-error recovery  `317ae240`
- **desktop** fix(desktop): thread eager profile metadata through registry enumeration  `2ed39365`
- **desktop** fix(desktop): remember selected profile across restarts  `2952119b`
- **desktop** fix(desktop): single-flight refreshProfiles with retry recovery in global remote mode  `57043c2b`
- **desktop** fix(desktop): document connect-on-demand origin, add fallback-profiles integration test  `a9285967`
- **desktop** fix(desktop): do not treat deferred local enumeration as a failure  `c475484f`
- **desktop** fix(desktop): keep pin list identity gateway-wide  `ff57f173`
- **desktop** fix(desktop): probe a cached pooled remote backend before dispatching to it  `9577d663`
- **desktop** fix(desktop): retire the composer busy latch on gateway reconnect (#93059)  `616d6c54`
- **desktop** fix(desktop): preserve terminal state during reconnect hydration  `2e75f9dc`
- **desktop** fix(desktop): hydrate transcript after reconnect attach  `19251ac9`
- **desktop** fix(desktop): typecheck fixes for salvaged tests (afterEach import, routed-request mock typing)  `57876f4b`
- **desktop** fix(desktop): feature-detect ctx.onDispose in the hide-sweep scheduler  `9730bc78`
- **desktop** fix(desktop): re-home the active key when the primary gateway re-homes  `0366eaca`
- **desktop** fix(desktop): keep bot reconciliation off inactive backends  `66186dc5`
- **desktop** fix(desktop): retain open pane gateway owners  `3cf4f7ab`
- **desktop** fix(desktop): preserve registered gateways during mode switches  `700ff780`
- **desktop** fix(desktop): keep owner-routed tile gateways out of idle prune  `1808d33a`
- **desktop** fix(desktop): require an open socket before publishing a secondary gateway route  `7e0b5356`
- fix: omit User-Agent from anonymous OpenViking identity probes  `fab534b5`
- **desktop** fix(desktop): first Windows update attempt no longer fails on dying backend processes (#74805)  `b04f8578`
- **desktop** fix(desktop): pin the complete macOS usage-description set + add reminders entitlement  `a7eee2a7`
- **desktop** fix(desktop): declare NSAppleMusicUsageDescription to disclaim MediaLibrary TCC prompt  `f0e99026`
- **desktop** fix(desktop): declare NSLocalNetworkUsageDescription for macOS 15+ (#81563)  `5d286654`
- **desktop** fix(desktop): declare macOS calendar and reminder permissions  `8d27e1df`
- **desktop** fix(desktop): return True when fallback sign + strict verification succeed  `c0b5a8e1`
- **desktop** fix(desktop): never delete safeStorage keychain item in the updater  `177688e3`
- **desktop** fix(desktop): scope keychain reset to the legacy ad-hoc fallback only  `91dcca9a`
- **desktop** fix(desktop): reset keychain entry after macOS re-sign to prevent prompt on every launch  `d1c6d5ba`
- **desktop** fix(desktop): sort titlebar-overlay-width import before window-connection-route (lint)  `71d804d0`
- **desktop** fix(desktop): fail closed when messaging DELETE cannot resolve an owner  `cab6c4f7`
- **desktop** fix(desktop): prefer messaging/cron slice when restoring a dual-listed session  `add24666`
- **desktop** fix(desktop): route messaging session DELETE/archive to owning profile  `718654a9`
- **desktop** fix(desktop): isolate SSH routing by window  `7944ad21`
- **desktop** fix(desktop): align SSH terminal routing precedence  `d77114d0`
- **desktop** fix(desktop): route terminals through registry SSH  `a70e7b0c`
- **desktop** fix(desktop): resolve active v2 registry SSH scope  `d2c8727d`
- **desktop** fix(desktop): retain routed socket through turn completion  `120430be`
- **desktop** fix(desktop): decide image/file byte-upload by the session's own connection, not ambient  `6b3977b5`
- **desktop** fix(desktop): route ambient SSH profile deletion to remote  `76af834d`
- **gateway** fix(gateway): authorize routed messages in transport scope  `2afed508`
- **gateway** fix(gateway): scope routed history before session lookup  `9ab748ab`
- **computer-use** fix(computer-use): default the cursor overlay off on Linux X11  `c6ae9325`
- **gateway** fix(gateway): log secondary startup-reconnect handoff failures instead of dropping them  `dce4abe9`
- **gateway** fix(gateway): schedule secondary-profile reconnect when initial adapter connect fails  `96489f3c`
- **desktop** fix(desktop): guard gateway-open resume against active fresh-draft transition (#68594)  `2a4460b5`
- **desktop** fix(desktop): release profile activation lease on dial failure  `4b21f970`
- **desktop** fix(desktop): surface profile-switch dial failures instead of silently activating  `c06d3c0b`
- **desktop** fix(desktop): preserve profile overrides on local source picks  `7d6bf56c`
- **desktop** fix(desktop): invalidate stale runtimes before profile reopen  `613822af`
- **desktop** fix(desktop): preserve remote session routing  `893c8b1f`
- **desktop** fix(desktop): preserve registry owner for session sends  `abe58428`
- **desktop** fix(desktop): retain registry session ownership  `26932ea0`
- **desktop** fix(desktop): reuse primary during owned route activation  `1ec32e73`
- **desktop** fix(desktop): reuse registry primary for owned session RPCs  `6c0ddecf`
- **desktop** fix(desktop): preserve recovery refresh ownership  `502298ef`
- **desktop** fix(desktop): guard stale refresh ownership  `693dd5d0`
- **desktop** fix(desktop): guard async switch publications  `b3bdf0c8`
- **desktop** fix(desktop): enforce gateway switch publication ownership  `ee3dc554`
- **desktop** fix(desktop): preserve switch loading ownership  `f23b3c80`
- **desktop** fix(desktop): preserve gateway switch recovery ownership  `559a56c3`
- **desktop** fix(desktop): recover failed gateway switch setup  `c2bce09d`
- **desktop** fix(desktop): cancel timed-out gateway activations  `b687c6b2`
- **desktop** fix(desktop): harden gateway-switch commit ordering for stalled and overlapping switches (#93937)  `300fcdbf`
- **desktop** fix(desktop): commit gateway switches before publishing the new source (#93937)  `5472d1d6`
- **macos** fix(macos): derive interpreter alias names dynamically in the TCC anchor  `5259f565`
- **macos** fix(macos): stable TCC anchor for uv-managed python interpreter (#85345)  `cc5ff96f`
- **update** fix(update): bound optional cua-driver refresh  `105cea64`
- **update** fix(update): bound the cua-driver installer drain after a failed kill  `65fada09`
- fix: redirect stdin to DEVNULL in non-verbose cua-driver installer (#79684)  `5c5e8492`
- **desktop** fix(desktop): stop the Bots roster hanging on a live profile  `458f26c0`
- **doctor** fix(doctor): classify certificate-anchored DRs as stable + keep explicit env_map hermetic  `6cb3a263`
- **macos** fix(macos): harden TCC check against codesign timeouts, clarify scope  `2d37ed05`
- **macos** fix(macos): guard empty DR in TCC check, tighten platform-guard test  `8665b1e4`
- **macos** fix(macos): detect stale TCC grants and guide one-time re-grant  `36c17550`
- **desktop** fix(desktop): allow microphone from macOS setup launcher  `7d9953d3`
- **install** fix(install): heal the updater's self-owned-marker refusal loop on Windows  `26c987c3`
- **delegation** fix(delegation): suppress subagent-owned process notifications in parent chat by default  `afee3570`
- **desktop** fix(desktop): skip Tip delay when moving between adjacent chrome  `b742be71`
- **update** fix(update): also defer the missing-binary CUA install on Windows  `f751a8c5`
- **update** fix(update): defer interactive CUA installs on Windows  `0c23bf19`
- **livetest** fix(livetest): render multi-query bridge calls  `a667ab60`
- **tool-describe** fix(tool-describe): separate missing and direct names  `b09f6177`
- **tool-search** fix(tool-search): preserve exact and per-query ranking semantics  `1e86a263`
- **desktop** fix(desktop): keep the Cronjobs pane subscribed to roster hydration  `250faa69`
- **hermes-bots** fix(hermes-bots): stop New Cronjob dialog crash when the owner is a roster object  `b73e0578`
- **desktop** fix(desktop): stop the edit composer's timers from outliving it  `37a8c10a`
- **desktop** fix(desktop): copy unsafe RPC rejections instead of mutating name  `961635c1`
- **desktop** fix(desktop): coerce bot RPC rejections for React 19 error formatting  `a837c7aa`
- **desktop** fix(desktop): scope Cronjobs pane to the roster-clicked bot when the focused session has no owner (#94516)  `936a6ea8`
- **desktop** fix(desktop): make --setup-tcc-identity produce a VALID signing identity on modern macOS  `28f2ea86`
- **desktop** fix(desktop): clear the JS/TS check failures on the Browser pop-out  `30b042e1`
- **tool-search** fix(tool-search): bridge batch barrier, listing truncation, source indexing (salvage #92693, part 1)  `62b2d780`
- **mcp** fix(mcp): Atlassian catalog entry no longer 404s + Grafana defensive curation  `95668f5e`
- **update** fix(update): gateway-only concurrent instances no longer abort hermes update (#37039)  `36f14234`
- **teams** fix(teams): request supported transcript content format  `7c5c9943`
- **update** fix(update): restart a booted-out launchd gateway instead of silently skipping it (#74973, salvage #75021)  `bee489d5`
- **cli** fix(cli): reconcile scoped-closure and reduced-lockfile freshness checks  `76d8f876`
- **cli** fix(cli): don't re-run npm install on every TUI launch with npm>=10 reduced hidden lockfile  `def7bdc6`
- **tui** fix(tui): prevent spurious npm install on every launch  `4d66def3`
- **cli** fix(cli): scope TUI npm-install closure to all selected workspaces  `a96bad8e`
- **cli** fix(cli): scope TUI npm-install check to the ui-tui workspace closure  `0c47cd52`
- **desktop** fix(desktop): route session list REST through the active profile  `02c7ae95`
- **desktop** fix(desktop): translate sidebar recents_profile through SSH aliases  `90ee4460`
- **gateway** fix(gateway): bind session cwd for the live system-prompt rebuild  `cbd8de8a`
- **web** fix(web): never cache local development URLs in the extract cache  `f0381ee4`
- **web** fix(web): extract cache serves only after policy + provider gates; rescue and format/provider isolation  `8adef09b`
- **mcp** fix(mcp): tool-selection UIs stay in exclude mode instead of freezing include lists  `45b35f96`
- **mcp-catalog** fix(mcp-catalog): failed probe keeps the prior tool filter instead of wiping it  `965689d1`
- **mcp-catalog** fix(mcp-catalog): don't announce a probe on the exclude-mode install path  `01177ed7`
- **mcp** fix(mcp): treat tools.include: [] as an explicit empty whitelist  `fb1ec36a`
- **mcp** fix(mcp): review findings — reinstall no longer clobbers user exclude lists + 4 curation gaps  `054cba27`
- **docker** fix(docker): digest-suffix shared-container identity labels so distinct keys never collide  `d736f5d5`
- **config** fix(config): declare shared Docker container key  `f5200a4c`
- **memory** fix(memory): bind the checkpoint gate to post-turn micro-compaction too  `1ee524f7`
- **memory** fix(memory): bind the checkpoint gate to every compaction authority  `8cc379b5`
- **memory** fix(memory): review follow-ups for the pre-compress checkpoint contract  `70d0b1ff`
- **computer_use** fix(computer_use): route explicit screen capture to get_desktop_state  `aeac9822`
- **terminal** fix(terminal): persistent Docker containers are profile-scoped, not per-session  `15f7b729`
- **ws-only** fix(ws-only): address review blockers — opt-in gating, loopback fail-close, real v15 handshake tests  `49442c7b`
- fix: write ready sentinel to real stdout — server.py redirects sys.stdout to stderr at module level  `27e700e7`
- fix: websockets >=13 handler signature — read path from ws object, not second arg  `213f0a69`
- fix: use module-level Path import — local re-import shadowed it for the whole function  `9ee94d7d`
- fix: TypeScript casts + backend-ready test updates for { port, token } return  `71e2924c`
- **approval** fix(approval): machine-readable outcome parity on the gateway tails + sudo human-wait exclusion (#85125 2e)  `c8c3f4c4`
- **gateway** fix(gateway): widen computer-use media path repair to sibling surfaces  `bb0d5503`
- **curator** fix(curator): tell the background reviewer to read before it writes  `610e2e02`
- **background-review** fix(background-review): teach review prompts the enforced read-before-write handshake  `a70d2ffc`
- fix: follow-up for salvaged PR #93985 — cache key, snapshot, dead code  `b0cf2597`
- **memory** fix(memory): keep OpenViking identity operations consistent  `4387e039`
- **memory** fix(memory): scope OpenViking user cache to connection  `5ff03cb0`
- **memory** fix(memory): emit explicit-uid OpenViking URIs resolved from system status  `7cd43cdf`
- **memory** fix(memory): migrate OpenViking URIs to the viking://~ home alias  `fc4c2f45`
- **skills** fix(skills): preserve review marks across contexts  `335c60ec`
- **gateway** fix(gateway): resolve session-scoped Docker sandboxes for MEDIA delivery (#93950)  `d4f31a8f`
- **fallback** fix(fallback): surface provider transitions and primary recovery  `5908c577`
- **gateway** fix(gateway): recover explicit computer-use media paths  `1fac4408`
- **telegram** fix(telegram): wait for reconnect before failing send as Not connected  `6c1bfff6`
- **teams** fix(teams): do not call App() when the SDK was never bound  `f84f94b4`
- **agent** fix(agent): race Codex IPv6 and IPv4 connections  `d934bbd4`
- **tools** fix(tools): route browser snapshot storage through the symlink-safe writer  `bf8b28f2`
- **memory** fix(memory): log when a configured provider's tools are gated off by toolset config  `8172be0e`
- **agent** fix(agent): gate memory provider system_prompt_block on toolset config (#81014)  `b45b0285`
- **tests** fix(tests): e2e group-restart test no longer flakes on cold SessionDB init  `bc47fcd3`
- fix: system prompt no longer references tools/skills the session can't use; hermes-agent skill is always kept  `3733e4af`
- **tui-gateway** fix(tui-gateway): make WS reconnect replay actually deliver events (follow-up to #94219)  `beb79412`
- **signal** fix(signal): chunk long standalone sends and cover both delivery paths (salvage #57929 + #67279)  `48f69e51`
- **signal** fix(signal): chunk long cron deliveries instead of truncating  `cbc8d180`
- **desktop** fix(desktop): keep UI scale across in-page route navigation  `b637ee0f`
- **desktop** fix(desktop): stop gating edit-menu Paste on the clipboard probe (#91553)  `5400fb88`
- **desktop** fix(desktop): keep modal context menus inside dialogs  `e3b5512b`
- **desktop** fix(desktop): say why window enumeration failed instead of swallowing it  `5ef1409f`
- **desktop** fix(desktop): stop the HUD frosting the window while a turn runs  `321d5c76`
- fix: log a warning when parent-dir hardening is skipped for the install tree  `8b48f621`
- **terminal** fix(terminal): annotate sweep as POSIX-only for the killpg guard lint (#85125 CI)  `457e9b8d`
- **mcp** fix(mcp): psutil.pid_exists for stdio children liveness — Windows footgun (#85125 CI)  `786f3707`
- **web** fix(web): keyword-align titles of six high-impression docs pages  `e2e8d7e5`
- **models** fix(models): OpenRouter :nitro/:floor routing variants no longer rejected by /model validation  `f14059fa`
- **lsp** fix(lsp): abort diagnostics waits after transport death  `14201763`
- **lsp** fix(lsp): retire clients when the protocol reader exits  `2f506c20`
- **computer-use** fix(computer-use): recreate CUA session suspect after MCP timeout (#74799)  `c73d721b`
- **desktop** fix(desktop): restore pending_clarify snapshots on activate and resume  `53c46930`
- **desktop** fix(desktop): re-arm pending clarify cards in place  `dc998a2d`
- **desktop** fix(desktop): demote unanswered clarify cards on Stop  `e4dac841`
- **desktop** fix(desktop): stop transcript jumps when a turn settles  `ead9d8e3`
- **terminal** fix(terminal): sweep setsid descendants after local timeout group-kill (#85125 4b)  `9990bcb8`
- **mcp** fix(mcp): recover poisoned connections + fail fast on dead stdio transports (#85125 3b)  `2f33833d`
- **desktop** fix(desktop): keep Home new sessions detached from the last project  `f3e0cf09`
- **desktop** fix(desktop): hold the typed address in the browser bar until the page moves  `84758ed1`
- **desktop** fix(desktop): sort HUD windowing imports for eslint  `652f5d74`
- **codex** fix(codex): identify Hermes requests  `a0795acc`
- **desktop** fix(desktop): float and pin the HUD on Hyprland  `7e500d2e`
- **desktop** fix(desktop): never kill a healthy backend on a claim probe failure; surface real stderr (#93608)  `d08f9e14`
- **serve** fix(serve): Windows conflict probe uses SO_EXCLUSIVEADDRUSE (SO_REUSEADDR binds over live listeners on WinSock)  `c0ce7473`
- **serve** fix(serve): emit BACKEND_PORT_IN_USE sentinel + exit 75 on port bind conflict (#93608)  `de07bd5f`
- **desktop** fix(desktop): polish HUD movement and resizing on X11  `81baae6b`
- **desktop** fix(desktop): add a HUD layout reset control  `d467da91`
- **desktop** fix(desktop): keep the Linux HUD clickable and recoverable  `b595fcd5`
- **desktop** fix(desktop): debounce and re-verify zoom on Linux Wayland  `fab0de1c`
- **desktop** fix(desktop): move the Linux HUD with a native compositor drag  `11f3ebe2`
- **mcp** fix(mcp): resolve tool-call timeouts via the unified deadline layer (#85125 2g)  `7dde1b8b`
- **cron** fix(cron): share liveness helper with CLI and extend it to cronjob list  `5843b2f5`
- **cron** fix(cron): surface gateway liveness in cronjob tool results (#87033)  `302085ab`
- **tui** fix(tui): heartbeat and bounded reconnect for silent WebSocket drops  `e3f695e5`
- **desktop-update** fix(desktop-update): use the system default browser for the update shim  `9525c0e5`
- **approval** fix(approval): fail closed when the deadline import is unavailable; log clamp engagement  `446423d9`
- **desktop** fix(desktop): hold a per-turn socket lease so group-chat member turns survive the runtime-session reaper (#93602)  `c29c9d17`
- **approval** fix(approval): clamp approvals.timeout at the config-read chokepoint (#83220)  `4341cf1d`
- **agent** fix(agent): clamp authorization gate lock timeout to prevent OverflowError on macOS  `0dd0f6e6`
- **desktop** fix(desktop): scope branch-opens-primary to the currently selected session  `9fbe3cc0`
- **desktop** fix(desktop): open a branched session in the main workspace, not just a tile  `a4092cd2`
- **conformance** fix(conformance): make the journal-mode matrix honest — steer the child resolver, audit the effective mode  `905fdda1`
- **desktop** fix(desktop): give keyboard focus a visible affordance where the global no-ring reset hides it  `1bee67be`
- **hindsight** fix(hindsight): let hindsight_retain convey event time via occurred_at  `32fb12a2`
- **hindsight** fix(hindsight): harden event timestamps  `497d6d5a`
- **hindsight** fix(hindsight): send configured event timestamps  `97850afa`
- **desktop** fix(desktop): stack subsequent preview tiles as tabs instead of new right splits  `4d030a37`
- **desktop** fix(desktop): exclude cron sessions from the titlebar unread badge  `57ece811`
- **desktop** fix(desktop): stop bot-relay drain loop from redialing a WebSocket per connection per tick  `06fc941d`
- **pricing** fix(pricing): support Gemini context-tiered rates in pricing snapshot (#93469)  `c9e2a46d`
- **auth** fix(auth): malformed OpenRouter env key no longer shadows valid credential-pool key  `a87d314e`
- **terminal** fix(terminal): cap watch_patterns notifications over a process's lifetime  `b3730153`
- **desktop** fix(desktop): teach the torn-bundle guard to see missing lazy chunks  `c7f1f4d6`
- **desktop** fix(desktop): prefer the unpacked web dist over the asar-internal renderer index when packaged  `73af57a2`
- **desktop** fix(desktop): isolate a failed lazy syntax-diff import from the workspace pane  `b614e265`
- **desktop** fix(desktop): guard render-reachable route lookups against orphaned rows  `40ab950a`
- **desktop** fix(desktop): annotate group-chat members already orphaned before hydrate  `725cfe29`
- **desktop** fix(desktop): sweep group-chat rosters when a connection is removed  `c509af68`
- **desktop** fix(desktop): split strict connection routing from passive roster lookup  `ec013b76`
- **desktop** fix(desktop): group chats no longer crash when a member's connection is deleted  `09529afd`
- **desktop** fix(desktop): bound the boot and gateway-switch resolveGatewayWsUrl awaits too (#93454)  `e8d5660b`
- **desktop** fix(desktop): bound the revalidateConnection() await too (#93454)  `5ef205d8`
- **desktop** fix(desktop): bound reconnect awaits so a stuck IPC round-trip can't latch the UI frozen  `17f8e24c`
- **dashboard** fix(dashboard): follow scroll on implicit active-session resume (#93518)  `9c013eaa`
- **bot-relay** fix(bot-relay): add shutil.which step to CLI resolution and pin utf-8 decoding on delivery subprocess  `42a6d761`
- **bot-relay** fix(bot-relay): Windows path SyntaxError in waiter + PATH-less delivery ENOENT  `c099ef05`
- **cli** fix(cli): hard-exit the Windows update hand-off child once work is durable  `8d170602`
- **cli** fix(cli): fail closed on empty fleet probe across all pre-update liveness signals (#93406)  `93bf6f72`
- **cli** fix(cli): treat empty fleet probe as incomplete when gateways were restarted (#93406)  `d74bbb9b`
- **batch_runner** fix(batch_runner): teach the resume content scan to honor discard tombstones  `a26154ac`
- **batch_runner** fix(batch_runner): write a discard tombstone so resume skips no-reasoning prompts  `316d52fa`
- **model_metadata** fix(model_metadata): stop misreading max_tokens as context length in local probe  `a0c802c0`
- **model-metadata** fix(model-metadata): local ctx probe must not read max_tokens as the context window  `4d729e4b`
- **context** fix(context): prefer max_input_tokens over max_tokens for Anthropic proxies  `394f0f09`
- **gateway** fix(gateway): resolve PairingStore's default pairing dir lazily, not at import time  `e210fd8c`
- **cli** fix(cli): add --reasoning to both top-level value-flag sets  `1007296c`
- **cli** fix(cli): derive top-level value flags from parser  `694550e4`
- **config** fix(config): stop reporting stripped v15 defaults  `3963fc6f`
- **tools** fix(tools): widen the command-position anchor to the whole hardline class  `a7aa814c`
- **tools** fix(tools): anchor the mkfs hardline pattern to command position  `8163c873`
- **gateway** fix(gateway): route platform authorization reads through the profile secret scope  `7befc1d2`
- **gateway** fix(gateway): scope multiplex-profile authorization reads (weixin/yuanbao/wecom)  `d7e4204e`
- **desktop** fix(desktop): guard stale files refreshes  `9abeb89a`
- **desktop** fix(desktop): isolate files across connections  `30150fd0`
- fix: remove dead code, deduplicate error constants, fix skill key check  `0eda2ba0`
- **cron** fix(cron): prevent empty payload loop and protect against blank name overwrite  `350fb975`
- **cli** fix(cli): support reliable setup menu navigation  `8345effc`
- **desktop** fix(desktop): scheduled jobs on sleeping profiles keep firing  `d9a48f65`
- **desktop-update** fix(desktop-update): shim window only opens in the user's own browser family  `da57f492`
- **update** fix(update): auto-close desktop-update shim window after error/manual outcomes  `60bb2bb7`
- **desktop-update** fix(desktop-update): never render the posix update shim in Edge  `f329f9e4`
- **desktop** fix(desktop): update flow nudges a gateway reconnect; wake path probes instead of blind-closing  `b90289b0`
- **desktop** fix(desktop): probe half-open gateway socket on wake and reconnect  `cdd37035`
- **cron** fix(cron): warn loudly when the due-scan removes a consumed one-shot that already ran (#93524)  `29c5a12e`
- **desktop** fix(desktop): SkillsView tests no longer cascade-fail on slow CI runners  `a1c5e515`
- **cli** fix(cli): widen prompt_toolkit fallback to catch any runtime failure  `45aa0dc3`
- **cli** fix(cli): fall back to input() when prompt_toolkit can't attach stdin  `e8ab3b07`
- fix: widen secure_parent_dir to skip entire install tree  `9857bcba`
- fix: restore trailing newline at EOF lost in cherry-pick conflict resolution  `7fbf6e72`
- **gateway** fix(gateway): prove --replace ownership from the bound pid record  `2a27e1ff`
- fix: route codex payloads around the SDK's GIL-holding request transform (#93650)  `10a070bd`
- **adoption** fix(adoption): re-check donor growth at retire time, not just at export  `dc50f020`
- fix: align cache-policy pre-gate identity with the capability matcher  `f93b3507`
- **agent** fix(agent): normalize custom provider route identity  `0204e489`
- **agent** fix(agent): honor prompt_caching for custom providers  `0a3b7efe`
- **cron** fix(cron): refuse to run terminal jobs  `c3a63a16`
- **auth** fix(auth): thread use_https into the native password-login PKCE clear  `53ab03dc`
- **desktop** fix(desktop): bots group chat sends message on IME composition Enter  `7e67f64f`
- **cron** fix(cron): misfire backstop honors the one-shot grace window (#93526)  `ed8ee9a8`
- **cron** fix(cron): due-scan must not dispatch a one-shot past its grace window  `b37a5bc0`
- **desktop** fix(desktop): route remote file requests by connection  `0b62c27b`
- **agent** fix(agent): bypass response cache for empty retries  `21b92d26`
- **desktop** fix(desktop): clear stale group metadata on disband  `34feb375`
- **desktop** fix(desktop): route SSH media through active connection  `6eb77df1`
- **tools** fix(tools): share the task-id path sanitizer across backends; cover singularity overlays  `410b1ec5`
- **docker** fix(docker): sanitize the session-key task_id used as a sandbox path  `fb381e80`
- **desktop** fix(desktop): gate transport retries to idempotent or provably-unsent requests  `859010b9`
- **desktop** fix(desktop): harden Hermes API transport  `1cc76fce`
- **curator** fix(curator): say what pin actually does on an unmanaged skill  `ef882a55`
- **curator** fix(curator): check unpin result, guard status ghost rows, tighten test  `dd20c30d`
- **curator** fix(curator): report pin failures instead of false success and surface pinned unmanaged skills  `7caa731e`
- **desktop** fix(desktop): Windows HUD paints opaque white  `433f518c`
- **desktop** fix(desktop): resolve get-windows from the staged copy first  `1c75e059`
- **classifier** fix(classifier): 429 quota walls route to billing across providers; reset signals stay rate-limited  `0c3a5075`
- **state** fix(state): reap only proven database holders  `fe245256`
- **state** fix(state): recover FTS after orphan holder deferrals  `8f3a82f9`
- **auth** fix(auth): rotate credentials for named custom providers after 401/429  `37411f34`
- **auth** fix(auth): canonicalize configured provider display names  `030edf97`
- **auth** fix(auth): preserve configured provider compatibility  `3a7c0945`
- **auth** fix(auth): normalize configured provider pool keys  `c527b2c0`
- **gateway** fix(gateway): stop multiplex allowlist leak and bot-relay python -c injection  `2912c36a`
- **dashboard** fix(dashboard): name the exact gate trigger in fail-closed refusals  `b03b8ac5`
- **dashboard** fix(dashboard): secure loopback public URL proxy mode  `d3df14a7`
- **state** fix(state): stop rebuilding the whole FTS index on every open when the trigram tokenizer is missing  `608a56ed`
- **telegram** fix(telegram): watchdog silent long-poll death via last getUpdates progress (#92991)  `bf15b050`
- fix: managed-runtime guard no longer trips on sdist/build copies in the workspace  `3f5d3756`
- fix: reuse first-observed sequence when announced items land via output_item.done  `580060ff`
- **agent** fix(agent): harden pending Responses tool call settlement  `4f3ae189`
- **codex** fix(codex): settle pending Responses tool calls when output_item.done is omitted  `720344cf`
- **terminal** fix(terminal): subagents no longer hijack the tty with an interactive sudo prompt  `081cdd99`
- **state** fix(state): single fail-closed cross-process authority for all full FTS rebuilds  `9d0727d4`
- **state** fix(state): serialize cross-process FTS rebuild with file lock  `0f33c207`
- **tui_gateway** fix(tui_gateway): enable TCP keepalive on websocket sockets (dead-peer detection)  `d6bc3f2b`
- **tui-gateway** fix(tui-gateway): revalidate transport ownership before sentinel-parking on WS disconnect  `a7977771`
- **tui** fix(tui): make startup_orphan_reap recoverable and move its config onto dashboard.*  `47d6ce78`
- **tui** fix(tui): sweep orphaned tui/desktop/subagent session rows at gateway startup  `d3e4b50e`
- **tui** fix(tui): log 4001 session-not-found rejections for diagnosability  `c3058394`
- **bot-mode** fix(bot-mode): fail closed on transient group-session resume failures  `525597c9`
- **gateway** fix(gateway): adopt stranded bot sessions from the default store on profile resume  `26a4f89a`
- **agent** fix(agent): honor structured quota reset signals  `654d5370`
- **desktop** fix(desktop): distinguish provider quota exhaustion  `c2090ba6`
- **security** fix(security): cover privilege wrappers and command-string options  `6b3a7af7`
- **cron** fix(cron): stop a relative path from disabling the data-sink exemption  `a19e1bae`
- **security** fix(security): see through wrapper prefixes in the gateway lifecycle guards  `5921ba8c`
- **cron** fix(cron): preserve map keys as ids and skip junk values when flattening id-keyed jobs.json  `f2639f88`
- **cron** fix(cron): self-heal id-keyed jobs.json to canonical list form on load  `ec4b3bc0`
- **cron** fix(cron): normalize id-keyed jobs stores on load  `5a24dcf4`
- **install.ps1** fix(install.ps1): record 'skipped-long-path' when ConvertTo-LongPath short-circuits  `2e758627`
- **install.ps1** fix(install.ps1): initialize LastResolver before the resolved-path report  `203f111c`
- **cron** fix(cron): keep hermes console script on child PATH  `b0001f45`
- **gemini** fix(gemini): wrap schema-bearing tool results as opaque text  `03477166`
- **desktop** fix(desktop): show the launch-source preference for a single connection  `c25f206e`
- **desktop** fix(desktop): boot restore never overrides a live unnameable source  `d5463b3f`
- **desktop** fix(desktop): heal v1/v2 connection drift instead of re-homing onto local  `aaf63220`
- **desktop** fix(desktop): boot-time source restore keeps the All-profiles preference (#93197)  `4fea0f04`
- **desktop** fix(desktop): synchronize applied gateway registry  `96e58985`
- **desktop** fix(desktop): authenticate remote liveness probes  `6a25ec07`
- **install** fix(install): actually invoke check_cxx_compiler in both install stages  `a6bec08f`
- **install** fix(install): refresh Playwright upgrade for current main  `1fc9c1b4`
- **bots** fix(bots): protect new drafts from title sweep  `1b18442f`
- **browser** fix(browser): floor browser-use CLI subprocess PATH with sane system dirs  `478a09c0`
- **cron** fix(cron): re-anchor stale next_run_at after direct jobs.json schedule edits  `8f9abc98`
- **stt** fix(stt): surface the selection-specific error for explicit openai STT  `5d8b0315`
- **cli** fix(cli): honor target_model when resolving custom providers  `c4871226`
- **tui** fix(tui): settle tmux clipboard load on child exit  `6d48fbed`
- **tui** fix(tui): settle execFileNoThrow on timeout even when a daemon holds stdio  `27fb1179`
- **review** fix(review): fail-closed compressor detachment + warm-cache first request (#93057 review)  `74e6885f`
- **review** fix(review): bound same-model background review replay  `4202a508`
- **agent** fix(agent): separate cancellation diagnostics from tool output  `2033f4cc`
- **code-exec** fix(code-exec): preserve interrupt cancellation source  `c1c0efa3`
- **gateway** fix(gateway): preserve routing state across recovery  `80cec278`
- **gateway** fix(gateway): retry failed session database opens  `4b659f0e`
- **state** fix(state): make automatic repair non-destructive  `31a01f37`
- **agent** fix(agent): widen composite-id alias matching to the compressor; unify variant policy owners (#63000)  `a2a43f7e`
- **agent** fix(agent): preserve tool results across ID variants  `5496d599`
- fix: sniff fast-path keys on binary magic only, not NUL presence  `a9e46229`
- **cron** fix(cron): close NUL-padded script bypass in lifecycle guard  `92edb861`
- **cron** fix(cron): scan dot-operator sourced scripts in lifecycle guard  `da30db8e`
- **gateway** fix(gateway): lazy/unpersisted resume also rebinds transport and cancels the pending reap  `b4d4167d`
- fix: inert heredoc bodies no longer trip the gateway lifecycle guard (#88336)  `9aa0721b`
- fix: execute_code and argv-list payloads no longer bypass the gateway lifecycle guard (#68289)  `b34edd6b`
- **gateway** fix(gateway): resolve uninstall lifecycle guard conflict  `1c791cbf`
- **gateway** fix(gateway): close order-dependency + missing-verb gap in launchctl lifecycle guards  `679e07a0`
- **tools** fix(tools): pass single_query_deny_message to the ssh-config write approval gate  `acf82456`
- fix: pass single_query_deny_message to approval gate for ssh config writes  `dd2b5172`
- fix: use lookbehind anchor so binary-decoded and remote-read content still scans  `20e308fe`
- fix: lifecycle guard Branch A anchors the CLI name at command position (#77173 path false positive)  `180f9811`
- **vision** fix(vision): forward the API key to the server-type probe and cache failed verdicts  `51239e8e`
- **image_routing** fix(image_routing): stop fingerprint-probing remote OpenAI-compatible endpoints  `4ca993c7`
- **agent** fix(agent): keep max-iteration warnings out of quiet stdout  `fe483de4`
- **desktop** fix(desktop): single-flight tolerates sync resume runners; delegate tests assert owner routing  `36bbb41d`
- **desktop** fix(desktop): resolve the owning remote profile before a hint-less session read falls through to local  `b0af1199`
- **desktop** fix(desktop): route approval.respond through the session's owner, not the ambient socket  `09047ec6`
- **desktop** fix(desktop): single-flight session.resume per stored id + adopt-or-reuse on drift-abort  `77dd0699`
- **desktop** fix(desktop): make the explicit-queue-target recovery regression load-bearing  `18e941ac`
- **desktop** fix(desktop): isolate explicit queued submit recovery  `11fd82cf`
- **desktop** fix(desktop): recover routed submits after reconnect  `53471925`
- **desktop** fix(desktop): active gateway is never a session-RPC routing authority  `d12bc0c4`
- **desktop** fix(desktop): clarify preserved session tile recovery  `319e77ee`
- **desktop** fix(desktop): preserve live session tiles after reconnect  `72f6127b`
- **desktop** fix(desktop): force gateway reconnect after wake  `febed060`
- **gateway** fix(gateway): resolve approval.respond by durable identity before failing 4001  `9b3f60c0`
- **gateway** fix(gateway): make ws keepalive and orphan-reap grace config-driven (#79635)  `fdd8d75b`
- **gateway** fix(gateway): cancel pending WS-orphan reaps on resume and supersede stale runtimes quietly  `4aa162b3`
- **gateway** fix(gateway): re-bind session transport to a surviving window on pop-out close  `f2dbd37e`
- **tui-gateway** fix(tui-gateway): bound the interrupt-then-reap poll chain (review finding)  `3dd0ed1d`
- **tui-gateway** fix(tui-gateway): interrupt turns after websocket disconnect  `14b50f5e`
- **tui** fix(tui): reschedule WS orphan reap while a turn is still running  `30a37668`
- **desktop** fix(desktop): stop Inbox-style session cards from clipping text (#93036)  `0c1f1d2f`
- **desktop** fix(desktop): latch unsigned OAuth boots so the Sign in overlay stays put  `48f2ccb6`
- **cli** fix(cli): -Q stdout carries only the final response — no tool diffs, spinner lines, or reasoning  `63771675`
- fix: suppress reasoning display in quiet single-query mode  `8e2e3202`
- **agent** fix(agent): make the pre-call dedup pass variant-aware; widen batch regression coverage (#93251)  `faa2399e`
- fix: repair_message_sequence drops tool results for SDK tool_call objects  `36b4da54`
- **agent** fix(agent): consume every tool_call id variant when pairing tool results  `b9a62f65`
- **compression** fix(compression): register both id/call_id variants in _sanitize_tool_pairs  `52fb5081`
- **agent** fix(agent): keep tool results keyed on a tool_call's id variant (#55626)  `1a83b1e5`
- **cron** fix(cron): make gateway lifecycle matching shell-token aware (#80269)  `6d501c29`
- **cron** fix(cron): cover bootout/remove/disable in the gateway lifecycle guard  `320d884d`
- **desktop** fix(desktop): route each session RPC by its target session, not the focused tile  `b463840c`
- **cron** fix(cron): block profile-flag gateway restart/stop when self-targeting (#78028)  `c595d356`
- **lifecycle_guard** fix(lifecycle_guard): quote-aware command segmentation and word boundaries  `a74eb2dd`
- **desktop** fix(desktop): rebind legacy-remote-primary Bot tiles via live-connection scoping  `58d84d3e`
- **desktop** fix(desktop): rebind Bot Chats after gateway restart  `6b4a2eeb`
- fix: set failed=True for repeated_outer_errors exit + drop append_message  `b8cd00f9`
- **loop** fix(loop): bound outer-loop error retries per turn instead of relying on max_iterations (#92450)  `56e7fd2a`
- **desktop** fix(desktop): wait 5m before reconnect warning toast  `8db59d08`
- **desktop** fix(desktop): stop transient remote ticket blips locking the chat  `f2c204d6`
- **dashboard-auth** fix(dashboard-auth): correct authentication docs anchor  `bd13d593`
- **dashboard-auth** fix(dashboard-auth): replace stale insecure guidance  `7cc92cb1`
- **desktop** fix(desktop): route session RPCs by their own target session, not the focused tile  `3a263b55`
- fix: quitting the CLI no longer spams shutdown-race API errors onto the shell  `9ea7fe99`
- **desktop** fix(desktop): sort nous-alt imports and mark it first-party  `c9d8712f`
- **desktop** fix(desktop): completed /goal chip no longer sticks to the composer forever  `0a171fff`
- fix: gateway lifecycle guards gate on process ownership, not inherited env  `0e038425`
- **plugins** fix(plugins): dispose persistent auth registrations on plugin disable and re-discovery drop  `d861fbe5`
- **dashboard-auth** fix(dashboard-auth): keep the provider registry alive across per-home plugin-manager unloads  `b2ade238`
- **approval** fix(approval): stop the CLI and ACP offering a scope the protected gate discards  `165d1849`
- **desktop** fix(desktop): show approvals for protected file writes  `04154a37`
- **gateway** fix(gateway): honor approval scope capabilities  `4e8419da`
- **agent** fix(agent): break immediately on interpreter shutdown in conversation loop  `e63786fc`
- **bot-mode** fix(bot-mode): bound the Bots home re-front so the view stops strobing  `2350f4dc`
- **bot-mode** fix(bot-mode): a cronjob row opens — clicking one no longer does nothing  `913de4ec`
- **desktop** fix(desktop): show the in-app browser in Bot Mode  `beb84835`
- **kanban** fix(kanban): reuse event stream database connection  `2ebb1cb4`
- **dashboard** fix(dashboard): preserve placeholder cwd fallback  `b7cb3212`
- **dashboard** fix(dashboard): preserve exported terminal overrides  `3a817211`
- **dashboard** fix(dashboard): scope terminal config to selected profile  `5a85c4a7`
- **bot-mode** fix(bot-mode): review follow-ups for recoverable-archive resurrection  `48651947`
- **bot-mode** fix(bot-mode): resurrect canonical Bot Chat archived by recoverable reasons on reopen (#92687)  `bef31fb0`
- **desktop** fix(desktop): anchor the during-turn tail by entry id, not index  `a234e936`
- **desktop** fix(desktop): review follow-ups for the room-race fixes  `2863e8fb`
- **bot-mode** fix(bot-mode): review follow-ups for the turn lock  `c460e87d`
- **desktop** fix(desktop): make member stop sticky — per-member hold until explicit resume (#93129)  `0c474d78`
- **desktop** fix(desktop): drop superseded group-chat turns and dedupe adjacent identical replies (#93127)  `ae6baf33`
- **test** fix(test): deterministic delivery-spawn sentinel + fold bot_mode into agent config tab  `a07ada23`
- **bot-mode** fix(bot-mode): re-schedule a push that races an in-flight drain + pin the watermark's fire-again contract  `bb63e0c4`
- **desktop** fix(desktop): don't push a live connection as absent when its profile fetch blips  `e00d6c19`
- **web** fix(web): fold single-field bot_mode config section into agent tab  `3ac63066`
- **bot-mode** fix(bot-mode): require status-code context for bare numeric classifier rules  `69948516`
- **desktop** fix(desktop): badge active-gateway bots too — resolve the relay attention key for local rows  `387698a6`
- **desktop** fix(desktop): track isDisabled flips in the adapter no-op notify gate  `90803f22`
- **desktop** fix(desktop): stop no-op adapter swaps notifying the thread runtime + derive backend venv from the selected interpreter  `4019518e`
- **dashboard** fix(dashboard): detect stale code after hermes update and refuse model picker with clear 503 (#86207)  `f293e720`
- **desktop** fix(desktop): route bot-chat RPCs to the bot's own gateway via tile ownerRoute (#92956)  `9452bca3`
- **bot-mode** fix(bot-mode): group rooms name renamed bots — 'Lucy is thinking…', never a stale 'Hermes'  `f530cd2b`
- **desktop** fix(desktop): route hidden Bot Chat RPCs to the owning profile backend (4001 session-not-found) (#92928)  `2c244f07`
- **desktop** fix(desktop): Send Diagnostics dialog no longer clips the link behind a horizontal scrollbar  `bdf10471`
- **tui-gateway** fix(tui-gateway): messaging a never-used bot no longer fails with 'session not found'  `fe2e6b76`
- **bot-mode** fix(bot-mode): first click on a bot opens its chat — the home no longer bounces over it  `a4c6c6bd`
- **update** fix(update): verify launchd is supervising the gateway after a restart  `1bf93660`
- **desktop** fix(desktop): typing /voice points at the composer voice button  `102a30f6`
- **update** fix(update): stop a gateway we cannot relaunch instead of leaving it on stale code  `dfcef700`
- **desktop** fix(desktop): resolve Bot tiles on their owner  `7ead9b93`
- **desktop** fix(desktop): preserve cross-realm Bot registry errors  `9ff7f332`
- **desktop** fix(desktop): preserve Bot tabs across owner lifecycles  `a81854a2`
- **desktop** fix(desktop): bound Bot owner wake races  `856fc66d`
- **gateway** fix(gateway): /p/<profile>/ on a non-multiplex gateway fails closed instead of serving the owner profile  `6cb1085d`
- **api-server** fix(api-server): a /p/<profile> prefix on a non-multiplexed gateway fails closed instead of misdelivering  `265bdcac`
- **bot-relay** fix(bot-relay): sweep stale relay artifacts + never leak the deliver tempfile  `764dba69`
- **bot-mode** fix(bot-mode): reap orphaned DM payloads from gateway housekeeping  `793fba42`
- **bot-mode** fix(bot-mode): isolate DM tempfiles per user  `08742d0e`
- **bot-mode** fix(bot-mode): clean up message tempfiles  `eaa61ff6`
- **cli** fix(cli): one-shot runs linger for notify_on_complete background processes so Bot Mode replies survive parent exit  `9e181977`
- **desktop** fix(desktop): Bot Mode keeps Cloud alias identity after hosted handoff  `3638961d`
- **peer** fix(peer): resolve hidden canonical Bot Chats in hermes peer dm  `231e613d`
- fix: import managed_python_env at the git-path site; assert the managed-env contract in the repair test  `0c14f060`
- **update** fix(update): widen UV-env isolation to the sibling dependency-sync sites  `fbfdb931`
- **update** fix(update): isolate pip install from third-party UV env vars  `08f5a0a9`
- **desktop** fix(desktop): spoken replies use the connected gateway's TTS, not a stowaway local backend  `c012a364`
- **compression** fix(compression): -900k Codex variants keep the global 50% threshold; 85% autoraise stays on 272K base slugs  `933c209e`
- **vision** fix(vision): review follow-ups — LA/PA JPEG guard, third embed site  `30d45550`
- **vision** fix(vision): shrink oversized history embeds via JPEG quality, not halving  `c02fe650`
- **compression** fix(compression): share one image-strip policy across demote and retire passes  `b7544dba`
- fix: derive the pinned interpreter's Scripts dir via venv_bin_dir (#76105 lint)  `5c1a304c`
- **test** fix(test): stale-VIRTUAL_ENV fixture accepts strict_quarantine kwarg  `27d7d566`
- **update** fix(update): address review on stale-VIRTUAL_ENV pin  `33e813da`
- **update** fix(update): pin uv installs to the running interpreter when VIRTUAL_ENV is stale  `13f9d18e`
- **model** fix(model): single exact eligibility predicate for -900k variants; reject ineligible aliases  `7b89e177`
- fix: harden the metadata-walk probe (directory-named plugin.js regression test, lint)  `0430e3c7`
- **desktop** fix(desktop): stop missing plugin entries from flooding IPC logs  `6a4e212e`
- **install** fix(install): never strand hermes.exe when a Windows update fails  `503d863f`
- fix: desktop plugins over 512 KiB no longer load truncated  `ecf63ad3`
- fix: stamp _db_persisted at row load time so resumed transcripts never re-append (#92231)  `016ba661`
- **browser** fix(browser): cap browser_vision native embeds for history reuse  `dff84f18`
- **compression** fix(compression): retire stale vision tool images in the protected tail  `7ff2fe8b`
- **vision** fix(vision): size native embeds for history reuse  `21a93f0a`
- **desktop** fix(desktop): spare concurrently starting backends  `b44c2bda`
- **dashboard** fix(dashboard): recover update success after restart  `09110609`
- **test** fix(test): isolate the fork-sync test from the host machine; abort at the reload proof point  `4553e719`
- **cli** fix(cli): treat a fork's upstream sync as an update  `e366df68`
- **update** fix(update): a gateway killed by the restart phase and never replaced now fails the fleet check (DOWN row)  `16848778`
- **picker** fix(picker): harden keyless provider gate logging and credentials path validation  `5f0a8f87`
- **picker** fix(picker): scope Vertex explicit-config to Hermes signals, not ambient ADC  `b9f17ba3`
- fix: surface Bedrock in explicit-only model pickers when AWS env credentials are set  `3503c06d`
- **models** fix(models): bind Anthropic pool key to its endpoint  `9ce46a09`
- **models** fix(models): discover Anthropic pool API keys  `8ede2e14`
- **desktop** fix(desktop): enforce exact route identity authority  `38ce2d75`
- fix: accept pool-only Anthropic OAuth entries in the desktop picker filter  `4f0e466e`
- **inventory** fix(inventory): keep Anthropic OAuth logins visible in desktop pickers  `4ec57d56`
- **desktop** fix(desktop): settings scope requests can never target primary by accident  `c942cd9e`
- **desktop** fix(desktop): keep Messaging on active profile  `abd7f75b`
- **desktop** fix(desktop): model settings follow active profile instead of primary  `680b1150`
- **gateway** fix(gateway): honor env-configured local backends and persist Tool Gateway declines  `8b86097a`
- **gateway** fix(gateway): fix 3-tuple/4-tuple arity crash in get_gateway_eligible_tools  `ce9ddd35`
- **tools** fix(tools): don't pre-check keyless local backends in Tool Gateway checklist  `4edb2427`
- **update** fix(update): token-based control-plane classifier + live E2E for the Desktop-lifecycle cold-start skip (#76129 salvage follow-up)  `f4067774`
- **update** fix(update): skip Windows gateway cold-start when Desktop owns lifecycle  `4ccc4b69`
- **desktop** fix(desktop): a failed Bot Chat registry lookup no longer forks the bot's forever chat  `87b645f5`
- **tests** fix(tests): repair the two Linux-lane CI failures on this branch  `0b01599e`
- **update** fix(update): reword refusal message — footgun linter matched prose 'venv open (' as bare open()  `0c435f46`
- **update** fix(update): a contended venv is never mutated — failed shim quarantine now refuses instead of warning (#87331)  `83864c0b`
- **gateway** fix(gateway): control-socket hardening from #92447 post-merge review  `7a54ab22`
- **gateway** fix(gateway): control-socket fallback survives deep TMPDIR; tests bind-location-aware  `67aac4d8`
- fix: restore generic corruption match in FTS self-heal  `987064ca`
- **state** fix(state): fail closed on unscoped SQLite corruption  `50bbcbf2`
- **skills_guard** fix(skills_guard): --host flags no longer flagged as DNS exfiltration  `13f4cfeb`
- **windows** fix(windows): remove the hermes launchers on uninstall  `5d5179d7`
- **windows** fix(windows): stage hermes launchers in the managed binary dir, not the git checkout  `679e9cd2`
- **desktop** fix(desktop): resolve Win10 translucency defaults from platform, not glass capability  `67a5d7bc`
- **desktop** fix(desktop): stop manufacturing duplicate toolCallIds at the fold, repair poisoned cached tails  `40f3e58f`
- **desktop** fix(desktop): dedupe duplicate toolCallId parts at the runtime boundary (#87857)  `9f8dca34`
- **history** fix(history): keep carrier rewinds race-safe after refresh  `fd411648`
- **gateway** fix(gateway): finite-bounded watchdog knob validation + wire keys through load_gateway_config  `8ee0103e`
- **gateway** fix(gateway): keep loop-watchdog default at 3 strikes; dedupe constants; register knobs in config defaults  `36161457`
- **gateway** fix(gateway): make loop-liveness watchdog tolerant of transient reconnect stalls  `aa08cb8c`
- **compression** fix(compression): preserve live assistant carriers after refresh  `ebae0064`
- **gateway** fix(gateway): claim ledger rows and clear resume_pending inline before the abandonable boot-send task  `684e95a0`
- **compression** fix(compression): restore the prune runway when a would-grow refusal keeps the transcript  `4c76ec81`
- **gateway** fix(gateway): retain failed replacement evidence  `a4f16e3f`
- **gateway** fix(gateway): distinguish failed systemd replacements  `596bfc55`
- **gateway** fix(gateway): make handoff recovery idempotent  `83b09ebd`
- **gateway** fix(gateway): preserve systemd handoff recovery  `91fb1751`
- **gateway** fix(gateway): make systemd the sole restart owner  `5b024c7c`
- **gateway** fix(gateway): isolate kanban dispatcher to_thread context  `f12cd040`
- **gateway** fix(gateway): isolate supervised watcher contexts  `bf3a0bb9`
- **gateway** fix(gateway): give supervision exhaustion an owner for queued platforms  `e1737207`
- **gateway** fix(gateway): heal a dead reconnect watcher when the platform is already queued  `92018e76`
- **tui** fix(tui): log the refused shared-handle transfer and pin _get_db caching  `349d9aee`
- **tui** fix(tui): never transfer the shared launch SessionDB to one agent  `bd2afde4`
- **gateway** fix(gateway): clear resume_pending for all claimed ledger rows before any redelivery send  `41e29a60`
- **gateway** fix(gateway): do not let boot-path sends hold the inbound gate  `ce944a5a`
- **telegram** fix(telegram): fail closed on long send-path flood waits  `a444b673`
- **terminal** fix(terminal): scope environment cache by session key to prevent cross-profile SSH leakage  `a270c4ad`
- **bot-mode** fix(bot-mode): persist canonical chat before opening  `e95dd466`
- **discord** fix(discord): render provider model lists >25 options across multiple select menus  `ab3e2f56`
- **state** fix(state): split forensic-backup identity from repair-epoch fingerprint; publish backup bundle atomically  `1fe8683e`
- **state** fix(state): include the rollback journal in the forensic backup  `5777e68b`
- **state** fix(state): exclude SQLite's commit counters from the repair fingerprint  `8779b782`
- **state** fix(state): never let a peer connection reset the repair budget  `602c45e4`
- **state** fix(state): stop backup staging from posing as a forensic copy  `8de64b16`
- **state** fix(state): keep the repair fingerprint from cancelling POSIX advisory locks  `b3f14c85`
- **state** fix(state): make backup atomic and the disk guard proportional  `c914a9ac`
- **state** fix(state): stop unbounded state.db repair loop from filling the disk  `27d661e1`
- **bot-mode** fix(bot-mode): the canonical Bot Chat is found by NAME — session-id pins removed  `a9860d41`
- **bot-mode** fix(bot-mode): a bot row opens the bot's canonical Bot Chat (#92042)  `ff88f274`
- **windows** fix(windows): preserve launcher layout invariants  `a08b9091`
- **windows** fix(windows): restore dedicated CLI launchers on update  `9782275b`
- **tests** fix(tests): remove four shared-state and lifetime faults at high concurrency  `969094e4`
- **desktop** fix(desktop): Send Diagnostics review fixes — consent accuracy, log-grade redaction, dismissal guard, linkless-success (review feedback)  `0a9a449a`
- **update** fix(update): ZIP swap preserves the built desktop app (apps/desktop/release)  `01c14ad7`
- **update** fix(update): don't ZIP-fallback on dependency failures or dirty trees  `eac3f645`
- **desktop** fix(desktop): strip off-scheme paint from selection copies  `3cc7f220`
- **update** fix(update): holder classifier derives value-flags from the real parser; de-flake goal-resume fixture  `7d6db4ef`
- **update** fix(update): venv-holder labels parse the real subcommand; gateway ancestors stay visible to the scan  `c02cac00`
- **desktop** fix(desktop): render the Nous Cloud-down recovery when a cloud backend fails (#85335)  `23140a73`
- **desktop** fix(desktop): surface Nous Cloud 503 at the OAuth ticket-mint boundary  `d0ea5f17`
- **desktop** fix(desktop): surface actionable error when Nous Cloud agent returns 503 (#85335)  `274158ec`
- **telegram** fix(telegram): omit topic routing from rich edits  `e9a7c7aa`
- **credits** fix(credits): suppress depleted banner on stealth-preview models  `ad96d2e2`
- **state** fix(state): scope salvage to repair-connection durability + live-writer guard  `3bdc2165`
- **state** fix(state): apply macOS write barriers on every state.db repair connection  `ca28a69a`
- **cli** fix(cli): guard empty message text in _display_resumed_history  `f5adeed3`
- **state** fix(state): only flag uninspectable Hermes processes as holders  `2ea5287d`
- **state** fix(state): use /proc readlinks + cmdline fallback for holder detection  `1c59daaa`
- **state** fix(state): guard gateway FTS rebuild + comment early flag-set  `c45e2b19`
- **state** fix(state): defer FTS rebuild under foreign WAL holders  `fc72d6c7`
- **desktop** fix(desktop): error card honors the classifier's retry verdict + failing-session identity (review feedback)  `334bcbac`
- **desktop** fix(desktop): error card renders router-free threads without crashing  `892790f9`
- fix: remove function-level 'import time as _time' that shadowed the module import  `04acfb96`
- fix: hermes update no longer strands non-interactive updates on a parked branch with unmerged commits  `bbbc50ac`
- **bedrock** fix(bedrock): align auxiliary region resolution with runtime + document Mantle route  `41ca67c5`
- **moa** fix(moa): keep Bedrock slots on provider runtime  `e57d55fc`
- **telegram** fix(telegram): honor the direct-messages-topic alias in the fresh-final gate  `bad2ed86`
- **telegram** fix(telegram): keep DM-topic tables on sendRichMessage when drafts degrade  `194729c9`
- **zai** fix(zai): GLM-5.3 low/medium reasoning effort reaches the wire instead of clamping to high  `30f9955a`
- **telegram** fix(telegram): widen cancellation-shielded stop to sibling paths  `3841910c`
- **telegram** fix(telegram): rebuild after cancellation-shielded stop  `9e36774d`
- **cron** fix(cron): nudge review of escaped-run failures too  `dd034718`
- **gateway** fix(gateway): multiplex refusal must exit EX_CONFIG (78), not 1  `2fb1e62b`
- **backup** fix(backup): don't hang forever on locked SQLite sources  `d422f710`
- **backup** fix(backup): don't nest state-snapshots/ into full backups  `f9849c43`
- **zai** fix(zai): add GLM-5.3 support — 1M context window, model lists, reasoning_effort  `01d8562f`
- **bot-mode** fix(bot-mode): a bot row opens the conversation you were last having  `0287dfb0`
- **cli** fix(cli): Linux hermes.desktop entry launches instead of silently dying on system python (#90292)  `d9d967e0`
- **compression** fix(compression): auto-raise Daybreak Codex threshold  `ac8dff4f`
- **model_metadata** fix(model_metadata): add Daybreak Codex 900K context  `f8e5949f`
- **update** fix(update): pre-update snapshots now cover every profile, not just the invoking one (#66140)  `15751166`
- **desktop** fix(desktop): scope the salvaged fix to the failure-path removal  `001a4c91`
- **desktop** fix(desktop): stop tabs double-click-hiding the tab strip; body double-tap reveals it  `3aeb5928`
- **browser** fix(browser): sweep orphan artifact files at store construction  `2cb8794f`
- **browser** fix(browser): honor live Developer Mode for privileged capability selection  `c16c262d`
- **api** fix(api): correct _handle_browser_control_frame return annotation  `23a64a97`
- **browser** fix(browser): make the artifact boundary compose end-to-end and scope stores per profile  `84728986`
- **browser** fix(browser): offload broker lock acquisition off the event loop  `45078eb9`
- **browser** fix(browser): bind the extension lane at controller registration, not transport auth  `a5882058`
- **browser** fix(browser): keep bound controller routing authoritative  `2039b572`
- **browser** fix(browser): preserve controller work across reconnects  `095a1d07`
- **browser** fix(browser): harden extension controller routing  `d524cc9a`
- **desktop** fix(desktop): boot overlays stay opaque under window glass  `f33b260a`
- **clients** fix(clients): hide compaction carriers across surfaces  `a2a23a8f`
- **api** fix(api): hide compaction scaffolding from clients  `97e32d49`
- **agent** fix(agent): preserve live merged tool-call carriers  `6b7aee2f`
- **agent** fix(agent): guard merged assistant compaction handoffs  `fdf01114`
- **classifier** fix(classifier): retry provider-injected parameter 400s instead of aborting  `6e536283`
- **providers** fix(providers): use copy-on-write instead of deepcopy in NVIDIA prepare_messages  `b95f3a52`
- **desktop** fix(desktop): omit empty rewind rebind requests  `bed7e975`
- **tui** fix(tui): classify repaired rows in rewind rebinds  `d67583ac`
- **gateway** fix(gateway): preserve pending transcript state on failed rewinds  `67ee4816`
- **agent** fix(agent): preserve live turns in compaction carriers  `3e5e4c5d`
- **auth** fix(auth): make prefixed cookie deletions valid per cookie-prefix rules  `52629a5d`
- **auth** fix(auth): mirror the PKCE setter's cookie shape in clear_pkce_cookie  `5e57bf19`
- **auth** fix(auth): use SameSite=None for PKCE cookie over HTTPS to fix cross-site redirect dropping  `7c7cd24d`

### 性能（perf，5 条）

- **tool-search** perf(tool-search): cache stems and bound result metadata  `e35a7bdd`
- **bluebubbles** perf(bluebubbles): move attachment reads off the event loop  `f5a9ba9e`
- **ci** perf(ci): set python test workers to one for each core, from measurement  `0012dd1e`
- **api** perf(api): classify compaction rows once per message in run.completed transcript  `0b8a8487`
- **browser** perf(browser): read the feature flags via load_config_readonly  `652e0a72`

### 回退（revert，4 条）

- Revert "Merge pull request #94245 from kshitijk4poor/feat/gw-event-replay"  `9f05b065`
- Revert "chore: remove stealth/ox-alpha from OpenRouter and Nous Portal model catalogs"  `03c97d98`
- **macos** revert(macos): remove the TCC interpreter anchor — anchored copies could not load libpython  `2f9e1870`
- Revert "feat(desktop): error card offers Nous support link on Portal-auth sessions"  `3903428a`

### 撞特性补丁面（手维护补丁，逐条核对）

**`conversation-cost-panel.patch`**（补丁面 15 文件）：69 个提交撞面

- fmt(js): `npm run fix` on merge (#96263)  `8d30c204`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(tui-gateway): unset semantics for every live-adopted compression/model key  `ca753b96`
  - 撞：`tui_gateway/server.py`
- fix(serve): bounded flush-on-SIGTERM + periodic incremental session flush  `6d4e851d`
  - 撞：`tui_gateway/server.py`
- feat(desktop): read-only stored-transcript resume + legacy owner-backfill trigger (#94724)  `9faa6853`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- Revert "Merge pull request #94245 from kshitijk4poor/feat/gw-event-replay"  `9f05b065`
  - 撞：`tui_gateway/server.py`
- fmt(js): `npm run fix` on merge (#96076)  `36b0a96d`
  - 撞：`apps/desktop/src/i18n/zh.ts`
- feat(desktop): Managed updates section drives per-connection SSH updates  `bc4eea77`
  - 撞：`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(tui): adopt live compression config on the next Desktop/TUI turn  `11cf59d9`
  - 撞：`tui_gateway/server.py`
- fix(tui): _init_session cwd hydration must not fall back to the launch DB  `4896cab0`
  - 撞：`tui_gateway/server.py`
- fix(tui): fail closed when a named profile's state.db won't open  `0a4d3aba`
  - 撞：`tui_gateway/server.py`
- fix(desktop): confirm guarded Settings model applies  `8fe4816e`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`…
- fix(tui_gateway): ask before queueing a guarded model picked mid-turn (#91043)  `25525799`
  - 撞：`tui_gateway/server.py`
- feat(desktop): fleet profile rail — every registered gateway's agents on one strip  `fd565c80`
  - 撞：`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): paint stored Bot Chat history immediately instead of stranding the wake on an unsatisfiable profile gate  `dd0aae41`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): stop the status-stack poll storming a dead session with 4001s  `c19849cd`
  - 撞：`tui_gateway/server.py`
- feat(desktop): hide the docked Browser tab while it is popped out  `e8df4017`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): open a Browser tab in the default browser from its context menu  `26777a41`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(chat-plane): trace_id + turn telemetry, transient-delta split, seq-namespace epoch  `874fab0c`
  - 撞：`tui_gateway/server.py`
- feat(desktop): OS-keychain encryption for stored secrets is now opt-in — no more macOS Keychain password prompt on every launch  `6a6e16fa`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(gateway): bind session cwd for the live system-prompt rebuild  `cbd8de8a`
  - 撞：`tui_gateway/server.py`
- feat(gateway): slim WS-only server — remove FastAPI/uvicorn from desktop boot path  `434ea57e`
  - 撞：`tui_gateway/server.py`
- feat: browser snapshots drop LLM summarization — truncate-and-store like web_extract; auxiliary.web_extract slot removed  `a75ea37d`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fmt(js): `npm run fix` on merge (#94346)  `c86612ef`
  - 撞：`apps/desktop/src/i18n/ar.ts`
- feat(desktop): add Settings toggle for vibe hearts  `93acc22a`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(tui-gateway): seq-stamped event replay for lossless desktop reconnect  `87631bd8`
  - 撞：`tui_gateway/server.py`
- fix(desktop): re-arm pending clarify cards in place  `dc998a2d`
  - 撞：`apps/desktop/src/types/hermes.ts`
- feat(desktop): let the in-app browser hold more than one tab  `8a8f74e7`
  - 撞：`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): make Cmd/Ctrl+L focus the composer from anywhere  `28b758d5`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): add a HUD layout reset control  `d467da91`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): probe half-open gateway socket on wake and reconnect  `cdd37035`
  - 撞：`tui_gateway/server.py`
- fix(tui-gateway): revalidate transport ownership before sentinel-parking on WS disconnect  `a7977771`
  - 撞：`tui_gateway/server.py`
- fix(tui): make startup_orphan_reap recoverable and move its config onto dashboard.*  `47d6ce78`
  - 撞：`tui_gateway/server.py`
- fix(tui): sweep orphaned tui/desktop/subagent session rows at gateway startup  `d3e4b50e`
  - 撞：`tui_gateway/server.py`
- fix(tui): log 4001 session-not-found rejections for diagnosability  `c3058394`
  - 撞：`tui_gateway/server.py`
- fix(desktop): distinguish provider quota exhaustion  `c2090ba6`
  - 撞：`apps/desktop/src/app/shell/hooks/use-statusbar-items.tsx`、`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`…
- feat: review slot appears in every aux-model picker (desktop, dashboard, CLI)  `65c58651`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(gateway): make ws keepalive and orphan-reap grace config-driven (#79635)  `fdd8d75b`
  - 撞：`tui_gateway/server.py`
- fix(gateway): cancel pending WS-orphan reaps on resume and supersede stale runtimes quietly  `4aa162b3`
  - 撞：`tui_gateway/server.py`
- fix(gateway): re-bind session transport to a surviving window on pop-out close  `f2dbd37e`
  - 撞：`tui_gateway/server.py`
- fix(tui-gateway): bound the interrupt-then-reap poll chain (review finding)  `3dd0ed1d`
  - 撞：`tui_gateway/server.py`
- fix(tui-gateway): interrupt turns after websocket disconnect  `14b50f5e`
  - 撞：`tui_gateway/server.py`
- fix(tui): reschedule WS orphan reap while a turn is still running  `30a37668`
  - 撞：`tui_gateway/server.py`
- feat: /review command — independent reviewer subagent on every surface  `12395e57`
  - 撞：`tui_gateway/server.py`
- fix(desktop): stop transient remote ticket blips locking the chat  `f2c204d6`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(gateway): honor approval scope capabilities  `4e8419da`
  - 撞：`tui_gateway/server.py`
- feat(bot-mode): push-notified relay drain with poll backstop (#93091)  `9c829f96`
  - 撞：`tui_gateway/server.py`
- fmt(js): `npm run fix` on merge (#92896)  `891ec3fb`
  - 撞：`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): configure per-profile remote overrides from the profile rail  `1ad47333`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(bot-mode): bots on every Desktop connection can message each other  `d3e087fd`
  - 撞：`tui_gateway/server.py`
- feat(dashboard): Desktop and dashboard read the update receipt instead of inferring success (#91277 Phase-1 bullet 3)  `8804e783`
  - 撞：`apps/desktop/src/types/hermes.ts`
- fix(history): keep carrier rewinds race-safe after refresh  `fd411648`
  - 撞：`tui_gateway/server.py`
- fix(tui): log the refused shared-handle transfer and pin _get_db caching  `349d9aee`
  - 撞：`tui_gateway/server.py`
- fix(tui): never transfer the shared launch SessionDB to one agent  `bd2afde4`
  - 撞：`tui_gateway/server.py`
- fmt(js): `npm run fix` on merge (#92089)  `fce30d81`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): Send Diagnostics review fixes — consent accuracy, log-grade redaction, dismissal guard, linkless-success (review feedback)  `0a9a449a`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): Send Diagnostics — one-click redacted debug-bundle upload from the error card  `8f30e9c7`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fmt(js): `npm run fix` on merge (#92032)  `8286c465`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- polish(desktop): cloud-down overlay gets Portal/Discord action buttons  `a9ddd0f0`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): render the Nous Cloud-down recovery when a cloud backend fails (#85335)  `23140a73`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- fix(desktop): error card honors the classifier's retry verdict + failing-session identity (review feedback)  `334bcbac`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- polish(desktop): rename error-card action to 'Copy error details'  `50f1e414`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- Revert "feat(desktop): error card offers Nous support link on Portal-auth sessions"  `3903428a`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): error card offers Nous support link on Portal-auth sessions  `e3d46bb5`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(desktop): failed turns name the failing layer with recovery actions  `98f6fc54`
  - 撞：`apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts`、`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`…
- feat(desktop): give hiding the tab strip a command, and a way back  `272b007f`
  - 撞：`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- refactor(desktop): make a zone's tab strip a stated mode, not a flag five paths wrote  `315307f1`
  - 撞：`apps/desktop/src/i18n/ar.ts`、`apps/desktop/src/i18n/en.ts`、`apps/desktop/src/i18n/ja.ts`、`apps/desktop/src/i18n/types.ts`、`apps/desktop/src/i18n/zh-hant.ts`、`apps/desktop/src/i18n/zh.ts`
- feat(browser): add authenticated control broker  `5df1d0e1`
  - 撞：`tui_gateway/server.py`
- fix(clients): hide compaction carriers across surfaces  `a2a23a8f`
  - 撞：`tui_gateway/server.py`
- fix(agent): preserve live turns in compaction carriers  `3e5e4c5d`
  - 撞：`tui_gateway/server.py`

### 撞品牌换装覆盖面（832 个提交 / 覆盖面 862 文件）

品牌补丁由 `build/rebrand.py` 规则引擎整张重出，撞面**不需要人工重放**——这里列出只为一件事：上游若改了规则锚点的上下文，替换会无声 no-op，由 `test_hermes_charter.py` 的哨兵负责报红。改动最密的文件：

- `apps/desktop/electron/main.ts` —— 75 次改动
- `apps/desktop/src/plugins/hermes-bots/plugin.js` —— 74 次改动
- `hermes_cli/update_cmd.py` —— 53 次改动
- `apps/desktop/src/app/gateway/hooks/use-gateway-boot.ts` —— 41 次改动
- `gateway/run.py` —— 40 次改动
- `hermes_cli/main.py` —— 39 次改动
- `hermes_cli/web_server.py` —— 37 次改动
- `hermes_cli/config_defaults.py` —— 36 次改动
- `apps/desktop/src/i18n/zh.ts` —— 33 次改动
- `apps/desktop/src/i18n/en.ts` —— 30 次改动


## 三、下载

| 版别 | 资产 | 链接 |
|------|------|------|
| 私有版（内网日常用） | `black-pool-win64.zip` | [直接下载](https://github.com/lightproud/biav-sc-code/releases/download/black-pool-bundle/black-pool-win64.zip) |
| Release 页（含 SHA-256 digest） | — | [black-pool-bundle](https://github.com/lightproud/biav-sc-code/releases/tag/black-pool-bundle) |

> 链接**恒定**、内容滚动——每次周更由组装线覆盖同一资产名。要核对拿到的是不是这一版，
> 解压后看包内 `BUILD.md` 的「上游 pin」行是否为 `v2026.8.27`。
> 公版 `black-pool-public-win64.zip` 不随周更出包，按需手动触发 `assemble-black-pool-public.yml`。

## 四、BPA 更新指南（内网 bpa-dev 车间）

**推荐路径——双击一键更新**：车间根 `bpa-dev\deploy\update.cmd`。六步流水线自动跑完
① 银芯克隆 `git pull --ff-only` → ② 车间 `svn update` → ③ 下载最新整包进 `releases\`
（SHA-256 比对 Release 官方 digest）→ ④ `assemble.cmd` 组装（按 `config\assembly.txt`
拼内网补丁 / 插件 / 技能 / 配置）→ ⑤ `deploy.cmd` 部署（旧 `home\` 用户数据增量并入，
旧版让位 `.old` 回滚位）→ ⑥ 拉起部署位。日志落 `车间根\update.log`。

**手动路径**（下载失败或要挑版本时）：

1. 从上表下载 zip 进 `bpa-dev\releases\`，比对 Release 页 digest 后登记进 `CHECKSUMS.txt`
2. `assemble.cmd black-pool-win64.zip` —— 出 `staging\BlackPool\` + 装配清单 `ASSEMBLY.md`
3. `deploy.cmd` —— 成品上位，旧版进 `.old`
4. 双击部署位 `Black Pool.lnk` 或 `launcher.cmd` 验收

**验收三看**：包内 `BUILD.md` 上游 pin = `v2026.8.27` · 关于页出身行 = 「基于 Hermes Agent
0.20.6 定制」· 内网补丁在 `ASSEMBLY.md` 里逐张有名有增删行数。

**出事回滚**：`rollback.cmd <部署目录>` 一键回切 `.old`，问题版留 `.failed-*` 供取证。

**纪律提醒**：换包**必经组装**——直接解压 zip 进部署位会丢掉全部内网补丁与配置；
整包不载测试套件（出厂清场已裁），跑 `scripts\run_tests.sh` 会明说原因并指路。
详见 `projects/black-pool-agent/deploy/RUNBOOK.md`。

## 五、需要守密人注意的

**本轮非周更例程档期**，是守密人当面派发「拉下 Hermes 最新版本」。闭环跑了三轮才全绿，中间两处人工接手：

### 一、特性补丁重放：1 处

`conversation-cost-panel.patch` 在 `apps/desktop/src/app/shell/hooks/use-statusbar-items.tsx` 的 import 区撞车（5 个 hunk 只拒了 #2，其余 4 段与另外 14 档干净落位）。

**成因**：上游把紧邻的 `import type { RuntimeReadinessResult }` 改成了 `import { runtimeReadinessDisplay, type RuntimeReadinessResult }`——那正是 hunk #2 用来认位置的上下文行。补丁自己要改的是另一行（给 `@/lib/statusbar` 加 `usageCostLabel`），与上游这次改动毫无关系。

**重放正确性的硬证据**：新旧两版补丁的增删行**逐字相同**（各 802 增 / 16 删，`diff` 输出为空），全部差异只落在上下文行；重出 diff 以 v2026.8.27 纯净克隆为基准，确保补丁只含特性、不含换快照。

### 二、测试翻面：1 处

上游新增 `themes/presets.test.ts > "nous-alt is the retired Nous, not the default"`，断言 `DEFAULT_SKIN_NAME` 仍是 `'nous'`——正是 2026-08-03 配色裁定强制为 `'black-pool'` 的那一行。按 2026-08-24 先例**翻面成收口哨兵**（不豁免、不删用例）：上游验「默认是 nous」，私有版验「默认已强制为 black-pool」，谁把默认皮肤改回去这条当场红。锚点全树唯一（lesson #58 已核）。

副产品：该用例原本在第 46 行首个断言即中断，后面 4 条（`nous-alt` 注册 / `nous` 未被顶替 / 深色底色值）从未执行；翻面后首次跑通，全绿。

### 三、高风险条目里真撞的

第二节「撞特性补丁面」列了 69 个撞面提交，**实际只有上述 1 处需要人工重放**。i18n 六档虽被 `npm run fix` 批量格式化多次、并被多个 feat 塞进新文案键，hunk 全部带偏移自动落位。品牌换装面 832 个提交撞面、覆盖 862 文件，由规则引擎整张重出，锚点点火台账全数命中，无哑火。

### 四、组装线

**已出包，回查确认**（run [#27](https://github.com/lightproud/BIAV-SC-CODE/actions/runs/33106017338)，构建自 `de7e8acc`，结论 success）。三件逐条核过：

| 检查 | 结果 |
|------|------|
| run 结论 | **success** —— 两个 job 全绿：回归网（ubuntu 全量 vitest，18:58:10 → 19:07:51 UTC）+ 打包（windows，含可搬移性冒烟、桌面真启动冒烟捕获 Chromium stderr、出厂清理） |
| zip 是否本次覆盖 | **是**。资产 id `531438299 → 532760793`，更新时间 **2026-08-28 03:18（北京）/ 2026-08-27T19:18:30Z**，下载计数归零 |
| BUILD.md 上游 pin 行 | **`v2026.8.27`**。工作流第 158 行以 `sed` 从检出的 `UPSTREAM.md` 提取，构建提交 `de7e8acc` 上该行即为 `v2026.8.27`（确定性推导，非推测） |

**本版 zip 实况**：

| 项 | 值 |
|----|----|
| 体积 | 393,611,352 字节（约 375 MiB；上一版 394,344,530 字节，略瘦 733,178 字节） |
| SHA-256 | `7842aa6adc38c9748d9539e1accd2d4ffb4429a08db0b0f21e5dd6a9bdd6228e` |
| 上一版 SHA-256 | `079ef62c04415e88f5d9a0d9f9103dc445b4116c2f344fe7d4e7ac8092697fe2`（v2026.8.19，已被覆盖） |

第三节的下载链接现已指向本版，守密人可直接取用。

### 五、gaps.md

无新增漏缝。两处接手均已在规则引擎内留痕（含「勿再加回」注记），不需要挂账。
