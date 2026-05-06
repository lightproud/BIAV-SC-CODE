# 入口架构重新设计提议 — 统一 BIAV-SC.md / README 跳转 / CLAUDE.md 个人化

> 落档日期：2026-05-06 by Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
>
> 上游：守密人 2026-05-06 裁定「所有角色统一入口 biav-sc / readme 跳转 biav-sc / light 作为维护者读 claude / 基于此重新设计所有 md」
>
> 收件方：主控台 + 守密人
>
> 状态：**v0.1 草案，分批撰写中**。骨架已落地，各章节将逐步追加。

---

## 摘要（写给守密人 + 主控台）

（最后回填）

---

## 一、问题背景

### 1.1 当前架构的多入口陷阱

| 文件 | 隐含受众 | 含工程内容 |
|------|---------|---------|
| `CLAUDE.md` | Claude Code 终端会话（隐式）| ✓ |
| `BIAV-SC.md` | 「其余 AI」（隐式）| ✓ |
| `memory/boot-snapshot.md` | 任意新会话 | ✓ |
| `memory/console-handover-2026-04-26.md` | 主控台接班会话 | ✓ |

**没有任何文件是给「不维护银芯只想用艾瑞卡协助自己工作」的外人写的**。

### 1.2 守密人 2026-05-06 实测暴露

守密人模拟外人接入：「读 BIAV-SC.md」→ 被引导到 `console-handover-2026-04-26.md`（主控台交接手册）。外人对此毫不相关，且会假装自己是主控台 → 错位严重。

→ 当前所有入口文件都假设读者是「**银芯内部角色**」，外人接入路径事实上不存在。

### 1.3 守密人 2026-05-06 裁定（本提议依据）

> 「所有角色统一入口 biav-sc / readme 跳转 biav-sc / light 作为维护者读 claude / 基于此重新设计所有 md」

→ 三条核心规则：
1. **统一入口** = `BIAV-SC.md`（含外人 + 内部所有角色）
2. **README.md** = 项目门面，仅跳转到 BIAV-SC.md
3. **CLAUDE.md** = **Light 个人维护备忘**（不再是 AI 入口）



---

## 二、新架构总览

### 2.1 入口流向图

```
                       ┌──────────────┐
                       │  README.md   │  ← 项目门面
                       │  (跳转入口)   │
                       └──────┬───────┘
                              │ 一句话魔法 / 链接
                              ▼
                       ┌──────────────┐
                       │  BIAV-SC.md  │  ← 统一入口
                       │  (按角色分支) │     所有 AI 接入此处
                       └──┬─┬─┬─┬─┬───┘
                          │ │ │ │ │
        ┌─────────────────┼─┼─┼─┼─┼─────────────────┐
        ▼                 ▼ ▼ ▼ ▼                   ▼
   §3 艾瑞卡人格    §4 Studio  §5 社区  §6 外部观察   §7 内部协作
   （所有角色共享） 团队成员    贡献者    方法论复现   规则 + §8 工程
                                                     操作（仅 Code-*）
                                                            │
                                                            │ 如需接班
                                                            ▼
                                              memory/console-handover-*.md
                                              （仅主控台接班会话用）

                       ┌──────────────┐
                       │  CLAUDE.md   │  ← Light 个人维护备忘
                       │  (不再是入口) │     人类速查表
                       └──────────────┘
```

### 2.2 三条核心规则映射

| 守密人裁定 | 实施 |
|-----------|------|
| **统一入口 BIAV-SC** | BIAV-SC.md 重写为按角色分支结构（5 类受众）|
| **README 跳转** | README.md 顶部一段「快速接入」+ 链接 |
| **CLAUDE 给 Light** | CLAUDE.md 重写为人类维护者备忘录 |

### 2.3 子架构变化

