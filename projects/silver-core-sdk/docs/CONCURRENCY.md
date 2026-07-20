# Running conversations concurrently

The SDK supports true parallelism at three levels: **many conversations** over
one `SessionManager`, **parallel-safe tools within a turn** (grouped
`Promise.all`: read-only tools plus foreground `Agent` calls, which are
`parallelSafe` because each child runs its own isolated loop AND its own
persistent Bash cwd/env namespace — forked from the parent's snapshot at
spawn, so batch-mates' `cd`/`export` never cross-pollute (audit 2026-07-14
M-10); the background-shell registry stays query-wide by design; writes stay
serial), and **background subagents**. This doc is about the first level and
the two knobs that make a large fan-out safe.

## The footgun: pull-driven iteration

`SessionManager.query()` returns a `Query` that only advances when its iterator
is **pulled**. So this runs SEQUENTIALLY even though the manager supports
parallelism — you serialized it yourself by awaiting each drive to completion:

```ts
// WRONG — sequential despite the shared manager
for (const task of tasks) {
  for await (const _ of mgr.query(task)) { /* ... */ }
}
```

## `runConcurrent` — drive N conversations in parallel

```ts
import { createBptSession, runConcurrent } from 'silver-core-sdk';

const mgr = createBptSession({ /* provider, mcpServers, ... */ });
const outcomes = await runConcurrent(
  mgr,
  tasks.map((prompt) => ({ prompt })),      // ManagedTask[] — same args as mgr.query()
  { concurrency: 8 },                        // at most 8 conversations in flight
);
// outcomes are index-aligned with tasks (NOT completion-ordered):
for (const { index, result, error } of outcomes) {
  if (error) console.error(`task ${index} failed`, error);
  else console.log(`task ${index} ->`, result?.subtype);
}
await mgr.close();
```

- **Failure isolation**: a task whose drive throws gets `{ error, result: null }`;
  the batch never rejects — one bad task cannot sink its siblings.
- **`concurrency`** defaults to `min(tasks.length, 8)`.
- **`collectMessages: true`** attaches the full message list per outcome (off by
  default to keep memory flat for large fan-outs).
- **`onMessage(index, message)`** streams every message as it arrives, tagged by
  task index.

## Two bounds, two layers

`runConcurrent`'s `concurrency` bounds **conversations**. Each conversation can
issue many API requests over its life, so under a large fan-out you also want to
bound **requests** to stay under the API rate limit:

```ts
const mgr = createBptSession({
  provider: { maxConcurrentRequests: 12 },   // shared transport gate; env: BPT_MAX_CONCURRENT_REQUESTS
});
```

`maxConcurrentRequests` (default `0` = unlimited) caps concurrent in-flight
Messages API requests through the shared transport. A request holds its slot for
the whole streaming lifetime; excess requests queue FIFO until a slot frees.
Pair the two: `concurrency` keeps you from opening 500 conversations at once;
`maxConcurrentRequests` keeps those conversations from opening 500 API streams at
once.

## What the SDK does NOT coordinate for you

- **Rate-limit sizing** — the transport retries 429 with backoff, but picking the
  concurrency numbers for your account tier is yours.
- **Shared files / external state across conversations** — write-tool
  serialization only holds *within a single conversation-turn*; the
  read-before-write gate is *per-query*. Two parallel conversations editing the
  same file is your lock to hold, not the SDK's.
