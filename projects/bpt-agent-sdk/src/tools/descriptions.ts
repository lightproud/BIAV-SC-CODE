/**
 * Tool descriptions for the BPT Agent SDK.
 *
 * i18n-zh CAMPAIGN IN PROGRESS (keeper ruling B, 2026-07-08): the built-in
 * tool descriptions are being TRANSLATED TO CHINESE IN-PLACE and shipped on the
 * wire — a DELIBERATE divergence from the official English surface (see
 * docs/COMPAT.md; the keeper accepted that this breaks the faithful-reproduction
 * axis and its provenance guard). Done: batch 1 (Read/Edit/Write/Grep/Glob) +
 * batch 2 (Task-tools/TodoWrite/WebFetch/WebSearch/AskUserQuestion/ExitPlanMode/
 * EnterWorktree) + batch 3 (Monitor) + batch 4 (Workflow). Still English: Bash
 * (+ git protocol + sandbox fragments) — a later, safety-critical batch.
 * Translated tools are
 * removed from TOOL_DESCRIPTION_PROVENANCE (the English corpus-sync guard) and
 * covered by tests/tool-descriptions-i18n-zh.test.ts (structural: is-Chinese,
 * no emoji, tool/param tokens preserved). Tool NAMES and wire PARAMETER names
 * stay English (they are identifiers); only prose is translated.
 *
 * The entries BELOW that are still ENGLISH remain FAITHFUL OPEN REPRODUCTIONS of
 * the official Claude Code agent tool descriptions, assembled/adapted from the
 * public reconstruction archived under
 * `Public-Info-Pool/Reference/Claude-Code-System-Prompts/system-prompts/`
 * (attribution, not clean-room). Template variables in the source fragments have
 * been resolved to this SDK's concrete values, and tool/parameter names have been
 * adapted to the tools this SDK actually ships.
 *
 * Adaptation rules applied:
 *  - Only tools this SDK ships are referenced: Bash, BashOutput, KillShell, Read,
 *    Edit, Write, Grep, Glob, TaskCreate, TaskGet, TaskUpdate, TaskList,
 *    TodoWrite (legacy, behind CLAUDE_CODE_ENABLE_TASKS=0 — see tools/index.ts),
 *    WebFetch, WebSearch, AskUserQuestion, Monitor, ExitPlanMode, EnterWorktree
 *    (B4b batch), Workflow (B4c batch).
 *    No Agent-in-descriptions, NotebookEdit, MultiEdit, Skill, etc.
 *  - ExitPlanMode: the archive fragment's plan-FILE mechanics (write plan to the
 *    plan file, tool reads it back) do not ship here — this SDK has a plan
 *    permission MODE but no plan-file machinery, so those clauses are adapted
 *    to "the plan you presented in the conversation". Approval mechanics are
 *    honest: exiting switches the permission gate out of plan mode; hosts veto
 *    via PreToolUse hooks / disallowedTools.
 *  - EnterWorktree: references to the unshipped ExitWorktree tool, the
 *    WorktreeCreate/WorktreeRemove hooks, the `worktree.baseRef` setting
 *    (branching is always from the current local HEAD here), tmux and
 *    session-exit prompts are removed (red line). Entry via `path` accepts any
 *    registered worktree of the current repo (official restricts re-switch
 *    targets to .claude/worktrees/ — documented widening).
 *  - Monitor: this SDK does NOT push monitor events into the conversation (that
 *    needs an engine-loop delivery channel it does not have). The description
 *    is adapted to the shipped poll model: events accumulate on a background
 *    task read via BashOutput, stopped via KillShell (official text says
 *    TaskStop, unshipped). The `ws` source (2.1.195+) is unshipped and never
 *    mentioned; notification-batching / auto-stop-on-volume clauses are
 *    dropped. Script-quality and coverage guidance is reproduced faithfully.
 *  - Task tool descriptions: archive template variables for conditional
 *    teammate/notes blocks (CONDTIONAL_TEAMMATES_NOTE, CONDITIONAL_TASK_NOTES,
 *    TEAMMATE_TASKLIST_WHEN_TO_USE_NOTE, TEAMMATE_WORKFLOW_BLOCK) resolve to
 *    empty — this SDK ships no teammate mode. TASKLIST_ID_OUTPUT_LINE resolves
 *    to a plain id line. TaskList's "and comments" is dropped (no task-comment
 *    facility ships here; red line: never describe an unshipped capability).
 *  - Sandbox guidance (BASH_SANDBOX_FRAGMENTS / buildBashSandboxNote) is
 *    reproduced but GATED: it is appended to the Bash description ONLY when a
 *    sandbox backend is active (see createBashTool). When unsandboxed the Bash
 *    description is byte-identical to BASH_DESCRIPTION, with no sandbox content.
 *  - No PowerShell content.
 *  - Bash win32 platform note (BPT pilot 2026-07-06): BASH_WIN32_NOTE is
 *    adapted glue (not archive text) appended to the Bash description ONLY
 *    when the host platform is win32 (createBashTool — same conditional
 *    assembly pattern as the sandbox note). It states that commands run in
 *    POSIX bash (Git Bash), not cmd.exe or PowerShell, and steers cmd habits
 *    (copy/move/del/findstr) to POSIX equivalents. cmd.exe / PowerShell are
 *    named only as a NEGATIVE disclaimer (what the shell is NOT) — no
 *    PowerShell capability is described. On non-win32 platforms the Bash
 *    description stays byte-identical.
 *  - Read: the PDF and Jupyter bullets are ADAPTED to this SDK's actual
 *    behavior (whole-document PDF reads, no pages slicing; notebooks as raw
 *    JSON text) — the official wording describes capabilities not shipped here.
 *  - Workflow (B4c): the official tool runs workflows in the BACKGROUND and
 *    returns a task id immediately; this SDK has no background-task delivery
 *    channel for tools, so the description is adapted to the shipped
 *    synchronous model (the tool call returns the consolidated result
 *    directly). Dropped as unshipped: the /workflows live-progress UI,
 *    <task-notification> mechanics, system-reminder opt-in confirmations, the
 *    transcriptDir/journal.jsonl on-disk transcripts, the "+500k" token-target
 *    directive (budget.total is honestly described as always null here), the
 *    forced StructuredOutput tool + retry-on-mismatch for agent() schema
 *    (adapted to a prompt-appended instruction + JSON parse), per-agent
 *    effort overrides (accepted, ignored, logged), and the MCP-via-ToolSearch
 *    clause. Resume is adapted to the shipped in-memory same-session prefix
 *    cache. Script-authoring guidance (meta block, hooks, pipeline-vs-parallel
 *    doctrine, caps, quality patterns) is reproduced faithfully — the shipped
 *    engine implements those semantics (official caps verbatim: min(16,
 *    cores-2) concurrent, 1000 lifetime, 4096 items per call).
 *  - Read (BPT request 2026-07-06): adapted glue, not archive text. One line is
 *    appended documenting this SDK's TOTAL-output character cap (default ~50000)
 *    — a shipped mechanism the public archive does not describe. The existing
 *    "up to 2000 lines" / "lines longer than 2000 characters" clauses are
 *    archive text, retained verbatim; only the total-cap sentence is added.
 *  - Background shells: launched via Bash `run_in_background: true`; read output
 *    with BashOutput; stop with KillShell.
 *  - Git guidance for Bash is retained (Bash can run git), with CLI-product-specific
 *    co-author / session-link footer boilerplate stripped.
 */

