# 官方臂协议剖面 — spike 实测报告（2026-07-05）

> **目的**：为 bpt-agent-sdk 一致性测试套件（五层金字塔设计，守密人 2026-07-05 拷问 #2 批准）
> 验证「官方 Agent SDK 无头 + 本地内容盲仿真器」的三断点通断，并产出正式内容盲仿真器的需求规格。
>
> **被测物**：`@anthropic-ai/claude-agent-sdk@0.3.199`（钉死审计基线）+ 其自动拉起的引擎
> `@anthropic-ai/claude-code@2.1.201`（CLI 子进程）。均 `npm i --no-save` 临时装入 scratchpad，
> 未进任何仓库依赖（净室纪律）。
>
> **环境**：银芯云容器（Linux 无头，Node 22），流量指向本地 `127.0.0.1` 纯 http 仿真器。
> **API 费用：$0**（全程零真实 API 调用）。

## 一、三断点判定总表

| 断点 | 问题 | 判定 | 证据 |
|------|------|------|------|
| 1. 无头启动 | 官方 SDK + spawn 的 CLI 能否无头跑 | **通（早已实证）** | vs-official run #35/#40 官方臂 9/9 出分（GitHub Actions）；本次本地容器再证 |
| 2. base_url 重定向 | 引擎认不认 `ANTHROPIC_BASE_URL=http://127.0.0.1:{port}` | **通，一发即中** | S1：纯 http + 假密钥（`sk-ant-api03-…` 格式合法即可），POST `/v1/messages` 打到仿真器，脚本文本原样进 `result/success` |
| 3. 协议苛刻度 | 除 `/v1/messages` 外还要什么 | **通，面极窄** | 全四场仅一个额外端点 `GET /v1/code/agent-proxy/ca-cert`（本容器代理探测，404 后照常工作）；无 count_tokens / models 列表 / 遥测强依赖 |

**架构裁定：活体差分成立。** L1-L4 可让两引擎每次 CI 都对同一台内容盲仿真器活体对跑，
零 API 费、零金样维护，无需退化为「标本差分」。

## 二、四场景实测记录

| 场景 | 脚本 | 官方臂行为 | 判读 |
|------|------|-----------|------|
| S1 纯文本单轮 | 一段 SSE 文本回复 | `active_goal → system/init → assistant → rate_limit_event → result/success`，文本原样返回 | 断点 2 通；流形状与我方实现可直接差分 |
| S2 工具环闭合 | 第 1 轮 `tool_use`(Read fixture)，第 2 轮文本 | 两次 POST `/v1/messages`：真执行了 Read、回传 tool_result、二轮收尾成功 | **agent 环最小闭环坐实**——L1/L2 差分的成立前提 |
| S3 429 重试 | 第 1 发 HTTP 429（retry-after:1），第 2 发文本 | 发 `system/api_retry`，按 retry-after 重试一次，成功恢复 | L4 故障注入官方臂可测 |
| S4 SSE 中途掐断 | 发到 message_delta 后断连 | **不重试**（仅 1 次 POST）；把「Connection closed mid-response」当 assistant 文本吐出，终态竟为 `result/success` | 行为怪癖，与本 SDK 语义可能不同——L4 高价值差分点 |

## 三、意外收获（黑箱观测所得，全部合法）

1. **`active_goal` 新观测变体**：官方流每场开头都发一个 `active_goal` 消息——**不在**本 SDK
   COMPAT 观测臂 25 变体清单内。含义：官方 surface 已随引擎版本漂移（agent-sdk 0.3.199 钉死，
   但其 spawn 的 CLI 2.1.201 是活的）。**推论：一致性测试必须双包同钉**（agent-sdk 版本 + claude-code
   引擎版本各自锁死），否则「基线」本身在脚下滑动。
2. **`api_retry` 的真实线缆形状是 `system/api_retry`**（system+subtype 形），而本 SDK 净室重建时
   因官方文档自相矛盾选择了顶层 `type:'api_retry'` 判别。COMPAT.md 观测臂设计注记的「文档不一致」
   现在有了活体证据，L1 建成后可据此裁定是否翻转对齐。
3. **`rate_limit_event` 在无 429 的成功场景也会发**（S1）——官方把它当常态状态播报，
   不是错误事件。与本 SDK「仅 429 时发射」语义不同，登记为已知差异候选。
4. **beta 旗全表**（线缆元数据，对任何代理运营者可见）：`claude-code-20250219, oauth-2025-04-20,
   interleaved-thinking-2025-05-14, thinking-token-count-2026-05-13, context-management-2025-06-27,
   prompt-caching-scope-2026-01-05, mid-conversation-system-2026-04-07, effort-2025-11-24,
   extended-cache-ttl-2025-04-11`——正式仿真器按此声明兼容面即可。
5. **鉴权走 `authorization` 头**（本环境未见 `x-api-key`），且带 `x-claude-remote-container-id` 等
   容器注入头——正式仿真器不得对头集合做白名单强校验，照单全收即可。

## 四、正式内容盲仿真器需求规格（由本剖面直接导出）

- **必需端点**：`POST /v1/messages`（SSE）一个即可；对未知路径回 404 不致命
- **SSE 最低集**：message_start / content_block_start / content_block_delta /
  content_block_stop / message_delta / message_stop（S1-S3 均以此集通过）
- **路由**：按（路径 + 到达序）出脚本，**绝不读请求体**
- **内容盲纪律（净室防火墙，spike 期已全程执行并自审通过）**：
  - 请求体 `req.resume()` 直排、永不缓冲永不解析（官方臂请求体内含专有系统提示词全文）
  - 日志仅记：方法、路径、头**名**集合；头**值**仅白名单（anthropic-version / anthropic-beta /
    content-type / accept 四个协议元数据）
  - 每次运行末尾跑自审断言：全部输出物中不得含请求体派生内容（本次四场全 PASS）
- **故障注入库**：HTTP 429（官方会按 retry-after 重试）、SSE 中途断连（官方不重试、
  错误文本化 + success 终态——差分基准已记录）

## 五、限制与残余风险

- 本容器环境有代理注入头 / ca-cert 探测等本地特异性；**CI（GitHub Actions）复刻一遍**
  仍是下一步必做项（预计零费、一次 dispatch）
- S4 的「错误文本化 + success」行为可能受 CLI 版本影响，钉版后需复测
- 引擎 CLI 是活版本（npm 装到什么算什么）——正式套件须在安装步显式钉
  `@anthropic-ai/claude-code@<版本>`，并把双包版本写进每份差分报告头

## 六、结论一句话

三断点全通，**活体差分架构成立**：一致性测试 L1-L4 层可以零 API 费、每次 CI、
双臂活体对跑内容盲仿真器；spike 附带采到 3 项官方行为怪癖与 1 个新观测变体，
全部为合法黑箱观测，已可直接喂给 L1 用例设计。

---

*方法说明：本剖面全部数据来自官方 SDK 的公开消息流与 HTTP 线缆行为观测（黑箱），
未读取、未记录、未持久化官方臂任何请求体内容；spike 代码位于会话 scratchpad，
不入仓（正式仿真器将在测试套件开工时净室重写）。*
