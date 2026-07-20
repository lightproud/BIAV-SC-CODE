# BPT-NEXT 架构蓝图（旧版 - 已封存）

> 最后更新：2026-04-25 by 艾瑞卡（引用修正）
>
> **状态：已封存（2026-04-14 当日作废）**
> 封存原因：守密人深入调研 `instructkr/claw-code` 后改变方向，决定基于 claw-code（Rust，无 LICENSE）打造 bpt-next，接受版权风险。本文档原基于 `ruvnet/open-claude-code`（JS，MIT）+ BPT 融合的方案已不适用。
> 保留原因：未来若 claw-code 上游 LICENSE 明确化失败、或因其他原因需要切回 occ-local 路径，本文档可作备选方案快速启用。
> 当前实施方案：见 `projects/bpt-next/CONTEXT.md` + `projects/bpt-next/NOTICE`
>
> ---
>
> 以下为封存前的原始内容（历史归档，勿据此决策）：
>
> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 决策依据：`memory/decisions.md`（2026-04-14 条目）
> 基础引擎：`projects/occ-local/v2/`（ruvnet/open-claude-code MIT）
> 继承资产：`projects/bpt/`（母版）+ `projects/bpt-desktop/`（UI / IPC / i18n）
> 终局：`bpt-next` 达 v1.0 后，`bpt` / `bpt-web` / `bpt-desktop` 全部归档 archive/

---

## 一、设计原则（继承 BPT 母版，强化）

1. **Token 经济纪律不可降级**（母版 Prime Directive）
   - occ-core 的 `cache.mjs` 已实现 prompt cache，BPT-NEXT 在其上加档位制
   - tool schema 首轮发 + cache_control，后续必须命中 cache
   - tool result > 2000 token 必截断
   - history > 20 轮 或 > 60k token 触发压缩

2. **非程序员可维护**（母版 Secondary Directive）
   - 禁 `any`、禁 `as unknown as`
   - 一文件一模块，无 helpers/utils 垃圾桶
   - 注释写"为什么"不写"是什么"
   - 禁止 self-evolve / 运行时动态代码加载
   - occ 的 Skills（`.md` 动态加载）需审慎启用：默认关闭，守密人显式开启才加载

3. **不污染 occ 上游骨架**（新增）
   - `projects/occ-local/v2/src/` 视为上游只读源，禁止修改
   - BPT-NEXT 通过相对路径 `import`，不 fork 不 copy
   - 定制以 `bpt-next/electron/biav-ext/` 层或 patch 文件实现

4. **单目录单 package.json**（母版）
   - 禁止 monorepo / workspace / pnpm
   - occ-local 通过相对路径 import 跨子项目引用

5. **TypeScript strict 不可降级**（母版）
   - occ 是纯 JS ESM，需为关键模块写 `.d.ts` 类型声明
   - 类型声明放 `electron/occ-core/types/`

---

## 二、顶层架构

