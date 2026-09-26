<!--
name: "Data: SDK assistant user message UUID field"
description: "Schema description for the optional user_message_uuid join key on the first SDK assistant reply frame, including partial-stream placement, exclusions, and backward compatibility"
ccVersion: "2.1.246"
-->
Client uuid of the user message that triggered this turn (submitMessage options.uuid), stamped on the turn's FIRST reply frame only — the first assistant message in complete-message mode; with --include-partial-messages the stamp normally rides the first non-ping stream event instead (see SDKPartialAssistantMessage), and a turn that produces no stream events still stamps its first assistant message — so a consumer can bind the reply to the send it answers without waiting for the result. Wrapper-level sibling — never inside `message.content` — so it is not replayed to the model. Absent on every later frame of the turn, on subagent frames (parent_tool_use_id set), on synthetic/scheduled (meta) turns, on turns without a client uuid, and from older producers.