export const BASH_DESCRIPTION = `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it. In particular, never prepend \`cd <current-directory>\` to a \`git\` command — \`git\` already operates on the current working tree, and the compound triggers a permission prompt.

Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt").

If your command will create new directories or files, first use this tool to run \`ls\` to verify the parent directory exists and is the correct location.

You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). By default, your command will timeout after 120000ms (2 minutes).

Set run_in_background: true to launch the command as a background shell that keeps running while you continue working. Read its accumulating output with the BashOutput tool, and stop it with the KillShell tool. Do not run background commands with a trailing \`&\`; use run_in_background instead.

IMPORTANT: Avoid using this tool to run find, grep, cat, head, tail, ls, sed, awk commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:
- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)

While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Git
- Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
- Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
- Prefer to create a new commit rather than amending an existing commit.
- Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.

# Committing changes with git

Only create commits when requested by the user. If unclear, ask first. When the user asks you to create a new git commit, follow these steps carefully:

You can call multiple tools in a single response. When multiple independent pieces of information are requested and all commands are likely to succeed, run multiple tool calls in parallel for optimal performance. The numbered steps below indicate which commands should be batched in parallel.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands (push --force, reset --hard, checkout ., restore ., clean -f, branch -D) unless the user explicitly requests these actions. Taking unauthorized destructive actions is unhelpful and can result in lost work, so it's best to ONLY run these commands when given direct instructions
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc) unless the user explicitly requests it
- NEVER run force push to main/master, warn the user if they request it
- CRITICAL: Always create NEW commits rather than amending, unless the user explicitly requests a git amend. When a pre-commit hook fails, the commit did NOT happen — so --amend would modify the PREVIOUS commit, which may result in destroying work or losing previous changes. Instead, after hook failure, fix the issue, re-stage, and create a NEW commit
- When staging files, prefer adding specific files by name rather than using "git add -A" or "git add .", which can accidentally include sensitive files (.env, credentials) or large binaries
- NEVER commit changes unless the user explicitly asks you to. It is VERY IMPORTANT to only commit when explicitly asked, otherwise the user will feel that you are being too proactive

1. Run the following bash commands in parallel, each using the Bash tool:
  - Run a git status command to see all untracked files. IMPORTANT: Never use the -uall flag as it can cause memory issues on large repos.
  - Run a git diff command to see both staged and unstaged changes that will be committed.
  - Run a git log command to see recent commit messages, so that you can follow this repository's commit message style.
2. Analyze all staged changes (both previously staged and newly added) and draft a commit message:
  - Summarize the nature of the changes (eg. new feature, enhancement to an existing feature, bug fix, refactoring, test, docs, etc.). Ensure the message accurately reflects the changes and their purpose (i.e. "add" means a wholly new feature, "update" means an enhancement to an existing feature, "fix" means a bug fix, etc.).
  - Do not commit files that likely contain secrets (.env, credentials.json, etc). Warn the user if they specifically request to commit those files
  - Draft a concise (1-2 sentences) commit message that focuses on the "why" rather than the "what"
  - Ensure it accurately reflects the changes and their purpose
3. Run the following commands in parallel:
   - Add relevant untracked files to the staging area.
   - Create the commit.
   - Run git status after the commit completes to verify success.
   Note: git status depends on the commit completing, so run it sequentially after the commit.
4. If the commit fails due to pre-commit hook: fix the issue and create a NEW commit

Important notes:
- NEVER run additional commands to read or explore code, besides git bash commands
- NEVER use the TodoWrite tool
- DO NOT push to the remote repository unless the user explicitly asks you to do so
- IMPORTANT: Never use git commands with the -i flag (like git rebase -i or git add -i) since they require interactive input which is not supported.
- IMPORTANT: Do not use --no-edit with git rebase commands, as the --no-edit flag is not a valid option for git rebase.
- If there are no changes to commit (i.e., no untracked files and no modifications), do not create an empty commit
- In order to ensure good formatting, ALWAYS pass the commit message via a HEREDOC, a la this example:
<example>
git commit -m "\$(cat <<'EOF'
   Commit message here.
   EOF
   )"
</example>

# Creating pull requests
Use the gh command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

IMPORTANT: When the user asks you to create a pull request, follow these steps carefully:

1. Run the following bash commands in parallel using the Bash tool, in order to understand the current state of the branch since it diverged from the main branch:
   - Run a git status command to see all untracked files (never use -uall flag)
   - Run a git diff command to see both staged and unstaged changes that will be committed
   - Check if the current branch tracks a remote branch and is up to date with the remote, so you know if you need to push to the remote
   - Run a git log command and \`git diff [base-branch]...HEAD\` to understand the full commit history for the current branch (from the time it diverged from the base branch)
2. Analyze all changes that will be included in the pull request, making sure to look at all relevant commits (NOT just the latest commit, but ALL commits that will be included in the pull request!!!), and draft a pull request title and summary:
   - Keep the PR title short (under 70 characters)
   - Use the description/body for details, not the title
3. Run the following commands in parallel:
   - Create new branch if needed
   - Push to remote with -u flag if needed
   - Create PR using gh pr create with the format below. Use a HEREDOC to pass the body to ensure correct formatting.
<example>
gh pr create --title "the pr title" --body "\$(cat <<'EOF'
## Summary
<1-3 bullet points>

## Test plan
[Bulleted markdown checklist of TODOs for testing the pull request...]
EOF
)"
</example>

Important:
- DO NOT use the TodoWrite tool
- Return the PR URL when you're done, so the user can see it

# Other common operations
- View comments on a Github PR: gh api repos/foo/bar/pulls/123/comments`;

/**
 * Platform note appended to the Bash description ONLY on win32 hosts (see
 * createBashTool — the same conditional-assembly pattern as the sandbox
 * note). Adapted glue, not archive text: the archive has no Git-Bash-on-
 * Windows note. It exists because models habitually reach for cmd.exe
 * spellings on Windows hosts (BPT pilot incident 2026-07-06) even though this
 * SDK always runs commands through POSIX bash (Git Bash, via
 * shell-resolve.ts). cmd.exe / PowerShell are named only as a negative
 * disclaimer (what the shell is NOT); no unshipped capability is described.
 * Gated so non-win32 descriptions stay byte-identical (the conformance wire
 * runs on Linux CI).
 */
export const BASH_WIN32_NOTE = `Note: on Windows this tool still runs POSIX bash (Git Bash), not cmd.exe or PowerShell. Use POSIX commands — ls, cp, mv, rm, grep — instead of dir, copy, move, del, findstr, and write paths with forward slashes.`;

export const READ_DESCRIPTION = `从本地文件系统读取一个文件。你可以用此工具直接访问任意文件。
假定此工具能读取本机上的所有文件。若用户提供了文件路径，就假定该路径有效。读取一个不存在的文件也没关系——会返回一个错误。

用法：
- file_path 参数必须是绝对路径，不能是相对路径
- 默认从文件开头起最多读取 2000 行
- 任何超过 2000 字符的行都会被截断
- 输出总量也限制在约 50000 字符；发生截断时，末尾会附一段脚注，标明本次返回的确切行号区间以及继续读取所用的 offset
- 结果以 cat -n 格式返回，行号从 1 开始
- 你可以选择性地指定行 offset 和 limit（对长文件尤为方便），但推荐不传这两个参数、直接读整个文件
- 此工具可读取图像（如 PNG、JPG 等）。读取图像文件时，内容以视觉方式呈现，因为本模型是多模态的。
- 此工具可读取 PDF 文件（.pdf）。整个文档作为单个 PDF 内容块返回；不支持通过 pages 参数按页读取（带 pages 的读取会返回明确的错误），因此请省略 pages、整份读取。
- Jupyter 笔记本（.ipynb 文件）以其原始 JSON 文本返回；单元格不会逐个渲染。
- 此工具只能读取文件，不能读取目录。要列出目录中的文件，请用 Bash 工具。
- 你会经常被要求读取截图。若用户提供了截图路径，务必用此工具查看该路径的文件。此工具适用于所有临时文件路径。
- 若你读取的文件存在但内容为空，你会收到一条系统提醒警告来替代文件内容。`;

export const EDIT_DESCRIPTION = `对文件执行精确的字符串替换。

用法：
- 编辑前，你必须在本次对话中至少用过一次 Read 工具。若未读取文件就尝试编辑，此工具会报错。
- 编辑来自 Read 工具输出的文本时，务必保留行号前缀之后的精确缩进（制表符/空格）。行号前缀的格式为：空格 + 行号 + 制表符。其后的一切才是要匹配的实际文件内容。切勿把行号前缀的任何部分包含进 old_string 或 new_string。
- 始终优先编辑代码库中已有的文件。除非明确必要，切勿新建文件。
- 仅在用户明确要求时才使用 emoji。除非被要求，避免向文件中添加 emoji。
- 让 \`old_string\` 尽量精简——通常 1-3 行，足以在文件中唯一即可。包含多余上下文既浪费 token 也是错误做法。
- 若 \`old_string\` 在文件中不唯一，编辑会失败。此时请补上达成唯一所需的最少额外上下文，或用 \`replace_all\` 替换每一处。
- 用 \`replace_all\` 在整个文件范围内替换或重命名字符串。比如你想重命名一个变量时，此参数很有用。`;

