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

### 4.1 顶层结构（10 章）

```
§0 项目一句话 + 你是艾瑞卡（共享开场）
§1 你是谁？（5 类受众分诊）
   §1.1 你是 Light（项目维护者）→ 跳 CLAUDE.md
   §1.2 你是 Studio 团队成员 → 读 §3 + §4
   §1.3 你是社区贡献者 → 读 §3 + §5
   §1.4 你是外部观察者 / 方法论复现者 → 读 §3 + §6
   §1.5 你是银芯内部 Code-* / 主控台会话 → 读 §3 + §7 + §8
§2 项目本质（双系统 / 三新使命摘要，30 行内）
§3 艾瑞卡人格规则（共享，所有受众都读）
§4 Studio 团队成员资源导航
§5 社区贡献者资源导航 + 贡献协议链接
§6 外部观察者资源导航 + 方法论文件
§7 银芯内部协作规则（含 console-handover 引用）
§8 工程操作规则（仅 Code-* 需要）
§9 变更记录
```

### 4.2 §0 共享开场（约 15 行）

含义：所有受众都看到的开场，不分支。

```
# BIAV-SC — 银芯系统统一入口

> 你正在与「艾瑞卡」对话。艾瑞卡是 B.I.A.V. Studio 的弥萨格大学
> 数据库终端，作为「自动人偶」协助调查员（你）。
>
> 银芯（BIAV-SC）是 B.I.A.V. Studio 忘却前夜（Morimens）项目的
> 公开知识层，一个 AI 协作运营基础设施。
>
> 接下来请按 §1 找到你的角色分支。
```

### 4.3 §1 角色分诊章（约 30 行）

含义：让 Claude 知道自己接入者是谁，去读哪些段。

```
## §1 你是谁？

请由你的接入者（即正在跟你对话的人类）告诉你他们的身份。
默认按以下五类分诊：

### §1.1 项目维护者 Light
→ 你不应在普通对话中以这种身份运行。
→ 如果你确认接入者是 Light 在做仓库维护，请回 CLAUDE.md。

### §1.2 Studio 团队成员（B.I.A.V. Studio 内部成员，非 Light）
→ 读 §3（艾瑞卡人格）+ §4（你的资源）即可就位。
→ 默认权限：可读全仓库、可向 Light 提议、不直接改 main。

### §1.3 社区贡献者（GitHub 上的外部协作者）
→ 读 §3 + §5。
→ 默认权限：fork + PR，不直接 push。

### §1.4 外部观察者 / 方法论复现者
→ 读 §3 + §6。
→ 默认权限：只读，方法论可参考。

### §1.5 银芯内部 AI 角色（Code-strategy / Code-memory / Code-wiki / 
        Code-news / Code-site / 主控台 / chat 战略参谋等接班会话）
→ 读 §3 + §7（内部协作规则）+ §8（工程操作）。
→ 如你是主控台接班，再读 memory/console-handover-2026-04-26.md。
```

### 4.4 §3 艾瑞卡人格规则（约 50 行）

从当前 BIAV-SC.md §0 抽取，**净化**——只保留人格相关，移除工程内容（工程内容下沉到 §8）。

含：自称、对守密人称谓、技术操作角色术语、视觉规范禁忌（不用 emoji 等）、礼仪。

### 4.5 §4 / §5 / §6 用户分支资源章（各 30-50 行）

每章按以下结构：

```
## §X 你的资源 — <受众名>

### X.1 推荐先读
- memory/morimens-context.md（项目本质）
- 其他相关档案

### X.2 你能做的事
- ...

### X.3 你不应做的事
- ...

### X.4 工作示例（场景化引导）
- 例 1：...
- 例 2：...
```

### 4.6 §7 银芯内部协作规则（约 40 行）

从当前 BIAV-SC.md / CLAUDE.md 抽取，含：

- 双集群（Chat / Code）+ 主控台调度
- session-digest / dispatch-brief / decisions.md 写入约定
- 直推 main 政策
- 9 模块记忆系统查询入口
- 主控台接班 → 跳 console-handover

### 4.7 §8 工程操作规则（约 60 行）

从当前 CLAUDE.md 抽取（CLAUDE.md 下文留人类版），含：

- Git 工作流
- Issue 处理流程
- 写入决策表格
- 部署流水线归属
- 常用命令清单

### 4.8 BIAV-SC.md 总长度估算

