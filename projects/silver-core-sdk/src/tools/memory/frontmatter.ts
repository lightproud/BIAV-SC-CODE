/**
 * Frontmatter memory schema (keeper ruling 2026-07-29, T75 design round —
 * scs-req-memory-frontmatter-attachment-r1): in `schema: 'frontmatter'` every
 * written memory file must begin with the official Claude Code memory
 * frontmatter head, so write-side quality has a harness-enforced floor and the
 * selective-attachment picker (attachment.ts) has a description to select by.
 *
 * The contract (official memory-instructions shape; `pinned` per the same
 * ruling — always-attach, outside the picker):
 *
 *   ---
 *   name: <short-kebab-case-slug>
 *   description: <one-line summary — used to decide relevance during recall>
 *   metadata:
 *     type: user | feedback | project | reference
 *     pinned: <true|false, optional>
 *   ---
 *   <the fact / memory body — free form>
 *
 * Validation floor (r1 §1.2): frontmatter presence, required name +
 * description, the four-type enum, and a single-line description cap of 150
 * characters (aligned with the resident-index line budget). Kebab-case is
 * prompt guidance, NOT validated — memory content is frequently non-ASCII and
 * a hard slug rule would reject honest names. The resident index
 * /memories/MEMORY.md is EXEMPT (an index is not a memory — same exemption
 * cards mode had). Validation failures return a STRUCTURED error restating
 * the format plus the delete+create migration path, so a model touching an
 * old-format file learns the way out instead of retrying str_replace forever
 * (r1 迁移悬崖).
 *
 * The parser is a deliberate YAML SUBSET, not a YAML engine: top-level
 * `key: value` lines plus the `metadata:` block's indented keys. Known keys
 * are collected wherever they appear (indented under metadata or top-level —
 * lenient read, strict write guidance); unknown keys are tolerated for
 * forward compatibility; duplicated known keys are an error (a duplicate is
 * always a confused write, and last-wins would train the model on it).
 */

export const MEMORY_FRONTMATTER_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export type MemoryFrontmatterType = (typeof MEMORY_FRONTMATTER_TYPES)[number];

/** Single-line description cap (aligned with the ~150-char index-line budget). */
export const FRONTMATTER_DESCRIPTION_MAX_CHARS = 150;

export type MemoryFrontmatter = {
  name: string;
  /** One line, <= FRONTMATTER_DESCRIPTION_MAX_CHARS chars — the selective-
   *  attachment picker's relevance signal. */
  description: string;
  type: MemoryFrontmatterType;
  /** Always-attach flag (r1 §四 ruling): a pinned memory bypasses the
   *  attachment picker, does not count against maxFiles, and takes budget
   *  priority. Default false. */
  pinned: boolean;
};

export type FrontmatterParseResult =
  | { ok: true; frontmatter: MemoryFrontmatter; body: string }
  | { ok: false; reason: string };

const FENCE = '---';
const KNOWN_KEYS = ['name', 'description', 'type', 'pinned'] as const;
type KnownKey = (typeof KNOWN_KEYS)[number];

/** Strip one matching pair of surrounding quotes (models often quote values). */
function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse the frontmatter head off `content`. Returns the typed head + the body
 * (everything after the closing fence), or a human-readable reason.
 */
export function parseMemoryFrontmatter(content: string): FrontmatterParseResult {
  const lines = content.split('\n');
  if ((lines[0] ?? '').trimEnd() !== FENCE) {
    return {
      ok: false,
      reason:
        'the file does not start with a frontmatter block (the first line must be "---")',
    };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]!.trimEnd() === FENCE) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return {
      ok: false,
      reason: 'the frontmatter block is never closed (no second "---" line)',
    };
  }

  const fields: Partial<Record<KnownKey, string>> = {};
  for (let i = 1; i < close; i += 1) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (m === null) {
      return {
        ok: false,
        reason: `unparseable frontmatter line ${i + 1}: ${JSON.stringify(line.slice(0, 60))}`,
      };
    }
    const key = m[1]!;
    if (key === 'metadata') continue; // the nesting container itself carries no value
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) continue; // forward-compat
    if (fields[key as KnownKey] !== undefined) {
      return { ok: false, reason: `frontmatter repeats the field "${key}"` };
    }
    fields[key as KnownKey] = unquote(m[2]!.trim());
  }

  const name = fields.name ?? '';
  if (name.length === 0) {
    return { ok: false, reason: 'missing or empty required field "name"' };
  }
  const description = fields.description ?? '';
  if (description.length === 0) {
    return { ok: false, reason: 'missing or empty required field "description"' };
  }
  if (description.length > FRONTMATTER_DESCRIPTION_MAX_CHARS) {
    return {
      ok: false,
      reason:
        `description is ${description.length} characters, over the ` +
        `${FRONTMATTER_DESCRIPTION_MAX_CHARS}-character single-line limit`,
    };
  }
  const type = fields.type ?? '';
  if (!(MEMORY_FRONTMATTER_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason:
        type.length === 0
          ? 'missing required field "type" under metadata'
          : `invalid type ${JSON.stringify(type)} — must be one of ` +
            MEMORY_FRONTMATTER_TYPES.join(' | '),
    };
  }
  let pinned = false;
  if (fields.pinned !== undefined) {
    if (fields.pinned !== 'true' && fields.pinned !== 'false') {
      return {
        ok: false,
        reason: `invalid pinned value ${JSON.stringify(fields.pinned)} — must be true or false`,
      };
    }
    pinned = fields.pinned === 'true';
  }

  return {
    ok: true,
    frontmatter: { name, description, type: type as MemoryFrontmatterType, pinned },
    body: lines.slice(close + 1).join('\n'),
  };
}

/**
 * Validate content for a frontmatter-mode write. Returns null when valid,
 * else the STRUCTURED error string surfaced to the model — restates the
 * format AND the delete+create migration path (r1 迁移悬崖: a str_replace /
 * insert into an old-format file is re-validated as a whole and rejected, so
 * the error must teach the rewrite, not just say no).
 */
export function validateMemoryFrontmatter(content: string): string | null {
  const parsed = parseMemoryFrontmatter(content);
  if (parsed.ok) return null;
  return (
    `Error: frontmatter validation failed: ${parsed.reason}. ` +
    `Every memory file must begin with YAML frontmatter in this exact shape:\n` +
    `---\n` +
    `name: <short-kebab-case-slug>\n` +
    `description: <one-line summary — used to decide relevance during recall>\n` +
    `metadata:\n` +
    `  type: user | feedback | project | reference\n` +
    `  pinned: <true|false, optional>\n` +
    `---\n` +
    `<the memory body — free form>\n` +
    `The description must be a single line of at most ` +
    `${FRONTMATTER_DESCRIPTION_MAX_CHARS} characters. To convert an existing ` +
    `file written under another format, do not edit it in place with ` +
    `str_replace or insert (the whole file is re-validated and the edit will ` +
    `keep failing) — delete the file and re-create it with the frontmatter ` +
    `head, keeping the body content. Fix the content and retry the command.`
  );
}
