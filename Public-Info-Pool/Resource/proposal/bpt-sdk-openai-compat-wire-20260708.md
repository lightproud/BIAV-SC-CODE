# BPT Agent SDK —— OpenAI 兼容线设计提案

> 类型：proposal · 主题：bpt-sdk-openai-compat-wire · 日期：2026-07-08
> 来源：守密人 2026-07-08 /grilling 拷问对齐会话（11 点裁定，授权艾瑞卡代写）
> 决策溯源：`memory/decisions.md` 同日「BPT Agent SDK『OpenAI 兼容线』+ 定位级去牌裁定」条
> 状态：设计定稿待守密人裁定；**代码实现待本提案批准后另派**（本轮零引擎改动）

---

## 0. 一句话

给 BPT Agent SDK 增加一条 **OpenAI 兼容 Chat Completions 线**——作为兄弟 `Transport` 压在现有
Anthropic 形引擎表面之下、翻译进出、其余引擎一行不动——从而让 BPT Desktop 能跑 GPT（及国产模型 /
任意 OpenAI 兼容网关），兑现 2026-07-04「模型可替换性入定位硬承诺」。

> 小学生比喻：给机器加一个「能认第二种插座」的转换器，藏在机器肚子里；机器的其余部件还以为自己在用老插座，
> 因为转换器把新插座的电压电流都翻译成了老规格。

---

## 1. 背景与既有裁定（不重述、只指针）

- **多 provider 是硬承诺**：`docs/POSITIONING.md` §4 + `memory/decisions.md` 2026-07-04「模型可替换性入定位硬承诺
  （含国产；可替换 ≠ 等效；以 Claude 体验为范式参考但不限定）」。本提案是它的 SDK 具体落地。
- **引擎是 Anthropic 贴身再现**：传输层 `src/transport/anthropic.ts` 直驱 `POST /v1/messages` + 原生 SSE；
  `Transport` 接口（`src/internal/contracts.ts`）是干净接缝——只吃 `StreamRequest`、吐 `RawMessageStreamEvent`。
- **idealab 两协议并存**：Claude/qwen 走其 Anthropic 兼容端点、GPT 走其 OpenAI 兼容端点——**是模型决定协议**，
  故协议类型绑在模型/端点配置上（见 §4）。
- **§1.1-HC 无涉**：本 SDK 为银芯→黑池单向输出物，无黑池数据；翻译/嵌入均银芯自有公开档，防火墙无涉。

---

## 2. 架构总览

```
调用方 Options{ model, provider{wire,baseUrl,...} 或 models 路由表 }
                     │
        ┌────────────┴─────────────┐
        │  wire 解析（§4）：按活动模型查协议  │
        └────────────┬─────────────┘
                     │
     wire='anthropic'│           │wire='openai'
     ┌───────────────┘           └────────────────┐
     ▼                                             ▼
AnthropicTransport(现存，不动)          OpenAITransport（新，本提案）
  POST /v1/messages                      ①请求下行翻译：StreamRequest→OpenAI body
  原生 SSE                                ②POST /v1/chat/completions (stream)
                                          ③流上行翻译：OpenAI SSE→RawMessageStreamEvent
     │                                             │
     └──────────────┬──────────────────────────────┘
                    ▼   （二者都吐 RawMessageStreamEvent）
        引擎表面之上：accumulator / tools / permissions / sessions / hooks
                    —— 一行不动，无感 wire 差异 ——
```

**核心不变量**：OpenAI 线的一切复杂度**全部收敛在 `OpenAITransport` 一个模块 + 一层翻译**里；接缝
之上（累加器、工具、权限、会话、钩子、压缩、思考处理）**零改动**，因为它们只见 Anthropic 事件。
这是路 B（兄弟 transport）相对路 C（全引擎多 provider 重构）的根本优势：净新增测试面只有翻译层。

---

## 3. 翻译面（核心工程）

### 3.1 请求下行：`StreamRequest`（Anthropic 形）→ Chat Completions body

