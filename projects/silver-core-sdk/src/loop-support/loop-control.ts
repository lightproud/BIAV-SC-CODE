/**
 * R5 LoopControl tool (SCS-REQ-REPOS-01 §3 R5) — the model-side surface of a
 * host-built loop.
 *
 * Semantics: the model can only PROPOSE stopping. A call delivers the
 * proposal to the host as a structured event (the `onProposal` callback the
 * host wired at assembly); whether the loop continues is the HOST's decision.
 * The engine's own behavior never changes on a proposal — the tool_result
 * explicitly tells the model to keep working until instructed otherwise.
 *
 * Opt-in export: the tool is REGISTERED only when the host passes
 * `options.loopControl` at assembly; it is never part of the default
 * built-in set.
 *
 * Chase note (the requirement's single chase precondition): no official
 * command-tool-surface schema corpus is available in the archive
 * (`Public-Info-Pool/Reference/Claude-Code-System-Prompts/` carries prompt
 * snapshots, not tool schemas), so this shape is SELF-DESIGNED per the
 * requirement's draft and marked "待对齐" (pending alignment) in
 * docs/COMPAT.md; it will be revised if a corpus lands.
 */

import type { BuiltinTool, ToolResultPayload } from '../internal/contracts.js';
import type { LoopStopProposal } from '../types.js';

export const LOOP_CONTROL_TOOL_NAME = 'LoopControl';

/** Host wiring for the LoopControl tool (see `Options.loopControl`). */
export type LoopControlOptions = {
  /** Receives each stop proposal as a structured event. Host-owned; a throw
   *  here is contained (debug-logged) and never breaks the turn. */
  onProposal?: (proposal: LoopStopProposal) => void;
};

const ACK =
  'Stop proposal recorded and delivered to the host. The host decides ' +
  'whether the loop continues — keep working until instructed otherwise.';

/** Build the LoopControl builtin (registered opt-in by query assembly). */
export function createLoopControlTool(opts: LoopControlOptions): BuiltinTool {
  return {
    name: LOOP_CONTROL_TOOL_NAME,
    description:
      'Propose that the host stop the current loop. The proposal is ' +
      'delivered to the host as a structured event; the host alone decides ' +
      'whether the loop continues — calling this tool does not stop, pause, ' +
      'or change anything by itself. Use it when the loop objective appears ' +
      'complete, or when continuing appears pointless or harmful. Give a ' +
      'concrete reason the host can act on.',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose_stop'],
          description: 'The only supported action: propose stopping the loop.',
        },
        reason: {
          type: 'string',
          description: 'Why the loop should stop (shown to the host).',
        },
      },
      required: ['action', 'reason'],
    },
    async execute(input, ctx): Promise<ToolResultPayload> {
      const action = input['action'];
      if (action !== 'propose_stop') {
        return {
          content: `LoopControl failed: unsupported action ${JSON.stringify(action)}; the only supported action is "propose_stop".`,
          isError: true,
        };
      }
      const reason = input['reason'];
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return {
          content: 'LoopControl failed: "reason" must be a non-empty string.',
          isError: true,
        };
      }
      const proposal: LoopStopProposal = { action: 'propose_stop', reason };
      try {
        opts.onProposal?.(proposal);
      } catch (err) {
        // Host callback errors are the host's problem — contain them so the
        // engine's behavior stays proposal-independent.
        ctx.debug(
          `LoopControl: onProposal callback threw (${err instanceof Error ? err.message : String(err)}); proposal still acknowledged`,
        );
      }
      ctx.debug(`LoopControl: stop proposed — ${reason}`);
      return { content: ACK };
    },
  };
}
