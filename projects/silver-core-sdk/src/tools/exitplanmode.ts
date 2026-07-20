/**
 * ExitPlanMode built-in tool (B4b batch).
 *
 * Official input (0.3.201 docs snapshot): `{ allowedPrompts?: Array<{ tool:
 * 'Bash'; prompt: string }> }` — "Exits planning mode. Optionally specifies
 * prompt-based permissions needed to implement the plan."
 *
 * Semantics in THIS SDK (which has a real `plan` permission mode on the
 * gate — src/permissions/gate.ts step 6 — but no plan-file machinery):
 *
 *  - The tool needs a live handle on the session's permission gate to flip
 *    the mode. ToolContext does not carry one today, so the tool reads an
 *    OPTIONAL, duck-typed `permissionGate` property off the context
 *    (`PlanModeControl` below). WIRING POINT (out of this batch's file
 *    scope): query.ts builds the per-turn ToolContext (~line 1281) with the
 *    gate in scope — add `permissionGate: gate` there (and the subagent
 *    runtime's child context equivalently) to activate real mode switching.
 *  - Wired + mode 'plan': the call restores the permission mode active BEFORE
 *    plan mode was entered (recorded by EnterPlanMode; 'default' when plan mode
 *    was entered by other means, e.g. a host setPermissionMode) and reports the
 *    transition (audit r4 U3-1). allowedPrompts are ECHOED BUT NOT APPLIED — this gate has
 *    no prompt-based (natural-language) Bash rules, and mistranslating them
 *    into pattern rules would grant the wrong thing; the result says so
 *    explicitly (behavior-honesty red line: no silent pretending).
 *  - Wired + mode not 'plan': explicit error (nothing to exit).
 *  - Not wired: explicit error, permission mode untouched.
 *
 * readOnly: true — REQUIRED for the tool to be callable at all in plan mode
 * (gate step 6 denies every non-readOnly tool there, which would deadlock the
 * exit). It never touches files; the "approval flow" veto point for hosts is
 * a PreToolUse hook or a disallowedTools rule on 'ExitPlanMode', both of which
 * run BEFORE the readOnly auto-allow.
 */

import type {
  BuiltinTool,
  PermissionGate,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import { AbortError } from '../errors.js';
import { EXITPLANMODE_DESCRIPTION } from './descriptions.js';
import { takePriorPlanMode } from './enterplanmode.js';

/** The slice of the permission gate ExitPlanMode needs (duck-typed context extension). */
export type PlanModeControl = Pick<PermissionGate, 'getMode' | 'setMode'>;

/** @deprecated `permissionGate` is a formal ToolContext field since the
 *  2026-07-10 audit batch; this alias is kept for existing import sites. */
export type ToolContextWithPermissionGate = ToolContext;

type AllowedPrompt = { tool: 'Bash'; prompt: string };

function parseAllowedPrompts(
  raw: unknown,
): { ok: true; value: AllowedPrompt[] | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(raw)) {
    return { ok: false, error: '"allowedPrompts" must be an array.' };
  }
  const out: AllowedPrompt[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: 'each allowedPrompts entry must be an object.' };
    }
    const rec = entry as Record<string, unknown>;
    if (rec['tool'] !== 'Bash') {
      return { ok: false, error: 'allowedPrompts[].tool must be the literal "Bash".' };
    }
    if (typeof rec['prompt'] !== 'string' || rec['prompt'].length === 0) {
      return { ok: false, error: 'allowedPrompts[].prompt must be a non-empty string.' };
    }
    out.push({ tool: 'Bash', prompt: rec['prompt'] });
  }
  return { ok: true, value: out };
}

export const exitPlanModeTool: BuiltinTool = {
  name: 'ExitPlanMode',
  description: EXITPLANMODE_DESCRIPTION,
  // Session permission-mode state only; never touches files. readOnly is
  // load-bearing: plan mode (gate step 6) denies every non-readOnly tool, so a
  // non-readOnly ExitPlanMode could never run in the one mode it exists for.
  // Hosts keep a veto via PreToolUse hooks / disallowedTools (gate steps 1-2).
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      allowedPrompts: {
        type: 'array',
        description:
          'Optional prompt-based permissions needed to implement the plan.',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', enum: ['Bash'] },
            prompt: {
              type: 'string',
              description: 'Natural-language description of the commands the plan needs.',
            },
          },
          required: ['tool', 'prompt'],
        },
      },
    },
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const prompts = parseAllowedPrompts(input['allowedPrompts']);
    if (!prompts.ok) {
      return { content: `ExitPlanMode failed: ${prompts.error}`, isError: true };
    }

    const gate = ctx.permissionGate;
    if (gate === undefined) {
      return {
        content:
          'ExitPlanMode failed: no permission-mode controller is wired on this ' +
          'tool context (the host must expose the permission gate as ' +
          '`permissionGate` on the ToolContext). The permission mode was NOT ' +
          'changed.',
        isError: true,
      };
    }

    const mode = gate.getMode();
    if (mode !== 'plan') {
      return {
        content: `ExitPlanMode failed: the session is not in plan mode (current permission mode: ${mode}).`,
        isError: true,
      };
    }

    // audit r4 U3-1: restore the mode active before plan mode (recorded by
    // EnterPlanMode) rather than hard-coding 'default' and silently discarding
    // the user's mode choice (e.g. acceptEdits). Plan mode entered by other
    // means leaves no record and falls back to 'default' (unchanged behavior).
    const restoreTo = takePriorPlanMode(gate) ?? 'default';
    gate.setMode(restoreTo);
    ctx.debug(`ExitPlanMode: permission mode plan -> ${restoreTo}`);
    const lines = [`Exited plan mode. Permission mode: plan -> ${restoreTo}.`];
    if (prompts.value !== undefined && prompts.value.length > 0) {
      lines.push(
        'Requested prompt-based permissions (NOT applied — this permission ' +
          'gate has no prompt-based Bash rules; each command is evaluated ' +
          'individually under the default mode):',
      );
      for (const p of prompts.value) lines.push(`- Bash: ${p.prompt}`);
    }
    return { content: lines.join('\n') };
  },
};
