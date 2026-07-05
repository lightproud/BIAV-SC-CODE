/**
 * Tool descriptions for the BPT Agent SDK.
 *
 * These are FAITHFUL OPEN REPRODUCTIONS of the official Claude Code agent tool
 * descriptions, assembled/adapted from the public reconstruction archived under
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
 *    (B4b batch).
 *    No Agent-in-descriptions, Workflow, NotebookEdit, MultiEdit, Skill, etc.
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
 *  - Read: the PDF and Jupyter bullets are ADAPTED to this SDK's actual
 *    behavior (whole-document PDF reads, no pages slicing; notebooks as raw
 *    JSON text) — the official wording describes capabilities not shipped here.
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

export const READ_DESCRIPTION = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- This tool allows you to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as this is a multimodal model.
- This tool can read PDF files (.pdf). The whole document is returned as a single PDF content block; page-range reads via the pages parameter are not supported (a read with pages set returns an explicit error), so omit pages and read the document whole.
- Jupyter notebooks (.ipynb files) are returned as their raw JSON text; cells are not rendered individually.
- This tool can only read files, not directories. To list files in a directory, use the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`;

export const EDIT_DESCRIPTION = `Performs exact string replacements in files.

Usage:
- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- Keep \`old_string\` minimal — usually 1-3 lines, only enough to be unique in the file. Including excess context wastes tokens and is an error.
- The edit will FAIL if \`old_string\` is not unique in the file. In that case, add the minimum extra context needed for uniqueness, or use \`replace_all\` to change every instance.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`;

export const WRITE_DESCRIPTION = `Writes a file to the local filesystem, overwriting if one exists.

When to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;

export const GREP_DESCRIPTION = `A powerful search tool built on ripgrep

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke \`grep\` or \`rg\` as a Bash command. The Grep tool has been optimized for correct permissions and access.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
- Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\``;

export const GLOB_DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns`;

export const TODOWRITE_DESCRIPTION = `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`;

export const TASKCREATE_DESCRIPTION = `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks`;

export const TASKGET_DESCRIPTION = `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.`;

export const TASKUPDATE_DESCRIPTION = `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

Mark task as completed after finishing work:
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

Delete a task:
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

Claim a task by setting owner:
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\``;

export const TASKLIST_DESCRIPTION = `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Unique task identifier
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description.`;

export const WEBFETCH_DESCRIPTION = `- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
- IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
- The URL must be a fully-formed valid URL
- HTTP URLs will be automatically upgraded to HTTPS
- The prompt should describe what information you want to extract from the page
- This tool is read-only and does not modify any files
- Results may be summarized if the content is very large
- Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
- When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
- For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).`;

export const WEBSEARCH_DESCRIPTION = `- Allows the model to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond the model's knowledge cutoff
- Searches are performed automatically within a single API call

CRITICAL REQUIREMENT - You MUST follow this:
- After answering the user's question, you MUST include a "Sources:" section at the end of your response
- In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
- This is MANDATORY - never skip including sources in your response
- Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)

Usage notes:
- Domain filtering is supported to include or block specific websites
- Web search is only available in the US

IMPORTANT - Use the correct year in search queries:
- You MUST use the current year when searching for recent information, documentation, or current events.
- Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year`;

export const ASKUSERQUESTION_DESCRIPTION = `Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

export const EXITPLANMODE_DESCRIPTION = `Use this tool when you are in plan mode and have finished presenting your plan and are ready for user approval to begin implementing.

## How This Tool Works
- You should have already presented your complete plan in the conversation before calling this tool
- This tool does NOT take the plan content as a parameter - it signals that you're done planning and ready to implement
- On approval the session's permission mode exits plan mode, so implementation tools (Write, Edit, Bash) can run
- Optionally pass allowedPrompts to declare the Bash permissions your plan will need

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Before Using This Tool
Ensure your plan is complete and unambiguous:
- If you have unresolved questions about requirements or approach, use AskUserQuestion first (in earlier phases)
- Once your plan is finalized, use THIS tool to request approval

**Important:** Do NOT use AskUserQuestion to ask "Is this plan okay?" or "Should I proceed?" - that's exactly what THIS tool does. ExitPlanMode inherently requests user approval of your plan.

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.`;

export const ENTERWORKTREE_DESCRIPTION = `Use this tool ONLY when explicitly instructed to work in a worktree — either by the user directly, or by project instructions (CLAUDE.md / memory). This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")
- CLAUDE.md or memory instructions direct you to work in a worktree for the current task

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless worktrees are explicitly requested by the user or project instructions
- Never use this tool unless "worktree" is explicitly mentioned by the user or in CLAUDE.md / memory instructions

## Requirements

- Must be in a git repository
- Must not already be in a worktree session when creating a new worktree (\`name\`); switching into another existing worktree via \`path\` is allowed

## Behavior

- Creates a new git worktree inside \`.claude/worktrees/\` on a new branch, branched from your current local HEAD
- Switches the session's working directory to the new worktree

## Entering an existing worktree

Pass \`path\` instead of \`name\` to switch the session into a worktree that already exists (e.g., one you just created with \`git worktree add\`). The path must appear in \`git worktree list\` for the current repository — paths that are not registered worktrees of this repo are rejected.

## Parameters

- \`name\` (optional): A name for a new worktree. If neither \`name\` nor \`path\` is provided, a random name is generated.
- \`path\` (optional): Path to an existing worktree of the current repository to enter instead of creating one. Mutually exclusive with \`name\`.`;

export const MONITOR_DESCRIPTION = `Start a background monitor that watches a long-running script. Each stdout line is an event. Events accumulate on the returned background task id — this SDK does not push them into the conversation. Read new events with BashOutput (pass the returned taskId as bash_id) and stop the watch with KillShell.

Pick by how many events you need:
- **One** ("tell me when the server is ready / the build finishes") → use **Bash with \`run_in_background\`** and a command that exits when the condition is true, e.g. \`until grep -q "Ready in" dev.log; do sleep 0.5; done\`. Its exit is the single event.
- **One per occurrence, indefinitely** ("tell me every time an ERROR line appears") → Monitor with an unbounded command (\`tail -f\`, \`inotifywait -m\`, \`while true\`).
- **One per occurrence, until a known end** ("emit each CI step result, stop when the run completes") → Monitor with a command that emits lines and then exits.

Your script's stdout is the event stream. Each line is one event. Exit ends the watch.

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

**Don't use an unbounded command for a single event.** \`tail -f\`, \`inotifywait -m\`, and \`while true\` never exit on their own, so the monitor stays armed until timeout even after the event has fired. For "tell me when X is ready," use Bash \`run_in_background\` with an \`until\` loop instead. Note that \`tail -f log | grep -m 1 ...\` does *not* fix this: if the log goes quiet after the match, \`tail\` never receives SIGPIPE and the pipeline hangs anyway.

**Script quality:**
- Every pipe stage must flush per line or matches sit in its buffer unseen: \`grep\` needs \`--line-buffered\`, \`awk\` needs \`fflush()\`. \`head\` cannot flush at all — \`| head -N\` delivers nothing until N matches accumulate, then ends the stream.
- In poll loops, handle transient failures (\`curl ... || true\`) — one failed request shouldn't kill the monitor.
- Poll intervals: 30s+ for remote APIs (rate limits), 0.5-1s for local checks.
- Write a specific \`description\` — it labels the watch ("errors in deploy.log" not "watching logs").
- Only stdout is the event stream. Stderr is captured separately (BashOutput shows it under [stderr]) — for a command you run directly (e.g. \`python train.py 2>&1 | grep --line-buffered ...\`), merge stderr with \`2>&1\` so its failures reach your filter. (No effect on \`tail -f\` of an existing log — that file only contains what its writer redirected.)

**Coverage — silence is not success.** When watching a job or process for an outcome, your filter must match every terminal state, not just the happy path. A monitor that greps only for the success marker stays silent through a crashloop, a hung process, or an unexpected exit — and silence looks identical to "still running." Before arming, ask: *if this process crashed right now, would my filter emit anything?* If not, widen it.

  # Wrong — silent on crash, hang, or any non-success exit
  tail -f run.log | grep --line-buffered "elapsed_steps="

  # Right — one alternation covering progress + the failure signatures you'd act on
  tail -f run.log | grep -E --line-buffered "elapsed_steps=|Traceback|Error|FAILED|assert|Killed|OOM"

For poll loops checking job state, emit on every terminal status (\`succeeded|failed|cancelled|timeout\`), not just success. If you cannot confidently enumerate the failure signatures, broaden the grep alternation rather than narrow it — some extra noise is better than missing a crashloop.

**Output volume**: every stdout line accumulates toward the background-output cap, so the filter should be selective — but selective means "the lines you'd act on," not "only good news." Never pipe raw logs; filter to exactly the success and failure signals you care about.

The script runs in the same shell environment as Bash. Exit ends the watch (exit code is reported). Timeout → killed (default 600000ms; \`persistent: true\` disables the timeout for session-length watches such as PR monitoring or log tails — the monitor then runs until KillShell or the session ends). Use KillShell to cancel early.`;

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
  { tool: 'Read', faithful: true, slugs: ['tool-description-readfile'] },
  { tool: 'Edit', faithful: true, slugs: ['tool-description-edit'] },
  { tool: 'Write', faithful: true, slugs: ['tool-description-write', 'tool-description-write-read-existing-file-first'] },
  { tool: 'Grep', faithful: true, slugs: ['tool-description-grep'] },
  { tool: 'Glob', faithful: true, slugs: ['tool-description-glob'] },
  { tool: 'TodoWrite', faithful: true, slugs: ['tool-description-todowrite'] },
  { tool: 'TaskCreate', faithful: true, slugs: ['tool-description-taskcreate'] },
  { tool: 'TaskGet', faithful: true, slugs: ['tool-description-task-get'] },
  { tool: 'TaskUpdate', faithful: true, slugs: ['tool-description-taskupdate'] },
  { tool: 'TaskList', faithful: true, slugs: ['tool-description-tasklist'] },
  { tool: 'WebFetch', faithful: true, slugs: ['tool-description-webfetch'] },
  { tool: 'WebSearch', faithful: true, slugs: ['tool-description-websearch'] },
  { tool: 'AskUserQuestion', faithful: true, slugs: ['tool-description-askuserquestion'] },
  { tool: 'ExitPlanMode', faithful: true, slugs: ['tool-description-exitplanmode'] },
  { tool: 'EnterWorktree', faithful: true, slugs: ['tool-description-enterworktree'] },
  {
    tool: 'Monitor',
    faithful: true,
    slugs: ['tool-description-background-monitor-streaming-events'],
  },
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