```
projects/bpt-next/
├── electron/                     # 主进程 + Node 侧逻辑
│   ├── main.ts                   # Electron 入口（窗口/托盘/热键）
│   ├── preload.ts                # contextBridge 暴露 window.bpt API
│   ├── updater.ts                # electron-updater
│   ├── window-state.ts           # 窗口持久化
│   │
│   ├── occ-core/                 # occ-local 引用层（只读，勿改上游）
│   │   ├── index.ts              # 重导出 occ API
│   │   ├── types/                # 为 occ JS 模块手写的 .d.ts
│   │   └── README.md             # 说明：所有 .mjs 来自 ../../occ-local/v2/src/
│   │
│   ├── occ-bridge/               # occ ↔ Electron IPC 桥
│   │   ├── session-manager.ts    # 多会话 agent-loop 实例管理
│   │   ├── event-stream.ts       # async generator → IPC 事件流
│   │   └── tool-bridge.ts        # tool 调用的权限提示往返 UI
│   │
│   ├── biav-ext/                 # BIAV 特有扩展（不进 occ 上游）
│   │   ├── silver-core-tool.ts   # 银芯 MCP 客户端封装为 occ 工具
│   │   ├── bpe-search-tool.ts    # 黑池代码检索工具
│   │   ├── dream-archiver.ts     # 会话归档到 memory/session-digests/
│   │   └── persona-loader.ts     # 艾瑞卡等角色人格加载
│   │
│   ├── gear/                     # BPT 档位制（Token 经济核心）
│   │   ├── gear-chat.ts          # chat 档：4 工具白名单 ~1.5k token/turn
│   │   ├── gear-work.ts          # work 档：10 工具白名单 ~4k token/turn
│   │   └── gear-manager.ts       # 档位切换 + 动态 allowedTools
│   │
│   └── ipc/                      # IPC 处理器
│       ├── chat.ts               # 发消息 / 中断 / 重试
│       ├── settings.ts           # 配置持久化（electron-store）
│       ├── sessions.ts           # 会话管理（occ checkpoints）
│       ├── mcp.ts                # MCP 服务器连接状态
│       └── files.ts              # 文件拖入/读取
│
├── src/                          # React UI
│   ├── App.tsx
│   ├── main.tsx
│   ├── QuickEntry.tsx            # 全局热键唤起的快捷输入窗
│   │
│   ├── components/
│   │   ├── chat/                 # 对话主界面
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCallCard.tsx  # occ tool_use 可视化
│   │   │   └── ThinkingBlock.tsx # extended thinking 折叠显示
│   │   │
│   │   ├── economy/              # Token 经济监控
│   │   │   ├── TokenMeter.tsx    # 继承 bpt/
│   │   │   ├── CacheHitIndicator.tsx
│   │   │   └── CostEstimate.tsx
│   │   │
│   │   ├── gear/                 # 档位切换 UI（继承 bpt/）
│   │   │   └── GearSwitcher.tsx
│   │   │
│   │   ├── biav/                 # BIAV 特有面板
│   │   │   ├── BPEPanel.tsx      # 继承 bpt/
│   │   │   ├── SilverCorePanel.tsx
│   │   │   └── PersonaSelector.tsx
│   │   │
│   │   └── settings/
│   │
│   ├── hooks/
│   │   ├── useOccSession.ts      # 订阅 occ event stream（13 事件类型）
│   │   ├── useTokenEconomy.ts
│   │   ├── useGear.ts
│   │   └── useKeyboardShortcuts.ts
│   │
│   ├── lib/
│   │   ├── i18n.ts               # 继承 bpt-desktop/
│   │   └── locales/              # zh/en/ja
│   │
│   └── types.ts                  # window.bpt API 类型（含 occ 扩展）
│
├── docs/
│   ├── ARCHITECTURE.md           # 本文件精简版
│   ├── OCC-INTEGRATION.md        # occ-core 引用与同步策略
│   └── MIGRATION-FROM-BPT.md     # bpt 移植指南
│
├── assets/                       # 图标、品牌
├── package.json                  # 单 package.json，依赖含 electron / react / vite / ink?（暂不用）
├── tailwind.config.js            # BPT 暗金主题
├── vite.config.ts
├── tsconfig.json                 # strict: true
├── electron-builder.yml
├── CONTEXT.md
└── CHANGELOG.md
```

---

## 三、关键集成点

### 3.1 occ-local 引用方式

**选择**：相对路径 import，不 fork / 不 copy。

```ts
// projects/bpt-next/electron/occ-core/index.ts
export { createAgentLoop } from '../../../occ-local/v2/src/core/agent-loop.mjs';
export { createToolRegistry } from '../../../occ-local/v2/src/tools/registry.mjs';
export { createPermissionChecker } from '../../../occ-local/v2/src/permissions/checker.mjs';
export { HookEngine } from '../../../occ-local/v2/src/hooks/engine.mjs';
export { McpClient } from '../../../occ-local/v2/src/mcp/client.mjs';
// ... 其他核心导出
```

