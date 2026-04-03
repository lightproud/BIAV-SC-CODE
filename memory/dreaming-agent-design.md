# 做梦 Agent 架构设计

> 创建：2026-04-02 by Code-主控台
> 状态：已确认，已实现

## 设计原则

**可移植性优先**：所有配置、prompt、调度逻辑全部存在 git 仓库内（`.github/workflows/dream.yml`）。不依赖任何外部平台的云端状态（如 `/schedule`）。换任何 AI 工具、fork 到其他项目，做梦系统都完整可用。

## 对标系统
- **Claude Code AutoDream** — 空闲时自动整理 memory（直接对标）
- **Voyager (NVIDIA)** — 自主探索积累可检索技能库 → 我们的 insights.json
- **Reflexion** — 失败后自我反思写入记忆 → 自动写入 lessons-learned
- **Sleep-Time Compute (Berkeley)** — 空闲预计算降低实时成本 → 提前备好每日简报
- **Sleepless Agent** — 24/7 自主运行，70% 零人工干预 → 小修复自主做

## 三层做梦架构

### 浅睡（Shallow Sleep）— 每 3 小时
- **实现**：`dream.yml` → `shallow-sleep` job（纯 shell + GitHub Actions，零 token 成本）
- **职责**：感知异常
  - 数据采集是否空跑/文件缺失
  - Workflow 是否失败/停滞
  - CLAUDE.md 引用路径是否断裂
  - Memory 文件是否超过 14 天未更新
- **产出**：异常时开 Issue（标签 `dream`），正常时无输出
- **替代**：原 health-check.yml + sync-memory.yml

### 深睡（Deep Sleep）— 每天 22:00 UTC
- **实现**：`dream.yml` → `deep-sleep` job（claude-code-action）
- **职责**：每日整理
  - 7 天日报趋势分析（平台活跃度、好评率、关键词）
  - Memory 一致性检查 + 自动修正时间戳
  - 知识缺口识别（采访 vs 数据库 diff）
- **产出**：`memory/dreams/YYYY-MM-DD.md` + `insights.json` 追加

### REM — 每周一 21:00 UTC
- **实现**：`dream.yml` → `rem-sleep` job（claude-code-action）
- **职责**：周度深度反思
  - 一周 commit 回顾和子项目活跃度分析
  - 经验提炼 → 自动追加 lessons-learned.md
  - project-status.md 自动同步
  - pending-discussions.md 清理
  - 跨天洞察整合
  - 下周工作建议
- **产出**：`memory/dreams/YYYY-WNN-weekly.md` + memory 更新

## 自主行动边界

| 发现类型 | 自主处理 | 只记录 |
|---------|---------|--------|
| 路径引用断裂 | ✅ 直接修 | |
| Memory 时间戳过期 | ✅ 直接更新 | |
| 已完成的 pending 条目 | ✅ 标记完成 | |
| 数据校验失败 | ✅ 开 Issue | |
| Workflow 失败 | ✅ 开 Issue | |
| 好评率趋势变化 | | ✅ dreams/ |
| 知识缺口 | | ✅ insights.json |
| 架构改进建议 | | ✅ 周报 |

**原则**：可逆的小修复自主做，不可逆的判断只记录。与 CLAUDE.md "经验自行记、决策请示制作人"一致。

## 洞察库（insights.json）

类似 Voyager 的技能库，做梦 agent 的发现以结构化方式积累，供其他会话检索。

```json
{
  "id": "insight-2026-04-02-001",
  "type": "trend|gap|anomaly|pattern",
  "summary": "描述",
  "evidence": ["source_file_1", "source_file_2"],
  "suggested_action": "建议",
  "auto_actionable": false
}
```

## Token 成本估算

| 层 | 频率 | 预估 token/次 | 月成本 |
|----|------|-------------|--------|
| 浅睡 | 8次/天 | 0 | $0 |
| 深睡 | 1次/天 | ~5K output | ~$5 |
| REM | 1次/周 | ~10K output | ~$2 |
| **合计** | | | **~$7/月** |