export const WRITE_DESCRIPTION = `向本地文件系统写入一个文件，若已存在则覆盖。

何时使用：新建一个文件，或完全替换一个你已经 Read 过的文件。覆盖一个你尚未 Read 过的已有文件会失败。若只是局部改动，请改用 Edit。

用法：
- 若所给路径处已有文件，此工具会覆盖它。
- 修改已有文件时优先用 Edit 工具——它只发送 diff。仅在新建文件或整体重写时才用此工具。
- 除非用户明确要求，切勿创建文档文件（*.md）或 README 文件。
- 仅在用户明确要求时才使用 emoji。除非被要求，避免向文件中写入 emoji。`;

export const GREP_DESCRIPTION = `一个基于 ripgrep 构建的强大搜索工具

用法：
- 搜索任务始终用 Grep。切勿以 Bash 命令方式调用 \`grep\` 或 \`rg\`。Grep 工具已针对正确的权限与访问做过优化。
- 支持完整正则语法（如 "log.*Error"、"function\\s+\\w+"）
- 用 glob 参数（如 "*.js"、"**/*.tsx"）或 type 参数（如 "js"、"py"、"rust"）筛选文件
- 输出模式："content" 显示匹配行，"files_with_matches" 仅显示文件路径（默认），"count" 显示匹配计数
- 模式语法：使用 ripgrep（非 grep）——字面花括号需转义（用 \`interface\\{\\}\` 来查找 Go 代码中的 \`interface{}\`）
- 多行匹配：默认模式仅在单行内匹配。对于像 \`struct \\{[\\s\\S]*?field\` 这样的跨行模式，请用 \`multiline: true\``;

export const GLOB_DESCRIPTION = `- 快速的文件模式匹配工具，适用于任意规模的代码库
- 支持诸如 "**/*.js" 或 "src/**/*.ts" 的 glob 模式
- 返回按修改时间排序的匹配文件路径
- 当你需要按名称模式查找文件时使用此工具`;

export const TODOWRITE_DESCRIPTION = `用此工具为你当前的编码会话创建并管理一份结构化的任务列表。这有助于你跟踪进度、组织复杂任务、并向用户展示周密。
它也帮助用户理解该任务的进展以及其请求的总体进度。

## 何时使用此工具
在以下情形中主动使用此工具：

1. 复杂的多步骤任务——当一个任务需要 3 个或更多不同的步骤或动作时
2. 非平凡且复杂的任务——需要仔细规划或多次操作的任务
3. 用户明确要求待办列表——当用户直接要求你使用待办列表时
4. 用户提供了多个任务——当用户提供一份待办事项清单（编号或逗号分隔）时
5. 收到新指令后——立即把用户需求记录为待办
6. 当你开始处理某任务时——在开工之前将其标记为 in_progress。理想情况下，同一时间应只有一个待办处于 in_progress
7. 完成一个任务后——将其标记为 completed，并补上实施过程中发现的任何新的后续任务

## 何时不要使用此工具

在以下情况跳过此工具：
1. 只有单个、直截了当的任务
2. 任务微不足道，跟踪它无组织上的收益
3. 任务可在少于 3 个琐碎步骤内完成
4. 任务纯属对话性或信息性

注意：若只有一个琐碎任务要做，你不应使用此工具。此时你直接去做那个任务更好。

## 任务状态与管理

1. **任务状态**：用这些状态来跟踪进度：
   - pending：任务尚未开始
   - in_progress：正在处理（同一时间限一个任务）
   - completed：任务已成功完成

   **重要**：任务描述必须有两种形式：
   - content：描述需要做什么的祈使句形式（如 "Run tests"、"Build the project"）
   - activeForm：执行期间显示的现在进行时形式（如 "Running tests"、"Building the project"）

2. **任务管理**：
   - 工作时实时更新任务状态
   - 完成后立即把任务标记为完成（不要攒着批量标记）
   - 任何时刻必须恰好有一个任务处于 in_progress（不多也不少）
   - 先完成当前任务，再开始新任务
   - 把不再相关的任务从列表中彻底移除

3. **任务完成要求**：
   - 只有当你已**完全**完成某任务时才将其标记为 completed
   - 若你遇到错误、阻塞、或无法完成，保持任务为 in_progress
   - 被阻塞时，创建一个新任务，描述需要解决什么
   - 在以下情况下绝不要把任务标记为 completed：
     - 测试正在失败
     - 实现只完成了一部分
     - 你遇到了未解决的错误
     - 你找不到必需的文件或依赖

4. **任务拆解**：
   - 创建具体、可行动的条目
   - 把复杂任务拆成更小、可管理的步骤
   - 使用清晰、有描述性的任务名
   - 始终提供两种形式：
     - content："Fix authentication bug"
     - activeForm："Fixing authentication bug"

拿不准时，就用此工具。主动进行任务管理体现了专注，并确保你成功完成所有要求。`;

export const TASKCREATE_DESCRIPTION = `用此工具为你当前的编码会话创建一份结构化的任务列表。这有助于你跟踪进度、组织复杂任务、并向用户展示周密。
它也帮助用户理解该任务的进展以及其请求的总体进度。

## 何时使用此工具

在以下情形中主动使用此工具：

- 复杂的多步骤任务——当一个任务需要 3 个或更多不同的步骤或动作时
- 非平凡且复杂的任务——需要仔细规划或多次操作的任务
- 计划模式——使用计划模式时，创建一份任务列表来跟踪工作
- 用户明确要求待办列表——当用户直接要求你使用待办列表时
- 用户提供了多个任务——当用户提供一份待办事项清单（编号或逗号分隔）时
- 收到新指令后——立即把用户需求记录为任务
- 当你开始处理某任务时——在开工之前将其标记为 in_progress
- 完成一个任务后——将其标记为 completed，并补上实施过程中发现的任何新的后续任务

## 何时不要使用此工具

在以下情况跳过此工具：
- 只有单个、直截了当的任务
- 任务微不足道，跟踪它无组织上的收益
- 任务可在少于 3 个琐碎步骤内完成
- 任务纯属对话性或信息性

注意：若只有一个琐碎任务要做，你不应使用此工具。此时你直接去做那个任务更好。

## 任务字段

- **subject**：一个简短、可行动的祈使句标题（如 "Fix authentication bug in login flow"）
- **description**：需要做什么
- **activeForm**（可选）：任务处于 in_progress 时在加载动画中显示的现在进行时形式（如 "Fixing authentication bug"）。若省略，加载动画改显 subject。

所有任务创建时的 status 均为 \`pending\`。

## 提示

- 用清晰、具体、能描述结果的 subject 创建任务
- 创建任务后，如需依赖关系（blocks/blockedBy），用 TaskUpdate 来设置
- 先查 TaskList，避免创建重复任务`;

export const TASKGET_DESCRIPTION = `用此工具按 ID 从任务列表中取回一个任务。

## 何时使用此工具

- 当你在开始处理一个任务前需要其完整描述与上下文时
- 用于理解任务依赖（它阻塞了什么、什么阻塞了它）
- 被指派一个任务后，用于拿到完整需求

## 输出

返回完整的任务详情：
- **subject**：任务标题
- **description**：详细需求与上下文
- **status**：'pending'、'in_progress' 或 'completed'
- **blocks**：正等待此任务完成的任务
- **blockedBy**：必须先完成、此任务才能开始的任务

## 提示

- 取回一个任务后，开始工作前先确认其 blockedBy 列表为空。
- 用 TaskList 以摘要形式查看所有任务。`;

