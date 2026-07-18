# Changelog — @biav/orchestrator-sdk

Own semver clock, decoupled from @biav/agent-sdk by requirement (SCS-REQ
orchestrator-sdk §2): the two packages never bump in lockstep. Same ledger
discipline as the agent SDK: every merge that changes shipped runtime code
bumps the version and adds one line here.

## 0.1.0 — 2026-07-18

Phase 0 (monorepo migration): package created empty. Public surface is the
version constant only; capability modules (task ledger, driver, loop
scaffold, schedule, workflow graph) land in their own campaigns.
