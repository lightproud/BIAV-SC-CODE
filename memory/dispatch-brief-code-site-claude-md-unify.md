# 派发 Brief — Code-site：CLAUDE.md 统一入口（BIAV-SC.md 废弃）

> 落档日期：2026-05-19
> 派发方：主控台（艾瑞卡 opus4.7 长期战略锚点）
> 接收方：Code-site 会话（追派或另启）
> 验收方：守密人 / 主控台
>
> 上游依据：
> - 守密人 2026-05-19 关键洞察：「BIAV-SC.md 必然是弱约束，这是 Claude 结构决定的」
> - 守密人 5-19 反转裁定：CLAUDE.md 成为唯一 AI 入口，BIAV-SC.md 彻底废弃
> - 决策档：`memory/decisions.md` 2026-05-19「入口架构反转」条目（覆盖 5-6 全部裁定）
> - 废弃前置：`memory/dispatch-brief-code-site-entry-redesign-batch1.5-patch.md` 已标 deprecated
>
> 状态：待 Code-site 取用

---

## 一、任务概要

**结构性反转**——废弃 BIAV-SC.md 双入口设计，把 AI 入口完整迁移到 CLAUDE.md。理由：Claude Code 平台自动加载 CLAUDE.md = 平台级强约束，比 BIAV-SC.md（仅靠 prompt 远端注意力）有效得多。外部 AI 接入咒语改为直接读 CLAUDE.md raw URL —— Claude Code 自动加载 + 外部 raw URL 同源单一入口。

---

## 二、任务清单

### 2.1 CLAUDE.md 完整重写

把当前 `BIAV-SC.md`（350 行）+ Light 维护速查附录合并到 CLAUDE.md，结构如下：

```
§0 你是艾瑞卡（开场 + 人格规则核心）              ← 迁移自 BIAV-SC.md §0/§3
§1 项目本质（双系统 + 三新使命）                   ← 迁移自 BIAV-SC.md §2
§2 艾瑞卡人格规则（完整版）                        ← 迁移自 BIAV-SC.md §3
§3 接入方能力盘点                                  ← 迁移自 BIAV-SC.md §-1 等
§4 数据消费纪律（lesson #30 防御）                 ← 迁移自 BIAV-SC.md §8.5
§5 知识模块索引                                    ← 迁移自 BIAV-SC.md 知识模块索引段
§6 内部协作 + 工程操作                             ← 合并 BIAV-SC.md §7 + §8 + Light 速查
§7 引用法则（卡帕西 / 信息分类 / 贡献协议）        ← 新建，仅引用不内嵌
§8 Light 维护速查（git / hook / workflow / 凭据 / 子项目 / 历史决策） ← 保留当前 CLAUDE.md 主体
§9 变更记录
```

**关键设计**：
- §0 ~ §7 = AI 接入核心（强约束部分）—— 任何接入 AI 必读
- §8 Light 维护速查 = 工程操作附录 —— 工程维护场景查阅
- §9 变更记录

### 2.2 BIAV-SC.md 彻底废弃

- 直接 `git rm BIAV-SC.md`，**不保留指针**
- 守密人裁定明确：单一入口，不留双文件

### 2.3 README.md「接入弥萨格数据库」段更新

将链接从 `BIAV-SC.md` / `raw.githubusercontent.com/.../BIAV-SC.md` 改为 `CLAUDE.md` / `raw.githubusercontent.com/.../CLAUDE.md`。

接入咒语保持 2 行（守密人 5-6 收缩裁定有效）：

```
读 https://raw.githubusercontent.com/lightproud/brain-in-a-vat/main/CLAUDE.md，
按 §0 进入艾瑞卡（B.I.A.V. Studio 弥萨格大学数据库终端的自动人偶）人格协助我。
```

### 2.4 不在范围内

- ❌ 不动 `memory/` 内容档（决策、教训、战略、采访、卡帕西、信息分类法则等不变）
- ❌ 不动 `memory/dispatch-brief-*.md` 任何引用（批量更新留作 batch 2）
- ❌ 不动 `memory/console-handover-2026-04-26.md`
- ❌ 不动 `projects/*/CONTEXT.md` 引用（batch 2）
- ❌ 不动 `scripts/*` Python 工具
- ❌ 不引入新依赖
- ✅ 仅改 `CLAUDE.md` + 删 `BIAV-SC.md` + 改 `README.md`

---

## 三、实施前必做：内容映射检查

实施前 grep 当前 BIAV-SC.md 全文，列出所有现有章节，逐条映射到新 CLAUDE.md §0~§9：

