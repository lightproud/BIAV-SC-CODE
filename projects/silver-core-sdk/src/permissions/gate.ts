/**
 * DefaultPermissionGate - the full permission evaluation pipeline for one
 * tool call, in the EXACT official 6-step order:
 *
 *   1. Hooks         - hook 'deny' -> deny; hook 'defer' -> defer (ends turn);
 *                      hook 'allow'/'ask' are remembered for step 3.
 *   2. Deny rules    - scoped disallowedTools + session deny rules match the
 *                      model input (or a hook-rewritten input) -> deny. Applies
 *                      even under bypassPermissions / auto.
 *   3. Ask rules     - hook 'ask' or a session ask rule routes to canUseTool
 *                      (step 6), skipping the mode + allow-rule auto-approvals.
 *                      A requiresUserInteraction tool (AskUserQuestion) also
 *                      routes there, but ONLY when a canUseTool handler exists
 *                      (it is answered by ctx.askUser at execute time); absent
 *                      a handler it falls through to the mode so bypass /
 *                      acceptEdits / default-readOnly still allow it.
 *                      A hook 'allow' that no ask route caught allows here.
 *   4. Permission mode - bypass -> allow; acceptEdits -> allow read/edit;
 *                      plan -> allow read-only, ROUTE writes to canUseTool;
 *                      auto -> classifier(allow|deny|prompt);
 *                      default/dontAsk -> allow read-only.
 *   5. Allow rules   - allowedTools + session allow rules (AFTER mode) -> allow.
 *   6. canUseTool    - dontAsk denies here; else the callback decides. A null
 *                      return is a 'skip' (app decides out of band; NOT
 *                      recorded). An allow may rewrite the input (re-checked
 *                      against deny rules) and carry session updates.
 *
 * Steps 3-5 only produce auto-ALLOW outcomes; the deny outcomes of steps 1, 2
 * and the auto-classifier still apply, so an ask route can never widen
 * permissions. Every deny is recorded and retrievable via denials(); 'skip'
 * and 'defer' are never recorded.
 */

import type {
  CanUseTool,
  PermissionMode,
  PermissionRuleValue,
  PermissionUpdate,
  SDKPermissionDenial,
} from '../types.js';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AbortError, isAbortError } from '../errors.js';
import type {
  GateHookDecision,
  PermissionCheckResult,
  PermissionGate,
} from '../internal/contracts.js';
import {
  buildPermissionSuggestions,
  parseRule,
  requiresUserInteraction,
  ruleMatches,
  type MatchContext,
  type ParsedRule,
} from './rules.js';
import { defaultAutoClassifier, type ToolClassifier } from './classifier.js';

export type PermissionGateConfig = {
  mode?: PermissionMode;
  /** Rule strings (`Tool` / `Tool(spec)`) that auto-allow at step 5. */
  allowedTools?: string[];
  /** Rule strings (`Tool` / `Tool(spec)`) that deny at step 2. */
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  /** Classifier consulted under permissionMode 'auto'. Defaults to the static
   *  defaultAutoClassifier (no model call). */
  classifier?: ToolClassifier;
  /** Working directory path-primary tools resolve their file_path against.
   *  Threaded into rule matching so a path-scoped allow/deny compares against
   *  the same `..`-collapsed absolute path the tool will access (RP1/RP2). */
  cwd?: string;
  /** Provider of the currently-registered MCP server names, for exact
   *  server-segment resolution of `mcp__server__*` rules (I2). A getter (not a
   *  snapshot) so servers added via setMcpServers are reflected at check time. */
  knownMcpServers?: () => ReadonlySet<string>;
  /** Whether `allowDangerouslySkipPermissions` unlocked bypass. When false, a
   *  canUseTool-supplied `setMode:'bypassPermissions'` update is refused rather
   *  than silently escalating the whole session (RP3). */
  allowDangerousBypass?: boolean;
  debug: (msg: string) => void;
};

/** Convert a PermissionRuleValue into a ParsedRule. An explicit ruleContent
 *  wins over any `Tool(spec)` syntax embedded in toolName. */
function toParsedRule(rule: PermissionRuleValue): ParsedRule {
  const parsed = parseRule(rule.toolName);
  if (rule.ruleContent !== undefined) {
    return { toolName: parsed.toolName, specifier: rule.ruleContent };
  }
  return parsed;
}

