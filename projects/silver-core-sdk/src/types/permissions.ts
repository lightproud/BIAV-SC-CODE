/**
 * Silver Core SDK 公开类型面 — 权限判定面。
 *
 * 自 src/types.ts 按其自带的分节切出（结构审视 P7，2026-07-27）：切分依据是文件
 * 原本就标好的分节注释，不是新发明的边界。src/types.ts 保留为 barrel，所有
 * `from '../types.js'` 的既有 import 一行未动。
 *
 * 溯源与合规声明见 src/types.ts 头注（clean-room，仅据公开文档）。
 */

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type PermissionMode =
  /** Standard behavior: safe read-only tools run, others consult rules/canUseTool. */
  | 'default'
  /** Auto-accept file edits (Write/Edit and file-mutating operations). */
  | 'acceptEdits'
  /** Bypass permission checks entirely. */
  | 'bypassPermissions'
  /** Planning mode: read-only tools are auto-allowed; writes ROUTE to
   *  canUseTool (an ask) rather than being hard-denied. */
  | 'plan'
  /** Never prompt: deny anything that is not pre-approved by rules. */
  | 'dontAsk'
  /** v0.2: heuristic-classified approvals (src/permissions/classifier.ts). */
  | 'auto';

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session';

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdate =
  | {
      type: 'addRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'replaceRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeRules';
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'setMode';
      mode: PermissionMode;
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'addDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    }
  | {
      type: 'removeDirectories';
      directories: string[];
      destination: PermissionUpdateDestination;
    };

export type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

export type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
    /** Unique id of this permission request (required on the official surface;
     *  the gate generates one per canUseTool consultation). */
    requestId: string;
  },
) => Promise<PermissionResult | null>;

export type SDKPermissionDenial = {
  tool_name: string;
  tool_use_id: string;
  tool_input: Record<string, unknown>;
};
