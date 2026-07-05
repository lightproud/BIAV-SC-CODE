/**
 * v0.6 product-feature generators & classifiers — the observable "black box"
 * auxiliary model calls Claude Code fires around the main agent loop, shipped
 * here as REAL public SDK functions with real callers:
 *
 *   - detectCommandPrefix     -> permission allowlist matching (a Bash gate can
 *                                extract the prefix a command would be
 *                                allowlisted under, or flag command injection).
 *   - classifyBackgroundState -> the background-run notification layer (should
 *                                we ping the user? is the run done/stuck/going?)
 *                                — a real consumer of v0.5 background Bash.
 *   - generateSessionTitle    -> session UI naming.
 *   - generateTitleAndBranch  -> session creation (title + git branch).
 *   - generateSessionName     -> /rename with no args.
 *
 * Each is a thin wrapper over runUtilityCall with a faithful reproduced prompt
 * (prompts.ts) and a robust output parser. Because these ARE shipped features
 * with callers, reproducing their prompts does not violate the "no prompts for
 * unshipped capabilities" red line — the capability ships alongside its prompt.
 */

import {
  AWAY_SUMMARY_SYSTEM,
  BACKGROUND_STATE_SYSTEM,
  COMMAND_PREFIX_SYSTEM,
  MEMORY_FILES_OUTPUT_CONTRACT,
  MEMORY_FILES_SYSTEM,
  SESSION_NAME_SYSTEM,
  SESSION_TITLE_SYSTEM,
  TITLE_AND_BRANCH_SYSTEM,
} from './prompts.js';
import {
  extractJsonObject,
  runUtilityCall,
  type UtilityCallOptions,
} from './runtime.js';

// ---------------------------------------------------------------------------
// 1. Command prefix detection
// ---------------------------------------------------------------------------

/** The literal token the classifier returns when it detects command injection. */
export const COMMAND_INJECTION_TOKEN = 'command_injection_detected';

/**
 * Result of classifying a Bash command for allowlist matching:
 *   - { kind: 'prefix', prefix }  the allowlistable string prefix
 *   - { kind: 'none' }            no meaningful prefix (e.g. bare `git push`)
 *   - { kind: 'injection' }       command injection suspected -> never auto-allow
 */
export type CommandPrefixResult =
  | { kind: 'prefix'; prefix: string }
  | { kind: 'none' }
  | { kind: 'injection' };

/**
 * Extract the allowlistable command prefix for a Bash command, or flag command
 * injection. A permission layer uses this to decide whether a command matches a
 * user's allowed-prefix rule: an `injection` verdict must FALL BACK to a manual
 * prompt (never silently auto-allow), because a malicious command can share a
 * benign prefix. The model is asked to return only the bare token; this parses
 * it into a typed verdict and fails CLOSED (injection) on an empty/garbled
 * reply so an unparseable answer can never widen access.
 */
export async function detectCommandPrefix(
  command: string,
  opts: UtilityCallOptions = {},
): Promise<CommandPrefixResult> {
  const raw = await runUtilityCall(COMMAND_PREFIX_SYSTEM, command, opts, 128);
  return parseCommandPrefix(raw);
}