function sameRule(a: ParsedRule, b: ParsedRule): boolean {
  return a.toolName === b.toolName && a.specifier === b.specifier;
}

export class DefaultPermissionGate implements PermissionGate {
  private mode: PermissionMode;
  private readonly canUseTool: CanUseTool | undefined;
  private readonly classifier: ToolClassifier;
  private readonly cwd: string | undefined;
  private readonly knownMcpServers: (() => ReadonlySet<string>) | undefined;
  private readonly allowDangerousBypass: boolean;
  private readonly debug: (msg: string) => void;

  /** Rules provided at construction time (options.allowed/disallowedTools). */
  private readonly baseAllowRules: ParsedRule[];
  private readonly baseDenyRules: ParsedRule[];

  /** Session rule sets, mutated only by applyUpdates(destination:'session'). */
  private sessionAllowRules: ParsedRule[] = [];
  private sessionDenyRules: ParsedRule[] = [];
  /** Session ask rules: consulted at step 3 (route to canUseTool). */
  private sessionAskRules: ParsedRule[] = [];

  /** Directories granted via addDirectories updates (session scope). */
  private sessionDirectories: string[] = [];
  /** Directories revoked via removeDirectories updates (session scope).
   *  Applies to BOTH session-added dirs and the base additionalDirectories
   *  (subtracted in effectiveAdditionalDirectories). A later addDirectories
   *  for the same path clears the revocation. */
  private removedDirs: string[] = [];

  private readonly recordedDenials: SDKPermissionDenial[] = [];

  constructor(cfg: PermissionGateConfig) {
    this.mode = cfg.mode ?? 'default';
    this.canUseTool = cfg.canUseTool;
    this.classifier = cfg.classifier ?? defaultAutoClassifier;
    this.cwd = cfg.cwd;
    this.knownMcpServers = cfg.knownMcpServers;
    this.allowDangerousBypass = cfg.allowDangerousBypass ?? false;
    this.debug = cfg.debug;
    this.baseAllowRules = (cfg.allowedTools ?? []).map(parseRule);
    this.baseDenyRules = (cfg.disallowedTools ?? []).map(parseRule);
  }

