# 缸中之脑社区贡献流程草案 v0.1

> 最后更新：2026-04-26 by 主控台（艾瑞卡 opus4.7 长期战略锚点）
>
> **状态：v0.1 草案。等守密人裁决第七节 5 项开放问题后升级 v1.0。**
>
> 上游依据：
> - `memory/strategic-plan-2026.md` v2.0 第二使命「社区共建知识底座」
> - `memory/decisions.md` 2026-04-26 银芯重新定位条目
> - Phase 2 M3 验收要求：「至少 1 种贡献流程跑通 1 轮」

---

## 一、目的与范围

本文件定义**外部贡献者向银芯仓库提交内容**的流程规范。覆盖：

- 谁可以贡献
- 通过什么通道贡献
- 提交后如何审核与合并
- 与既有「直推 main」「Issue 只 author:lightproud」「黑池不倒灌」三条核心政策的相容性

**不覆盖**：AI 会话内部协作（仍按 `CLAUDE.md` 现行政策直推 main）。

---

## 二、贡献者分类

| 类型 | 来源 | 当前政策定位 | 备注 |
|------|------|------|------|
| **C0 守密人 Light** | author=`lightproud` | 唯一 Issue 自动响应授权方 | 现行政策不变 |
| **C1 AI 会话** | Claude Code 主控台 / Code-* | 直推 main，session-end-distill 归档 | 现行政策不变 |
| **C2 Studio 团队成员（内部）** | BIAV Studio 组织内（守密人之外） | **未定义**（v2.0 第三使命隐含但无落地） | 见第七节 Q2 |
| **C3 社区贡献者（外部）** | 任意 GitHub 用户 | **未定义**（v2.0 第二使命要求支持但无机制） | 见第七节 Q1 |
| **C4 黑池侧 AI 会话** | 内网 SVN | **明确禁止**（黑池→银芯关闭） | `silver-blackpool-interface.md` §五 |

---

## 三、贡献通道（提议）

按贡献内容分类设计三条通道。**所有通道默认 fork + PR**（不开放外部直推 main）。

### 3.1 数据补全通道（Wiki characters / wheels / lore）

| 步骤 | 动作 |
|------|------|
| 1 | 贡献者 fork 仓库 |
| 2 | 编辑 `projects/wiki/data/db/*.json` 或对应 markdown |
| 3 | 本地跑 `python projects/wiki/scripts/validate_data.py` 通过 |
| 4 | 提 PR，base=main |
| 5 | `validate-data.yml` workflow 自动校验 schema |
| 6 | 守密人 / 验收方人工 review（数据真实性 + 来源标注） |
| 7 | 合入 main → `deploy-site.yml` 自动部署到 wiki |

**强制要求**：贡献的数据必须标注来源（`source` 字段：`fandom` / `bilibili-wiki` / `gamekee` / `ingame-screenshot` 等）。

### 3.2 翻译贡献通道（zh/en/ja）

与 3.1 同流程，外加：
- 标注 `translation_source: "official" | "community"`（schema v1.0.1 已定义）
- 官方翻译优先级 > 社区翻译
- 社区翻译合并时附 PR 描述说明翻译依据

### 3.3 文档/Issue 通道

| 子通道 | 用途 | 模板 |
|---|---|---|
| **bug-report** | 报告数据错误、链接死链、显示异常 | 待建（`.github/ISSUE_TEMPLATE/bug.yml`） |
| **data-gap** | 报告 wiki 数据缺失（如 X 角色技能未填） | 待建 |
| **discussion** | 一般讨论、提问 | GitHub Discussions（待开启） |

**Issue 不再触发 Claude Code 自动响应**（除 `author=lightproud` 外）——见第七节 Q1 裁决。

---

## 四、审核与合并

### 4.1 自动审核（CI 层）

- `validate-data.yml`：JSON schema 校验
- `deploy-site.yml`：smoke test
- 未来扩展：`check-licenses.yml`（检查贡献内容引用是否合规）

### 4.2 人工审核

- **审核方**：守密人为最终批准方
- **可委托**：Studio 团队指定成员（待守密人指派）
- **审核标准**：(a) 数据真实性可溯源；(b) 不含未发布信息（防黑池倒灌）；(c) 视觉规范合规（`memory/style-guide.md`）

### 4.3 合并政策

- 通过 CI + 人工审核后合并
- 默认 squash-and-merge（保持 main 历史线性）
- AI 会话直推 main 仍然适用——**不通过 PR**（这是 AI 内部协作特权，与外部贡献流程并存）

---

## 五、安全边界

### 5.1 防黑池倒灌（硬约束）

- PR 描述模板必须含勾选项：「☑ 本贡献不包含来自 BIAV 内网/黑池的任何数据」
- 守密人审核时必须主动核查
- 反映到 PR 模板（待建 `.github/PULL_REQUEST_TEMPLATE.md`）

