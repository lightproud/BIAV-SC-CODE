/**
 * Custom slash commands — open reproduction of the official `.claude/commands`
 * custom-command surface (the SDK-side subset).
 *
 * Sources follow the effective `settingSources` (same resolver as CLAUDE.md /
 * .mcp.json loading): 'project' reads `<cwd>/.claude/commands/`, 'user' reads
 * `~/.claude/commands/`. Each `*.md` file is one command; subdirectories
 * namespace the name with ':' (`frontend/component.md` → `/frontend:component`).
 * On a name collision the project definition wins over the user one, and
 * engine built-ins (only `/compact` today) are never shadowed.
 *
 * Optional frontmatter supplies `description` and `argument-hint`. The parser
 * is a deliberate SUBSET (a `---` fence plus flat `key: value` lines) — enough
 * for the two consumed keys without pulling in a YAML dependency.
 *
 * Substitutions on expansion: `$ARGUMENTS` (the full argument string) and
 * `$1`..`$9` (whitespace-split positionals; a missing positional becomes '').
 * When the body uses no placeholder and arguments were given, the arguments
 * are appended after a blank line so they are never silently dropped.
 *
 * NOT reproduced (declared, not silent — see docs/COMPAT.md): `!command`
 * inline-bash execution, `@file` references, and the `allowed-tools` /
 * `model` / `disable-model-invocation` frontmatter keys (parsed keys other
 * than the two above are ignored).
 *
 * Loading happens ONCE at query construction; the set is static for the
 * query's lifetime, so `commands_changed` still has no source event here.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveSettingSources } from '../internal/setting-sources.js';
import type {
  APIUserMessage,
  SettingSource,
  SlashCommand,
  TextBlockParam,
} from '../types.js';

/** A custom command loaded from disk, ready for listing and expansion. */
export type LoadedSlashCommand = {
  /** Bare name without the leading slash; ':'-namespaced for subdirectories. */
  name: string;
  description: string;
  argumentHint: string;
  source: 'project' | 'user';
  /** Command body with the frontmatter fence stripped. */
  content: string;
};

/**
 * Engine built-ins surfaced alongside custom commands. These names are
 * RESERVED: a custom command file with the same name is dropped at load time
 * (built-in behavior must stay deterministic — /compact is recognized deep in
 * the engine loop by detectManualCompact, not by this expansion layer).
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'compact',
    description:
      'Compact the conversation history, optionally guided by trailing instructions',
    argumentHint: '[instructions]',
  },
];

/** Directory recursion bound: segments beyond this depth are ignored. */
const MAX_SCAN_DEPTH = 3;
/** Per-file size bound so a stray huge markdown cannot balloon the prompt. */
const MAX_COMMAND_FILE_BYTES = 65_536;

const NAME_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COMMAND_INVOCATION_RE = /^\/([A-Za-z0-9][A-Za-z0-9_:-]*)(?:\s+([\s\S]+))?$/;

/**
 * Load custom commands per the effective `settingSources`. All I/O failures
 * degrade to "no commands from that source" — a missing or unreadable
 * directory must never break query construction (runtime-context discipline).
 * `userCommandsDirOverride` is a test seam; production callers omit it.
 */
export function loadSlashCommands(
  cwd: string,
  sources: SettingSource[] | undefined,
  userCommandsDirOverride?: string,
): LoadedSlashCommand[] {
  const effective = resolveSettingSources(sources);
  const byName = new Map<string, LoadedSlashCommand>();
  // user first, project second: on a name collision the project entry
  // overwrites (most specific definition wins).
  if (effective.includes('user')) {
    const dir = userCommandsDirOverride ?? join(homedir(), '.claude', 'commands');
    for (const c of scanCommandsDir(dir, 'user')) byName.set(c.name, c);
  }
  if (effective.includes('project')) {
    const dir = join(cwd, '.claude', 'commands');
    for (const c of scanCommandsDir(dir, 'project')) byName.set(c.name, c);
  }
  for (const builtin of BUILTIN_SLASH_COMMANDS) byName.delete(builtin.name);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The full command list (built-ins + custom) in the official SlashCommand shape. */
export function slashCommandInfos(
  custom: readonly LoadedSlashCommand[],
): SlashCommand[] {
  return [
    ...BUILTIN_SLASH_COMMANDS.map((b) => ({ ...b })),
    ...custom.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
    })),
  ];
}

