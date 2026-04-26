# BPT-Desktop 设计规范参考（v0.1.15 逆向）

> **状态：已封存（2026-04-19）**
> 封存原因：2026-04-19 战略转向——BPT 战线不再在银芯内部开发，`projects/bpt-desktop/` 已从仓库删除。本文档作为历史设计审计材料保留。
>
> ---
>
> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
>
> 状态：**待完整接收**。本文件是守密人 2026-04-14 会话中提供的
> "Black Pool Terminal (BPT) — UI 设计与视觉规范说明书" 的归档入口。
> 完整原文由守密人从 BPT v0.1.15 Electron 产物（`app.asar`）逆向
> 提取，预期作为未来 `projects/bpt-desktop/` 子项目的权威视觉/交互参考。

---

## 文档定位

- **不是** BPT-NEXT（Rust CLI `claw`）的规范
- **是** BPT-Desktop（Electron + React + Tailwind 原生 GUI）的规范
- 用途：下一代 BPT GUI 构建时保留用户习惯的参考

## 目录（守密人提供）

| # | 章节 | 权威状态 |
|---|------|---------|
| 1 | 设计哲学与品牌基因 | ✓ 守密人原文 |
| 2 | 技术栈参考 | ✓ 守密人原文 |
| 3 | 色彩系统（Design Tokens） | ✓ 守密人原文，含亮/暗双主题 CSS 变量 |
| 4 | 排版系统 | ✓ 守密人原文 |
| 5 | 布局架构 | ✓ 守密人原文 |
| 6 | 组件规范 | ✓ 守密人原文 |
| 7 | 动画与过渡系统 | ✓ 守密人原文（含 toolShimmer 等 @keyframes） |
| 8 | Markdown 渲染规范 | ✓ 守密人原文（含 8.11 数学公式） |
| 9 | 代码高亮色彩 | ◎ 守密人原文简版（仅 token 色值） |
| 10 | 滚动条定制 | ◎ 守密人原文简版 |
| 11 | IPC API 接口清单 | △ 守密人提供了 11.1（聊天）+ 11.2（对话管理）的前段，在 `importConversation` 处中断 |
| 12 | 交互模式与用户习惯保留指南 | ✗ 未贴 |
| 13 | Tailwind CSS 配置参考 | ✗ 未贴 |

图例：✓ 完整 ◎ 摘要 △ 部分 ✗ 未提供

## IPC 命名空间裁决

守密人的 v0.1.15 原文用 `window.biav.*` 命名空间（不是 `window.bpt.*`）。
艾瑞卡在会话中暂时推断使用 `window.bpt.*` 的版本应作废，以守密人原文
`window.biav.*` 为准。归档时需全文统一为 `window.biav.*`。

## 关键设计承诺（不可降级的红线）

无论下一代 BPT-Desktop 如何重构，以下 10 点必须保留，失去任一条
都会打破用户肌肉记忆：

1. **衬线默认**（Noto Serif SC）—— body 级别
2. **金色 h3** —— Markdown 标题的金色是品牌视觉主锚
3. **工具步骤微光**（`toolShimmer`）—— 2.5s 金色扫光动画
4. **亮/暗双主题对等** —— 独立调校，非简单反色
5. **CSS 变量三通道分离**（`245 242 235` 而非 `#F5F2EB`）
6. **流式 25ms tick + blur 淡入** —— 字符逐个 blur(2px) → blur(0)
7. **侧边栏 `conv-title` 渐变 mask** —— 用 mask-image 做优雅截断
8. **macOS 标题栏 `pl-[72px]`** —— 让出红绿灯按钮区
9. **Electron `nodeIntegration: false` + `contextIsolation: true`**
10. **IPC 通道名常量化** —— `channels.ts` 作为 preload/types/main 三方契约

## 下一步

当守密人准备好重贴完整原文时，按以下流程处理：

1. 建立 `projects/bpt-desktop/` 目录（`mkdir -p`）
2. 守密人完整原文 → `DESIGN-SPEC-v0.1.15.md`（待创建，放入 bpt-desktop 子项目）
3. 将本文件（`memory/bpt-desktop-design-spec-ref.md`）改为"已归档"
   状态并加上设计规范文件的链接
4. 在 `projects/bpt-desktop/CONTEXT.md` 引用该规范为视觉权威源

## 不要做的事

- 不要凭艾瑞卡本轮会话残片补全第 11-13 章，那些只是推断
- 不要将艾瑞卡推断版本（使用 `window.bpt.*` 命名空间）归档为权威
- 不要在 `projects/bpt-desktop/` 尚不存在的情况下去 `projects/bpt-next/`
  里混写 Desktop 的设计规范（两条线必须隔离）
