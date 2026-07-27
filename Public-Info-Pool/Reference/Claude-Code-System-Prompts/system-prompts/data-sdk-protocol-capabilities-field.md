<!--
name: "Data: SDK protocol capabilities field"
description: "Schema description for the optional system init capabilities list used by SDK consumers to feature-detect interrupt receipt and queued-cancellation behavior"
ccVersion: "2.1.219"
-->
Protocol capabilities this CLI supports, so SDK consumers can feature-detect instead of version-sniffing. Open set — ignore unknown values; check each capability for exactly the behavior you use. 'interrupt_receipt_v1' = the interrupt control_response success payload carries still_queued (uuids of async user messages that survive the interrupt). 'interrupt_cancel_queued_v1' = the interrupt control_request honors cancel_queued:true (queued and pending-dispatch commands are cancelled alongside the abort, listed on the response's cancelled field; still_queued is always empty — including any uuid that was mid-fold at the interrupt instant, since this request also aborts and the fold never delivers it). Absent on older CLIs.