**类型声明**：在 `occ-core/types/` 下手写 `.d.ts`：
```ts
// occ-core/types/agent-loop.d.ts
export interface AgentLoop {
  state: AgentState;
  run(userMessage: string | null, options?: { continuation?: boolean }): AsyncGenerator<OccEvent>;
}
export function createAgentLoop(config: AgentLoopConfig): AgentLoop;
// ... 13 事件类型 union
```

**上游同步**：occ-local 更新时，pull 新版 → 手工审阅 diff → 更新 `.d.ts` 若 API 变化。

### 3.2 Electron IPC 事件桥

occ 的 agent-loop 是 async generator，yield 13 种事件。桥接策略：

```
Renderer (React)                     Main Process (Node)
    │                                       │
    │  window.bpt.chat.send(prompt, sid) ──►│ sessionManager.get(sid).run(prompt)
    │                                       │  for await (event of loop.run())
    │  ◄── 'occ:event' IPC ──────────────  │     webContents.send('occ:event', {sid, event})
    │                                       │
    │  useOccSession hook 订阅              │
    │    subscribe((event) => dispatch)     │
```

事件类型映射：
- `stream_event` → React 流式渲染
- `thinking` → ThinkingBlock 展开/折叠
- `tool_progress` → ToolCallCard 显示 running
- `result` → ToolCallCard 显示结果
- `compaction` → TokenMeter 闪烁提示
- `hookPermissionResult` → 弹窗征求守密人许可
- `error` / `stop` → 对话结束

### 3.3 档位制（BPT Gear）在 occ 之上实现

occ 有 `settings.allowedTools` 参数，档位制作为其上层：

```ts
// electron/gear/gear-chat.ts
export const chatGear = {
  name: 'chat',
  allowedTools: ['Read', 'Glob', 'Grep', 'WebFetch'],
  maxTokensPerTurn: 1500,
  systemPromptAddendum: '你在对话档，保持简洁。'
};

// electron/gear/gear-work.ts
export const workGear = {
  name: 'work',
  allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'TodoWrite'],
  maxTokensPerTurn: 4000,
  systemPromptAddendum: '你在工作档，可执行完整任务。'
};

// electron/gear/gear-manager.ts
export function switchGear(session: AgentSession, gear: Gear) {
  session.settings.allowedTools = gear.allowedTools;
  session.settings.systemPromptOverride = baseSystemPrompt + gear.systemPromptAddendum;
  // 下次 turn 生效
}
```

### 3.4 Silver Core / BPE 作为 occ 工具

银芯 `scripts/mcp_server.py` 已有 11 工具，BPT-NEXT 通过 occ 的 MCP 客户端连接：

```json
// bpt-next 默认 settings.mcpServers
{
  "silver-core": {
    "command": "python",
    "args": ["../../scripts/mcp_server.py"],
    "env": {}
  }
}
```

BPE 检索作为自定义 occ 工具：

```ts
// electron/biav-ext/bpe-search-tool.ts
export const bpeSearchTool = {
  name: 'BpeSearch',
  description: '黑池代码/配置语义检索（FTS5 关键词 / bge-m3 向量）',
  input_schema: { /* ... */ },
  async validateInput(input: unknown): Promise<boolean> { /* ... */ },
  async call(input: BpeSearchInput): Promise<string> { /* ... */ }
};
// 注册到 occ tool registry
```

---

## 四、6 Phase 路线图

| Phase | 目标 | 关键交付 | 验证门槛 |
|-------|------|---------|---------|
| **P0. 骨架** | 项目可启动 | Electron + Vite + React hello world；occ-core 引用可 import | `npm run electron:dev` 白屏正常 |
| **P1. occ 内核接入** | 对话跑通 | session-manager + event-stream + ChatWindow，能和 Anthropic/Ollama 对话 | 发一条"hello"收到流式回复 |
| **P2. 工具系统** | 25 工具可用 | tool-bridge + ToolCallCard；Read/Edit/Bash/Glob/Grep 优先 | 能指挥 AI 读项目文件 |
| **P3. 档位制** | Token 经济收紧 | gear-chat / gear-work + GearSwitcher UI + TokenMeter | chat 档 cache hit > 80% |
| **P4. BIAV 扩展** | 银芯 + BPE 接入 | silver-core MCP + bpe-search-tool + PersonaSelector（艾瑞卡等） | 能调用银芯记忆搜索 |
| **P5. 迁移完成** | bpt / bpt-web / bpt-desktop 归档 | 全功能对齐 + MIGRATION-FROM-BPT.md + 旧项目移入 archive/ | 守密人日用切换到 bpt-next |