/**
 * The message text when a user message is PURE text (a plain string or only
 * text blocks), else null. Expansion must not touch mixed-content messages —
 * replacing a message that also carries an image would silently drop it.
 */
export function pureTextOf(message: APIUserMessage): string | null {
  if (typeof message.content === 'string') return message.content;
  const blocks = message.content;
  if (!blocks.every((b): b is TextBlockParam => b.type === 'text')) return null;
  return blocks.map((b) => b.text).join('\n');
}

/**
 * Expand a `/name [args]` invocation against the loaded custom commands.
 * Returns null (caller passes the text through unchanged) when the text is
 * not a slash invocation, names a built-in, or names no loaded command.
 */
export function expandSlashCommand(
  text: string,
  commands: readonly LoadedSlashCommand[],
): { name: string; expanded: string } | null {
  const match = COMMAND_INVOCATION_RE.exec(text.trim());
  if (match === null) return null;
  const name = match[1];
  if (name === undefined) return null;
  if (BUILTIN_SLASH_COMMANDS.some((b) => b.name === name)) return null;
  const command = commands.find((c) => c.name === name);
  if (command === undefined) return null;
  const args = (match[2] ?? '').trim();
  const positionals = args.length > 0 ? args.split(/\s+/) : [];
  let substituted = false;
  const expanded = command.content.replace(
    /\$(ARGUMENTS|[1-9])/g,
    (_whole, key: string) => {
      substituted = true;
      if (key === 'ARGUMENTS') return args;
      return positionals[Number(key) - 1] ?? '';
    },
  );
  const finalText =
    !substituted && args.length > 0 ? `${expanded}\n\n${args}` : expanded;
  return { name, expanded: finalText };
}

/**
 * Frontmatter subset parser: a leading `---` fence closed by a `---` line,
 * with flat `key: value` entries between (quotes around the value stripped).
 * Anything else returns the input untouched as the body.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || lines[0]?.trim() !== '---') {
    return { meta: {}, body: raw };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (let i = 1; i < closeIdx; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv === null) continue;
    const key = kv[1];
    let value = (kv[2] ?? '').trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== undefined) meta[key] = value;
  }
  return { meta, body: lines.slice(closeIdx + 1).join('\n') };
}

function scanCommandsDir(
  root: string,
  source: 'project' | 'user',
): LoadedSlashCommand[] {
  const out: LoadedSlashCommand[] = [];
  walk(root, [], 0);
  return out;

  function walk(dir: string, segments: string[], depth: number): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    entries.sort();
    for (const entry of entries) {
      const path = join(dir, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (depth < MAX_SCAN_DEPTH && NAME_SEGMENT_RE.test(entry)) {
          walk(path, [...segments, entry], depth + 1);
        }
        continue;
      }
      if (!entry.endsWith('.md')) continue;
      const base = entry.slice(0, -'.md'.length);
      if (!NAME_SEGMENT_RE.test(base)) continue;
      if (stat.size > MAX_COMMAND_FILE_BYTES) continue;
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const { meta, body } = parseFrontmatter(raw);
      const content = body.trim();
      if (content.length === 0) continue;
      out.push({
        name: [...segments, base].join(':'),
        description: meta['description'] ?? firstLineOf(content),
        argumentHint: meta['argument-hint'] ?? '',
        source,
        content,
      });
    }
  }
}

/** Fallback description: the first non-empty line, de-headinged and bounded. */
function firstLineOf(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed.length > 0) {
      return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed;
    }
  }
  return '';
}