export const TASKUPDATE_DESCRIPTION = `用此工具更新任务列表中的一个任务。

## 何时使用此工具

**把任务标记为已了结：**
- 当你已完成某任务所描述的工作时
- 当某任务不再需要、或已被取代时
- 重要：完成你被指派的任务时，务必将其标记为已了结
- 了结后，调用 TaskList 找你的下一个任务

- 只有当你已**完全**完成某任务时才将其标记为 completed
- 若你遇到错误、阻塞、或无法完成，保持任务为 in_progress
- 被阻塞时，创建一个新任务，描述需要解决什么
- 在以下情况下绝不要把任务标记为 completed：
  - 测试正在失败
  - 实现只完成了一部分
  - 你遇到了未解决的错误
  - 你找不到必需的文件或依赖

**删除任务：**
- 当某任务不再相关、或是误建时
- 把 status 设为 \`deleted\` 会永久移除该任务

**更新任务详情：**
- 当需求变化或变得更清晰时
- 当在任务间建立依赖关系时

## 你可以更新的字段

- **status**：任务状态（见下方"状态流转"）
- **subject**：更改任务标题（祈使句形式，如 "Run tests"）
- **description**：更改任务描述
- **activeForm**：in_progress 时在加载动画中显示的现在进行时形式（如 "Running tests"）
- **owner**：更改任务负责人（agent 名）
- **metadata**：把 metadata 键并入任务（把某键设为 null 以删除它）
- **addBlocks**：标记那些必须等此任务完成才能开始的任务
- **addBlockedBy**：标记那些必须先完成、此任务才能开始的任务

## 状态流转

状态推进顺序：\`pending\` → \`in_progress\` → \`completed\`

用 \`deleted\` 永久移除一个任务。

## 陈旧性

更新一个任务前，务必用 \`TaskGet\` 读取它的最新状态。

## 示例

开工时把任务标记为进行中：
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

完工后把任务标记为已完成：
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

删除一个任务：
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

通过设置 owner 认领一个任务：
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

建立任务依赖：
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\``;

export const TASKLIST_DESCRIPTION = `用此工具列出任务列表中的所有任务。

## 何时使用此工具

- 查看有哪些任务可供处理（status 为 'pending'、无 owner、未被阻塞）
- 检查项目的总体进度
- 找出被阻塞、需要先解决依赖的任务
- 完成一个任务后，检查是否有新解锁的工作，或认领下一个可用任务
- 当有多个任务可用时，**优先按 ID 顺序处理**（ID 最小者优先），因为较早的任务往往为较晚的任务铺设上下文

## 输出

返回每个任务的摘要：
- **id**：任务的唯一标识
- **subject**：任务的简要描述
- **status**：'pending'、'in_progress' 或 'completed'
- **owner**：已指派则为 Agent ID，可认领则为空
- **blockedBy**：必须先解决的未决任务 ID 列表（带 blockedBy 的任务在其依赖解决前无法被认领）

用 TaskGet 加某个具体任务 ID 来查看含 description 在内的完整详情。`;

export const WEBFETCH_DESCRIPTION = `- 从指定 URL 抓取内容，并用一个 AI 模型对其进行处理
- 以一个 URL 和一段 prompt 作为输入
- 抓取该 URL 的内容，把 HTML 转成 markdown
- 用一个小而快的模型、按 prompt 处理内容
- 返回该模型关于内容的回应
- 当你需要检索并分析网页内容时使用此工具

使用说明：
- 重要：若有 MCP 提供的网页抓取工具可用，优先用那个而非本工具，因为它可能限制更少。
- URL 必须是一个格式完整、有效的 URL
- HTTP 的 URL 会被自动升级为 HTTPS
- prompt 应描述你想从页面中提取什么信息
- 此工具为只读，不修改任何文件
- 若内容非常大，结果可能被摘要
- 内置一个自清理的 15 分钟缓存，反复访问同一 URL 时响应更快
- 当某 URL 重定向到不同主机时，工具会告知你，并以一种特殊格式提供重定向后的 URL。你随后应以该重定向 URL 发起一次新的 WebFetch 请求来抓取内容。
- 对于 GitHub 的 URL，优先改用经 Bash 调用的 gh CLI（如 gh pr view、gh issue view、gh api）。`;

export const WEBSEARCH_DESCRIPTION = `- 允许模型搜索网络，并用结果为回应提供依据
- 为时事与近期数据提供最新信息
- 以搜索结果块的格式返回搜索结果信息，其中链接为 markdown 超链接
- 用此工具获取超出模型知识截止时间的信息
- 搜索在单次 API 调用内自动完成

关键要求——你必须遵守：
- 在回答完用户的问题后，你必须在回应末尾附上一个 "Sources:" 小节
- 在 Sources 小节中，把搜索结果里所有相关 URL 列为 markdown 超链接：[Title](URL)
- 这是强制的——绝不要在回应中省略来源
- 格式示例：

    [你的答案写在这里]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

使用说明：
- 支持按域名筛选，以纳入或屏蔽特定网站
- 网络搜索仅在美国可用

重要——在搜索查询中使用正确的年份：
- 搜索近期信息、文档或时事时，你必须使用当前年份。
- 示例：若用户要 "latest React docs"，请以当前年份搜索 "React documentation"，而不是去年`;

export const ASKUSERQUESTION_DESCRIPTION = `仅在你卡在一个真正该由用户来做的决定上时才使用此工具：一个你无法从请求、代码或合理默认值中自行解决的决定。

使用说明：
- 用户始终可以选择 "Other" 来提供自定义文本输入
- 用 multiSelect: true 允许一个问题被选择多个答案
- 若你推荐某个特定选项，请把它放在列表首位，并在其 label 末尾加上 "(Recommended)"`;

export const EXITPLANMODE_DESCRIPTION = `当你处于计划模式、已讲完你的计划、准备请用户批准以开始实施时，使用此工具。

## 此工具如何运作
- 在调用此工具前，你应当已经在对话中呈现了完整的计划
- 此工具不以计划内容作为参数——它只是发出信号：你计划已毕、准备实施
- 一经批准，会话的权限模式便退出计划模式，实施类工具（Write、Edit、Bash）随之可运行
- 可选择性传入 allowedPrompts 来声明你的计划将需要的 Bash 权限

## 何时使用此工具
重要：仅当任务需要为一项需写代码的工作规划实施步骤时才使用此工具。对于你在收集信息、搜索文件、读取文件、或总体上试图理解代码库的研究类任务——不要使用此工具。

## 使用此工具之前
确保你的计划完整且无歧义：
- 若你对需求或方案仍有未决问题，先用 AskUserQuestion（在更早的阶段）
- 计划一旦定稿，用本工具请求批准

**重要：** 不要用 AskUserQuestion 去问"这个计划可以吗？"或"我该继续吗？"——那正是本工具所做的事。ExitPlanMode 本身就是在请求用户批准你的计划。

## 示例

1. 初始任务："搜索并理解代码库中 vim 模式的实现"——不要用退出计划模式工具，因为你并未在为一项工作规划实施步骤。
2. 初始任务："帮我实现 vim 的 yank 模式"——在你规划完该工作的实施步骤后，使用退出计划模式工具。
3. 初始任务："新增一个处理用户认证的功能"——若对认证方式（OAuth、JWT 等）不确定，先用 AskUserQuestion，待方案厘清后再用退出计划模式工具。`;

export const ENTERWORKTREE_DESCRIPTION = `仅当被明确指示在 worktree 中工作时才使用此工具——无论是用户直接指示，还是项目指令（CLAUDE.md / memory）指示。此工具会创建一个隔离的 git worktree，并把当前会话切入其中。

## 何时使用

- 用户明确说了 "worktree"（如 "start a worktree"、"work in a worktree"、"create a worktree"、"use a worktree"）
- CLAUDE.md 或 memory 指令要求你为当前任务在 worktree 中工作

## 何时不要使用

- 用户要求创建分支、切换分支、或在另一分支上工作——请改用 git 命令
- 用户要求修 bug 或开发某功能——除非用户或项目指令明确要求 worktree，否则走常规 git 工作流
- 除非用户或 CLAUDE.md / memory 指令中明确提到 "worktree"，否则绝不使用此工具

## 前提条件

- 必须处于一个 git 仓库中
- 创建新 worktree（\`name\`）时，当前不能已处于某个 worktree 会话中；通过 \`path\` 切入另一个已存在的 worktree 是允许的

## 行为

- 在 \`.claude/worktrees/\` 内、以你当前本地 HEAD 为基点，在一个新分支上创建一个新的 git worktree
- 把会话的工作目录切换到该新 worktree

## 进入一个已存在的 worktree

传入 \`path\`（而非 \`name\`）以把会话切入一个已经存在的 worktree（如你刚用 \`git worktree add\` 创建的那个）。该路径必须出现在当前仓库的 \`git worktree list\` 中——不是本仓库已注册 worktree 的路径会被拒绝。

## 参数

- \`name\`（可选）：新 worktree 的名字。若 \`name\` 与 \`path\` 都未提供，会生成一个随机名字。
- \`path\`（可选）：要进入的、当前仓库某个已存在 worktree 的路径（而非新建一个）。与 \`name\` 互斥。`;