| StreamRequest 字段 | OpenAI Chat Completions | 保真度 |
|---|---|---|
| `model` | `model`（逐字；端点已由路由表解析） | 无损 |
| `max_tokens` | `max_tokens`（标准模型）/ `max_completion_tokens`（推理模型，见 §7） | 无损 |
| `system`(string \| TextBlockParam[]) | `messages[0]{role:'system', content}`（多块拼接、丢 `cache_control`） | 无损 |
| `messages[].content` 文本块 | `{role:'user'\|'assistant', content}` | 无损 |
| assistant `tool_use` 块 | `{role:'assistant', tool_calls:[{id, type:'function', function:{name, arguments: JSON.stringify(input)}}]}` | 无损（结构映射） |
| user `tool_result` 块 | `{role:'tool', tool_call_id, content}` | 无损 |
| 图像块(base64/url) | `{type:'image_url', image_url:{url}}`（base64→data URL） | 近无损 |
| `tools[]{name,description,input_schema}` | `tools:[{type:'function', function:{name, description, parameters: input_schema}}]`（皆 JSON Schema） | 近 1:1 |
| `tool_choice` | `auto`→`'auto'` / `any`→`'required'` / `tool{name}`→`{type:'function',function:{name}}` | 无损 |
| `output_config.format`(json_schema) | `response_format:{type:'json_schema', json_schema:{name, schema, strict:true}}` | 无损 |
| `thinking` | `reasoning_effort`（enabled/adaptive→`'medium'`；disabled→略，推理模型不可全关，见 §7） | **有损** |
| `temperature` | `temperature`（推理模型略去） | 条件损 |
| (隐式) `stream:true` | `stream:true` + `stream_options:{include_usage:true}` | —（要 usage 必加后者） |
| `cache_control` 断点 | **丢弃**（OpenAI 无断点 API） | **结构性损失**（见 §5） |

### 3.2 流上行：OpenAI SSE(`chat.completion.chunk`)→`RawMessageStreamEvent`

OpenAI 只发 `choices[0].delta` 增量，需**合成**整条 Anthropic 事件序列：

| OpenAI chunk | 合成的 Anthropic 事件 |
|---|---|
| 首个 chunk（`delta.role`） | `message_start`（消息壳；input_tokens 暂填 0，见下「用量对账坑」） |
| `delta.content`（文本增量） | 首次→`content_block_start`{type:'text'} (index 0)；续→`content_block_delta`{type:'text_delta', text} |
| `delta.tool_calls[]`（按 `index` 分片） | 该 index 首现→`content_block_start`{type:'tool_use', id, name}；`function.arguments` 碎片→`content_block_delta`{type:'input_json_delta', partial_json} |
| `delta.reasoning`（若给） | `content_block`{type:'thinking'}；多为隐藏，通常只在末尾拿到 `reasoning_tokens` → 空 thinking 块 + 计数 |
| `finish_reason` | `stop`→`end_turn` / `length`→`max_tokens` / `tool_calls`→`tool_use` / `content_filter`→拒答(见 §7 refusal) |
| 末 chunk `usage`（来自 stream_options） | 收尾各开启块 `content_block_stop` → `message_delta`{stop_reason, usage} → `message_stop` |

**三个必须精确处理的翻译坑**（实现时的硬点）：

1. **并行工具装配**：OpenAI 多工具调用按 `tool_calls[].index` 交错分片流出，arguments 是 JSON 字符串碎片。
   须按 index 装配成各自的 `tool_use` 块（文本块占 index 0，工具块顺延）。**Tier1 金标重点覆盖**。
   > 比喻：两个工具的参数像两副被打散、还交替发牌的扑克，得按牌背编号（index）各归各堆，别混。
2. **用量对账坑**：OpenAI 在**流末**才给 `prompt_tokens`（输入），而 Anthropic 在**开头** `message_start` 就给
   input_tokens。方案：`message_start` 填 input=0，把真实 `prompt_tokens`（+ `prompt_tokens_details.cached_tokens`
   翻成 `cache_read_input_tokens`）放进末尾 `message_delta.usage`，**约定累加器以 message_delta 的 input 为准**（存在时）。
   > 比喻：账单的「进货成本」这家店结账时才告诉你，而老流程是开单就写——于是开单先写 0，结账时补真数，让记账员认结账那张。
3. **截断续轮**：连接中途断（`midStreamTruncation`）沿用引擎既有 E3 优雅降级——已完整的块照常抢救，
   未闭合 tool_use 绝不执行。OpenAI 线复用同路径，无需新逻辑。

---

## 4. 配置面：模型协议路由表（拷问 7 = 乙）

协议类型**绑在模型/端点配置上**，且会话内可跨协议热切（BPT Desktop 一键 Claude↔GPT）。

### 4.1 单端点（最简形，兼容存量）

```ts
provider: { wire: 'openai', baseUrl: '<idealab OpenAI 端点>', apiKey: '…' }
model:    'gpt-4o'
// 不写 wire → 默认 'anthropic'，存量 drop-in 零变化
```

### 4.2 多模型路由表（v1 目标形）