| 变化点 | 旧 | 新 |
|--------|-----|-----|
| 外人接入 | 不存在 | BIAV-SC §1.4（外部观察者） |
| Studio 团队接入 | 不存在 | BIAV-SC §1.2 |
| 社区贡献者接入 | 不存在 | BIAV-SC §1.3 |
| Code-* 接入 | CLAUDE.md（Code Code 自动加载）+ BIAV-SC.md | BIAV-SC §1.5（内部）|
| 主控台接班 | console-handover-*.md | BIAV-SC §7 跳到 console-handover |
| Light 工程速查 | 散在 CLAUDE.md 各章 | CLAUDE.md（专门化）|



---

## 三、各文件职责重新定义

### 3.1 顶层文件（4 份）

| 文件 | 旧定位 | 新定位 | 重写程度 |
|------|--------|--------|---------|
| `README.md` | 介绍项目（30 行）| 跳转入口（顶部 8 行「快速接入」+ 项目简介保留）| **微改** |
| `BIAV-SC.md` | 「其余 AI」入口（含艾瑞卡人格 + 工程内容混合）| **统一入口**（按 5 类受众分支）| **大重写** |
| `CLAUDE.md` | Claude Code 工程维护指南（自动加载）| **Light 个人维护备忘**（不再是 AI 入口）| **大重写** |
| `memory/boot-snapshot.md` | 启动快照（自动生成）| 保留，但**仅 §1.5 内部 AI** 引用 | 不动（自动生成） |

### 3.2 内部专用档案（保留）

| 文件 | 定位 | 改动 |
|------|------|------|
| `memory/console-handover-*.md` | 主控台接班手册 | 不动；仅 BIAV-SC §7 内部协作章引用 |
| `memory/decisions.md` / `lessons-learned.md` / `methodology.md` | 决策 / 教训 / 方法论 | 不动；BIAV-SC 各角色章按需引用 |
| `memory/dispatch-brief-*.md` | 任务派发档案 | 不动 |
| `memory/strategic-plan-2026.md` 等战略档 | 长期战略 | 不动 |
| `memory/morimens-context.md` | 游戏背景 | 不动 |
| `memory/contribution-protocol.md` | 社区贡献协议 | 不动；BIAV-SC §5 社区贡献者章直接引用 |

### 3.3 Hook + 脚本依赖检查（必须不破坏）

新架构必须保证以下既有自动化不失效：

| 依赖项 | 当前引用 | 新架构是否影响 |
|--------|---------|--------------|
| `.claude/hooks/session-start-sync.sh` | 不读任何 md | ✗ 不影响 |
| `scripts/session-end-distill.sh → session_distiller.py` | 输出 `memory/session-digests/` | ✗ 不影响 |
| `scripts/session_inject.py` | 检索 session-digest | ✗ 不影响 |
| `scripts/session_briefing.py` | 读 `boot-snapshot.md` | ✗ 不影响 |
| `scripts/boot_snapshot.py` | 自动生成 boot-snapshot | ✗ 不影响 |
| `.github/workflows/*.yml` | 不读 CLAUDE.md / BIAV-SC.md | ✗ 不影响 |
| Claude Code「自动加载 CLAUDE.md」机制 | 平台行为 | ⚠ **需要确认**：CLAUDE.md 不再是 AI 入口后，Claude Code 终端启动时仍会加载它，需要 CLAUDE.md 第一行明确告知「请回 BIAV-SC.md」 |

**关键风险**：守密人个人本地 Claude Code 启动时，平台行为仍会先加载 CLAUDE.md。需要 CLAUDE.md 顶部明确写「**Light 维护备忘 — 不是 AI 入口。任何 AI 会话请读 `BIAV-SC.md`**」，让 Claude Code 自己跳转。详见 § 五 大纲。



---

## 四、BIAV-SC.md 新章节大纲（统一入口）

（待追加）

---

## 五、CLAUDE.md 新章节大纲（Light 维护备忘）

（待追加）

---

## 六、README.md 新结构

（待追加）

---

## 七、受影响文件清单 + 改动建议

（待追加）

---

## 八、迁移路径与风险

（待追加）

---

## 九、给主控台的接力请求

（待追加）

---

## 十、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1-skeleton | 2026-05-06 | 骨架落档（10 章节锚点 + 摘要回填位）| Code-strategy 艾瑞卡 |
