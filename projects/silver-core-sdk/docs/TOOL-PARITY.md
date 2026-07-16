# Tool parity ledger

Why this file exists: the SDK reproduces the **Claude Code CLI agent** tool
surface. Twice a tool that official Claude Code has went unshipped for no real
reason — just a coverage gap in the community system-prompt reconstruction the
SDK cross-references (`Public-Info-Pool/Reference/Claude-Code-System-Prompts/`):
**MultiEdit** (added 2026-07-15) and **EnterPlanMode** (added 2026-07-15). The
root cause was that nothing enumerated "official CLI tools × shipped? × why
not" in one place, so a miss had no backstop.

This ledger is that backstop. `tests/tool-parity.test.ts` pins the shipped
default-builtin set to the **Shipped** table below: adding or removing a tool
reds the test until this file is updated, forcing a conscious decision and a
line here.

Scope note: the reconstruction archive is **multi-product** (claude.ai web,
Cowork, Claude-in-Chrome, computer-use, remote/scheduling). Only Claude Code
**CLI agent** tools belong here; other products' tools are listed under
"Out of scope" so they are not re-flagged as gaps.

---

## Shipped (default built-ins)

Registered by `createBuiltinTools` (`src/tools/index.ts`).

| Tool | Source | Notes |
|------|--------|-------|
| Read | `read.ts` | |
| Write | `write.ts` | |
| Edit | `edit.ts` | |
| MultiEdit | `multiedit.ts` | added 2026-07-15 (was a gap); atomic same-file batch |
| Bash / BashOutput / KillShell | `bash.ts` / `shells.ts` | |
| Glob | `glob.ts` | |
| Grep | `grep.ts` | |
| Read/ListMcpResourcesTool | `resources.ts` | |
| ReadMcpResourceTool | `resources.ts` | |
| ReadMcpResourceDirTool | `resources.ts` | added 2026-07-15 (was a gap); `resources/directory/read` |
| EnterPlanMode | `enterplanmode.ts` | added 2026-07-15 (was a gap); mirror of ExitPlanMode |
| ExitPlanMode | `exitplanmode.ts` | |
| EnterWorktree | `enterworktree.ts` | |
| Monitor | `monitor.ts` | poll model (no event push) |
| WebFetch | `webfetch.ts` | |
| WebSearch | `websearch.ts` | |
| AskUserQuestion | `askuserquestion.ts` | host answers via `onUserQuestion` |
| TaskCreate / TaskGet / TaskUpdate / TaskList | `tasks` | (TodoWrite legacy, behind `CLAUDE_CODE_ENABLE_TASKS=0`) |
| TaskOutput / TaskStop | `shells.ts` | background-task read/stop |
| TodoWrite | legacy | only when `CLAUDE_CODE_ENABLE_TASKS=0` |
| Workflow | `workflow.ts` | |
| SendMessage | subagent bridge | continue/stop a spawned subagent |

## Shipped (conditional / deferred — not in `createBuiltinTools`)

| Tool | Source | How it registers |
|------|--------|------------------|
| Agent (alias Task) | `subagents/agent-tool.ts` | conditionally registered in `query.ts` |
| ToolSearch | `tools/toolsearch.ts` | deferred-builtin mechanism |

## Deliberately excluded (documented, NOT gaps)

| Tool | Why not shipped |
|------|-----------------|
| NotebookEdit / NotebookRead | need a Jupyter subsystem the SDK has no counterpart for |
| PowerShell | Windows-shell variant of Bash; out of scope |
| ExitWorktree | references worktree machinery this SDK does not ship (EnterWorktree adapts around it) |
| SlashCommand | host routing concern — the command arrives as a user message; engine must not advertise a command it would swallow |
| Skill / invoke-skill | the SDK has no skill subsystem (see CONTEXT.md) |
| **LSP** | needs a full Language-Server-Protocol subsystem (per-filetype servers) the SDK has no counterpart for — same class as NotebookEdit. Confirmed a real CLI tool, deliberately deferred as a subsystem, not a one-file tool. Archive: `tool-description-lsp.md`. |

## Open assessment (host-facing; revisit as the host layer grows)

These are real Claude Code surfaces but lean **host responsibility** — the
headless engine has no delivery channel today. As the consuming host (BPT)
builds these channels, each could become a host-capability-gated tool surface
in the SDK (the pattern already used for `askUser` / `mcpResources`: the SDK
ships the tool, the host wires the capability, absent capability → graceful
"not configured" error).

| Tool | Archive | Assessment |
|------|---------|------------|
| SendUserFile | `tool-description-senduserfile.md` | Pushes a deliverable file to the user (incl. "reach their phone"). Needs a host file-delivery capability. Candidate for a capability-gated surface once the host exposes the channel. |
| ListAgents | `tool-description-listagents.md` | Lists agents reachable via SendMessage — mostly cross-session / cloud / remote-bridge infra the SDK deliberately does not do (no teammate mode). Revisit only if the host adds that fabric. |

## Out of scope (other products, NOT Claude Code CLI)

Not SDK gaps — belong to other Claude surfaces:
claude.ai web / Cowork (Artifact, ClaudeDesign, DesignSync, onboarding role
picker, plugin/skill marketplace: ListConnectors, SuggestConnectors,
SearchMcpRegistry, SearchPlugins, SearchSkills), Claude-in-Chrome (browser*,
chrome*), computer-use (computer*, mouse/key/zoom), remote/scheduling
(CronCreate, ScheduleWakeup, Snooze, RemoteTrigger, PushNotification),
host session control (EndConversation, SendUserMessage), code-review command
host tools (ReportFindings), REPL (an alternative JS-orchestration execution
paradigm, not a standard terminal-agent tool).
