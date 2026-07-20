# Onboarding — silver-core-sdk in 30 minutes

Goal: get a new maintainer from zero to "I can make a change safely and prove
it works" in half an hour. Read top to bottom once; keep it open for the
tripwires in §6.

## 1. What this is (2 min)

`silver-core-sdk` is an independent TypeScript agent harness whose **public API is
drop-in compatible** with `@anthropic-ai/claude-agent-sdk`, but whose **engine
drives the Anthropic Messages API directly** (`fetch` + SSE) — no bundled CLI,
no subprocess. It exists so BPT Desktop can run agents without the forbidden
`claude.exe` engine. Same sockets, self-built motor.

- Mental model: the engine is a loop — model thinks → emits tool_use → we run
  the tool → feed the result back → repeat, until an end condition. Everything
  else (permissions, hooks, MCP, sessions, subagents, sandbox) hangs off that
  loop.
- It is a **public-information reproduction**: the default system prompts are an
  open reproduction of the official Claude Code prompts (from a public,
  MIT-licensed reconstruction, with attribution) — not leaked material. See
  `docs/POSITIONING.md`.
- Positioning inside 银芯: a 银芯→黑池 one-way output artifact (firewall-aligned;
  black-pool data never flows back). Non-mission-line engineering product.

## 2. The five-minute tour of the repo

```
src/
  query.ts            # the public query() entrypoint + Query object wiring
  engine/loop.ts      # THE agent loop (turns, tool dispatch, thinking, results)
  transport/          # Messages-API transport (fetch + SSE, retries, watchdog)
  tools/              # built-in tools (Read/Write/Edit/Bash/Glob/Grep/Task/…)
  permissions/        # permission gate + rules + auto classifier
  hooks/              # hook matcher/runner (PreToolUse, PostToolBatch, …)
  mcp/                # MCP registry + stdio/http/sdk servers
  sessions/           # JSONL session store + resume/fork/rename/tag
  subagents/          # Agent tool + subagent runtime (nested loops, fork)
  sandbox/            # Bash sandbox backends (bwrap on Linux)
  generators/ verifier/ tips/   # utility model-calls (titles, verify, context tips)
  types.ts            # the public type surface (Options, SDKMessage, hooks, …)
  internal/contracts.ts         # engine-internal wire types (StreamRequest, …)
tests/                # vitest suite (unit + emulator e2e) — ~mirrors src/
  conformance/        # differential harness vs the official arm (L1-L5) + drift
docs/                 # COMPAT / MIGRATION / ARCHITECTURE / POSITIONING / this
```

Deeper structure lives in `docs/ARCHITECTURE.md`. `CONTEXT.md` is the
session/milestone log — read it for "what's in flight right now."

## 3. Build & test (run these now)

```bash
cd projects/silver-core-sdk
npm ci                 # deps: only fast-glob + zod
npm run typecheck      # tsc --noEmit — must be exit 0
npm run build          # tsc -p — must be exit 0
npx vitest run         # full suite — must be all green (2 skipped = real bwrap)
```

If those four are clean you have a working checkout. The suite runs in ~12s and
is hermetic (no API key, no network) — the emulator-backed e2e test drives the
real transport over local HTTP.

## 4. The authoritative docs (know which is which)

| Doc | Answers |
|---|---|
| `docs/COMPAT.md` | Per-feature tier (FULL / PARTIAL / ACCEPTED / UNSUPPORTED) vs the official SDK. **The map of what's done and what diverges.** |
| `docs/MIGRATION.md` | What a consumer must change when swapping from the official SDK; behavioral differences. |
| `docs/ARCHITECTURE.md` | How the engine is put together. |
| `docs/POSITIONING.md` | Why the residual behavioral gap is structural, not a backlog; the clean-room→public-reproduction ruling. |
| `CHANGELOG.md` | The shipped ledger — one entry per version-bumping merge. |
| `CONTEXT.md` | Current milestone / session context. |
| `../../memory/project-status.md` | The 银芯-wide authority for this project's status (progress numbers live only there). |

## 5. Make your first change safely (the loop)

1. Branch from latest `main`.
2. Change `src/…`, add/adjust a test in the matching `tests/…` file (the suite
   is ~1:1 test:source — find the sibling file and follow its patterns; helpers
   like `MockTransport`, `makeDeps`, `FakeHookRunner` are already there).
3. `npm run typecheck && npm run build && npx vitest run` — all green.
4. If you changed shipped runtime (`src/**` or a runtime dep), **bump the
   version** in `package.json` and add a `CHANGELOG.md` entry (see §6).
5. Update `docs/COMPAT.md` if you changed a feature's tier, and
   `docs/MIGRATION.md` if the change is consumer-visible/behavioral.
6. Open a PR; self-verify (paste the green suite); squash-merge.

## 6. Tripwires (the disciplines that will bite you)

- **Version-bump guard.** A CI guard (`scripts/check-version-bump.mjs`) reds any
  merge that changes `src/**` or a runtime dep without bumping `package.json`'s
  version and adding a CHANGELOG line. Docs/tests/CI-only changes need no bump.
- **Red lines on new capability.** Ship a capability AND its faithful prompt
  reproduction together, with a real caller — never a prompt with no consumer.
  Reproduced prompt text is byte-checked against its archived source
  (provenance + corpus-sync tests). Never invent behavior the official arm
  doesn't have; if you can't verify it, don't claim it (fail-closed/fail-safe).
- **No black-pool inflow.** This is a 银芯→黑池 one-way artifact. Never pull
  internal/black-pool data in. (Repo-wide hard constraint; see root `CLAUDE.md`
  §1.1-HC.)
- **Honest subsets, not fake parity.** A headless direct-API engine legitimately
  can't do some things (no subprocess/CLI/ripgrep/PDF-dep/plugins). Where we
  differ, say so in COMPAT with the reason — don't paper over it. "SUPERSET" (we
  do everything official does plus extras) is fine and counts as FULL for
  drop-in.
- **The conformance suite is the truth serum.** `tests/conformance/` runs the
  same scenarios through our engine and the real official arm and diffs them
  (L1 stream syntax → L5 real-API statistical band). Known differences are
  registered (KD-*), and a ratchet baseline (`baseline.json`) only-grows-green.
  If you change engine behavior, expect the conformance ratchet to have an
  opinion.
- **Drift sentinel + pins.** The official arm is a moving target, so it's
  dual-pinned in `tests/conformance/pins.json`. The weekly drift sentinel
  (`.github/workflows/conformance-drift.yml`) auto-drafts an alignment PR when
  upstream publishes past the pins — but **pins move ONLY by keeper ruling after
  a conformance re-run** (选择性追踪). Don't bump pins casually.
- **Node ≥ 20.3, ESM-only.** `"type": "module"`; cannot be `require()`d.

## 7. Where to go next

- Reading the loop end-to-end: `src/engine/loop.ts` is the spine — start at
  `runAgentLoop`, follow a turn through `computeThinking`, tool dispatch, and
  the result arms.
- The public surface a consumer sees: `src/types.ts` (`Options`, `SDKMessage`,
  hook inputs) + `docs/COMPAT.md` side by side.
- What's currently open / recently shipped: `CHANGELOG.md` top +
  `../../memory/project-status.md` "## Silver Core SDK".
