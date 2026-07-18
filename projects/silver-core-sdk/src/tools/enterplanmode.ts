/**
 * EnterPlanMode built-in tool — the mirror of ExitPlanMode (audit 2026-07-15
 * tool-parity gap: the SDK shipped the "exit" half of the plan-mode pair but
 * not the "enter" half).
 *
 * Semantics in THIS SDK (which has a real `plan` permission mode on the gate —
 * src/permissions/gate.ts step 6 — but no plan-file machinery):
 *
 *  - Like ExitPlanMode, it flips the session's permission MODE through the
 *    gate handle carried on ToolContext (`permissionGate`, a formal field
 *    since the 2026-07-10 audit batch). It switches the gate to 'plan' so the
 *    agent explores read-only and presents a plan for approval; ExitPlanMode
 *    switches back.
 *  - Wired + mode is NOT already 'plan': switch to 'plan', report the
 *    transition.
 *  - Wired + mode already 'plan': explicit error (nothing to enter).
 *  - Not wired: explicit error, permission mode untouched (behavior-honesty
 *    red line — no silent pretending).
 *
 * readOnly: true — it only flips session permission-mode state and never
 * touches files. Entering plan mode only ever RESTRICTS (plan mode denies
 * non-readOnly tools), so auto-approving the entry is safe; hosts keep a veto
 * via a PreToolUse hook / disallowedTools rule on 'EnterPlanMode' (gate steps
 * 1-2 run before the readOnly auto-allow).
 */

import type { BuiltinTool, ToolContext, ToolResultPayload } from '../internal/contracts.js';
import type { PermissionMode } from '../types.js';
import { AbortError } from '../errors.js';
import { ENTERPLANMODE_DESCRIPTION } from './descriptions.js';

/**
 * Per-gate memory of the permission mode active when plan mode was entered, so
 * ExitPlanMode can restore it instead of hard-coding 'default' (audit r4 U3-1).
 * Keyed by the gate object — the query's single, stable permission gate across
 * turns (query.ts and the subagent runtime thread the SAME reference into every
 * turn's ToolContext), so an enter-then-explore-then-exit round trip resolves to
 * the same key. A WeakMap keeps this off the gate contract and self-clears when
 * the gate is collected.
 */
const priorModeByGate = new WeakMap<object, PermissionMode>();

/** Record the mode active before plan mode (called by EnterPlanMode at entry). */
export function recordPriorPlanMode(gate: object, mode: PermissionMode): void {
  priorModeByGate.set(gate, mode);
}

/** Consume the recorded pre-plan mode for a gate (called by ExitPlanMode).
 *  undefined when plan mode was not entered through EnterPlanMode. */
export function takePriorPlanMode(gate: object): PermissionMode | undefined {
  const mode = priorModeByGate.get(gate);
  priorModeByGate.delete(gate);
  return mode;
}

export const enterPlanModeTool: BuiltinTool = {
  name: 'EnterPlanMode',
  description: ENTERPLANMODE_DESCRIPTION,
  // Session permission-mode state only; never touches files. See file header
  // for why readOnly is safe here (entering plan mode only restricts).
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {},
  },
  async execute(
    _input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const gate = ctx.permissionGate;
    if (gate === undefined) {
      return {
        content:
          'EnterPlanMode failed: no permission-mode controller is wired on this ' +
          'tool context (the host must expose the permission gate as ' +
          '`permissionGate` on the ToolContext). The permission mode was NOT ' +
          'changed.',
        isError: true,
      };
    }

    const mode = gate.getMode();
    if (mode === 'plan') {
      return {
        content: 'EnterPlanMode failed: the session is already in plan mode.',
        isError: true,
      };
    }

    // audit r4 U3-1: remember the pre-plan mode so ExitPlanMode restores it
    // (e.g. acceptEdits) instead of silently dropping it to 'default'. `mode` is
    // guaranteed != 'plan' by the guard above.
    recordPriorPlanMode(gate, mode);
    gate.setMode('plan');
    ctx.debug(`EnterPlanMode: permission mode ${mode} -> plan`);
    return {
      content:
        `Entered plan mode. Permission mode: ${mode} -> plan. Explore the ` +
        'codebase read-only and present a plan for approval; call ExitPlanMode ' +
        'once the user approves to resume implementation.',
    };
  },
};
