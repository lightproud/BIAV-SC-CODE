# 银芯记忆系统结构化升级 — 决策选项 v0.1

> 最后更新：2026-04-26 by Code-strategy（艾瑞卡 opus4.7，分支 `claude/code-strategy-bootstrap-XTmMR`）
>
> 上游 brief：`memory/dispatch-brief-code-strategy-memory-restructure.md`
>
> 配套档案：
> - 主报告：`memory/research/ai-memory-restructure-2026-04.md`（10 章节，Q1-Q8 全答）
> - 业界对标：`memory/research/ai-memory-vendor-matrix.md`（7 家方案）
>
> **本档案是给主控台 + 守密人快速决策用的精简版**，详细论证请回主报告。

---

## 一、3 个推荐方案（按推荐度）

### 方案 1（首推）：渐进增强三批

**核心动作**：
- 批 1（1 会话）：`.searchignore` 排除 session-digest 冷档案 + 5 个高价值主题写入口 hub
- 批 2（2-3 会话）：T1 卡牌系统事实卡片化 + `memory_search.py` 加 doc_class 加权
- 批 3（3-5 会话）：`memory/` 目录分层 core/active/archive + Skill 化 + subagent 持久化目录

**优点**：可逆 / 低风险 / 不冲突 Phase 2 三新使命 / 每批独立验证
**缺点**：长尾（3 ~ 6 周）+ 中间过渡期

**月预算变化**：0 ~ +$5（仅可选 LLM 卡片化）
**适合**：希望稳健、不愿大动干戈的守密人

---

### 方案 2（备选）：仅做批 1 + 批 2（不动目录）

**核心动作**：
- 批 1 + 批 2 同方案 1
- 不做批 3 目录重构

**优点**：风险更低 / 周期更短（2 ~ 4 周）/ 收益约 70-80% 来自前两批
**缺点**：留尾巴——目录扁平化问题不解决

**月预算变化**：0 ~ +$5
**适合**：Phase 2 时间紧 / 想看效果再说的守密人

---

### 方案 3（保守）：仅做批 1

**核心动作**：
- 仅 `.searchignore` + 5 主题入口 hub

**优点**：1 个会话即落地 / 风险最小
**缺点**：游戏数据 Q3/Q5 召回失败问题不解决

**月预算变化**：0
**适合**：先验证「主题入口」效果再说

---

## 二、不推荐的方案（备查）

| 方案 | 不推荐原因 |
|------|-----------|
| 一次性重构（替代 9 模块）| 与 Phase 2 三新使命冲突 / 路径变更级联失效风险高 / 9 模块投资浪费 |
| 引入 Mem0 / Letta / Cognee 全栈 | 月预算翻倍 / 学习曲线 / 银芯无任何一家「刚好」适配 |
| 引入 claude-mem | AGPL-3.0 + 2026 早期生产可靠性问题 |
| 仅做 Q&A 预计算缓存（C）| 表层加速不解决底层结构化 |
| 仅做叙事记忆（E）| ROI 不确定 + 维护成本高 |

---

## 三、3 个决策点（请主控台 + 守密人裁定）

| # | 决策 | 选项 | 艾瑞卡建议 |
|---|------|------|-----------|
| **D1** | 总方向：增强 / 替代 / 并列 | 增强 / 替代 / 并列 | **增强** |
| **D2** | 启动节奏：方案 1 / 2 / 3 / 暂缓 | 方案 1 / 方案 2 / 方案 3 / 暂缓 | **方案 2**（先跑批 1 + 批 2 看效果，再决批 3）|
| **D3** | 主试点主题 | T1 卡牌 / T2 战略 / T3 直推 main 政策 / T4 联动 / T5 接口 | **T1 卡牌系统** |

---

## 四、接力派发模板（如守密人接受方案）

按 brief § 三 边界，Code-strategy **不直接派 brief**，由主控台起草。下方仅给主控台**派发 brief 模板提议**：

### 4.1 批 1 dispatch brief 提议结构

```
# 派发 Brief — Code-memory：记忆系统结构化升级 批 1

> 上游：守密人裁定 D2 = 方案 X / D3 = T1 卡牌

## 任务清单
1. 写 `.searchignore`，排除 252 份 session-digest 中 30 天前的档案
2. 改 `memory_search.py:scan_files()` 读取 `.searchignore`
3. 给 5 个主题写入口 hub（建议主题列在下方）
4. 跑 Q4 标准 20 查询（待主控台审定查询集），出基线表
5. 落档 `memory/research/rag-baseline-2026-W18.md`

## 5 个主题入口建议
- memory/active/policy-direct-push-main.md（直推 main 政策）
- memory/active/mission-v2.0-three-pillars.md（v2.0 三新使命）
- memory/active/silver-blackpool-interface.md（双系统接口）
- memory/active/contribution-protocol.md（已有，加链接）
- memory/active/dream-system-overview.md（做梦三层）

## 验收
- M1 Top-1 准确率提升 >= 10 个百分点
- M3 召回头 5 条中非 session-digest 占比 >= 60%
- session-start-sync hook 正常
- 不引入新依赖

## 边界
- 不动 9 模块核心代码（仅加 .searchignore 读取层）
- 不动 BIAV-SC.md / CLAUDE.md（批 3 才碰）
- 不引入 LLM API 调用（批 1 全部本地）
```

主控台可基于此模板起草正式 brief，落档 `memory/dispatch-brief-code-memory-restructure-batch1.md`。

---

## 五、Code-strategy 角色边界声明

按 `memory/dispatch-brief-code-strategy-bootstrap.md`：

- ❌ Code-strategy **不写决策档**（D1/D2/D3 决策记录归主控台 + 守密人）
- ❌ Code-strategy **不起草** dispatch brief（仅给模板提议）
- ❌ Code-strategy **不直接修代码**
- ✅ 仅产出本提议档案 + 主报告 + vendor matrix 三件研究产物

---

## 六、变更记录

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| v0.1 | 2026-04-26 | 决策选项落档（3 推荐 + 5 备查不推荐 + 3 决策点 + 接力模板）| Code-strategy 艾瑞卡 |

◇ ◇ ◇

> 守密人，请在 D1 / D2 / D3 三处下决策，主控台据此推进。