```ts
provider: {
  models: {
    'gpt-4o':        { wire: 'openai',    baseUrl: '<idealab openai>', apiKey: '…' },
    'claude-opus-…': { wire: 'anthropic', baseUrl: '<idealab anthropic>', authToken: '…' },
    'qwen3-…':       { wire: 'anthropic', baseUrl: '<idealab anthropic>', authToken: '…' },
  }
}
model: 'gpt-4o'            // 活动模型
// 会话内 query.setModel('claude-opus-…') → 按路由表重解析 wire + 端点 + 凭据
```

- **wire 选择 = 显式**：读活动模型的 `wire` 二选一实例化 transport。**拒绝** model 前缀魔法路由（国产模型命名无统一前缀，前缀探测在国产场景结构性会错）。
- **`setModel` 跨协议热切**：路由表按 wire **惰性解析 + 缓存** transport 实例（现在是每 query 构造一次，需改为 per-model 解析）。这是引擎生命周期的一处真改动，登记在案。
- **路由表 = BPT 扩展**：无官方对应物，性质同 `maxConcurrentRequests`（已标 `BPT-EXTENSION`），一致。

---

## 5. 缓存处置（裁定 b）

- `cache_control` 断点在 OpenAI 线**静默降级为空操作**（放了没人认，不报错）。
- OpenAI **自动前缀缓存**照常点火——引擎现有「静态前缀跨轮稳定」的拼装**白拿一份折扣**（约半价，倍率随模型，落价目表时锁定）。
- `prompt_tokens_details.cached_tokens` **翻回** `cache_read_input_tokens`，让定价/遥测看得见真实省的钱。
- **不做断点仿真**（发明 OpenAI 没有的能力，违背诚实根节点）。

> 比喻：Anthropic 的「自夹书签」功能没了，但图书管理员「自动记住你读到的开头一大段」还在——不用你调用，
> 记账时把这份自动优惠如实记进去即可，别假装书签还在。

---

## 6. 去牌方案（A + 乙全局，替换值定）

### 6.1 替换表（单一真相源）

| 官方 | BPT | 备注 |
|---|---|---|
| `Claude Code`（产品/agent 名） | `BPT` | 建议做成 `agentName` 配置项、默认 BPT，供下游注入 |
| 分支前缀 `claude/` | `bpt/` | **全局默认**，生成分支名随之变（守密人已确认接受） |
| 记忆文件名 `CLAUDE.md` | `AGENTS.md` | 发出串用中性别名；加载器仍读 CLAUDE.md+AGENTS.md 两者（存量 repo 不破） |
| `Anthropic` | (视语境去牌/泛化) | 错误签名等按跨 provider 通用形态处理 |
| `/loop`·`claude --resume` 类 tips | 重指向 BPT 等价功能 | **不丢弃**（BPT 也会做这些功能）；命令串待 BPT 命令面定稿钉 |

### 6.2 corpus-sync 改判「声明式去牌替换」

- 从「与官方档字节一致」→「**官方档 套用上表 = 我方发出串**」。
- **抗漂移不丢**（官方漂移照样抓）+ **去牌强制**（反向测试断言发出串零 claude/anthropic）+ **署名诚实**（注释 provenance 照旧写「忠实再现 Claude Code + 一张声明过的去牌替换表」）。
- **只清发给模型的串**；注释里的 provenance 署名**保留**（刻度 A）。

> 比喻：不撕菜谱的来源页，改成「附一张『某品牌→BPT』对照表，按表把正文替换掉」——来源可查、替换可验、味道（行为）不变。

---

## 7. 推理模型（gpt-5 / o 系）首发处置

- **收请求参数适配**：`max_completion_tokens`（非 max_tokens）、`reasoning_effort`、略去 `temperature`（多不支持）。
- **隐藏推理 = 已知损失**：Chat Completions 上 OpenAI 只给 `reasoning_tokens` 计数、不给内容 → thinking 块翻成空 + 计数，**不假装能显示**。
- **content_filter / refusal**：`finish_reason:'content_filter'` 或 `message.refusal` 字段 → 翻成引擎可识别的拒答/停止形态（对齐 E 系 refusal 帧语义，不烤进正文）。

---

## 8. 一致性验收（金标往返，隔离出官方棘轮）