| BIAV-SC.md 当前内容 | CLAUDE.md 新章 |
|---|---|
| §0 共享开场 | §0 |
| §1 你是谁？5 类受众分诊 | **删除**（守密人 5-6 收缩裁定单一受众，已废止） |
| §2 项目本质 | §1 |
| §3 艾瑞卡人格规则 | §0 核心 + §2 完整 |
| §4 / §5 / §6 受众分支资源章 | **删除**（同上） |
| §7 银芯内部协作规则 | §6 上半 |
| §8 工程操作规则 | §6 下半 |
| §9 变更记录 | §9 |

**禁止丢失项**：本检查表落档到 commit message 或附录。

---

## 四、验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `BIAV-SC.md` **不存在** | `ls BIAV-SC.md` 失败 |
| 2 | `CLAUDE.md` 含艾瑞卡人格 / 数据消费纪律 / 知识模块索引 / 内部协作 / 工程操作 / Light 速查 / 卡帕西引用 / 信息分类引用 | grep 关键词 |
| 3 | `CLAUDE.md` 总行数 ≤ 500（守密人硬约束的合理上限，因合并 BIAV-SC + Light 速查） | `wc -l` |
| 4 | `README.md` 接入段链接改为 `CLAUDE.md` / 含新咒语 | grep |
| 5 | `git diff --stat` 仅 3 文件变化（CLAUDE.md / BIAV-SC.md 删除 / README.md） | 命令行 |
| 6 | 内容映射检查表落档到 commit message | commit message 核查 |
| 7 | 不引入新依赖 | `pip freeze` 对比修改前后 |
| 8 | CLAUDE.md §0 ~ §7 不含「你是谁？5 类受众分诊」/ Studio/社区/外部观察者分支资源章（守密人 5-6 单一受众裁定继承） | grep |
| 9 | 接入咒语指向 CLAUDE.md raw URL 而非 BIAV-SC.md | 守密人确认 |
| 10 | 模拟 Claude Code 启动加载 CLAUDE.md 后能正确进入艾瑞卡人格 | 主控台或守密人模拟测试 |

---

## 五、提交规范

- 直推 main（按当前政策）
- commit message 建议：
  ```
  feat(entry): unify AI entry to CLAUDE.md, deprecate BIAV-SC.md
                per 守密人 2026-05-19 反转裁定

  Resolves dispatch (memory/dispatch-brief-code-site-claude-md-unify.md).

  Trigger: 守密人 insight that BIAV-SC.md is structurally weak constraint
  due to LLM attention decay over long context. Claude Code platform
  auto-loads CLAUDE.md → platform-level strong constraint vs BIAV-SC.md's
  prompt-far weak constraint.

  Changes:
  - CLAUDE.md: complete rewrite as unified AI entry
    §0 艾瑞卡 / §1 项目本质 / §2 人格完整 / §3 能力盘点 /
    §4 数据纪律 / §5 知识索引 / §6 内部协作+工程 /
    §7 法则引用 (Karpathy + info-classification + contribution-protocol) /
    §8 Light 维护速查 / §9 变更记录
  - BIAV-SC.md: git rm (单一入口，不留双文件)
  - README.md: 接入段链接 BIAV-SC.md → CLAUDE.md
                接入咒语 raw URL 同改

  Content mapping table: [grep result of BIAV-SC.md mapped to new chapters]

  Covers 守密人 2026-05-06 CLAUDE.md/BIAV-SC.md 全部裁定 +
  同日收缩裁定 (5-class triage already abandoned; this继承).

  Code-site boundary observed: only entry files (CLAUDE/BIAV-SC/README).
  ```

---

## 六、艾瑞卡角色规则提醒

Code-site 仍按**当前** `BIAV-SC.md §3` 艾瑞卡人格规则运行（重写后变成 CLAUDE.md §2，但本会话按当前版本）。

---

## 七、后续 batch 2 接力（待本 batch 验收后决策）

- 批量更新 `memory/dispatch-brief-*.md` 第九节「引用 BIAV-SC §0」→「引用 CLAUDE.md §0」
- 更新 `memory/methodology.md` / `memory/contribution-protocol.md` 等引用 BIAV-SC.md 的地方
- 更新 `projects/*/CONTEXT.md` 启动顺序引用
- 更新 `memory/console-handover-2026-04-26.md` 引用

主控台 batch 2 brief 待本 batch 验收后另起。

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v1.0 | 2026-05-19 | 初版 brief 落档（守密人入口架构反转裁定接力） | 主控台艾瑞卡 opus4.7 |
