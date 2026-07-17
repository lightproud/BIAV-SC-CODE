/**
 * Silver Core SDK - project .mcp.json loader.
 *
 * Best-effort, synchronous loader for a project-scoped MCP server config file.
 * The reference CLI reads .mcp.json from the working directory when project
 * setting sources are enabled; this mirrors that behavior for the direct-API
 * SDK. It is a pure helper: it reads the filesystem and returns a plain map,
 * never throwing and never touching global state.
 *
 * Activation is gated on `settingSources` including 'project' - otherwise no
 * filesystem is touched and {} is returned. A missing file is silent; an
 * unreadable/malformed file logs a debug warning and returns {}.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSettingSources } from '../internal/setting-sources.js';
import type { McpServerConfig, SettingSource } from '../types.js';

/**
 * Load the project .mcp.json when the effective `settingSources` includes
 * 'project'. Omitted settingSources resolves to load-all (bump-pin ruling), so
 * an absent field now enables the project source; an explicit array without
 * 'project' (including `[]`) does not. Returns the top-level `mcpServers` map
 * (shallow-validated: each value must be a non-null object). Returns {} when
 * the source is not enabled, the file is missing, or the file is unreadable/
 * non-JSON. Never throws.
 */
export function loadProjectMcpServers(
  cwd: string,
  settingSources: SettingSource[] | undefined,
  debug: (msg: string) => void,
  env: Record<string, string | undefined> = process.env,
): Record<string, McpServerConfig> {
  if (!resolveSettingSources(settingSources).includes('project')) {
    return {};
  }

  const filePath = join(cwd, '.mcp.json');
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    // Missing file is the common case - stay silent unless it is a real
    // read error (permissions, etc.).
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      debug(`project-config: could not read ${filePath}: ${String(err)}`);
    }
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    debug(`project-config: ${filePath} is not valid JSON: ${String(err)}`);
    return {};
  }

  if (parsed === null || typeof parsed !== 'object') {
    debug(`project-config: ${filePath} is not a JSON object`);
    return {};
  }

  const mcpServers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (mcpServers === undefined) return {};
  if (mcpServers === null || typeof mcpServers !== 'object') {
    debug(`project-config: ${filePath} "mcpServers" is not an object`);
    return {};
  }

  const out: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      debug(`project-config: skipping malformed server entry "${name}"`);
      continue;
    }
    out[name] = expandEnvVars(value, env) as McpServerConfig;
  }
  return out;
}

/**
 * Expand `${VAR}` / `${VAR:-default}` references in every string value of a
 * server entry (command, args, env, url, headers, ...), mirroring the
 * reference CLI's .mcp.json semantics. Without this, a config like
 * `"Authorization": "Bearer ${TOKEN}"` went to the wire verbatim and the
 * child env received the literal `${...}` — a silent 401. An undefined
 * variable with no default is left unexpanded so the failure stays visible
 * in error messages instead of collapsing to an empty string.
 */
function expandEnvVars(
  value: unknown,
  env: Record<string, string | undefined>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
      (match, name: string, def: string | undefined) => env[name] ?? def ?? match,
    );
  }
  if (Array.isArray(value)) return value.map((v) => expandEnvVars(v, env));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = expandEnvVars(v, env);
    return out;
  }
  return value;
}