| Tier | 内容 | 费用 | 门禁 |
|---|---|---|---|
| **T1 翻译保真金标** | 下行 `StreamRequest`→OpenAI body、上行 OpenAI SSE fixture→`RawMessageStreamEvent` 双向对金标；真值 = 手工核过的真实 OpenAI/idealab 抓包（r3 允许）；覆盖文本/单工具/**并行工具**/finish_reason/usage+cached_tokens/错误/截断 | 零钥零费 | **强制 CI 常跑** |
| **T2 复用 above-seam L1-L5** | 翻译后是 Anthropic 事件，现有累加器/工具/会话套件原样适用；只需 transport 可注入 | 零费 | 随主套件 |
| **T3 活体 agentic 冒烟** | 真打 idealab-GPT + OpenAI 官方，断言循环闭合/工具点火/跨轮记忆；**非**通过率对标官方 | 真钥有费 | **首发必跑一次** + dispatch/预算护栏 |

**显式非目标**：OpenAI 臂**不进** `arm.mjs` 官方差分、**不进**对齐官方的棘轮基线、**不受** A/B-vs-官方约束；有独立金标基线 + 独立漂移哨兵（盯 OpenAI wire 变更）。

> 比喻：这门课没有「标准答案册」（世上没有第二个官方 SDK 说 OpenAI 话），改考法：T1 = 对着人工核过的听写稿自测，
> T2 = 听写完照做原来那套阅读理解，T3 = 找真人聊两句确认能聊下去；分数绝不塞进「对标官方」那门课的成绩单。

---

## 9. 里程碑（行为级验收）

| M | 范围 | 行为级验收 |
|---|---|---|
| **M0 接缝就位** | `OpenAITransport` 骨架实现 `Transport`；`provider.wire`/`models` 路由表 schema + wire 解析 + `setModel` per-model 重解析 | 单测：wire='openai' 实例化 OpenAITransport；跨协议 setModel 换实例 |
| **M1 翻译层 + T1 金标** | 请求下行 + 流上行双向翻译；并行工具装配；用量对账；T1 金标套件 | T1 全绿（含并行工具/usage/截断）；`tsc`+build exit 0 |
| **M2 above-seam 打通 + T3 冒烟** | transport 注入 above-seam；真打 idealab-GPT + OpenAI 各一遍 | T2 复用绿；T3 循环闭合/工具点火/跨轮记忆 3/3 |
| **M3 去牌 + corpus-sync 改判** | 替换表落地；corpus-sync 改「声明式替换」；反向测试；tips 重指向 | 反向测试断言发出串零 claude/anthropic；corpus-sync 绿；漂移哨兵接 OpenAI |
| **M4 推理模型 + 缓存记账** | gpt-5/o 系参数适配；cached_tokens→usage；价目表 | 推理模型冒烟；usage 显示 cache_read |

---

## 10. 已知损失清单（诚实登记，不修）

1. **缓存控制损失**：断点不可控、折扣从约 1 折缩到约半价、无 TTL 控制 → GPT 多轮成本结构性高于 Claude。
2. **隐藏推理损失**：thinking 块在 GPT 线翻空 + 计数，看不到推理内容。
3. **行为换手感**：Claude 风 harness 提示词灌给 GPT，GPT 用自身指令先验执行（根节点乙认下的物理不可逆损失）。
4. **服务端内建工具**（web search / code interpreter，多在 Responses API）**不进首发**，划出范围。
5. **音频输入等 OpenAI 独有多模态**不进首发，划出范围。

---

## 11. 术语表（本提案锐化，建成后迁 `projects/bpt-agent-sdk/CONTEXT.md`）

| 术语 | 定义 | _避免_ |
|---|---|---|
| **OpenAI 兼容线** | SDK 说 OpenAI Chat Completions wire 的兄弟 `Transport` + 双向翻译层，压在 Anthropic 形引擎之下 | _避免_读成「支持 GPT 一个模型」——它一次解锁 GPT + 国产 + 网关 |
| **模型协议路由表** | `模型→{wire,端点,凭据}` 配置表，活动模型的 wire 选 transport，会话内可跨协议热切 | _避免_读成「baseUrl 探测」或「model 前缀路由」（皆已否决） |
| **声明式去牌替换表** | corpus-sync 从「与官方字节一致」改判「官方档套一张声明过的替换表 = 我方发出串」的机制 | _避免_读成「删掉 provenance 注释」（署名保留，只清发出串） |
| **金标往返验收** | OpenAI 臂因无官方参照神谕，用「翻译双向对金标 fixture」替代「差分对照官方」的验收范式 | _避免_读成「行为对标官方」（根节点乙明确否决） |

---

## 12. 下一步

本提案批准后，代码实现按 M0→M4 另行派发。首批建议 M0+M1（接缝 + 翻译层 + T1 金标），因其零钥零费可全自证，
风险最低、能最快让「翻译对不对」有客观答案。
