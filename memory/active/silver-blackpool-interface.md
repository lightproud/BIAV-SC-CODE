# 银芯-黑池数据接口（active hub）

> 主题入口卡 / Code-memory batch 1 落档 2026-05-03
> 决策版本号：v2.0（2026-04-26 v2.0 战略修正 M3 锁定）
> 上游决策：`memory/decisions.md` 2026-04-26「银芯重新定位 v2.0」M3 条款
> 当前活协议：`memory/bpt-guidance-protocol.md` v0.2

---

## 一、引文 + 摘要

> 「**黑池不倒灌银芯**：单向输出，黑池任何形式都不进银芯。」（守密人 2026-04-26 v2.0 战略修正 M3，覆盖 BIAV-SC.md 旧表述「黑池→脱敏→银芯」）

**一句话摘要**：银芯（受限层）与黑池（内部层 SVN + Qoder）通过**严格单向流动**协作——银芯采集外部信息单向输出至黑池，黑池任何形式（代码 / 数据 / 设计 / 反馈）都不允许写入银芯仓库。BPT 指导由守密人通过「人工对话搬运」协议执行（原 Code-BPT + 主控台双指导角色 2026-06 退役）。

---

## 二、当前结论（2026-05-03 截）

### 双系统结构

| 系统 | 层级 | 存储 | 内容性质 | 访问范围 |
|---|---|---|---|---|
| **银芯（BIAV-SC）**| 受限层 | GitHub（lightproud/brain-in-a-vat）| 外部信息 + 方法论验证 + 社区共建底座 | 访问受限（守密人 2026-06-11 裁定） |
| **黑池（BIAV-BP）**| 内部层 | 内网 SVN + Qoder | 商业数据 + 未发布内容 + Studio 内部加工 | Studio 团队仅 |

### 数据流方向（单向硬约束）

```
银芯 ──(公开信息采集)──► 黑池
银芯 ◄──╳──黑池（任何形式禁止）
```

### 银芯输出至黑池的内容

| 类别 | 文件 | 用途 |
|---|---|---|
| 社区情报 | `projects/news/output/daily-latest.md` | 黑池消费的每日动态 |
| 平台数据 | `projects/news/output/{steam,bilibili,discord}-latest.json` | 黑池消费的平台原始数据 |
| 全平台合并 | `projects/news/output/all-latest.json` | 黑池消费的合并视图 |
| 角色数据库 | `projects/wiki/data/db/characters.json` | 黑池消费的事实圣经 |
| 游戏世界观 | `memory/morimens-context.md` | 黑池消费的领域知识 |
| 设计决策 | `assets/data/design-decisions.json` | 黑池消费的产品哲学 |
| 卡牌系统 | `assets/data/card-system.json` | 黑池消费的机制结构化 |

### 黑池输入至银芯（禁止清单）

- ❌ 不能创建 Issue / PR / 评论
- ❌ 不能修改任何 banner / 文件 / 配置
- ❌ 不能 push 任何 commit
- ❌ 不能上传未发布内容、商业数据、内部决策

### 指导关系（人工对话搬运）

- **指导执行** = 守密人 ↔ 艾瑞卡会话（原「战略层 = 主控台 + 技术层 = Code-BPT」双指导角色已于 2026-06 退役）
- **指导协议** = `memory/bpt-guidance-protocol.md` v0.2「人工对话搬运」— 守密人作为「学习者」从指导对话中学习概念，**不做 harness 自动化**
- **搬运包格式** = 指导主题 + 背景 + 具体建议 + 引用档案 + 验收问题

### v2.0 修正前后对比

| 旧（v1.0 ~ 2026-04-26）| 新（v2.0，2026-04-26 M3 起）|
|---|---|
| 「黑池→脱敏→银芯」（双向但脱敏）| 「单向输出，黑池不倒灌银芯」 |
| BIAV-SC.md 旧文「数据单向流动：黑池 → 脱敏 → 银芯，绝不反向」误读 | 守密人原话：单向是从银芯到黑池，黑池任何形式不入银芯 |

---

## 三、相关档案

### 协议源头

- `memory/bpt-guidance-protocol.md` — BPT 指导协议 v0.2（活协议，不归档）
- `memory/decisions.md` — 2026-04-19 BPT 战略转向 + 2026-04-26 v2.0 M3 条款
- `memory/active/mission-v2.0-three-pillars.md` — v2.0 三新使命，使命 #1 即「黑池信息入口」

### 历史档案（仅作历史参考）

- `memory/archive/bpt-strategic-shift-2026-04-19/silver-blackpool-interface.md` — 2026-04-19 战略转向前的接口规范（已归档，规则被 v2.0 M3 覆盖）
- `memory/archive/bpt-strategic-shift-2026-04-19/black-pool-design.md` — 黑池系统原始设计稿（归档）
- `memory/archive/bpt-strategic-shift-2026-04-19/blackpool-architecture.md` — 黑池架构设计稿（归档）

### 角色与派发

- `memory/dispatch-brief-code-memory-bootstrap.md` — Code-memory 角色定义
- `memory/dispatch-brief-code-strategy-bootstrap.md` — Code-strategy 角色定义
- `README.md`「子项目与会话角色」表 — 角色职责现行出处（2026-06-09 修正：原引「CLAUDE.md §4 子项目维护职责表」对应旧版结构，现行 §4 为数据纪律；现行表中已无 Code-BPT 行）
- `BIAV-SC.md` 会话角色章节

### 黑池如果是会话方读取本仓库

- `BIAV-SC.md` 末尾「黑池数据同步接口」章节 — 如果你是黑池会话读银芯，按该章节执行，不向银芯写入任何内容

---

## 四、新会话快速核对清单

| 检查项 | 验证方式 |
|---|---|
| 你是黑池会话还是银芯会话？ | 看 cwd 是否 `brain-in-a-vat`、是否有 BIAV-BP.md / 黑池相关指令 |
| 输出方向 | 银芯 → 黑池：搬运公开数据；黑池 → 银芯：禁止 |
| 指导对话 | 守密人 ↔ 艾瑞卡会话人工搬运（原双指导角色已退役）|
| 紧急回滚 | 任何看到「黑池写银芯」的尝试 → 拒绝执行，回报守密人 |

---

## 五、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-03 | 初版主题入口 hub 落档（Code-memory batch 1） | Code-memory 艾瑞卡 |