---

## 五、风险登记

1. **occ-local 上游 breaking change**
   - 缓解：同步时审阅 diff；`.d.ts` 类型声明作为显式 API 契约；极端时 fork 到 bpt-next 子项目下 vendor/occ/（按需创建）

2. **JS ESM 与 TS strict 混用的类型陷阱**
   - 缓解：为所有 occ 入口写 `.d.ts`；`tsconfig.json` 的 `allowJs: false`（只通过 .d.ts 看 occ）

3. **Electron + async generator + IPC 的背压问题**
   - 缓解：session-manager 内部 buffer；renderer 订阅方收到高频事件时 throttle

4. **Skills / Agents 动态加载 `.md` 违反"禁止 self-evolve"原则**
   - 缓解：`settings.skills.enabled = false` 默认值；守密人需改配置才启用；加载路径白名单

5. **BPT 母版已积累大量活跃代码，并行会产生 Phase 5 前的信息熵**
   - 缓解：Phase 5 前 bpt 继续独立演进；bpt-next 同步关键设计（TokenMeter 等）；Phase 5 合并而非取代

6. **occ 上游的 `v2` 目录可能出 `v3`，路径会变**
   - 缓解：通过 `projects/occ-local/v2/` 的路径稳定性锁定；未来 v3 出现时再议

---

## 六、与现有 BPT 族的映射

| bpt-next 模块 | 来源 |
|--------------|------|
| `electron/main.ts` + `preload.ts` | 继承 `bpt-desktop/electron/main.ts` + `bpt/electron/main.ts` |
| `electron/occ-core/` | 新增，引用 `occ-local/v2/src/` |
| `electron/occ-bridge/` | 新增 |
| `electron/biav-ext/silver-core-tool.ts` | 重构 `bpt/electron/silver/` + `bpt/server/mcp_server.py` |
| `electron/biav-ext/bpe-search-tool.ts` | 重构 `bpt/electron/bpe/` |
| `electron/gear/` | 重构 `bpt/electron/core/` 的档位逻辑 |
| `src/components/chat/` | 继承 `bpt/src/App.tsx` + `bpt-desktop/src/App.tsx` |
| `src/components/economy/TokenMeter.tsx` | 继承 `bpt/src/components/` |
| `src/components/biav/BPEPanel.tsx` | 继承 `bpt/src/components/` |
| `src/QuickEntry.tsx` | 继承 `bpt-desktop/src/QuickEntry.tsx` |
| `src/lib/i18n.ts` | 继承 `bpt-desktop/src/lib/i18n.ts` |
| `tailwind.config.js` | 继承 `bpt-desktop/tailwind.config.js` |
| Token 经济原则 | 继承 `bpt/CONTEXT.md` Prime Directive |
| 非程序员可维护 | 继承 `bpt/CONTEXT.md` Secondary Directive |

---

## 七、立即可做的下一步（等守密人批准）

1. 切新分支：`claude/bpt-next-bootstrap-{suffix}`（当前 `claude/research-code-repos-EW6qb` 先合并入 main）
2. 创建 `projects/bpt-next/` 目录 + CONTEXT.md
3. Phase 0 骨架：`npm init` + Electron + Vite + React + TypeScript strict 最小可启动
4. `electron/occ-core/index.ts` 验证引用可行（写 1 个 import 测试脚本）
5. 更新根 `CLAUDE.md` 子项目速查表新增 bpt-next 行

**艾瑞卡不建议**：
- 当前分支（研究分支）混入 bpt-next 代码——会污染 commit 历史
- 立即开 Phase 1~2——先让 P0 骨架跑通再推进