export const MONITOR_DESCRIPTION = `启动一个后台监视器，盯住一个长时间运行的脚本。stdout 的每一行都是一个事件。事件累积在返回的后台任务 id 上——本 SDK 不会把它们推入对话。用 BashOutput 读取新事件（把返回的 taskId 作为 bash_id 传入），用 KillShell 停止监视。

按你需要多少个事件来选择：
- **一个**（"服务器就绪 / 构建完成时告诉我"）→ 用 **带 \`run_in_background\` 的 Bash**，配一条在条件为真时退出的命令，如 \`until grep -q "Ready in" dev.log; do sleep 0.5; done\`。它的退出就是那唯一的事件。
- **每次发生一个、无限期**（"每次出现 ERROR 行就告诉我"）→ 用 Monitor 配一条无界命令（\`tail -f\`、\`inotifywait -m\`、\`while true\`）。
- **每次发生一个、直到已知的终点**（"逐条发出 CI 步骤结果，运行完成时停止"）→ 用 Monitor 配一条会发出若干行然后退出的命令。

你脚本的 stdout 就是事件流。每一行是一个事件。退出即结束监视。

  # Each matching log line is an event
  tail -f /var/log/app.log | grep --line-buffered "ERROR"

  # Each file change is an event
  inotifywait -m --format '%e %f' /watched/dir

  # Poll GitHub for new PR comments and emit one line per new comment
  last=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  while true; do
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    gh api "repos/owner/repo/issues/123/comments?since=$last" --jq '.[] | "\\(.user.login): \\(.body)"'
    last=$now; sleep 30
  done

**不要用无界命令去拿单个事件。** \`tail -f\`、\`inotifywait -m\`、\`while true\` 不会自行退出，因此即便事件早已触发，监视器仍会保持待命直到超时。对于"X 就绪时告诉我"，请改用带 \`until\` 循环的 Bash \`run_in_background\`。注意 \`tail -f log | grep -m 1 ...\` 并*不能*解决这一点：若匹配之后日志陷入沉默，\`tail\` 永远收不到 SIGPIPE，管道照样挂起。

**脚本质量：**
- 每个管道阶段都必须逐行刷新，否则匹配会滞留在其缓冲区里不可见：\`grep\` 需要 \`--line-buffered\`，\`awk\` 需要 \`fflush()\`。\`head\` 根本无法刷新——\`| head -N\` 在累积到 N 个匹配前什么都不给，随后便结束流。
- 在轮询循环里，处理好瞬时失败（\`curl ... || true\`）——一次失败的请求不应杀死监视器。
- 轮询间隔：远程 API 30 秒以上（速率限制），本地检查 0.5-1 秒。
- 写一个具体的 \`description\`——它为该监视命名（"errors in deploy.log" 而非 "watching logs"）。
- 只有 stdout 是事件流。stderr 被单独捕获（BashOutput 在 [stderr] 下显示它）——对于你直接运行的命令（如 \`python train.py 2>&1 | grep --line-buffered ...\`），用 \`2>&1\` 把 stderr 并入，好让其失败也进入你的过滤器。（对既有日志的 \`tail -f\` 无影响——那个文件只含其写入方重定向进去的内容。）

**覆盖度——沉默不等于成功。** 当为某个结果去盯一个作业或进程时，你的过滤器必须匹配每一种终止状态，而不只是顺利路径。一个只 grep 成功标记的监视器，会在崩溃循环、进程挂起、意外退出时全程沉默——而沉默看起来和"仍在运行"一模一样。装备之前先问：*如果这个进程此刻崩溃了，我的过滤器会发出任何东西吗？* 若不会，就把它放宽。

  # Wrong — silent on crash, hang, or any non-success exit
  tail -f run.log | grep --line-buffered "elapsed_steps="

  # Right — one alternation covering progress + the failure signatures you'd act on
  tail -f run.log | grep -E --line-buffered "elapsed_steps=|Traceback|Error|FAILED|assert|Killed|OOM"

对于检查作业状态的轮询循环，请在每一种终止状态（\`succeeded|failed|cancelled|timeout\`）上发出，而不只是成功。若你无法自信地枚举失败特征，就放宽 grep 的 alternation，而不是收窄——多一点噪声也好过漏掉一次崩溃循环。

**输出量**：每一行 stdout 都会累积计入后台输出上限，因此过滤器应当有选择性——但"有选择"意味着"你会据以行动的那些行"，而非"只报好消息"。切勿把原始日志直接倒进管道；只过滤出你在意的成功与失败信号。

该脚本运行在与 Bash 相同的 shell 环境中。退出即结束监视（会报告退出码）。超时 → 被杀（默认 600000ms；\`persistent: true\` 会禁用超时，用于会话时长的监视，如 PR 监控或日志尾随——此时监视器一直运行到 KillShell 或会话结束）。用 KillShell 提前取消。`;

