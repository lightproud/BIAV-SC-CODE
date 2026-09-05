<!--
name: "Data: SDK error result user message UUID field"
description: "Schema description for the optional user_message_uuid join key on SDK error results, including delivery-failure queue keys, exclusions, and backward compatibility"
ccVersion: "2.1.246"
-->
Client uuid of the user message that triggered this turn (submitMessage options.uuid), echoed back so a consumer can link this error result to the send it answers — the same join key the success variant echoes, carried alone (error turns have no request_sent_wall_ms to report). A delivery-failure result from the remote-session client echoes the failed send's queue key, which is client-minted when the host sent no uuid of its own. Absent on synthetic/scheduled (meta) turns, on turns without a client uuid, on session-scoped failures with no single triggering send (a crashed worker's zeroed result), and from older producers.