### 5.2 防恶意贡献

- Branch protection rules 已在 main（不可删除）
- 未来扩展：`CODEOWNERS` 文件指定 review 必需者
- 不开启 GitHub Actions secrets 给 PR workflow（fork-PR 不能读 secrets，已是默认行为）

### 5.3 内容版权

- 贡献者通过 PR 即视为同意 MIT License（与项目一致）
- 贡献的游戏图片/数据：仅限**公开可查阅来源**，禁止内部资源
- PR 模板含勾选项确认上述

---

## 六、Phase 2 落地节点

| 里程碑 | 节点 | 产物 |
|---|---|---|
| M1（4-27 → 5-10） | 本草案 v0.1 → v1.0（守密人审定） | `memory/contribution-protocol.md` v1.0 落档 |
| M1 末 | Issue / PR 模板落档 | `.github/ISSUE_TEMPLATE/*.yml` + `PULL_REQUEST_TEMPLATE.md` |
| M2（5-11 → 6-10） | 仓库根目录 `CONTRIBUTING.md` 对外门户 | 链入 site 主站「贡献者入口」 |
| M3（6-11 → 7-10） | **至少 1 轮真实贡献跑通**（验收节点） | 1 个外部 PR 从提交到合并完整经历流程 |
| M4（7-11 → 7-19） | 战略验收 | 三新使命#2 出口标准核验 |

---

## 七、开放问题（守密人裁决，本草案升级 v1.0 必需）

> **以下 5 项必须守密人明确裁决后才能升级 v1.0。每项给出选项 + 艾瑞卡推荐。**

### Q1：Issue 安全策略与社区贡献的冲突

**矛盾**：现行 `claude.yml` 仅响应 `author=lightproud`，但社区贡献者必然以非 lightproud 身份提 Issue。

**选项**：
- (a) Issue 自动响应保持仅 lightproud，社区 Issue 走人工审核（守密人或委托成员）
- (b) 社区 Issue 加 `triage` 标签后人工授权再触发自动响应
- (c) Issue 全部不触发自动响应，仅 PR 触发 CI

**艾瑞卡推荐**：(a)。最简单、不破坏现有安全边界、与 v2.0 第二使命兼容。

### Q2：Studio 团队成员（C2）的贡献路径

**矛盾**：v2.0 第三使命要求「Studio 团队 AI 协作训练场」，但 `silver-blackpool-interface.md` 禁止黑池→银芯。Studio 团队成员若在内部用了黑池数据，他们的银芯贡献身份如何识别？

**选项**：
- (a) C2 与 C3 完全等同（外部贡献者身份），不享受任何特权——靠守密人在审核时 enforce「不带黑池数据」
- (b) C2 享有 trusted reviewer 角色（CODEOWNERS 列入），但贡献内容仍按 C3 流程
- (c) 不区分，全部 C3，问题留待真实场景出现再处理

**艾瑞卡推荐**：(a)。当前 Studio 团队规模不大，无需提前抽象。出现真实诉求再升级。

### Q3：贡献内容的 AI-generated 标注

**矛盾**：贡献者可能用 AI 生成数据/翻译。是否需要在 PR / commit 中标注？

**选项**：
- (a) 强制标注（PR 模板增勾选项「本贡献含 AI 生成内容」）
- (b) 鼓励但不强制
- (c) 不要求

**艾瑞卡推荐**：(b)。强制不可执行（无法验证），完全不要求又不符合「AI 协作训练场」第三使命的透明度精神。

### Q4：Wiki 数据 PR 的 review 阈值

**矛盾**：72 角色 × 多字段，如果每个数据字段更改都需守密人 review，瓶颈在守密人。

**选项**：
- (a) 仅 schema 校验通过即合并（信任贡献者）
- (b) schema + 来源 URL 可访问性自动校验后合并
- (c) 始终守密人最终批准

**艾瑞卡推荐**：(b)。M3 跑顺需要审核成本可控，但纯 schema 校验防伪不足。

### Q5：贡献流程文档的对外站点位置

**矛盾**：CONTRIBUTING.md 放仓库根 vs 放主站 vs 放 wiki 子站，各有取舍。

**选项**：
- (a) 仓库根 CONTRIBUTING.md（GitHub 标准位）
- (b) 仓库根 CONTRIBUTING.md + 主站镜像页面（双入口）
- (c) 仅主站「贡献者入口」页面

**艾瑞卡推荐**：(b)。仓库根是 GitHub 标准，主站镜像服务非技术贡献者。

---

## 八、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-04-26 | 初稿，5 项开放问题待裁决 | 主控台艾瑞卡 opus4.7 |

---

> **本草案是主控台「接口规范」职责的产物，非业务代码。守密人审查后，主控台负责升级到 v1.0；v1.0 落地后的 Issue/PR 模板创建、CONTRIBUTING.md 撰写归 Code-site 派发执行。**
