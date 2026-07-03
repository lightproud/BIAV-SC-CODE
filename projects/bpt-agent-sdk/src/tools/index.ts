/**
 * Built-in tool registry: the six v0.1 tools keyed by their public names
 * (Read, Write, Edit, Bash, Glob, Grep).
 */

import type { BuiltinTool } from '../internal/contracts.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';

/** Fresh Map per call so callers can filter without affecting others. */
export function createBuiltinTools(): Map<string, BuiltinTool> {
  const tools: BuiltinTool[] = [
    readTool,
    writeTool,
    editTool,
    bashTool,
    globTool,
    grepTool,
  ];
  return new Map(tools.map((t) => [t.name, t]));
}