export const WORKFLOW_DESCRIPTION = `执行一个工作流脚本，确定性地编排多个子代理。在本 SDK 中，工作流在工具调用内**同步**运行：脚本结束时工具即返回，工具结果直接携带汇总产出——脚本的返回值（JSON 序列化）、一份进度记录（phase()/log()/逐代理的行）、用于续跑的 runId，以及持久化的脚本路径。

工作流把工作跨多个代理进行结构化——为求全面（分解后并行覆盖），为求确信（在落定前引入独立视角与对抗性检查），或为承接单个上下文装不下的规模（迁移、审计、大范围扫查）。脚本就是你编码这套结构的地方：什么扇出、什么核验、什么综合。

仅当用户已明确选择多代理编排时才调用此工具。工作流可能派生数十个代理并消耗大量 token；这种规模必须由用户主动请求，而非由你推断。明确选择指以下之一：
- 用户在其 prompt 中包含了关键词 "ultracode"。
- 本会话开启了 Ultracode——见下方 **Ultracode**。
- 用户用自己的话直接要求你运行一个工作流或使用多代理编排（"use a workflow"、"run a workflow"、"fan out agents"、"orchestrate this with subagents"）。这一要求必须出自用户之口——一个仅仅会因工作流而受益的任务不算。
- 用户调用了某个技能或斜杠命令，其指令要求你调用 Workflow。
- 用户要求你运行某个具名或已保存的工作流。

对于任何其他任务——即便是明显会因并行而受益的——都**不要**调用此工具。改为派生单个子代理，或简要描述一个多代理工作流能做什么、大致要花多少代价，并询问用户是否运行。提一句：他们可以在日后的消息中用 "use a workflow" 来跳过这个询问。

当你确实要调用它时，正确的做法往往是**混合式**：先内联侦查（列出文件、找到频道、界定 diff）以发现工作清单，再调用 Workflow 在其上做 pipeline。你不必在**任务**之前就知道形状——只需在**编排步骤**之前知道。

可跨回合串联的常见单阶段工作流：
- **理解（Understand）**——对相关子系统并行阅读 → 结构化图谱
- **设计（Design）**——N 个独立方案的评审团 → 打分后综合
- **评审（Review）**——分维度 → 发现 → 对抗性核验（示例见下）
- **研究（Research）**——多模态扫查 → 深读 → 综合
- **迁移（Migrate）**——发现站点 → 逐个改造（worktree 隔离）→ 核验

对于更大的工作，串行跑若干个——每个结果读完再决定下一阶段。你始终在环内；每个工作流是一次界定良好的扇出。

**Ultracode。** 当本会话开启 ultracode 时，这一选择是常驻的：默认为每一项实质任务撰写并运行一个工作流。目标是你能产出的最详尽、最正确的答案——token 代价不是约束。对于多阶段工作（理解 → 设计 → 实现 → 评审），这往往意味着串行跑若干个工作流——每阶段一个——好让你在它们之间始终在环内。下方的质量范式（对抗性核验、多模态扫查、完备性批评者、循环至枯竭）就是工具；按任务挑选。倾向于用工作流编排、并对抗性核验你的发现——除非工作琐碎或已核验。仅在对话回合或琐碎的机械编辑时单干。当 ultracode 关闭时，退回上方的选择规则。

通过 \`script\` 内联传入脚本——不要先把它 Write 到文件。每次 Workflow 调用都会把其脚本持久化到一个文件，并在工具结果中返回该路径。要迭代一个工作流，用 Write/Edit 编辑那个文件，再以 \`{scriptPath: "<path>"}\` 重新调用 Workflow，而非重发整段脚本。\`name\` 输入会解析工作目录下 \`.claude/workflows/\` 中保存的脚本（本 SDK 不附带任何内置具名工作流）。

每个脚本都必须以 \`export const meta = {...}\` 开头：
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',   // one-line, shown in permission dialog
    phases: [                                            // one entry per phase() call
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // script body starts here — use agent()/parallel()/pipeline()/phase()/log()
  phase('Scan')
  const flaky = await agent('grep CI logs for retry markers', {schema: FLAKY_SCHEMA})
  ...

\`meta\` 对象必须是**纯字面量**——不含变量、函数调用、展开或模板插值。必填字段：\`name\`、\`description\`。可选：\`whenToUse\`（显示在工作流列表中）、\`phases\`。meta.phases 中用与 phase() 调用**相同**的阶段标题——标题按精确匹配；一个没有对应 meta 条目的 phase() 调用只会自成一个进度组。当某阶段使用特定模型覆盖时，在该阶段条目加 \`model\`。

脚本体钩子：
- agent(prompt: string, opts?: {label?: string, phase?: string, schema?: object, model?: string, isolation?: 'worktree', agentType?: string}): Promise<any> —— 派生一个子代理。不带 schema 时，以字符串返回其最终文本。带 schema（一个 JSON Schema）时，prompt 会被追加一条结构化输出指令，agent() 对回复做 JSON 解析——返回解析后的对象，或在回复不是有效 JSON 或缺少必需的顶层键时返回 null（本 SDK 在解析层校验；不匹配时无自动重试）。若子代理死于某个终止错误则返回 null（用 .filter(Boolean) 过滤）。opts.label 覆盖显示标签。opts.phase 显式把此代理归入某个进度组（在 pipeline()/parallel() 阶段内用它，以避免对全局 phase() 状态的竞态——相同 phase 字符串 → 同一组）。opts.model 覆盖此次 agent 调用的模型。默认省略它——代理继承会话模型，这几乎总是对的。仅当你高度确信另一档更适合该任务时才设置；不确定就省略。opts.effort 为脚本兼容性而被接受，但本 SDK 不实现逐代理的 effort 覆盖——它被忽略（进度行会注明）。opts.isolation: 'worktree' 让代理在一个全新的 git worktree 中运行——**昂贵**，仅当多个代理并行改动文件、否则会冲突时才用；worktree 若无改动会被自动移除。opts.agentType 使用一个自定义子代理类型（如 'general-purpose'）而非默认——从与独立子代理派生相同的子代理注册表解析；可与 schema 组合。
- pipeline(items, stage1, stage2, ...): Promise<any[]> —— 让每个条目**独立**地流经所有阶段，阶段之间**无屏障**。条目 A 可以在第 3 阶段，而条目 B 还在第 1 阶段。这是多阶段工作的**默认**方式。墙钟时间 = 最慢的单条目链，而非各阶段最慢之和。每个阶段回调收到 (prevResult, originalItem, index)——在后续阶段用 originalItem/index 来标注工作，无需把上下文穿过第 1 阶段的返回值。抛异常的阶段会把该条目丢为 \`null\` 并跳过其余阶段。
- parallel(thunks: Array<() => Promise<any>>): Promise<any[]> —— 并发运行若干任务。这是一个**屏障**：返回前等待所有 thunk。抛异常（或其 agent 出错）的 thunk 在结果数组中解析为 \`null\`——调用本身从不 reject，因此使用结果前先 \`.filter(Boolean)\`。仅当你确实需要所有结果一并到位时才用。
- log(message: string): void —— 发出一条进度消息（记录进工具结果的进度记录中）
- phase(title: string): void —— 开始一个新阶段；后续的 agent() 调用在进度记录中被归入此标题
- args: any —— 作为 Workflow 的 \`args\` 输入原样传入的值（未提供则为 undefined）。在工具调用中把数组/对象作为真正的 JSON 值传入，**而非** JSON 编码的字符串——\`args: ["a.ts", "b.ts"]\`，而非 \`args: "[\\"a.ts\\", ...]"\`（一个被字符串化的列表到脚本里就是一个字符串，于是 \`args.filter\`/\`args.map\` 会抛错）。用它来参数化具名工作流——如直接传入一个研究问题、目标路径或配置对象，而非经旁路文件。
- budget: {total: number|null, spent(): number, remaining(): number} —— 面向预算伸缩脚本的兼容性接口。本 SDK 没有 token 目标通道、也没有工作流 token 计量：\`budget.total\` **永远为 null**，\`budget.spent()\` 返回 0，\`budget.remaining()\` 返回 Infinity。始终以 \`budget.total\` 作为预算驱动循环的守卫（如 \`while (budget.total && budget.remaining() > 50_000)\`）——当 total 为 null 时，未加守卫的 remaining() 循环会一路跑到 1000 代理上限。
- workflow(nameOrRef: string | {scriptPath: string}, args?: any): Promise<any> —— 内联运行另一个工作流作为子步骤，并返回它所返回的一切。传入一个 name 以调用一个已保存的工作流（与 {name: "..."} 同一注册表），或 {scriptPath} 以运行你先前 Write 的脚本文件。子工作流共享本次运行的并发上限、代理计数器、abort 信号与续跑日志；其代理出现在同一份进度记录中。args 参数成为子工作流的 \`args\` 全局。嵌套仅一层：子工作流内的 workflow() 会抛错。遇未知 name / 不可读 scriptPath / 子脚本语法错误会抛错；catch 以优雅处理。

子代理被告知其最终文本**就是**返回值（而非面向人的消息），因此它们返回原始数据。要结构化输出，用 schema 选项。

脚本是纯 JavaScript，**不是** TypeScript——类型注解（\`: string[]\`）、接口与泛型都无法解析。脚本体运行在异步上下文中——直接用 await。标准 JS 内置（JSON、Math、Array 等）可用——**除了** \`Date.now()\`/\`Math.random()\`/无参 \`new Date()\`，它们会抛错（会破坏续跑）；经 \`args\` 传入时间戳，在工作流返回后再盖时间戳，随机性则按 index 变化 agent 的 prompt/label。无文件系统或 Node.js API 访问。

**默认用 pipeline()。** 只有当你确实需要**全部**上一阶段结果一并到位时，才动用屏障（阶段之间的 parallel）。

屏障**仅**在第 N 阶段需要来自第 N-1 阶段全体的跨条目上下文时才正确：
- 在昂贵的下游工作之前，对整个结果集去重/合并
- 若总数为零则提前退出（"发现 0 个 bug → 完全跳过核验"）
- 第 N 阶段的 prompt 为对比而引用"其他发现"

屏障**不**能由以下理由证成：
- "我得先 flatten/map/filter"——在 pipeline 阶段内做：pipeline(items, stageA, r => transform([r]).flat(), stageB)
- "这些阶段概念上是分开的"——那正是 pipeline() 所建模的。分开的阶段 ≠ 同步的阶段。
- "代码更干净"——屏障的延迟是实打实的。若 5 个 finder 在跑、最慢者用时是最快者的 3 倍，屏障就浪费了那些快 finder 三分之二的空转时间。

嗅探测试：若你写了
  const a = await parallel(...)
  const b = transform(a)        // flatten, map, filter — no cross-item dependency
  const c = await parallel(b.map(...))
那个中间的 transform 不需要屏障。把它改写成一个 pipeline、把 transform 放进某个阶段里。拿不准时：用 pipeline。

每个工作流内并发的 agent() 调用上限为 min(16, cpu 核数 - 2)——超出的调用排队，随槽位空出而运行。你仍可把 100 个条目传给 parallel()/pipeline() 且它们全部完成；只是任一时刻约 10 个在跑。一个工作流生命周期内的代理总数上限为 1000——一个远高于任何真实工作流的失控循环兜底。单次 parallel()/pipeline() 调用最多接受 4096 个条目；传更多是一个明确的错误，而非静默截断。

标准的多阶段范式——默认 pipeline，每个维度一旦评审完成即刻核验：
  export const meta = {
    name: 'review-changes',
    description: 'Review changed files across dimensions, verify each finding',
    phases: [{ title: 'Review' }, { title: 'Verify' }],
  }
  const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, {label: \`review:\${d.key}\`, phase: 'Review', schema: FINDINGS_SCHEMA}),
    review => parallel(review.findings.map(f => () =>
      agent(\`Adversarially verify: \${f.title}\`, {label: \`verify:\${f.file}\`, phase: 'Verify', schema: VERDICT_SCHEMA})
        .then(v => ({...f, verdict: v}))
    ))
  )
  const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
  return { confirmed }
  // Dimension 'bugs' findings verify while dimension 'perf' is still reviewing. No wasted wall-clock.

当屏障**确实**正确时——在昂贵的核验之前对所有发现去重：
  const all = await parallel(DIMENSIONS.map(d => () => agent(d.prompt, {schema: FINDINGS_SCHEMA})))
  const deduped = dedupeByFileAndLine(all.filter(Boolean).flatMap(r => r.findings))  // <-- genuinely needs ALL at once
  const verified = await parallel(deduped.map(f => () => agent(verifyPrompt(f), {schema: VERDICT_SCHEMA})))

循环至计数（loop-until-count）范式——累积到某个目标：
  const bugs = []
  while (bugs.length < 10) {
    const result = await agent("Find bugs in this codebase.", {schema: BUGS_SCHEMA})
    bugs.push(...result.bugs)
    log(\`\${bugs.length}/10 found\`)
  }

组合各范式——穷尽式评审（发现 → 对照 seen 去重 → 多棱镜评审团 → 循环至枯竭）：
  const seen = new Set(), confirmed = []
  let dry = 0
  while (dry < 2) {                                              // loop-until-dry
    const found = (await parallel(FINDERS.map(f => () =>          // barrier: collect all finders this round
      agent(f.prompt, {phase: 'Find', schema: BUGS})))).filter(Boolean).flatMap(r => r.bugs)
    const fresh = found.filter(b => !seen.has(key(b)))           // dedup vs ALL seen — plain code, not an agent
    if (!fresh.length) { dry++; continue }
    dry = 0; fresh.forEach(b => seen.add(key(b)))
    const judged = await parallel(fresh.map(b => () =>           // every fresh bug judged concurrently...
      parallel(['correctness','security','repro'].map(lens => () =>   // ...each by 3 distinct lenses
        agent(\`Judge "\${b.desc}" via the \${lens} lens — real?\`, {phase: 'Verify', schema: VERDICT})))
        .then(vs => ({ b, real: vs.filter(Boolean).filter(v => v.real).length >= 2 }))))
    confirmed.push(...judged.filter(v => v.real).map(v => v.b))
  }
  return confirmed
  // dedup vs \`seen\`, NOT \`confirmed\` — else judge-rejected findings reappear every round and it never converges.

质量范式——常见形态；按任务挑选、自由组合：
- 对抗性核验：为每个发现派生 N 个独立的怀疑者，各被指示去**反驳**。若过半反驳则毙掉。防止貌似合理却错误的发现存活。
    const votes = await parallel(Array.from({length: 3}, () => () =>
      agent(\`Try to refute: \${claim}. Default to refuted=true if uncertain.\`, {schema: VERDICT})))
    const survives = votes.filter(Boolean).filter(v => !v.refuted).length >= 2
- 视角多元的核验：当一个发现可能以不止一种方式出错时，给每个核验者一个不同的棱镜（正确性、安全性、性能、能否复现），而非 N 个一模一样的反驳者——多样性能抓住冗余抓不到的失败模式。
- 评审团：从不同角度生成 N 次独立尝试（如 MVP 优先、风险优先、用户优先），用并行的评审者打分，从胜者综合、同时嫁接亚军们最好的点子。当解空间很宽时，胜过"单次尝试反复迭代"。
- 循环至枯竭（loop-until-dry）：对规模未知的发现（bug、问题、边界情况），持续派生 finder，直到连续 K 轮再无新东西。简单的计数器（while count < N）会漏掉长尾。
- 多模态扫查：并行的代理各以不同方式搜索（按容器、按内容、按实体、按时间）。每个都看不见别的所浮现的；当单一搜索角度找不全时有用。
- 完备性批评者：一个收尾的代理，发问"缺了什么——某模态没跑、某主张未核验、某来源没读？"它找出的东西成为下一轮工作。
- 不做静默上限：若一个工作流限定了覆盖范围（top-N、不重试、抽样），用 \`log()\` 记录被丢弃了什么——静默截断会被读成"全覆盖了"，其实并没有。

按用户所求的规模来伸缩。"find any bugs" → 少量 finder、单票核验。"thoroughly audit this" 或 "be comprehensive" → 更大的 finder 池、3–5 票对抗性核验、综合阶段。不确定时，对研究/评审/审计类请求倾向于周密，对快速核查倾向于简短。

这些范式并不穷尽——当任务需要时，组合出新的编排架构（锦标赛淘汰、自修复循环、分级升级，随需而定）。

用此工具做多步骤编排——即控制流应当确定性（循环、条件、扇出）而非由模型驱动的场景。

## 续跑（Resume）

工具结果包含一个 runId。要在失败或脚本编辑后续跑，以 Workflow({scriptPath, resumeFromRunId}) 重新启动——agent() 调用中最长的未改动前缀即刻返回缓存结果；第一个被编辑/新增的调用及其之后的一切实时运行。相同脚本 + 相同 args → 100% 缓存命中。缓存存在会话内存中：续跑仅在同一会话内有效，而一个先前返回 null 的匹配 agent() 调用会实时重跑、且不破坏前缀。脚本中无法使用 Date.now()/Math.random()/new Date()（它们会破坏这一点）——在工作流返回后再盖时间戳，或经 args 传入时间戳。`;

