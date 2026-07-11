# Silver Core SDK 记忆系统 — 黑池消费搬运包

> 2026-07-11 · 对应 silver-core-sdk **v0.47.0**(M1+M2 全量)· 按人工对话搬运协议交付
> 本档为自包含搬运包:接入 BPT 不需要翻 SDK 源码。权威细节:SDK 仓内 `docs/MEMORY.md`。
> 银芯 → 黑池单向输出;黑池侧任何实现/数据/评测结果**不回流银芯**(§1.1-HC 同向)。

## 0. 一句话

`options.memory` 给 BPT 平台补上跨会话记忆:与 Anthropic 官方 memory tool(`memory_20250818`)
协议等价的六命令工具面,**存储由黑池注入**(记忆数据永不出内网),写侧质量下限由 harness
强制(协议提示 + 压缩前落盘 + 会话终结进度卡 + 可选记忆卡模式),读侧索引常驻,全程可记账。

## 1. 最小接入(三步)

**第一步:实现存储原语**(推荐路径——六个小原语,参考格式白拿):

```ts
import { createMemoryStore, type MemoryFileOps } from 'silver-core-sdk';

// 路径均为虚拟路径 /memories/...,由你映射到内网存储。
// 作用域键建议 = 用户ID × 项目ID(纯目录方案起步:\\内网存储\bpt-memory\<user>\<project>\)
class BptIntranetFileOps implements MemoryFileOps {
  stat(path)   { /* 'file' | 'directory' | null + sizeBytes */ }
  list(path)   { /* 目录直接子项 */ }
  read(path)   { /* 文件 UTF-8 内容 */ }
  write(path, content) { /* 建父目录、覆盖写 */ }
  delete(path) { /* 文件或目录递归删 */ }
  rename(o, n) { /* 移动;目标父目录自动建 */ }
}
export const makeBptMemoryStore = (userId, projectId) =>
  createMemoryStore(new BptIntranetFileOps(userId, projectId));
```

不想用原语层也可以直接实现 `MemoryStore` 六命令方法(view/create/strReplace/insert/delete/rename,
返回参考字符串、错误以 throw 交回)——但参考格式要自己对齐,不推荐。

**第二步:自测合规**(发给任何实现方,跑通 = 合规):

```ts
import { runMemoryStoreContractSuite } from 'silver-core-sdk';
const report = await runMemoryStoreContractSuite(() => makeFreshEmptyStore());
console.log(report.passed, report.failed, report.results);
```

**第三步:接入 query**:

```ts
query({ prompt, options: {
  memory: {
    store: makeBptMemoryStore(userId, projectId),
    schema: 'cards',                    // 国产模型场景建议开(见 §3)
    indexInjection: { maxLines: 200 },  // 读侧常驻帽
    instructions: '仅记录与本项目相关的信息。',
    // sessionEndUpdate / flushOnCompaction 默认已开;要关显式 false
  },
}})
```

双模式自动选择:Anthropic 协议 → native(官方类型条目直通,API 注入定义与协议提示);
`provider.protocol: 'openai-chat'`(任意兼容网关/国产模型)→ custom(SDK 自带工具定义 +
官方逐字协议提示)。**同一段消费代码两边行为一致,存储产物逐字节相同**(SDK 侧已测)。

## 2. harness 保障的下限(不靠模型自觉)

| 机制 | 行为 | 关闭旋钮 |
|---|---|---|
| 协议提示 | 开工先 view 记忆目录 / 进展随时落盘 / 假设随时断电(官方原文) | 不可关(native 由 API 注入) |
| 索引常驻 | 会话开始自动注入 `/memories/MEMORY.md` 头部(默认 200 行 / 25KB 先到者) | `indexInjection: false` |
| 压缩前落盘 | 自动压缩将折叠前,先给模型一次「把没存的进度存了再继续」回合;PreCompact 钩子可 deny | `flushOnCompaction: false` |
| 终结进度卡 | 会话正常结束后一轮有界回合更新 MEMORY.md 进度卡(abort/报错不触发;该回合的 result 被吸收,不顶掉任务自身答案) | `sessionEndUpdate: false` |
| 治理限额 | 64KB/文件、64 文件/目录、view 超 16,000 字符截断并提示 view_range 分页 | `limits: {...}` 调数值 |
| 记忆卡模式 | 见 §3 | 不设 `schema` |

## 3. 记忆卡模式(schema: 'cards')

每个记忆文件必须是一张或多张卡,写不合格直接被拒并收到可重试的结构化错误:

```
## <卡标题>
结论: <一句话结论>
依据: <来源/日期/会话>
过期条件: <何时该删或改>
```

半角/全角冒号均可,字段值可换行续写。默认限额:单卡 500 字符、单文件 50 张
(`cards: { maxCardChars, maxCardsPerFile }` 可调)。面向写侧纪律弱的模型;
Claude 系可先不开,评测(§5)后按分数定。

## 4. 记账与预算

- 每次 run 的 `result.metrics.memoryHealth`:`operations / reads / writes / errors /
  bytesRead / bytesWritten / indexInjectionTokens`——效果与成本争议以此为准,不以体感。
- **token 预算硬上限建议**(防记忆层反噬输入成本):人写指令层 2K / 索引常驻 1K /
  画像卡 0.5K;超限即裁剪,数值上线后按账单校准。
- 三层组合优先级(冲突时):**人写 > 模型自写 > 离线合成**。人写指令层今天就能上
  (systemPrompt append,与本包无耦合);离线合成层(夜间批处理重写画像卡)**等 1、2 层
  跑一个月、有真实数据后再立项**。

## 5. 评测集(上线前建、每月回归)

20 题跨会话回忆集(「上周约定的命名规范是什么」类):对候选模型 × cards 开关跑分;
检索类题目得分 < 80% 且索引常驻已到预算帽,才评估向量方案(在那之前 grep 级检索够用)。

## 6. 安全提醒

- 路径校验 SDK 层已做(前缀 / 规范化 / `../`、`..\`、URL 编码变体全拒),但黑池 store
  实现**仍不得信任传入路径**(纵深防御;本包 §1 的原语实现里再做一次包含性检查)。
- 记忆文件含用户工作内容,按内部数据密级管理,不进任何外发渠道。
- 加密是存储实现方的责任(SDK 契约不含加密)。

## 7. 版本与对账

- 依赖:`silver-core-sdk-0.47.0.tgz` 起(0.46.0 = M1 无 R7/R8/R9)。
- 变更台账:SDK `CHANGELOG.md` 0.46.0 / 0.47.0 两条;逐字段兼容口径 `docs/COMPAT.md`
  memory 行;完整规格与需求书原文 `docs/MEMORY.md`。