/** Pure parser for the command-prefix reply (unit-testable, no I/O). */
export function parseCommandPrefix(raw: string): CommandPrefixResult {
  // Strip stray code fences before line analysis.
  const cleaned = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .trim();
  const lines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Fail CLOSED on ambiguity. A well-formed reply is exactly ONE line (the bare
  // token). Anything else is malformed and must not be trusted:
  //   - empty reply -> injection (never a valid prefix)
  //   - MULTI-line reply -> injection (a benign prefix on line 1 must never
  //     mask an injection flag or a second command on line 2)
  const only = lines.length === 1 ? lines[0] : undefined;
  if (only === undefined) return { kind: 'injection' };
  const token = only.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (token.length === 0) return { kind: 'injection' };
  // Sentinel comparison tolerates case + trailing punctuation decoration
  // ("command_injection_detected." / "None") so a lightly-garbled sentinel
  // still fails closed / maps to none instead of leaking through as a prefix.
  const sentinel = token.toLowerCase().replace(/[.!,;:\s]+$/g, '');
  if (sentinel === COMMAND_INJECTION_TOKEN) return { kind: 'injection' };
  if (sentinel === 'none') return { kind: 'none' };
  // A genuine prefix is returned VERBATIM (case-sensitive: env-var prefixes like
  // `GOEXPERIMENT=synctest go test` must not be lowercased).
  return { kind: 'prefix', prefix: token };
}

// ---------------------------------------------------------------------------
// 2. Background agent state classifier
// ---------------------------------------------------------------------------

/** The four states a background run's tail can be classified into. */
export type BackgroundRunState = 'working' | 'blocked' | 'done' | 'failed';

/** Structured classification of a background run's transcript tail. */
export interface BackgroundStateResult {
  state: BackgroundRunState;
  /** One-line lock-screen detail. */
  detail: string;
  /** active = computing, idle = waiting on external, blocked = waiting on user. */
  tempo: 'active' | 'idle' | 'blocked';
  /** When blocked: the exact action the user should take. */
  needs?: string;
  /** Deliverable headline; {} when still working. */
  output: { result?: string };
}

const BACKGROUND_STATES: ReadonlySet<string> = new Set([
  'working',
  'blocked',
  'done',
  'failed',
]);
const BACKGROUND_TEMPOS: ReadonlySet<string> = new Set(['active', 'idle', 'blocked']);

/**
 * Classify the TAIL of a background agent transcript as working/blocked/done/
 * failed so a notification layer can decide whether to ping the user. Returns a
 * structured verdict. `previousState` is threaded into the prompt for the
 * classifier's stickiness rule (don't flip done->working without a restart).
 */
export async function classifyBackgroundState(
  input: { tail: string; previousState?: BackgroundRunState },
  opts: UtilityCallOptions = {},
): Promise<BackgroundStateResult> {
  const user =
    input.previousState !== undefined
      ? `Previous state: ${input.previousState}\n\nTranscript tail:\n${input.tail}`
      : input.tail;
  const raw = await runUtilityCall(BACKGROUND_STATE_SYSTEM, user, opts, 512);
  return parseBackgroundState(raw);
}

/** Pure parser for the background-state JSON reply (unit-testable, no I/O). */
export function parseBackgroundState(raw: string): BackgroundStateResult {
  const obj = extractJsonObject(raw);
  if (obj === null || typeof obj !== 'object') {
    // Fail SAFE toward not-interrupting: an unparseable reply is treated as
    // "done" (the notification gate only pings on "blocked"), so a garbled
    // classification never fabricates a false interruption.
    return { state: 'done', detail: 'unclassified (unparseable reply)', tempo: 'idle', output: {} };
  }
  const rec = obj as Record<string, unknown>;
  const state = BACKGROUND_STATES.has(rec.state as string)
    ? (rec.state as BackgroundRunState)
    : 'done';
  const tempo = BACKGROUND_TEMPOS.has(rec.tempo as string)
    ? (rec.tempo as BackgroundStateResult['tempo'])
    : state === 'blocked'
      ? 'blocked'
      : state === 'working'
        ? 'active'
        : 'idle';
  const outputRec =
    rec.output !== null && typeof rec.output === 'object'
      ? (rec.output as Record<string, unknown>)
      : {};
  const result: BackgroundStateResult = {
    state,
    detail: typeof rec.detail === 'string' ? rec.detail : '',
    tempo,
    output:
      typeof outputRec.result === 'string' ? { result: outputRec.result } : {},
  };
  if (typeof rec.needs === 'string' && rec.needs.length > 0) result.needs = rec.needs;
  return result;
}

// ---------------------------------------------------------------------------
// 3. Session title generator
// ---------------------------------------------------------------------------

/**
 * Generate a concise sentence-case session title (3-7 words) from session
 * content. The content is wrapped in <session> tags per the official prompt
 * (which instructs the model to treat it as inert data, not instructions).
 */
export async function generateSessionTitle(
  sessionContent: string,
  opts: UtilityCallOptions = {},
): Promise<string> {
  const user = `<session>\n${sessionContent}\n</session>`;
  const raw = await runUtilityCall(SESSION_TITLE_SYSTEM, user, opts, 128);
  const obj = extractJsonObject(raw);
  const title = readStringField(obj, 'title');
  // Fall back to a trimmed raw reply if the model returned a bare string.
  return title ?? stripToPlain(raw);
}

// ---------------------------------------------------------------------------
// 4. Session title + git branch generation
// ---------------------------------------------------------------------------

/** A generated session title paired with a `claude/`-prefixed git branch. */
export interface TitleAndBranch {
  title: string;
  /** kebab-case, always normalized to start with `claude/`. */
  branch: string;
}

/**
 * Generate a succinct title AND a `claude/`-prefixed kebab-case git branch from
 * a session description. The branch is normalized defensively (lowercased,
 * non-alphanumerics collapsed to dashes, forced under `claude/`) so a slightly
 * off-spec model reply still yields a valid, checkoutable branch name.
 */
export async function generateTitleAndBranch(
  description: string,
  opts: UtilityCallOptions = {},
): Promise<TitleAndBranch> {
  const system = TITLE_AND_BRANCH_SYSTEM.replace('{description}', description);
  // The description is already embedded in the (interpolated) system prompt;
  // the user turn just triggers generation.
  const raw = await runUtilityCall(
    system,
    'Please generate a title and branch name for this session.',
    opts,
    200,
  );
  const obj = extractJsonObject(raw);
  const title = readStringField(obj, 'title') ?? stripToPlain(raw);
  const rawBranch = readStringField(obj, 'branch') ?? '';
  return { title, branch: normalizeBranch(rawBranch, title) };
}

/**
 * Force a model-proposed branch into a valid `claude/<kebab>` name. Lowercases,
 * strips a leading `claude/`, collapses any run of non-alphanumeric chars to a
 * single dash, trims dashes, and re-prefixes. Falls back to slugifying the
 * title, then a constant, so the result is ALWAYS a non-empty valid branch.
 */
export function normalizeBranch(rawBranch: string, title: string): string {
  const slug = (s: string): string =>
    s
      .toLowerCase()
      .replace(/^claude\//, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  let body = slug(rawBranch);
  if (body.length === 0) body = slug(title);
  if (body.length === 0) body = 'session';
  return `claude/${body}`;
}

// ---------------------------------------------------------------------------
// 5. /rename auto-generated session name
// ---------------------------------------------------------------------------

/**
 * Generate a short kebab-case session name (2-4 words) from conversation
 * context — the behaviour of `/rename` with no args. The reply is normalized to
 * a valid kebab slug so it is safe to use as a name/identifier.
 */
export async function generateSessionName(
  conversation: string,
  opts: UtilityCallOptions = {},
): Promise<string> {
  const raw = await runUtilityCall(SESSION_NAME_SYSTEM, conversation, opts, 64);
  const obj = extractJsonObject(raw);
  const name = readStringField(obj, 'name') ?? stripToPlain(raw);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'session';
}

// ---------------------------------------------------------------------------
// 6. Away-summary generator ("while you were away" recap)
// ---------------------------------------------------------------------------

/**
 * Generate an under-40-word, 1-2 plain-sentence recap of a backgrounded run for
 * a "welcome back" surface, from the transcript tail. Same away/notification
 * family as classifyBackgroundState; the recap capability ships as this exported
 * function alongside its prompt. The reply is normalized to plain text.
 */
export async function generateAwaySummary(
  tail: string,
  opts: UtilityCallOptions = {},
): Promise<string> {
  const raw = await runUtilityCall(AWAY_SUMMARY_SYSTEM, tail, opts, 128);
  return parseAwaySummary(raw);
}

/**
 * Pure parser for the away-summary reply (unit-testable, no I/O). Enforces the
 * "no markdown, 1-2 plain sentences" contract by stripping code fences, heading
 * markers, emphasis, and wrapping quotes, and collapsing whitespace/newlines to
 * a single line. Non-lossy on words (no hard truncation — that is a model-side
 * instruction, not something to silently enforce here).
 */
export function parseAwaySummary(raw: string): string {
  return raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    // Strip markdown emphasis/code markers but NOT underscores: underscores are
    // far more likely to be snake_case identifiers or file paths (run_query,
    // db_client.py) in a plain recap than markdown emphasis, and blanket-
    // stripping them silently corrupts real content.
    .replace(/[*`]+/g, '')
    // Trim wrapping quotes, incl. both smart double AND smart single quotes.
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// 7. Determine which memory files to attach (query-time memory selection)
// ---------------------------------------------------------------------------

/** One available memory file the selector can choose from. */
export interface MemoryFileDescriptor {
  filename: string;
  description: string;
}

/**
 * Select which memory files are clearly useful for a user's query (up to 5).
 * The consuming path is memory/settingSources loading: when many memory files
 * exist, attach only the relevant ones instead of all. Fails SAFE to an EMPTY
 * selection (attach nothing) on a garbled reply, caps at 5, and — critically —
 * only ever returns filenames that are in the provided `available` set, so a
 * hallucinated filename can never be attached.
 */
export async function selectMemoryFilesToAttach(
  input: { available: MemoryFileDescriptor[]; query: string },
  opts: UtilityCallOptions = {},
): Promise<string[]> {
  if (input.available.length === 0) return [];
  const system = MEMORY_FILES_SYSTEM + '\n\n' + MEMORY_FILES_OUTPUT_CONTRACT;
  const listing = input.available
    .map((m) => `- ${m.filename}: ${m.description}`)
    .join('\n');
  const user = `Available memory files:\n${listing}\n\nUser query:\n${input.query}`;
  const raw = await runUtilityCall(system, user, opts, 256);
  return parseMemoryFileSelection(raw, input.available.map((m) => m.filename));
}

/**
 * Pure parser for the memory-file selection reply (unit-testable, no I/O).
 * Accepts a JSON array of filenames (or a newline/comma list as a fallback),
 * keeps only names present in `availableFilenames` (drops hallucinations and
 * duplicates), and caps the result at 5. Fails SAFE to [].
 */
export function parseMemoryFileSelection(raw: string, availableFilenames: string[]): string[] {
  const allowed = new Set(availableFilenames);
  let names: string[] = [];
  const parsed = tryParseArray(raw);
  if (parsed !== null) {
    names = parsed;
  } else {
    // Fallback: split a bare list on newlines/commas, strip bullets/quotes.
    names = raw
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .split(/[\n,]/)
      .map((s) => s.replace(/^[\s*\-•]+/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
      .filter((s) => s.length > 0);
  }
  const out: string[] = [];
  for (const n of names) {
    if (allowed.has(n) && !out.includes(n)) out.push(n);
    if (out.length >= 5) break;
  }
  return out;
}

/** Parse a JSON array of strings from a reply, or null. */
function tryParseArray(raw: string): string[] | null {
  const trimmed = raw.trim().replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return null;
    return arr.filter((x): x is string => typeof x === 'string').map((s) => s.trim());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Read a string field from a parsed JSON object, or null. */
function readStringField(obj: unknown, field: string): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  const v = (obj as Record<string, unknown>)[field];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/** Strip code fences and quotes from a bare-string fallback reply. */
function stripToPlain(raw: string): string {
  return raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

export type { UtilityCallOptions } from './runtime.js';
export {
  DEFAULT_UTILITY_MODEL,
  runUtilityCall,
  extractJsonObject,
  resolveUtilityTransport,
} from './runtime.js';
export {
  GENERATOR_PROVENANCE,
  type GeneratorProvenance,
  COMMAND_PREFIX_SYSTEM,
  BACKGROUND_STATE_SYSTEM,
  SESSION_TITLE_SYSTEM,
  TITLE_AND_BRANCH_SYSTEM,
  SESSION_NAME_SYSTEM,
  AWAY_SUMMARY_SYSTEM,
  MEMORY_FILES_SYSTEM,
} from './prompts.js';