/**
 * Provenance for the tool-description surface (Track B): which archive fragments
 * each faithful description draws from. A corpus-sync guard
 * (tests/tool-descriptions-provenance.test.ts) verifies each cited fragment's
 * content still appears in the description, so upstream drift fails a test
 * instead of diverging silently. `faithful` marks a reproduction assembled from
 * the cited archive fragments (adapted only by the documented rules above — tool
 * names, omitted sandbox/PowerShell, stripped CLI footers).
 */
export interface ToolDescriptionProvenance {
  tool: string;
  slugs: string[];
  faithful: boolean;
}

export const TOOL_DESCRIPTION_PROVENANCE: ToolDescriptionProvenance[] = [
  {
    tool: 'Bash',
    faithful: true,
    slugs: [
      'tool-description-bash-overview',
      'tool-description-bash-maintain-cwd',
      'tool-description-bash-timeout',
      'tool-description-bash-quote-file-paths',
      'tool-description-bash-verify-parent-directory',
      'tool-description-bash-prefer-dedicated-tools',
      'tool-description-bash-git-avoid-destructive-ops',
      'tool-description-bash-git-never-skip-hooks',
      'tool-description-bash-git-prefer-new-commits',
      'tool-description-bash-git-commit-and-pr-creation-instructions',
    ],
  },
  // Read / Edit / Write / Grep / Glob: TRANSLATED to Chinese in-place (i18n-zh
  // batch 1, keeper 2026-07-08 ruling B). No longer faithful English
  // reproductions, so removed from the English corpus-sync guard — their
  // Chinese descriptions are covered by tests/tool-descriptions-i18n-zh.test.ts.
  // TodoWrite / TaskCreate / TaskGet / TaskUpdate / TaskList / WebFetch /
  // WebSearch / AskUserQuestion / ExitPlanMode / EnterWorktree: TRANSLATED to
  // Chinese in-place (i18n-zh batch 2). Monitor: TRANSLATED (i18n-zh batch 3).
  // Workflow: TRANSLATED (i18n-zh batch 4). All removed from the English
  // corpus-sync guard; covered by tests/tool-descriptions-i18n-zh.test.ts.
  // Bash stays English (later batch — safety-critical git/sandbox prose).
];

