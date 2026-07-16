# silver-core-sdk 0.55.0 跨协议路由 · 黑池侧交接说明

> 银芯 → 黑池单向输出物 | 2026-07-13 | 对应 PR #678（v0.54.0）+ #680（v0.55.0）
> 面向：BPT 工程侧（SDK 消费方）。本档只讲「黑池要做什么、会看到什么」，SDK 内部实现细节见
> `projects/silver-core-sdk/docs/OPENAI-PROTOCOL.md`「Cross-protocol subagents」节与 CHANGELOG 0.54.0 / 0.55.0 条。

## 一、修了什么（对应 BPT 报障）

BPT 报障场景：主模型 `azure/gpt-5.6-sol`（openai-chat 协议）+ Haiku 档子代理映射
`bailian/deepseek-v4-pro`（仅网关 anthropic 路由有货）→ 每次 Agent 调用约 100–200ms 秒退
`400 模型不存在`。根因是 SDK 子代理无条件复用父会话 transport，把对的模型送进了错的路由；
模型本身在线。同根的另外两处也一并修了：hook `condition` 评估用的 utility 模型调用、
`compaction.model` 压缩摘要调用。

## 二、黑池要做的事（共两步）

**第 1 步：换 pin。** tarball 从当前 0.53.x/0.54.x pin 升到 `silver-core-sdk-0.55.0.tgz`。

**第 2 步：Options 加一段接线（唯一必改点）。**

```ts
import { query, createSubagentTransportResolver } from 'silver-core-sdk';

const q = query({
  prompt,
  options: {
    model: 'azure/gpt-5.6-sol',
    provider: { protocol: 'openai-chat', baseUrl: GW_OPENAI, apiKey: KEY /* 现有配置不动 */ },
    // ↓ 新增：模型 → 协议路由表（BPT 自己的网关事实，SDK 不猜）
    resolveSubagentTransport: createSubagentTransportResolver({
      protocolForModel: (m) => (m.startsWith('azure/') ? 'openai-chat' : 'anthropic'),
      providers: {
        // 网关 anthropic 路由的 baseUrl / 凭据；缺省则走 ANTHROPIC_* 环境变量链
        anthropic: { baseUrl: GW_ANTHROPIC, apiKey: KEY },
      },
    }),
  },
});
```

注意 `providers.anthropic.baseUrl` 填**不带** `/v1` 尾巴的 anthropic 路由根（SDK 会自动拼
`/v1/messages`）；不要把 openai 侧 baseUrl 原样抄过来——两条路由 URL 后缀与凭据链都不同，
SDK 已按协议分开解析，只需给对的根地址。

## 三、升级后行为语义（黑池验收对照）

| 场景 | 0.55.0 行为 |
|---|---|
| 不配 `resolveSubagentTransport` | 与旧版逐字节一致（回归零风险，回滚 = 删接线） |
| 子代理模型与父同协议（如 azure/*） | 共享父 transport，日志 `transportMode: shared-parent` |
| 子代理模型跨协议（如 bailian/*） | 走 anthropic 路由新 transport，日志 `transportMode: resolver-shared`，**不再 400** |
| `fork: true` 子代理 | 永远继承父模型 + 父 transport（缓存前缀不受影响），路由表不咨询 |
| hook condition 的 utility 调用 / compaction 摘要模型 | 同一张路由表生效（回调入参 `purpose` 字段区分 `subagent`/`utility`/`compaction`，标准实现只按模型路由、无需理会） |
| thinking 配置 | 跨协议非 Claude 子模型自动省略继承的 thinking（防网关拒收）；Claude 模型照常按代际适配 wire 形态 |
| 费用 | 子代理花费照常计入 family budget，`provider.pricing` 前缀表继续生效（可为 `bailian/` 加价目） |
| 性能 | 跨协议 transport 按协议记忆化（全查询共用，不逐 spawn 新建），不引入逐次 TLS 握手税 |
| 生命周期 | 记忆化 transport 由 SDK 侧自清（unref 空闲池 + TTL），黑池无需管释放 |

## 四、升级验证清单（建议冒烟三条）

1. 发一次会触发 Haiku 档子代理的 Agent 调用，确认子代理正常返回、无 `400 模型不存在`；
2. 打开 debug 日志核对一条 `transportMode: resolver-shared` 且 `childProtocol: anthropic`；
3. 跑一条不配回调的旧用例，确认行为与升级前一致。

## 五、版本与兼容

- 0.54.0（子代理路由）与 0.55.0（utility/compaction 扩展）均为 BPT-EXTENSION **新增**面，
  无既有 API 变更；从 0.3x / 0.52 / 0.53 pin 直升 0.55.0 即可，不必分两跳。
- 0.54.0 → 0.55.0 唯一形状变化：回调入参新增必填 `purpose` 字段（宿主只读不构造，无破坏）。
- 回归底数：全量套件 2202 通过 + 2 跳过（118 档案），含 22 条本特性验收矩阵测试
  （`tests/subagent-transport.test.ts`）。
