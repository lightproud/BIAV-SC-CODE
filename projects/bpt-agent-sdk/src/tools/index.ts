/**
 * Built-in tool registry: the six v0.1 tools keyed by their public names
 * (Read, Write, Edit, Bash, Glob, Grep).
 */

import type { BuiltinTool } from '../internal/contracts.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool, createBashTool } from './bash.js';
import type { SandboxContext } from '../types.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { webFetchTool } from './webfetch.js';
import { webSearchTool } from './websearch.js';
import { askUserQuestionTool } from './askuserquestion.js';
import { todoWriteTool } from './todo.js';
import { listMcpResourcesTool, readMcpResourceTool } from './resources.js';
import { bashOutputTool, killShellTool } from './shells.js';

/** Fresh Map per call so callers can filter without affecting others.
 *  When a sandbox is active (G-SANDBOX) the Bash tool is built with its
 *  sandbox-aware description + schema; absent, it is the byte-identical
 *  unsandboxed `bashTool`. */
export function createBuiltinTools(cfg?: { sandbox?: SandboxContext }): Map<string, BuiltinTool> {
  const tools: BuiltinTool[] = [
    readTool,
    writeTool,
    editTool,
    cfg?.sandbox !== undefined ? createBashTool(cfg.sandbox) : bashTool,
    bashOutputTool,
    killShellTool,
    globTool,
    grepTool,
    webFetchTool,
    webSearchTool,
    askUserQuestionTool,
    todoWriteTool,
    listMcpResourcesTool,
    readMcpResourceTool,
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