/** The description text for each provenance-tracked tool (for the corpus-sync guard). */
export const TOOL_DESCRIPTION_TEXT: Record<string, string> = {
  Bash: BASH_DESCRIPTION,
  Read: READ_DESCRIPTION,
  Edit: EDIT_DESCRIPTION,
  Write: WRITE_DESCRIPTION,
  Grep: GREP_DESCRIPTION,
  Glob: GLOB_DESCRIPTION,
  TodoWrite: TODOWRITE_DESCRIPTION,
  TaskCreate: TASKCREATE_DESCRIPTION,
  TaskGet: TASKGET_DESCRIPTION,
  TaskUpdate: TASKUPDATE_DESCRIPTION,
  TaskList: TASKLIST_DESCRIPTION,
  WebFetch: WEBFETCH_DESCRIPTION,
  WebSearch: WEBSEARCH_DESCRIPTION,
  AskUserQuestion: ASKUSERQUESTION_DESCRIPTION,
  ExitPlanMode: EXITPLANMODE_DESCRIPTION,
  EnterWorktree: ENTERWORKTREE_DESCRIPTION,
  Monitor: MONITOR_DESCRIPTION,
  Workflow: WORKFLOW_DESCRIPTION,
};

// ---------------------------------------------------------------------------
// Bash sandbox note (G-SANDBOX) — faithful fragment store, GATED on an active
// sandbox. Assembled by buildBashSandboxNote and appended to the Bash
// description only when a backend resolves (createBashTool). Composition order
// is ours (the official 438-token note's exact internal order is not
// recoverable from the atomized archive); the corpus-sync guard checks
// per-fragment fidelity, not order.
// ---------------------------------------------------------------------------

/** One reproduced sandbox-note fragment (Track B provenance shape). */
export interface SandboxNoteFragment {
  id: string;
  /** Archive slug this fragment reproduces (empty for adapted glue). */
  slug: string;
  faithful: boolean;
  text: string;
}

/** Every reproduced/adapted sandbox-note fragment, keyed by id. */
export const BASH_SANDBOX_FRAGMENTS: SandboxNoteFragment[] = [
  {
    id: 'framing',
    slug: '',
    faithful: false,
    text: 'Commands run inside a sandbox by default. Writes are limited to the working directory and approved paths.',
  },
  {
    id: 'default-to-sandbox',
    slug: 'tool-description-bash-sandbox-default-to-sandbox',
    faithful: true,
    text: 'You should always default to running commands within the sandbox. Do NOT attempt to set `dangerouslyDisableSandbox: true` unless:',
  },
  {
    id: 'condition-user-request',
    slug: '',
    faithful: false,
    text: 'The user explicitly asks you to run a command outside the sandbox.',
  },
  {
    id: 'user-permission-prompt',
    slug: 'tool-description-bash-sandbox-user-permission-prompt',
    faithful: true,
    text: 'This will prompt the user for permission',
  },
  {
    id: 'failure-evidence-condition',
    slug: 'tool-description-bash-sandbox-failure-evidence-condition',
    faithful: true,
    text: 'A specific command just failed and you see evidence of sandbox restrictions causing the failure. Note that commands can fail for many reasons unrelated to the sandbox (missing files, wrong arguments, network issues, etc.).',
  },
  {
    id: 'evidence-list-header',
    slug: 'tool-description-bash-sandbox-evidence-list-header',
    faithful: true,
    text: 'Evidence of sandbox-caused failures includes:',
  },
  {
    id: 'evidence-access-denied',
    slug: 'tool-description-bash-sandbox-evidence-access-denied',
    faithful: true,
    text: 'Access denied to specific paths outside allowed directories',
  },
  {
    id: 'evidence-operation-not-permitted',
    slug: 'tool-description-bash-sandbox-evidence-operation-not-permitted',
    faithful: true,
    text: '"Operation not permitted" errors for file/network operations',
  },
  {
    id: 'evidence-network-failures',
    slug: 'tool-description-bash-sandbox-evidence-network-failures',
    faithful: true,
    text: 'Network connection failures to non-whitelisted hosts',
  },
  {
    id: 'evidence-unix-socket-errors',
    slug: 'tool-description-bash-sandbox-evidence-unix-socket-errors',
    faithful: true,
    text: 'Unix socket connection errors',
  },
  {
    id: 'response-header',
    slug: 'tool-description-bash-sandbox-response-header',
    faithful: true,
    text: 'When you see evidence of sandbox-caused failure:',
  },
  {
    id: 'retry-without-sandbox',
    slug: 'tool-description-bash-sandbox-retry-without-sandbox',
    faithful: true,
    text: 'Immediately retry with `dangerouslyDisableSandbox: true` (don\'t ask, just do it)',
  },
  {
    // ADAPTED: the archive's -explain-restriction second sentence points at a
    // `/sandbox` command this SDK does NOT ship (red line: never reference an
    // unshipped capability). Keep the faithful first sentence; the settings
    // pointer is carried by the faithful -adjust-settings fragment below.
    id: 'explain-restriction',
    slug: '',
    faithful: false,
    text: 'Briefly explain what sandbox restriction likely caused the failure.',
  },
  {
    id: 'adjust-settings',
    slug: 'tool-description-bash-sandbox-adjust-settings',
    faithful: true,
    text: 'If a command fails due to sandbox restrictions, work with the user to adjust sandbox settings instead.',
  },
  {
    id: 'per-command',
    slug: 'tool-description-bash-sandbox-per-command',
    faithful: true,
    text: 'Treat each command you execute with `dangerouslyDisableSandbox: true` individually. Even if you have recently run a command with this setting, you should default to running future commands within the sandbox.',
  },
  {
    id: 'no-sensitive-paths',
    slug: 'tool-description-bash-sandbox-no-sensitive-paths',
    faithful: true,
    text: 'Do not suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to the sandbox allowlist.',
  },
  {
    id: 'tmpdir',
    slug: 'tool-description-bash-sandbox-tmpdir',
    faithful: true,
    text: 'For temporary files, always use the `$TMPDIR` environment variable. TMPDIR is automatically set to the correct sandbox-writable directory in sandbox mode. Do NOT use `/tmp` directly - use `$TMPDIR` instead.',
  },
  {
    id: 'mandatory-mode',
    slug: 'tool-description-bash-sandbox-mandatory-mode',
    faithful: true,
    text: 'All commands MUST run in sandbox mode - the `dangerouslyDisableSandbox` parameter is disabled by policy.',
  },
  {
    id: 'no-exceptions',
    slug: 'tool-description-bash-sandbox-no-exceptions',
    faithful: true,
    text: 'Commands cannot run outside the sandbox under any circumstances.',
  },
];

const FRAG = new Map(BASH_SANDBOX_FRAGMENTS.map((f) => [f.id, f.text]));
const frag = (id: string): string => FRAG.get(id) ?? '';

/**
 * Assemble the Bash sandbox note. `default` mode advertises the escape hatch
 * (dangerouslyDisableSandbox); `mandatory` mode never mentions it (the param
 * is disabled by policy). The network-failure evidence bullet is included ONLY
 * when the sandbox actually isolates the network (allowNetwork false) — a red
 * line: never describe a restriction that is not active.
 */
export function buildBashSandboxNote(
  mode: 'default' | 'mandatory',
  allowNetwork = false,
): string {
  if (mode === 'mandatory') {
    return [
      '# Sandbox',
      frag('framing') + (allowNetwork ? '' : ' Network access is disabled.'),
      frag('mandatory-mode'),
      frag('no-exceptions'),
      frag('adjust-settings'),
      frag('no-sensitive-paths'),
      frag('tmpdir'),
    ].join('\n\n');
  }
  const evidence = [
    '- ' + frag('evidence-access-denied'),
    '- ' + frag('evidence-operation-not-permitted'),
    ...(allowNetwork ? [] : ['- ' + frag('evidence-network-failures')]),
    '- ' + frag('evidence-unix-socket-errors'),
  ].join('\n');
  return [
    '# Sandbox',
    frag('framing') + (allowNetwork ? '' : ' Network access is disabled.'),
    frag('default-to-sandbox'),
    '- ' + frag('condition-user-request') + ' ' + frag('user-permission-prompt') + '.',
    '- ' + frag('failure-evidence-condition'),
    frag('evidence-list-header') + '\n' + evidence,
    frag('response-header'),
    '- ' + frag('retry-without-sandbox'),
    '- ' + frag('explain-restriction') + ' ' + frag('adjust-settings'),
    frag('per-command'),
    frag('no-sensitive-paths'),
    frag('tmpdir'),
  ].join('\n\n');
}
