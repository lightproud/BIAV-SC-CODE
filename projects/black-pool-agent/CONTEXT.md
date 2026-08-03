# Black Pool Agent — 会话上下文

> **定位（守密人 2026-08-02 换轨裁定 + 同日施工边界文书）**：使命#2「通用 AI 底层能力开发基地」
> **现行核心载体**——BPT v2 引擎层 = **Hermes**（[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)，
> MIT）。本子项目是其**公开扩展层**（沿 testbed 先例：workspace 不发布、锁步豁免）。
>
> **施工边界唯一权威** = 收敛文书原文归档
> `Public-Info-Pool/Resource/repo-engineering/bpt-hermes-charter-20260802.md`
> （15 条裁定 + 仓库拓扑 + 架构落位 + 禁止事项十条 + 验证起手式；动手前必读，
> 与本档冲突时以文书为准）。决策链见 `memory/decisions.md` 2026-08-02 两条。

## 铁律（文书裁定，机械守卫 `tests/test_hermes_charter.py`）

1. **核心零侵入**：一切能力走官方扩展面（plugins entry points / `skills.external_dirs` /
   MCP `mcp_servers:` / shell 事件钩子 / profile routing），不 fork 核心。`patches/` 为
   **白名单制**（2026-08-02 需求 #1 起启用：品牌换装补丁经守密人裁定入册，守卫钉
   白名单 + 干净应用 + LICENSE/版权零触碰三线；补丁不手写、由 `build/rebrand.py`
   规则引擎生成，`upstream/` 本体始终零修改、补丁只在部署组装期应用）；扩展点不够、
   被迫想碰核心 = **即停、记录 `gaps.md`、不硬闯**。
2. **§1.1-HC 切面化红线**：代码公开、配置内网——本子项目内**不得出现凭据、内网地址/路径、
   公司域信息**；插件一律通用化写法，通用化三问不过者归黑池域代码区并在 gaps.md 留
   「通用化未遂」记录（文书裁 15）。
3. **MIT 合规**：`upstream/LICENSE` 随快照保留；对外口径「基于 MIT 开源组件二次开发」，
   **禁止「100% 纯自研」表述**（文书裁 10）。
4. **银芯→黑池单向输出**：与 §1.1-HC 防火墙同向，黑池数据与需求原始材料不回流
   （归因回流 = 需求非数据）。

## 结构（文书 §2.2 + 守密人拓扑澄清）

```
plugins/    # 通用化域插件（零公司信息）        skills/   # 通用技能样例（团队技能实体在内网）
deploy/     # 通用部署/overlay 脚本（参数化）    patches/  # 预留，当前必须为空（守卫钉死）
gaps.md     # 漏缝清单（一等产出）              upstream/ # 官方源码快照（银芯开发镜像，见下）
UPSTREAM.md # pin 台账唯一权威
```

- **upstream/ 定位（守密人 2026-08-02 交互澄清）**：保留在银芯仓，供**开发、测试、追官方新版**
  ——即文书 §2.4 升级链条「外网机追官方 tag 先行体验」一环。黑池侧另有 SVN vendor 仓作
  **生产供应链**（整包零修改 + 离线可重建），两者并存各司其职。生产禁用 `hermes update`。
- 记忆纯个人 / 知识纯团队（黑池域，MCP + 只读挂载 + skills 主通道，**禁止**做成 memory
  provider 主通道）/ 仅技能分个人·团队两档——分层定则见文书裁 6 与 §3。

## 当前状态：骨架就绪，起手式属黑池侧（守密人 2026-08-02 裁定，T79 已销）

文书 §6 验证起手式**整体转性为给黑池侧的建议**，银芯不追踪执行（T79 销案，见
`memory/todo.md` 已清节）。银芯侧现状与姿势：
- **骨架已建**（2026-08-02）：本档 + §2.2 目录 + gaps.md + patches 空守卫在岗。
- **按需供材料**：黑池侧（含守密人）取用文书与本档指引，或点名派发（如对照清单盘点 /
  idealab 配置模板），届时按新任务另计。插件开发前先读 `upstream/AGENTS.md`
  （75,293 字节官方施工指南，已核实在快照内）。
- **常态职责**：upstream/ 追官方新版（`UPSTREAM.md` 例程）+ gaps.md 值守 + 红线守卫。

## 验证清单

- **上游套件容器内可全量复现**（2026-08-02 首跑实证：2,471 文件 / 22,766 过 / 40 环境伪影零真缺陷，
  报告 `Public-Info-Pool/Resource/repo-engineering/hermes-upstream-testrun-20260802.md`）。口径：
  uv **0.9.28**（上游钉版，容器自带 0.8.17 读不懂其 lockfile）→ `uv sync --locked --python 3.11
  --extra all --extra dev --extra anthropic --extra mistral --extra fal --extra modal --extra daytona
  --extra hindsight --extra parallel-web`（venv/缓存经 `UV_PROJECT_ENVIRONMENT`/`UV_CACHE_DIR`
  落仓外）→ `OPENROUTER_API_KEY="" OPENAI_API_KEY="" scripts/run_tests.sh -j 4`。
  已知假红排除集见报告（自更新家族 22 例为快照布局结构假红）；树内跑完测试须清生成物
  （`UPSTREAM.md` 例程步 2）
- 红线守卫：`pytest tests/test_hermes_charter.py -v`（patches 空 + 骨架完整）
- 改档后跑 `pytest tests/test_claude_md*.py -v`（CLAUDE.md 对账三卫）确认指针一致