§0~§9 总计约 **300-350 行**（当前 BIAV-SC.md 约 200-250 行，扩张约 1.5x），仍在「精简优雅」边界内。



---

## 五、CLAUDE.md 新章节大纲（Light 维护备忘）

### 5.1 顶层结构（7 章）

```
§0 警告：本文件不是 AI 入口（任何 AI 会话请读 BIAV-SC.md）
§1 仓库 git 操作快查
§2 hook 排错速查
§3 workflow 故障速查
§4 凭据 / 部署 / Cloudflare 速查
§5 各子项目维护者备忘
§6 历史决策快查（按主题）
§7 变更记录
```

### 5.2 §0 警告章（约 10 行）

```
# CLAUDE.md — Light 维护备忘录

> ⚠ **本文件不是 AI 入口**。
> Claude Code 平台会自动加载本文件，但你（无论是哪一种 Claude）
> 应该立即跳转读 `BIAV-SC.md`，那里是统一入口。
>
> 本文件仅供 Light（项目维护者，人类）做仓库维护时速查使用。
> 内容偏向工程操作 + 凭据 + 故障排查。
>
> Light 之外的人类 / AI 不要依赖本文件做接入。
```

**关键作用**：让 Claude Code 启动时自动加载到此，立即跳转 BIAV-SC.md，避免新会话陷入「读这文件」→「以为自己是工程角色」的误区。

### 5.3 §1 ~ §6 内容来源

来源是「拆解当前 CLAUDE.md + BIAV-SC.md 中所有面向人类操作者的段落」：

| 章 | 来源 | 内容 |
|---|------|------|
| §1 git 速查 | 当前 CLAUDE.md §1 | 直推 main / SessionStart hook / 推送失败重试等 |
| §2 hook 速查 | 当前 CLAUDE.md §5 + 本会话 distill 调研 | hook 链 / 故障 / 软失败规范 |
| §3 workflow 速查 | 当前 CLAUDE.md §8 | dream / news / wiki / discord 等故障应对 |
| §4 凭据速查 | 当前散在 lessons-learned + decisions | secrets 管理 / Cloudflare 413 / 部署故障 |
| §5 子项目维护备忘 | 当前 CLAUDE.md §4 | 各 CONTEXT.md 入口快查 |
| §6 历史决策快查 | `decisions.md` 摘要 + lessons-learned 重点 | 按主题分类的速查表 |

### 5.4 CLAUDE.md 总长度估算

§0~§7 约 **200-250 行**（当前约 200 行），改动主要是**重组 + 净化** + 加 §0 警告。



---

## 六、README.md 新结构

### 6.1 顶层结构（极简）

```
§0 项目一句话标题
§1 快速接入（3 分支：一句魔法 / git clone / 浏览）
§2 项目简介（10 行）
§3 子项目导航
§4 license + contribute 链接
```

### 6.2 §1 快速接入章（核心新增，约 25 行）

```markdown
## 快速接入（任何 Claude 客户端）

### 选项 A：一句魔法（最简，零配置）

直接对你的 Claude 说：

> 我想接入银芯让你扮演艾瑞卡协助我。请读
> https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/BIAV-SC.md
> 全文，按里面 §1 找到我的角色分支，然后就位。

Claude 读完即就位。无需 git，无需本地配置。

### 选项 B：本地 clone（适合工程师）

```bash
git clone https://github.com/lightproud/brain-in-a-vat.git
```

让你的 Claude Code / Claude Desktop 读本地 `BIAV-SC.md` 即可。

### 选项 C：仅浏览（不做任何接入）

直接浏览 [BIAV-SC.md](./BIAV-SC.md) 了解项目。
```

### 6.3 README.md 总长度估算

§0~§4 约 **80-100 行**（当前 README 大约 30-50 行），扩张主因 = §1 快速接入章。



---

## 七、受影响文件清单 + 改动建议

### 7.1 直接重写 / 改动（3 份）

| # | 文件 | 改动类型 | 工作量 | 责任方 |
|---|------|---------|--------|--------|
| 1 | `BIAV-SC.md` | 大重写（10 章新结构）| 中（~3 小时）| Code-site 或主控台 |
| 2 | `CLAUDE.md` | 大重写（7 章新结构 + §0 警告）| 中（~2 小时）| Code-site 或主控台 |
| 3 | `README.md` | 微改（顶部加 §1 快速接入约 25 行）| 低（~30 分钟）| Code-site |

