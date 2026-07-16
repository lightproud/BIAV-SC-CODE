<!--
name: 'Data: Context tip situation — subagent fan-out'
description: Situation text for detecting when repeated independent subtasks should be fanned out to subagents
ccVersion: 2.1.203
-->
User has a batch of similar, independent subtasks — "do X for each of these modules", "update all twelve services", "write a test for each of these handlers" — and Claude is working through them one at a time in the main conversation. Also matches when the user asks "can you do these in parallel?" or comments on how long the sequential pass is taking. IMPORTANT: Do NOT match one broad investigation (that is parallel-investigation), multi-stage orchestration with control flow between stages (that is workflow-orchestration), or steps that depend on each other's results.
