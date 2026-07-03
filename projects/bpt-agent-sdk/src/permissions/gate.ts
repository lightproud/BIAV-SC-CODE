/**
 * DefaultPermissionGate - the full permission evaluation pipeline for one
 * tool call, in the EXACT order documented on the PermissionGate contract:
 *
 *   1. hook deny                                   -> deny
 *   2. disallowedTools rule                        -> deny
 *   3. hook allow                                  -> allow (hook updatedInput wins)
 *   4. allowedTools rule                           -> allow
 *   5. mode bypassPermissions                      -> allow
 *   6. mode plan                                   -> readOnly ? allow : deny
 *   7. mode acceptEdits && (readOnly || isFileEdit)-> allow
 *   8. mode default/dontAsk && readOnly            -> allow
 *   9. otherwise (or hook 'ask'): canUseTool if provided; else deny
 *
 * A hook 'ask' decision routes to step 9 by skipping the auto-ALLOW outcomes
 * of steps 3-8; deny outcomes (steps 1, 2 and the plan-mode deny of step 6)
 * still apply, so 'ask' can never widen permissions.
 *
 * `dontAsk` differs from `default` only at step 9: canUseTool is never
 * consulted, the call is denied directly. Every deny is recorded and
 * retrievable via denials().
 */

import type {
  CanUseTool,
  PermissionMode,
  PermissionRuleValue,
  PermissionUpdate,
  SDKPermissionDenial,
} from '../types.js';
import { AbortError, isAbortError } from '../errors.js';
import type {
  GateHookDecision,
  PermissionCheckResult,
  PermissionGate,
} from '../internal/contracts.js';
import { parseRule, ruleMatches, type ParsedRule } from './rules.js';

export type PermissionGateConfig = {
  mode?: PermissionMode;
  /** Rule strings (`Tool` / `Tool(spec)`) that auto-allow at step 4. */
  allowedTools?: string[];
  /** Rule strings (`Tool` / `Tool(spec)`) that deny at step 2. */
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
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
  private readonly debug: (msg: string) => void;

  /** Rules provided at construction time (options.allowed/disallowedTools). */
  private readonly baseAllowRules: ParsedRule[];
  private readonly baseDenyRules: ParsedRule[];

  /** Session rule sets, mutated only by applyUpdates(destination:'session'). */
  private sessionAllowRules: ParsedRule[] = [];
  private sessionDenyRules: ParsedRule[] = [];
  /** Stored for replace/remove round-trips; not consulted by the v0.1 pipeline. */
  private sessionAskRules: ParsedRule[] = [];

  /** Directories granted via addDirectories updates (session scope). */
  private sessionDirectories: string[] = [];

  private readonly recordedDenials: SDKPermissionDenial[] = [];

  constructor(cfg: PermissionGateConfig) {
    this.mode = cfg.mode ?? 'default';
    this.canUseTool = cfg.canUseTool;
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
    },
  ): Promise<PermissionCheckResult> {
    const { toolUseID, signal, readOnly, isFileEdit, hook } = opts;
    if (signal.aborted) throw new AbortError();

    // Step 1: hook deny.
    if (hook?.decision === 'deny') {
      return this.deny(toolName, toolUseID, input, 'PreToolUse hook', hook.reason);
    }

    // Step 2: disallowedTools rule.
    if (this.anyRuleMatches(this.baseDenyRules, this.sessionDenyRules, toolName, input)) {
      return this.deny(toolName, toolUseID, input, 'disallowedTools rule');
    }

    // A hook 'ask' skips the auto-allow outcomes of steps 3-8 (deny outcomes
    // still apply) and forces the step-9 canUseTool path.
    const hookAsk = hook?.decision === 'ask';

    // Step 3: hook allow (hook updatedInput wins).
    if (!hookAsk && hook?.decision === 'allow') {
      return { decision: 'allow', updatedInput: hook.updatedInput ?? input };
    }

    // Step 4: allowedTools rule.
    if (
      !hookAsk &&
      this.anyRuleMatches(this.baseAllowRules, this.sessionAllowRules, toolName, input)
    ) {
      return { decision: 'allow', updatedInput: input };
    }

    // Step 5: bypassPermissions mode allows everything.
    if (!hookAsk && this.mode === 'bypassPermissions') {
      return { decision: 'allow', updatedInput: input };
    }

    // Step 6: plan mode - read-only tools allowed, everything else denied.
    if (this.mode === 'plan') {
      if (!readOnly) {
        return this.deny(
          toolName,
          toolUseID,
          input,
          'plan mode',
          'only read-only tools are permitted in plan mode',
        );
      }
      if (!hookAsk) {
        return { decision: 'allow', updatedInput: input };
      }
      // readOnly under hook 'ask': fall through to step 9.
    }

    // Step 7: acceptEdits mode auto-approves read-only tools and file edits.
    if (!hookAsk && this.mode === 'acceptEdits' && (readOnly || isFileEdit)) {
      return { decision: 'allow', updatedInput: input };
    }

    // Step 8: default/dontAsk modes auto-approve read-only tools.
    if (!hookAsk && (this.mode === 'default' || this.mode === 'dontAsk') && readOnly) {
      return { decision: 'allow', updatedInput: input };
    }

    // Step 9: consult canUseTool - except under dontAsk, which never prompts.
    if (this.mode === 'dontAsk') {
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

    let result: Awaited<ReturnType<CanUseTool>>;
    try {
      result = await this.canUseTool(toolName, input, {
        signal,
        toolUseID,
        decisionReason: opts.decisionReason ?? hook?.reason,
      });
    } catch (err) {
      if (isAbortError(err) || signal.aborted) throw new AbortError();
      const msg = err instanceof Error ? err.message : String(err);
      return this.deny(toolName, toolUseID, input, 'canUseTool callback', `callback threw: ${msg}`);
    }
    if (signal.aborted) throw new AbortError();

    if (result === null) {
      // The callback declined to decide; the conservative outcome is deny.
      return this.deny(
        toolName,
        toolUseID,
        input,
        'canUseTool callback',
        'callback returned no decision',
      );
    }
    if (result.behavior === 'allow') {
      if (result.updatedPermissions && result.updatedPermissions.length > 0) {
        this.applyUpdates(result.updatedPermissions);
      }
      return { decision: 'allow', updatedInput: result.updatedInput ?? input };
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
          if (update.behavior === 'ask') {
            this.debug(
              'permissions: "ask" rules are stored but not consulted by the v0.1 pipeline',
            );
          }
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
          this.mode = update.mode;
          break;
        }
        case 'addDirectories': {
          for (const dir of update.directories) {
            if (!this.sessionDirectories.includes(dir)) this.sessionDirectories.push(dir);
          }
          break;
        }
        default: {
          // removeDirectories (and future types) are not supported in v0.1.
          this.debug(`permissions: unsupported update type "${update.type}", ignored`);
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

  // -------------------------------------------------------------------------

  private anyRuleMatches(
    base: ParsedRule[],
    session: ParsedRule[],
    toolName: string,
    input: Record<string, unknown>,
  ): boolean {
    return (
      base.some((r) => ruleMatches(r, toolName, input)) ||
      session.some((r) => ruleMatches(r, toolName, input))
    );
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