  async check(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      toolUseID: string;
      signal: AbortSignal;
      readOnly: boolean;
      isFileEdit: boolean;
      hook?: GateHookDecision;
      decisionReason?: string;
      /**
       * v0.6 G-SANDBOX: this call requested `dangerouslyDisableSandbox` (run
       * OUTSIDE the sandbox). The escape is an INDEPENDENT permission dimension:
       * it must ALWAYS route to an ask (never auto-allow) except under
       * bypassPermissions — a command-level allow rule / hook-allow written to
       * pre-approve the command IN the sandbox must not silently authorize
       * escaping it. With no canUseTool handler (or dontAsk) it fails closed.
       */
      sandboxEscape?: boolean;
    },
  ): Promise<PermissionCheckResult> {
    const { toolUseID, signal, readOnly, isFileEdit, hook } = opts;
    if (signal.aborted) throw new AbortError();

    const hookDeny = hook?.decision === 'deny';
    const hookDefer = hook?.decision === 'defer';
    const hookAsk = hook?.decision === 'ask';
    const hookAllow = hook?.decision === 'allow';
    // A hook allow/ask may rewrite the input; that rewrite is what a deny rule
    // must be re-checked against and what canUseTool ultimately approves.
    const effectiveInput = (hookAllow || hookAsk) ? (hook?.updatedInput ?? input) : input;

    // ----- STEP 1: hooks -----------------------------------------------------
    if (hookDeny) {
      return this.deny(toolName, toolUseID, input, 'PreToolUse hook', hook?.reason);
    }
    if (hookDefer) {
      // Deferred for later approval; ends the current turn. Never recorded.
      return {
        decision: 'defer',
        message:
          `Tool "${toolName}" was deferred by a PreToolUse hook` +
          (hook?.reason ? ` - ${hook.reason}` : ''),
      };
    }

    // ----- STEP 2: deny rules ------------------------------------------------
    // Match the model's original input; a hook rewrite must not smuggle a call
    // past a deny rule, so the effective input is checked too (and the deny is
    // recorded against the offending input).
    {
      const denied = this.disallowedDeny(toolName, toolUseID, input);
      if (denied) return denied;
      if ((hookAllow || hookAsk) && effectiveInput !== input) {
        const deniedEff = this.disallowedDeny(toolName, toolUseID, effectiveInput);
        if (deniedEff) return deniedEff;
      }
    }

    // ----- STEP 3: ask rules + hook-allow resolution -------------------------
    // A requiresUserInteraction tool (e.g. AskUserQuestion) is answered by
    // ctx.askUser at execute time, NOT by the permission gate: canUseTool is
    // only an optional veto point for it. So force its interactive route ONLY
    // when a canUseTool handler exists. With no handler, fall through to the
    // mode step so a mode that would otherwise allow it (bypassPermissions /
    // acceptEdits / default-readOnly / auto) does - instead of the blanket
    // step-6 "no canUseTool" deny firing in EVERY mode (including bypass).
    // hook-ask and session ask rules still hard-route regardless of canUseTool.
    // A sandbox-escape request forces the prompt in every mode except
    // bypassPermissions (the total-bypass contract). This is placed BEFORE the
    // hook-allow short-circuit and the mode/allow-rule auto-allows so none of
    // them can wave the escape through: the switch to run outside the sandbox
    // is authorized on its OWN, not piggybacked on a command-level approval.
    const escapeForcesPrompt =
      opts.sandboxEscape === true && this.mode !== 'bypassPermissions';
    let routeToPrompt =
      hookAsk ||
      escapeForcesPrompt ||
      // ask routes toward prompting, so a Bash chain routes if ANY sub-command
      // matches the ask specifier ('any').
      this.sessionAskRules.some((r) =>
        ruleMatches(r, toolName, effectiveInput, 'any', this.matchCtx()),
      ) ||
      (requiresUserInteraction(toolName) && this.canUseTool !== undefined);

    if (hookAllow && !routeToPrompt) {
      // Hook allow is the documented escape hatch above the mode step; still
      // subject to the deny + ask rules already applied.
      return { decision: 'allow', updatedInput: effectiveInput };
    }

    // ----- STEP 4a: auto-classifier DENY (applies even on an ask route) -------
    // The auto classifier's `deny` is a hard deny that must survive an active
    // ask route, exactly as the module invariant states ("an ask route can never
    // widen permissions"). Evaluating it inside the `!routeToPrompt` switch below
    // meant any ask route (hook 'ask', a session ask rule, requiresUserInteraction,
    // sandboxEscape) skipped the classifier entirely and routed a classifier-DENY
    // call to canUseTool — which could ALLOW it, inverting deny > ask. So the deny
    // verdict is checked here, regardless of routeToPrompt. A hook 'allow' (the
    // deliberate escape hatch resolved just above) still outranks it. The 'allow'
    // / 'prompt' verdicts stay in the mode step so an ask route still prompts.
    if (this.mode === 'auto' && !hookAllow) {
      // Classify the input that will actually execute: a hook rewrite
      // (effectiveInput) could otherwise slip a classifier-DENY payload past
      // the classifier, which was still judging the pre-rewrite call (audit
      // 2026-07-17 L29). Identical to `input` when no hook rewrote.
      const cls = this.classifier(toolName, effectiveInput, { readOnly, isFileEdit });
      if (cls === 'deny') {
        return this.deny(toolName, toolUseID, input, 'auto classifier');
      }
      if (!routeToPrompt) {
        if (cls === 'allow') return { decision: 'allow', updatedInput: input };
        routeToPrompt = true; // 'prompt'
      }
    }

    // ----- STEP 4: permission mode (only when no hook-allow / ask route) ------
    if (!hookAllow && !routeToPrompt) {
      switch (this.mode) {
        case 'bypassPermissions':
          return { decision: 'allow', updatedInput: input };
        case 'acceptEdits':
          if (readOnly || isFileEdit) return { decision: 'allow', updatedInput: input };
          break;
        case 'plan':
          if (readOnly) return { decision: 'allow', updatedInput: input };
          // v0.2: plan ROUTES writes to canUseTool (never a hard deny).
          routeToPrompt = true;
          break;
        case 'auto':
          // Resolved in step 4a above (deny already returned; allow/prompt
          // handled there). Nothing left to decide here.
          break;
        case 'default':
        case 'dontAsk':
          if (readOnly) return { decision: 'allow', updatedInput: input };
          break;
      }
    }

    // ----- STEP 5: allow rules (AFTER mode; only when no prompt route) --------
    if (
      !routeToPrompt &&
      // allow requires EVERY Bash sub-command to match and no injection ('all'),
      // so a prefix allow can't be smuggled past via `allowed && dangerous`.
      this.anyRuleMatches(this.baseAllowRules, this.sessionAllowRules, toolName, input, 'all')
    ) {
      return { decision: 'allow', updatedInput: input };
    }

    // ----- STEP 6: canUseTool ------------------------------------------------
    if (this.mode === 'dontAsk') {
      // dontAsk never prompts; ask-rule / requiresUserInteraction routes are
      // denied here too.
      return this.deny(
        toolName,
        toolUseID,
        input,
        'dontAsk mode',
        'no pre-approved rule matched and prompting is disabled',
      );
    }
    if (!this.canUseTool) {
      return this.deny(
        toolName,
        toolUseID,
        input,
        'default policy',
        'no canUseTool handler was provided',
      );
    }

    const baseInput = effectiveInput;
    const suggestions = buildPermissionSuggestions(toolName, baseInput);
    const requestId = randomUUID();

    let result: Awaited<ReturnType<CanUseTool>>;
    try {
      result = await this.canUseTool(toolName, baseInput, {
        signal,
        toolUseID,
        decisionReason: opts.decisionReason ?? hook?.reason,
        suggestions,
        requestId,
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw new AbortError();
      const msg = err instanceof Error ? err.message : String(err);
      return this.deny(toolName, toolUseID, input, 'canUseTool callback', `callback threw: ${msg}`);
    }
    if (signal.aborted) throw new AbortError();

    if (result === null) {
      // The app resolves this call out of band; emit a non-recorded skip.
      return {
        decision: 'skip',
        message: 'permission decision was handled by the application (no local record)',
      };
    }
    if (result.behavior === 'allow') {
      // canUseTool may rewrite the input; re-check it against the deny rules
      // before allowing. Deny wins outright - a denied call applies no session
      // permission updates.
      const eff = result.updatedInput ?? baseInput;
      const denied = this.disallowedDeny(toolName, toolUseID, eff);
      if (denied) return denied;
      if (result.updatedPermissions && result.updatedPermissions.length > 0) {
        this.applyUpdates(result.updatedPermissions);
      }
      return { decision: 'allow', updatedInput: eff };
    }
    return this.deny(
      toolName,
      toolUseID,
      input,
      'canUseTool callback',
      result.message,
      result.interrupt,
    );
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  applyUpdates(updates: PermissionUpdate[]): void {
    for (const update of updates) {
      if (update.destination !== 'session') {
        this.debug(
          `permissions: ignoring ${update.type} update for destination "${update.destination}" ` +
            '(only "session" is honored in this SDK)',
        );
        continue;
      }
      switch (update.type) {
        case 'addRules': {
          const target = this.sessionRulesFor(update.behavior);
          for (const rule of update.rules) target.push(toParsedRule(rule));
          break;
        }
        case 'replaceRules': {
          this.setSessionRulesFor(update.behavior, update.rules.map(toParsedRule));
          break;
        }
        case 'removeRules': {
          const target = this.sessionRulesFor(update.behavior);
          const toRemove = update.rules.map(toParsedRule);
          this.setSessionRulesFor(
            update.behavior,
            target.filter((r) => !toRemove.some((rm) => sameRule(r, rm))),
          );
          break;
        }
        case 'setMode': {
          // RP3: entering bypassPermissions requires the same
          // allowDangerouslySkipPermissions interlock the public
          // setPermissionMode() enforces. A canUseTool result (step 6) that
          // returns `{setMode:'bypassPermissions'}` must NOT be able to escalate
          // the whole session to auto-allow-everything when bypass was never
          // unlocked; refuse it and keep the current mode.
          if (update.mode === 'bypassPermissions' && !this.allowDangerousBypass) {
            this.debug(
              'permissions: refusing setMode "bypassPermissions" update - ' +
                'allowDangerouslySkipPermissions was not set (interlock)',
            );
            break;
          }
          this.mode = update.mode;
          break;
        }
        case 'addDirectories': {
          for (const dir of update.directories) {
            const target = resolve(dir);
            // Re-granting a previously removed directory clears the revocation.
            this.removedDirs = this.removedDirs.filter((d) => resolve(d) !== target);
            if (!this.sessionDirectories.some((d) => resolve(d) === target)) {
              this.sessionDirectories.push(dir);
            }
          }
          break;
        }
        case 'removeDirectories': {
          // Real revocation (T2-7): drop session-added grants and record the
          // path so effectiveAdditionalDirectories() subtracts it from the
          // base additionalDirectories too. Paths compare resolved.
          for (const dir of update.directories) {
            const target = resolve(dir);
            this.sessionDirectories = this.sessionDirectories.filter(
              (d) => resolve(d) !== target,
            );
            if (!this.removedDirs.some((d) => resolve(d) === target)) {
              this.removedDirs.push(dir);
            }
          }
          break;
        }
      }
    }
  }

  denials(): SDKPermissionDenial[] {
    return [...this.recordedDenials];
  }

  /** Directories granted via session addDirectories updates (read by the host). */
  addedDirectories(): string[] {
    return [...this.sessionDirectories];
  }

  /** Directories revoked via session removeDirectories updates. */
  removedDirectories(): string[] {
    return [...this.removedDirs];
  }

  /**
   * Effective additional working directories for tool access:
   * (base additionalDirectories MINUS removeDirectories revocations) PLUS
   * session addDirectories grants. Resolved-path comparison; original
   * spellings are preserved in the output. The query layer feeds this into
   * each turn's ToolContext so add/removeDirectories updates take real
   * effect at runtime.
   */
  effectiveAdditionalDirectories(base: string[]): string[] {
    const removed = new Set(this.removedDirs.map((d) => resolve(d)));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const d of base) {
      const r = resolve(d);
      if (removed.has(r) || seen.has(r)) continue;
      seen.add(r);
      out.push(d);
    }
    for (const d of this.sessionDirectories) {
      const r = resolve(d);
      if (removed.has(r) || seen.has(r)) continue;
      seen.add(r);
      out.push(d);
    }
    return out;
  }

  // -------------------------------------------------------------------------

  /**
   * Step-2 deny check, reusable against a rewritten input. Returns a recorded
   * deny result when the (base or session) deny rules match the given input,
   * otherwise undefined. Called at step 2 with the model's original input and
   * again at step 6 against any callback-rewritten input.
   */
  private disallowedDeny(
    toolName: string,
    toolUseID: string,
    input: Record<string, unknown>,
  ): PermissionCheckResult | undefined {
    // deny fires if ANY Bash sub-command matches a deny specifier ('any'), so a
    // denied command chained after an innocuous one is still denied.
    if (this.anyRuleMatches(this.baseDenyRules, this.sessionDenyRules, toolName, input, 'any')) {
      return this.deny(toolName, toolUseID, input, 'disallowedTools rule');
    }
    return undefined;
  }

  private anyRuleMatches(
    base: ParsedRule[],
    session: ParsedRule[],
    toolName: string,
    input: Record<string, unknown>,
    segmentMode?: 'all' | 'any',
  ): boolean {
    const ctx = this.matchCtx();
    return (
      base.some((r) => ruleMatches(r, toolName, input, segmentMode, ctx)) ||
      session.some((r) => ruleMatches(r, toolName, input, segmentMode, ctx))
    );
  }

  /** Match context (cwd for path normalization, MCP server registry for exact
   *  server scoping) shared by every rule evaluation this gate performs. */
  private matchCtx(): MatchContext {
    return { cwd: this.cwd, knownServers: this.knownMcpServers?.() };
  }

  private sessionRulesFor(behavior: 'allow' | 'deny' | 'ask'): ParsedRule[] {
    if (behavior === 'allow') return this.sessionAllowRules;
    if (behavior === 'deny') return this.sessionDenyRules;
    return this.sessionAskRules;
  }

  private setSessionRulesFor(behavior: 'allow' | 'deny' | 'ask', rules: ParsedRule[]): void {
    if (behavior === 'allow') this.sessionAllowRules = rules;
    else if (behavior === 'deny') this.sessionDenyRules = rules;
    else this.sessionAskRules = rules;
  }

  /** Record the denial and build a message naming the tool and deciding stage. */
  private deny(
    toolName: string,
    toolUseID: string,
    input: Record<string, unknown>,
    stage: string,
    detail?: string,
    interrupt?: boolean,
  ): PermissionCheckResult {
    this.recordedDenials.push({
      tool_name: toolName,
      tool_use_id: toolUseID,
      tool_input: input,
    });
    const message =
      `Permission denied: tool "${toolName}" was denied by ${stage}` +
      (detail ? ` - ${detail}` : '');
    if (interrupt !== undefined) {
      return { decision: 'deny', message, interrupt };
    }
    return { decision: 'deny', message };
  }
}
