# Subagents — integration guide (Claude Code style)

Goal: wire a host (BPT) to the SDK's subagent surface the way Claude Code uses
it — delegate self-contained work to child agents that run in their own context
and report back a single final message. Read §1–§3 to integrate; keep §6 open
for the tripwires.

This is the SDK's own guidance for consuming the subagent API. It documents the
shipped behavior of `src/subagents/*` (`agent-tool.ts` / `agents.ts` /
`runtime.ts`) and `Options.agents` (`src/types.ts`).

## 1. Mental model (2 min)

- **One tool, one contract.** Subagents are spawned through a single built-in
  tool, `Agent` (a.k.a. Task). The child gets ONE user turn — the `prompt` you
  pass — and returns ONE final message to the parent. The child does NOT see the
  parent conversation; the parent does NOT see the child's intermediate steps.
- **Isolated by default, fork to continue.** A default spawn is *isolated*: a
  fresh context, its own system prompt, its own tool set, its own model. Set
  `fork: true` to instead *continue from the parent* — the child inherits the
  parent's history, cached prefix, system prompt, tool set, and model, and is as
  privileged as the parent.
- **Everything hangs off the loop.** Depth tracking, background delivery,
  worktree isolation, and model resolution live in the spawn closure the runtime
  installs on the tool context — not in the tool. The tool is a thin forwarder.

## 2. Wire it in (3 steps)

**Step 1 — register your agents.** Pass `options.agents`, a map of type-name →
`AgentDefinition`:

```ts
import { query, type AgentDefinition } from 'silver-core-sdk';

const agents: Record<string, AgentDefinition> = {
  'code-explorer': {
    description: 'Explore and map a subsystem', // 3-5 words, shown to the model
    prompt: EXPLORER_SYSTEM_PROMPT,             // the child's behavioral contract
    model: 'claude-sonnet-5',                   // FULL id — see §3
    tools: ['Read', 'Grep', 'Glob'],            // allowlist (optional)
    maxTurns: 20,
  },
};

for await (const msg of query({ prompt, options: { agents /* … */ } })) { /* … */ }
```

**Step 2 — the Agent tool is on by default.** `query()` registers `Agent`
automatically unless you bare-disallow or tool-filter it. `general-purpose` is a
valid `subagent_type` even with no `agents` map. Your registered type-names are
enumerated in the tool's `subagent_type` description, so the model knows exactly
what it may request.

**Step 3 — inject concrete model ids.** This is the one thing to get right; see
§3. Everything else has a safe default.

## 3. Model injection (read this or subagents will 400)

The SDK resolves a subagent's model through `resolveModelAlias(model, parent)`
(`src/subagents/agents.ts`). It is family-agnostic — it does not detect "Claude
vs not"; it branches on the STRING shape:

| `model` value | resolves to |
|---|---|
| unset / `'inherit'` | the parent (main-loop) model — safe; runs what the main loop runs |
| one of `opus` / `sonnet` / `haiku` / `fable` | a **hardcoded** id in the SDK's built-in table (e.g. `sonnet → claude-sonnet-4-5`) |
| any other string (a full id) | **passed through verbatim** |

The four short aliases map to Anthropic-official ids that may NOT match your
gateway (idealab), and one (`sonnet → claude-sonnet-4-5`) is a generation stale.