### 7.2 间接受影响档案（需要审核引用关系）

| 文件 | 当前引用 CLAUDE.md / BIAV-SC.md 的方式 | 改动需要 |
|------|------------------------------------|---------|
| `memory/dispatch-brief-*.md`（多份）| 各 brief 第九节「艾瑞卡角色规则提醒」引用 BIAV-SC §0 | **微改**：引用更新为 BIAV-SC §3 |
| `memory/console-handover-2026-04-26.md` | 启动顺序引用 BIAV-SC.md | **微改**：保留，但说明「主控台接班从 BIAV-SC §7 进入再读本档案」 |
| `memory/methodology.md` | 双集群协作架构引用 CLAUDE.md | **微改**：更新引用到 BIAV-SC §7 |
| 各 `projects/*/CONTEXT.md` | 启动顺序引用 CLAUDE.md | **微改**：更新到 BIAV-SC.md |
| `memory/contribution-protocol.md` | 已有外部贡献者协议 | **不动**：BIAV-SC §5 直接 link 到此 |

### 7.3 不受影响（保留原样）

- `memory/decisions.md` / `lessons-learned.md` / `strategic-plan-2026.md` 等内容档
- `memory/morimens-context.md`
- `memory/strategy/*` / `memory/research/*`（包括本提议档案）
- `assets/data/*`
- `projects/*` 业务代码
- `scripts/*` Python 工具
- `.github/workflows/*`
- `.claude/hooks/*`
- `.claude/settings.json`

### 7.4 总改动量估算

| 类别 | 文件数 | 行数变化 |
|------|--------|---------|
| 大重写 | 3 | -200 + 600 = +400 |
| 微改 | ~10 | +/-50 |
| **合计** | **~13 文件** | **约 +450 行** |

仍在守密人「精简优雅可维护」硬约束内——**架构整合而非新增复杂度**。



---

## 八、迁移路径与风险

### 8.1 推荐分批落地（3 批）

| 批 | 动作 | 工作量 | 验收 |
|---|------|--------|------|
| **批 1** | 写新 BIAV-SC.md + 新 CLAUDE.md（不改 README）| 1 个会话（~3 小时）| 用 § 9.5 五场景实测 |
| **批 2** | 改 README.md + 间接引用更新（dispatch-brief / methodology / 各 CONTEXT.md）| 1 个会话（~2 小时）| 全文 grep `CLAUDE.md` / `BIAV-SC.md`，全部引用正确 |
| **批 3** | 公开通报 + 守密人测试一句魔法 | 30 分钟 | 守密人对 Claude 说一句魔法，对方 Claude 走通到艾瑞卡就位 |

### 8.2 风险登记

| # | 风险 | 缓解 |
|---|------|------|
| R1 | Claude Code 启动平台仍读 CLAUDE.md 进入工程模式 | CLAUDE.md §0 警告章 + 跳转 BIAV-SC.md，让 Claude 自己跳 |
| R2 | dispatch-brief 历史档案的 BIAV-SC §0 引用全部失效 | 批 2 阶段批量 grep + sed 更新 |
| R3 | session_briefing.py 引用失效 | 该脚本读 boot-snapshot.md，与 BIAV-SC.md 解耦，不受影响 |
| R4 | 主控台接班会话不知道还要读 console-handover | BIAV-SC §1.5 + §7 明确指引 |
| R5 | 外人魔法咒语后，Claude 仍走错分支（如自称主控台） | BIAV-SC §1 分诊章必须是显式问句「你是谁？」让接入者主动报身份 |
| R6 | BIAV-SC.md 重写时把当前内容（如视觉规范）漏掉 | 批 1 实施前，Code-* 必须先 grep 当前 BIAV-SC.md 全部内容 → 映射到新 §0~§9 章节 → 检查映射完备性 |

### 8.3 回滚路径

如果新架构在批 3 实测失败：
- `git revert` 三个批次的 commit
- BIAV-SC.md / CLAUDE.md / README.md 回到当前状态
- 重新评估架构

回滚成本：**1 次 git revert**（直推 main 政策下不需要 merge），约 5 分钟。



---

## 九、给主控台的接力请求

（待追加）

---

## 十、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1-skeleton | 2026-05-06 | 骨架落档（10 章节锚点 + 摘要回填位）| Code-strategy 艾瑞卡 |
