# BPT-NEXT 构建与诊断验证报告

> **状态：已封存（2026-04-19）**
> 封存原因：2026-04-19 战略转向——BPT 战线不再在银芯内部开发，`projects/bpt-next/` 已从仓库删除。本文档作为历史验证审计材料保留。
>
> ---
>
> 最后更新：2026-04-14 by Code-主控台（艾瑞卡会话）
> 执行环境：银芯容器（Linux x86_64 / Claude Code on the web）
> 分支：`claude/bpt-next-bootstrap-Q41x3`

## 环境指纹

| 项 | 版本 |
|----|------|
| cargo | 1.94.1 (29ea6fb6a 2026-03-24) |
| rustc | 1.94.1 (e408947bf 2026-03-25) |
| gcc | 13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1) |
| OS | Linux runsc 4.4.0 x86_64 |

## 构建结果

```
cd projects/bpt-next/rust
cargo build --workspace
```

- **结果**：exit code 0，成功
- **耗时**：51.71 秒（容器内 cargo 缓存命中，远快于预估 10-20 分钟）
- **产物**：`target/debug/claw`，148 MB（debug + debuginfo）
- **9 crate 全部编译通过**：api / commands / compat-harness / mock-anthropic-service / plugins / runtime / rusty-claude-cli / telemetry / tools

## 版本信息

```
Claw Code
  Version          0.1.0
  Git SHA          e46f0c9        # 来自 BIAV commit（claw 构建时读 git rev-parse HEAD）
  Target           x86_64-unknown-linux-gnu
  Build date       2026-04-14
```

## 诊断快照

### `claw doctor`

```
Summary
  OK               5
  Warnings         1
  Failures         0

Auth           warn   no supported auth env vars were found
Config         ok     no config files present; defaults are active
Install source ok     official source of truth is ultraworkers/claw-code
Workspace      ok     project root detected on branch claude/bpt-next-bootstrap-Q41x3
Sandbox        ok     sandbox protections are active (workspace-only, no net)
System         ok     OS linux x86_64, version 0.1.0
```

唯一警告为预期（未设 API key）。其他 5 项全绿。

### `claw status`

```
Model             claude-opus-4-6          # 默认模型
Permission mode   danger-full-access       # ⚠️ 默认模式激进，建议守密人改为 workspace-write
Messages          0
Workspace Cwd     projects/bpt-next/rust
Project root      /home/user/brain-in-a-vat
Git branch        claude/bpt-next-bootstrap-Q41x3
Config files      loaded 0/5
Memory files      1                        # BIAV 的 CLAUDE.md
Session           live-repl
```

### `claw sandbox`

```
Enabled           true
Active            true
Filesystem mode   workspace-only
Network           not requested / not active
```

claw 启动即进入沙箱：只能访问 workspace 目录，默认无网络。

### `claw skills`

**关键发现：claw 的 skill 发现机制与 Claude Code 兼容，自动识别 BIAV skill。**

```
4 available skills:

Project roots:
  daily-news · legacy /commands            ← BIAV 自带
  sync-memory · legacy /commands           ← BIAV 自带
  validate-data · legacy /commands         ← BIAV 自带

User home roots:
  startup-hook-skill · ...                 ← Claude Code 系统 skill
```

这意味着：
- 未来 BIAV 的 `/commands/*.md` 自定义命令可直接被 claw 调用
- skill 层可以跨 Claude Code 与 claw 通用
- 银芯 MCP 服务器（`scripts/mcp_server.py`）可通过 claw 的 MCP 传输接入

### `claw mcp` / `claw agents`

- MCP：0 configured（尚未配置银芯 MCP）
- Agents：无自定义 agents

## 未完成的验证

### E2E 网络调用（通过 mock-anthropic-service）

尝试启动 `mock-anthropic-service --bind 127.0.0.1:18099` 并让 claw 发 prompt，但由于容器 sandbox 网络限制，claw 进程挂起未收到响应。`curl` 直连 mock service 也无回应。

**原因**：banyan 容器内 sandbox 默认无 localhost 网络可用（与 `claw sandbox` 显示 "Network: not requested / not active" 一致）。

**影响**：不影响构建与核心功能验证。守密人在本地 Windows/macOS 环境应可正常跑通 E2E。

## 许可证状态的重要修正

艾瑞卡初始 NOTICE 基于"根目录无 LICENSE 文件 = All Rights Reserved"做悲观评估。构建阶段核验发现：

- `rust/Cargo.toml` 工作区显式声明 `license = "MIT"`
- 9 个 crate 全部通过 `license.workspace = true` 继承
- `rust/README.md` 有 `## License` 节

**Rust 生态共识**：Cargo.toml 的 `license` SPDX 字段是法律上认可的授权声明，crates.io / cargo-about / cargo-deny 全部依赖此字段。许多大型 Rust 项目只在 Cargo.toml 声明而不放 LICENSE 文件。

**结论修正**：
- 主运行时（`claw` CLI 所属的 rust/）= **MIT 授权，可合法使用**
- src/（Python 镜像）= 上游 README 已明确"非主运行时"，但无独立 LICENSE 声明；谨慎对待
- 整体风险等级从**致命**下调为**低**

NOTICE 文件已同步修正，含完整证据链。

## 下一步建议

1. **守密人本地验证**（可选）：
   - Windows：先装 Rust（`winget install Rustlang.Rustup`），再 `cargo build`
   - 本地不受 sandbox 限制，可完整跑 E2E mock parity harness
2. **调整默认权限模式**：`danger-full-access` 太激进，建议在 `~/.claw.json` 或 `projects/bpt-next/.claw/settings.json` 设 `{"permissions": {"defaultMode": "workspace-write"}}`
3. **接入银芯 MCP**：`projects/bpt-next/.claw/settings.json` 加：
   ```json
   {
     "mcpServers": {
       "silver-core": {
         "command": "python",
         "args": ["../../scripts/mcp_server.py"]
       }
     }
   }
   ```
   即可把银芯 11 工具挂入 claw 的工具链
4. **向上游提 Issue**：友好建议 `instructkr/claw-code` 在根目录加 LICENSE 文件，让 MIT 声明对非 Rust 背景观察者也显而易见
5. **BPT 族收敛策略**：仍暂缓，等守密人本地实际使用 claw 一段时间后再决定

## 产物清单

- `rust/target/debug/claw` — 主 CLI 二进制（148M，本地构建产物，不入仓库）
- `rust/target/debug/mock-anthropic-service` — 确定性 mock 测试服务（79M，本地构建产物）
- `rust/target/debug/deps/` — 依赖目标（大量，本地构建产物）
- 总 `target/` 目录体积：需检查（预计 3-5 GB）

**注意**：`target/` 已在 claw 的 `.gitignore` 里，不会被提交。
