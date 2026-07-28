# 黑池转派需求:从包入口导出 estimateTextTokens 与 MAX_READ_OUTPUT_CHARS

- 提出方:黑池 BPT · 2026-07-28
- 优先级:P2(功能可用,当前靠手工镜像;正规导出后可删镜像)
- 类型:SDK 公开 API 补充(黑池不改 SDK 源码,按红线转派)
- 先例:`enumerateBuiltinToolMetadata`(ADR 0014)、`buildSystemPromptParts`(sdk-request-export-harness-base.md)——同一类「内部已有实现、只差入口一行 export」的请求
- 归档说明:本需求档此前未进 SVN、银芯未收到(同批 harness-base 请求已兑现);2026-07-28 经会话转派补收,现归档于此。
- **兑现状态:已于 SDK 0.97.0 兑现(2026-07-28,见 `projects/silver-core-sdk/CHANGELOG.md` 0.97.0 条;原拟 0.95.0,两度与同日审计波次 #867 / #868 撞号,定 0.97.0)。**

## 背景 / 需求

两个符号在 SDK 内部**已经实现且已 `export`**,但没有从 `src/index.ts` 转出,而包的 `exports` 只开了
`"."`(无子路径),故黑池经公开 API 取不到,只能在自己这边复制一份:

| 符号 | SDK 内位置 | 黑池当前做法 |
|---|---|---|
| `estimateTextTokens` | `src/engine/tokens.ts` | `electron/lib/context-composition.ts` 手工镜像一份同算法 |
| `MAX_READ_OUTPUT_CHARS` | `src/tools/fsutil.ts`(值 50000,read.ts / webfetch.ts 共用) | 无镜像,但无法对账面板口径 |

`estimateTextTokens` 这条是**手工同步契约**,注释里写得很直白:「与 SDK 权威估算器 estimateTextTokens
精确对齐(CJK 码点 ~1 token/字,其余按 UTF-16 码元数 /4 向上取整)……**改 SDK 该文件时须同步本函数与
isCjkCodePoint**」。这类靠人记得同步的对齐必然漂移——一旦 SDK 调整估算口径(例如改 CJK 判定区间或
除数),黑池的「上下文构成」面板会静默低报或高报,而且不会有任何测试变红,因为两边各自自洽。

面板本身已经在消费 SDK 的权威数据(`includePromptComposition` 吐的 `prompt_composition` 事件带
per-part 估算),但面板还要对**尚未成为请求**的素材做预估(用户正在输入的草稿、待注入的记忆片段、
知识库候选),这部分只能本地算,因此需要一个与 SDK 同源的估算函数。

## 请求

在 `src/index.ts` 增加:

```ts
export { estimateTextTokens } from './engine/tokens.js';
export { MAX_READ_OUTPUT_CHARS } from './tools/fsutil.js';
```

如果认为 `MAX_READ_OUTPUT_CHARS` 单独导出一个常量太零碎,替代方案是导出一个只读的上限集合(例如
`export const TOOL_OUTPUT_CAPS = { read: …, bash: …, webFetch: …, grepHeadLimit: … }`),黑池更希望要这个
——面板可以据此把「工具返回上限」如实标给用户,不必按版本猜。此项与
`sdk-request-read-total-char-cap.md` 相关,可一并考虑。

顺带说明:`estimateMessagesTokens` / `estimateToolDefsTokens`(同文件)若一并导出更好,黑池
`classifyTranscript` 里的每消息 +8 / 每块 +3 结构开销也是照 SDK 口径手抄的,同属会漂移的镜像。

## 验收

- 从包入口可 `import { estimateTextTokens } from 'silver-core-sdk'`,对同一字符串返回值与 SDK
  内部估算一致。
- 黑池删掉 `context-composition.ts` 的 `estimateTokens` 与 `isCjkCodePoint` 镜像后,
  `electron/lib/__tests__/context-composition.test.ts` 现有断言仍全绿(该测试文件里的期望值就是
  按 SDK 口径写的,可直接当对齐验证用)。

## 银芯兑现记录(0.97.0)

- 估算器三件全部导出:`estimateTextTokens` / `estimateMessagesTokens` / `estimateToolDefsTokens`
  (入口 re-export 原函数引用,与内部同一函数,结构上不可能漂移)。
- `MAX_READ_OUTPUT_CHARS` 直接导出;同时提供黑池更希望的 `TOOL_OUTPUT_CAPS` frozen 集合
  (`read` 50000 / `bash` 30000 尾保留 / `webFetch` 50000 / `grepHeadLimit` 250 条目数),
  每值 import 自各工具实际执行的常量、不重抄字面量(`src/tools/output-caps.ts`)。
- 验收测试 `tests/output-caps-export.test.ts`:函数引用同一性 + 样例算术 + 集合逐键对账 + frozen。