**Rule for the host: always put a FULL gateway id** in `AgentDefinition.model`
(or the Agent tool's `model` param) — never a bare alias — until
`options.modelAliases` ships. A bare `'sonnet'` resolves to the stale
`claude-sonnet-4-5`; your gateway rejects it and the subagent 400s. A full id is
passed through untouched and works.

> Note: this same table backs the compaction summarizer and the utility-call /
> verifier defaults (which hardcode `claude-haiku-4-5`). The proper fix is an
> `options.modelAliases` injection point so bare aliases and stale defaults map
> to your ids in one place; until then, pass full ids at every `model` / `opts.model`
> seam.

## 4. Invocation patterns (Claude Code style)

Pick the mode by the shape of the work — this mirrors how Claude Code delegates.

| Want | Mode | How |
|---|---|---|
| Fan out research / broad multi-file exploration without cluttering the main thread | **isolated** (default) | one `Agent` call per independent unit; give each a complete standalone prompt |
| A child that needs the parent's full context + cached prefix, executes once | **fork** | `fork: true` (or `AgentDefinition.fork`) |
| Long-running work; don't block the main turn | **background** (depth-0 only) | `run_in_background: true`; the result arrives on a later turn |
| Several agents that MUTATE files in parallel without clobbering each other | **worktree** | `isolation: 'worktree'` — each gets a temporary git worktree, auto-removed if left unchanged |

Foreground `Agent` calls batched in one assistant turn run **concurrently**:
the tool is `parallelSafe` (each child runs its own isolated loop), so the
engine groups the batch under one `Promise.all` like read-only tools instead
of awaiting one child at a time. Background exists to not block the *turn* —
it is not a prerequisite for parallelism within the batch.

Delegation discipline (reproduced from the official main-loop prompt — have your
host follow it):

- Delegate only when the subtask is **big or independent enough** to be worth
  it — broad exploration, or a self-contained unit that can run in parallel. For
  a quick lookup or single search, do it directly.
- **Don't duplicate a subagent's work.** If you delegated the research, don't
  also run the same searches in the parent.
- The `prompt` must be **self-contained.** The child sees only it — include every
  path, result, and detail it needs, and have it make reasonable assumptions
  rather than ask follow-up questions.

## 5. Authoring an AgentDefinition

Live knobs (functional in v0.2):

| field | use |
|---|---|
| `description` | 3-5 words; shown to the model as what this type is for |
| `prompt` | the child's system prompt (its behavioral contract). Ignored in fork mode |
| `tools` | tool **allowlist** (restrict what the child can call) |
| `disallowedTools` | tool **denylist** (stacks on the parent's bare disallow) |
| `model` | full gateway id (§3) |
| `maxTurns` | turn cap (default 20; the worker-fork preset uses 200) |
| `permissionMode` | the child's permission mode (an isolated child may override the parent's) |
| `background` | this type backgrounds by default when invoked |
| `fork` | this type forks by default |

Accepted but inert in v0.2 (safe to set for forward-compat; no effect yet):
`skills`, `mcpServers` (the child inherits the parent's servers), `memory`,
`effort`, and `initialPrompt` (main-thread only).

Two ready-made presets ship:

- the synthetic **`general-purpose`** — an isolated research/exploration
  fallback (used for the reserved type and for any unknown `subagent_type`);
- **`WORKER_FORK_AGENT`** — a fork preset (execute-once, `maxTurns` 200). Pair it
  with `buildWorkerForkPrompt(directive)` as the Agent tool's `prompt`.

The coordinator/teams presets are deliberately NOT shipped — they presuppose a
SendMessage/teams tool this SDK does not have; reproducing them would describe a
non-existent capability.

## 6. Tripwires

- **Background is depth-0 only.** A nested subagent cannot itself background; the
  runtime logs a warning and runs it in the foreground.
- **Nesting caps at depth 5** (`MAX_SUBAGENT_DEPTH`). A depth-5 child has no
  `Agent` tool in its set — it cannot spawn further.
- **Fork ignores a batch of fields.** In fork mode `agentDef.model` / `tools` /
  `disallowedTools` / `permissionMode` / `prompt`-as-system are ALL ignored
  (honoring them would break the inherited cached prefix). A fork child is as
  privileged as the parent — do not fork a task you meant to sandbox; use an
  isolated child with a `tools` allowlist for that.
- **The child sees only the `prompt`,** not the conversation. An underspecified
  prompt yields an underspecified result.
- **Bare model aliases 400 on your gateway** (§3). Pass full ids.

## 7. Worked example

```ts
import { query, buildWorkerForkPrompt, WORKER_FORK_AGENT } from 'silver-core-sdk';

const agents = {
  explorer: {
    description: 'Map a subsystem',
    prompt: EXPLORER_SYSTEM_PROMPT,
    model: 'claude-sonnet-5',          // full gateway id, not 'sonnet'
    tools: ['Read', 'Grep', 'Glob'],
  },
  worker: WORKER_FORK_AGENT,           // shipped fork preset
};

// Inside the loop, the model spawns via the Agent tool. Shapes it can request:
//
//   isolated fan-out (default):
//     Agent({ description: 'map auth', prompt: 'Explore src/auth and report …',
//             subagent_type: 'explorer' })
//
//   background isolated (depth 0 only):
//     Agent({ description: 'audit deps', prompt: '…', subagent_type: 'explorer',
//             run_in_background: true })
//
//   fork (privileged continuation, shared cache):
//     Agent({ description: 'apply fix', prompt: buildWorkerForkPrompt('Fix the …'),
//             subagent_type: 'worker', fork: true })
//
//   parallel file edits without conflict:
//     Agent({ description: 'migrate file', prompt: '…', isolation: 'worktree' })

for await (const msg of query({ prompt, options: { agents } })) { /* … */ }
```

## 8. See also

- `docs/ARCHITECTURE.md` — where the subagent runtime sits in the engine.
- `docs/CONCURRENCY.md` — background-task lifecycle and draining.
- `src/subagents/agents.ts` — the presets, `resolveAgentDefinition`, and
  `resolveModelAlias` (§3).
