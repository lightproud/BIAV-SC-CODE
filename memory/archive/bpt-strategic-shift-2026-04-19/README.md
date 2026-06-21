# BPT 战略转向归档（2026-04-19）

> 归档日期：2026-04-26 by 艾瑞卡会话
>
> **⚠ 定格快照（勿当现行）**：本目录所有文件是 2026-04-19 BPT 战线删除前的设计快照。
> 文中一切 `projects/bpt-*` / `scripts/*` / `memory/*` 路径引用均为**当时仓库状态**，
> 其中 BPT 战线、自造记忆子系统（dream / memory_search / knowledge_graph 等）、多会话
> Code-* 时代档案均已于 2026-06 退役删除——这些引用一律按历史快照理解，不指向现行文件。

## 背景

2026-04-19 守密人决策：BPT（黑池终端）整条战线**从银芯仓库删除**，不再在银芯内部开发。银芯转为 BPT 的指导者，采用「人工对话搬运」协议（守密人从对话中学习概念，不做 harness 自动化）。

详见：
- `memory/decisions.md` 2026-04-19 条目
- `memory/bpt-guidance-protocol.md`（**仍在 active memory，未归档**——是当前指导 BPT 的活协议）

## 本目录文件

以下 7 个文件是 2026-04-19 战略转向**之前**积累的 BPT 设计/架构文档。删除战线后这些文件失去执行价值，但保留作历史参考与黑池仓库（内网）潜在复用素材：

| 文件 | 大小 | 主题 |
|------|------|------|
| `bpt-master-plan.md` | 26 KB | BPT 总规划（多轮迭代版本） |
| `bpt-next-design.md` | 15 KB | bpt-next 架构设计 |
| `bpt-next-build-verification.md` | 6.5 KB | bpt-next 构建验证记录 |
| `bpt-desktop-design-spec-ref.md` | 4 KB | bpt-desktop 设计规范引用 |
| `blackpool-architecture.md` | 16 KB | 黑池系统架构设计 |
| `black-pool-design.md` | 9.5 KB | 黑池设计原始稿 |
| `silver-blackpool-interface.md` | 5.5 KB | 银芯-黑池接口规范 |

## 使用建议

- **新会话**：默认**不读**本目录文件。BPT 当前指导见 `memory/bpt-guidance-protocol.md`
- **黑池内网仓库**（BIAV-BP）：可参考本目录文件作为 BPT 历史设计输入
- **不要修改**：本目录文件已冻结，如需更新方案请在 active memory/ 新建文件

## 为什么不直接删

1. 决策档案（`decisions.md`）仍引用这些设计文档
2. 黑池仓库的工程师可能需要参考历史设计
3. lessons-learned #29 强调「档案保留比删除更安全」
4. git 历史虽然能查到，但 active 仓库结构清晰更重要
