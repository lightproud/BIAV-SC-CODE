#!/usr/bin/env python3
"""
boot_snapshot.py — 银芯启动快照生成器

生成 memory/boot-snapshot.md，新 AI 会话只读此文件即可快速就绪。
由做梦系统浅睡阶段每 6 小时自动更新。

Usage:
    python scripts/boot_snapshot.py
"""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_PATH = ROOT / "memory" / "boot-snapshot.md"


def read_file(path: str, fallback: str = "") -> str:
    """Read file content, return fallback if not found."""
    p = ROOT / path
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return fallback


def get_latest_dream() -> str:
    """Get the most recent dream journal entry."""
    dreams_dir = ROOT / "memory" / "dreams"
    if not dreams_dir.exists():
        return "No dream journals found."

    journals = sorted(dreams_dir.glob("2*.json"), reverse=True)
    if not journals:
        return "No dream journals found."

    latest = journals[0]
    try:
        data = json.loads(latest.read_text(encoding="utf-8"))
        date = latest.stem
        lines = [f"Latest dream: {date}"]

        if isinstance(data, dict):
            if "alerts" in data:
                alerts = data["alerts"]
                if alerts:
                    lines.append(f"  Alerts: {len(alerts)} active")
                else:
                    lines.append("  Alerts: none")
            if "insights" in data:
                for insight in data["insights"][:3]:
                    if isinstance(insight, str):
                        lines.append(f"  - {insight[:80]}")
                    elif isinstance(insight, dict) and "content" in insight:
                        lines.append(f"  - {insight['content'][:80]}")

        return "\n".join(lines)
    except Exception:
        return f"Latest dream: {latest.stem} (parse error)"


def get_daily_report_summary() -> str:
    """Daily-report pipeline removed 2026-05-03. No-op stub kept so legacy
    callers continue to work; long-window community analysis should now use
    data/platforms/{source}/{date}.json archive layer directly."""
    return ""


def get_workflow_health() -> str:
    """Summarize workflow health based on recent outputs."""
    checks = {
        "news aggregator": (ROOT / "projects/news/output/news.json").exists(),
        "discord archive": (ROOT / "projects/news/data/discord/state.json").exists(),
        "dream journals": any((ROOT / "memory/dreams").glob("2*.json")) if (ROOT / "memory/dreams").exists() else False,
        "wiki data": (ROOT / "projects/wiki/data/processed/characters.json").exists(),
    }

    lines = []
    for name, ok in checks.items():
        lines.append(f"{'OK' if ok else 'MISSING'}: {name}")
    return "\n".join(lines)


def generate_snapshot() -> str:
    """Generate the full boot snapshot."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    snapshot = f"""# 银芯启动快照 / BIAV-SC Boot Snapshot

> 最后更新：{now[:10]} by boot_snapshot.py (auto-generated)
> 新会话读完此文件即可就绪，无需逐个加载 memory 文件。
> 完整定义见 `BIAV-SC.md`，本文件是压缩启动包。

---

## 身份

你是 **BIAV-SC（银芯）** 系统的 AI，服务于 B.I.A.V. Studio 的忘却前夜（Morimens）项目。
制作人：Light。始终使用中文。

## 当前阶段

**Phase 1（记忆宫殿）已验证 → Phase 2（内容权威）进行中**

三条主线：
1. 事实圣经 — 72 角色（含皮肤/联动/彩蛋）+ 叙事结构 + 设计决策 
2. 自动情报循环 — 日报 3 源 + 哨兵 + 做梦三层 
3. 权威知识站点 — Phase 2 W1 自举完成 24 角色（含完整技能/命轮），剩余 48 角色待批量自举

阻塞项：YouTube/Twitter/NGA/TapTap API 未配（不阻塞核心）

## 协作铁律

- **直接推 main**（2026-04-26 PR #141 落地）— 不用 feature 分支，冲突时 `git pull --rebase` 重试
- SessionStart hook 自动同步 local main 与 origin/main，防止漂移堵塞推送
- 凭据绝不写入仓库；架构决策先向制作人提议，等确认再执行
- 详见 `memory/decisions.md`（2026-03-29 / 2026-04-26 条目）+ `memory/lessons-learned.md` #28 #29

## 管线健康

{get_workflow_health()}

## 最新社区情报

{get_daily_report_summary()}

## 做梦系统

{get_latest_dream()}

## 记忆系统 9 模块

| 模块 | 状态 |
|------|------|
| TF-IDF 搜索 | `scripts/memory_search.py` — 780 行 |
| 知识图谱 | `scripts/knowledge_graph.py` — 217 节点 443 边 |
| MemRL-lite | `scripts/memrl.py` — EMA 效用评分 |
| Sleep-Time Compute | `scripts/dream.py` — 预计算缓存 |
| 哨兵层 | `scripts/dream.py` — 异常检测（零成本） |
| MCP Server | `scripts/mcp_server.py` — 7 工具 |
| 上下文管理 | `scripts/context_manager.py` — 4 层推荐 |
| Reflexion | `scripts/reflexion.py` — 失败模式学习 |
| 选择性记忆 | `scripts/dream.py` — 膨胀检测 |

## Workflow 频率

| Workflow | 频率 | 状态 |
|----------|------|------|
| update-news | 每日 2 次 | Running |
| discord-archive | 每日 1 次 | Running |
| dream 浅睡 | 每 6 小时 | Running |
| dream 深睡 | 每日 19:00 UTC | Running |
| dream REM | 每周一 01:00 UTC | Running |
| deploy-site | push 触发 | Running |
| claude.yml | Issue 触发 | Available |

## 子项目速查

| 子项目 | 位置 | 状态 |
|--------|------|------|
| 主站 | `projects/site/` | 维护模式 |
| 新闻聚合 | `projects/news/` | 运行中 |
| Wiki | `projects/wiki/` | 数据补全中 |
| 衍生游戏 | `projects/game/` | 暂缓 |

> BPT 战线已于 2026-04-19 战略转向中从银芯仓库删除，银芯转为 BPT 指导者（协议见 `memory/bpt-guidance-protocol.md`）。

## 按需加载索引

需要更多细节时再读以下文件：
- 项目详细状态 → `memory/project-status.md`
- 战略评估 → `memory/strategic-assessment.md`
- 游戏世界观 → `memory/morimens-context.md`
- 角色数据库 → `projects/wiki/data/processed/characters.json`（解包真实数据 72 唤醒体）
- 最新社区数据 → `projects/news/output/all-latest.json`（输出层选样）+ `projects/news/data/platforms/`（archive 全量）
- 全平台数据 → `projects/news/output/all-latest.json`
- 设计决策 → `assets/data/design-decisions.json`
- 制作人采访 → `assets/data/interview-2026-04.json`

## 协作规则（精简）

- 所有会话直接推 main
- 修改 memory/ 文件时更新头部时间戳
- 凭据绝不写入仓库
- 架构决策先向制作人提出选项
- 只响应 author:lightproud 的 Issue
"""
    return snapshot.strip()


def main():
    snapshot = generate_snapshot()
    SNAPSHOT_PATH.write_text(snapshot + "\n", encoding="utf-8")
    print(f"Boot snapshot generated: {SNAPSHOT_PATH}")
    print(f"Size: {len(snapshot)} chars ({len(snapshot.split(chr(10)))} lines)")


if __name__ == "__main__":
    main()
