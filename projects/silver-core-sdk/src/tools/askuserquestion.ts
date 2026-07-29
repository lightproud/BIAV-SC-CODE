/**
 * Built-in AskUserQuestion tool: pose 1-4 structured multiple-choice questions
 * to the user and return their selected answers.
 *
 * Routes to the host handler wired via options.onUserQuestion (-> ctx.askUser).
 * Every exit reports WHAT HAPPENED, never what the user supposedly wanted:
 * no handler configured, input rejected, handler threw, handler produced no
 * answer, answers rendered per header. The four failure exits are isError and
 * each carries a distinct `outcome` in `structuredOutput`.
 *
 * WHY the wording matters (BPT request 2026-07-29): this tool used to collapse
 * a host-side MECHANICAL FACT into an assertion about a human's mind. A
 * handler that threw (IPC down, renderer crashed, host bug) and a handler that
 * returned null (question window closed, headless, host skipped it) both
 * rendered "User declined to answer." — so the model told the user it had
 * heard a refusal that was never uttered. BPT's UI has no cancel button at
 * all; the one sentence this tool emitted described an action its users are
 * physically unable to take. The SDK does not know the user's intent here and
 * must not invent one: it reports "no answer was obtained", and says the
 * intent is unknown.
 *
 * WHY structuredOutput (same request, D3): distinguishing those exits was
 * possible only by string-matching the hardcoded English sentence — which
 * `internal/contracts.ts` forbids in as many words ("Text is a rendering;
 * rendering is not an interface"), and which made the SDK's internal wording a
 * de-facto public contract that would break its consumer silently on any
 * rewording. `outcome` is that contract instead.
 *
 * Plumbing: this is a tool-execute callback, NOT permission-gate interception -
 * answers do not pass through the gate's updatedInput/denial ledger.
 */

import type {
  BuiltinTool,
  ToolContext,
  ToolResultPayload,
} from '../internal/contracts.js';
import type { UserQuestion, UserQuestionAnswer } from '../types.js';
import type { AskUserQuestionStructuredOutput } from '../types/tool-outputs.js';
import { AbortError, isAbortError } from '../errors.js';
import { singleLine } from '../internal/inert-text.js';
import { ASKUSERQUESTION_DESCRIPTION } from './descriptions.js';

/** Diagnosable message for ANY thrown value (same helper as resources.ts /
 *  webfetch.ts / websearch.ts, audit 2026-07-17 L74): a non-Error throw
 *  (string / plain object) rendered "failed: undefined" under a blind
 *  `(e as Error).message` cast, losing the only diagnostic there was. */
function thrownMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e !== null && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

/** An isError result carrying the machine-readable outcome. `error` mirrors
 *  the message so a consumer never has to parse the sentence (ReadMcpResource
 *  precedent, resources.ts:20-26). */
function outcomeError(
  outcome: Exclude<AskUserQuestionStructuredOutput['outcome'], 'answered'>,
  message: string,
): ToolResultPayload {
  const structuredOutput: AskUserQuestionStructuredOutput = {
    outcome,
    answers: [],
    error: message,
  };
  return { content: message, isError: true, structuredOutput };
}

type ParseOk = { ok: true; value: UserQuestion[] };
type ParseErr = { ok: false; message: string };

/** Validate + normalize the questions payload (string options -> {label}). */
function parseQuestions(raw: unknown): ParseOk | ParseErr {
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'AskUserQuestion failed: "questions" must be an array.' };
  }
  if (raw.length < 1 || raw.length > 4) {
    return {
      ok: false,
      message: `AskUserQuestion failed: "questions" must contain 1 to 4 questions (got ${raw.length}).`,
    };
  }

  const questions: UserQuestion[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: `AskUserQuestion failed: questions[${i}] must be an object.` };
    }
    const q = item as Record<string, unknown>;
    if (typeof q['question'] !== 'string' || (q['question'] as string).length === 0) {
      return {
        ok: false,
        message: `AskUserQuestion failed: questions[${i}].question must be a non-empty string.`,
      };
    }
    if (typeof q['header'] !== 'string' || (q['header'] as string).length === 0) {
      return {
        ok: false,
        message: `AskUserQuestion failed: questions[${i}].header must be a non-empty string.`,
      };
    }
    const rawOptions = q['options'];
    if (!Array.isArray(rawOptions) || rawOptions.length < 1) {
      return {
        ok: false,
        message: `AskUserQuestion failed: questions[${i}].options must be a non-empty array.`,
      };
    }
    const options: Array<{ label: string; description?: string; preview?: string }> = [];
    for (let j = 0; j < rawOptions.length; j++) {
      const opt = rawOptions[j];
      if (typeof opt === 'string') {
        if (opt.length === 0) {
          return {
            ok: false,
            message: `AskUserQuestion failed: questions[${i}].options[${j}] must be a non-empty string.`,
          };
        }
        options.push({ label: opt });
      } else if (opt && typeof opt === 'object' && !Array.isArray(opt)) {
        const o = opt as Record<string, unknown>;
        if (typeof o['label'] !== 'string' || (o['label'] as string).length === 0) {
          return {
            ok: false,
            message: `AskUserQuestion failed: questions[${i}].options[${j}].label must be a non-empty string.`,
          };
        }
        const normalized: { label: string; description?: string; preview?: string } = {
          label: o['label'] as string,
        };
        if (typeof o['description'] === 'string') normalized.description = o['description'] as string;
        // Official `preview` field: accepted and forwarded verbatim to the
        // host handler; rendering is the host UI's choice (keeper 2026-07-28
        // "三处全补" — accept honestly, never draw). Official constraint:
        // single-select only, enforced after multiSelect is known below.
        if (typeof o['preview'] === 'string') normalized.preview = o['preview'] as string;
        options.push(normalized);
      } else {
        return {
          ok: false,
          message: `AskUserQuestion failed: questions[${i}].options[${j}] must be a string or {label, description?, preview?} object.`,
        };
      }
    }

    const multiSelectRaw = q['multiSelect'];
    if (multiSelectRaw !== undefined && typeof multiSelectRaw !== 'boolean') {
      return {
        ok: false,
        message: `AskUserQuestion failed: questions[${i}].multiSelect must be a boolean when provided.`,
      };
    }
    if (multiSelectRaw === true && options.some((o) => o.preview !== undefined)) {
      return {
        ok: false,
        message: `AskUserQuestion failed: questions[${i}] uses preview on a multiSelect question — previews are only supported for single-select questions.`,
      };
    }

    questions.push({
      question: q['question'] as string,
      header: q['header'] as string,
      options,
      multiSelect: multiSelectRaw === true,
    });
  }

  return { ok: true, value: questions };
}

function renderAnswers(answers: UserQuestionAnswer[]): string {
  if (answers.length === 0) return 'No answers provided.';
  // Per-element shape validation (audit 2026-07-17 L72): the host handler is
  // untrusted input here — an element missing its `answers` array threw an
  // uncaught TypeError (`undefined.join`) OUTSIDE the execute try/catch and
  // crashed into the engine, while every sibling path degrades to isError.
  // This digest is LINE-ORIENTED: each answer is one `\n`-separated record. The
  // header and answer strings are host-handler output, so an embedded newline
  // forges an extra "Header: value" record — the same forgery WebSearch's
  // renderResults collapses for untrusted web content. Pass both through
  // singleLine so a record can only ever be created by this renderer.
  return answers
    .map((a) => {
      const header = typeof a?.header === 'string' ? singleLine(a.header) : '(missing header)';
      const list = Array.isArray(a?.answers)
        ? a.answers
            .filter((x): x is string => typeof x === 'string')
            .map(singleLine)
            .join(', ')
        : '(malformed answer)';
      return `${header}: ${list}`;
    })
    .join('\n');
}

export const askUserQuestionTool: BuiltinTool = {
  name: 'AskUserQuestion',
  description: ASKUSERQUESTION_DESCRIPTION,
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        description: '1 to 4 questions to ask the user.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The full question text.' },
            header: { type: 'string', description: 'A short label for the question (a few words).' },
            options: {
              type: 'array',
              minItems: 1,
              description:
                'Answer options: a string, or {label, description?, preview?}. ' +
                '`preview` is a self-contained HTML fragment the host UI may ' +
                'render when the option is focused (single-select questions only).',
              // The real accepted shapes, expressed instead of `{}` (the old
              // zero-constraint schema left the model to guess from prose —
              // 2026-07-28 keeper ruling "三处全补").
              items: {
                oneOf: [
                  { type: 'string', minLength: 1 },
                  {
                    type: 'object',
                    properties: {
                      label: { type: 'string', minLength: 1 },
                      description: { type: 'string' },
                      preview: { type: 'string' },
                    },
                    required: ['label'],
                  },
                ],
              },
            },
            multiSelect: {
              type: 'boolean',
              description: 'Whether the user may select multiple options (default false).',
            },
          },
          required: ['question', 'header', 'options'],
        },
      },
    },
    required: ['questions'],
  },
  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResultPayload> {
    if (ctx.signal.aborted) throw new AbortError();

    const parsed = parseQuestions(input['questions']);
    if (!parsed.ok) return outcomeError('invalid_input', parsed.message);

    if (!ctx.askUser) {
      return outcomeError(
        'not_configured',
        'AskUserQuestion requires options.onUserQuestion; none configured.',
      );
    }

    let answers: UserQuestionAnswer[] | null;
    try {
      answers = await ctx.askUser(parsed.value, { signal: ctx.signal });
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('AskUserQuestion was aborted');
      // A THROWING handler is a HOST fault, not a user decision — the user may
      // never have seen the question. Name the thrown reason (it used to be
      // swallowed whole, so a host with a broken question bridge saw nothing
      // anywhere) and state plainly that the intent is unknown.
      const reason = thrownMessage(e);
      ctx.debug(`AskUserQuestion: the onUserQuestion handler threw: ${reason}`);
      return outcomeError(
        'handler_error',
        `AskUserQuestion failed: the options.onUserQuestion handler threw (${reason}). ` +
          `No answer was obtained; the user's intent is unknown.`,
      );
    }

    if (answers === null) {
      // null is the handler contract's NEUTRAL "no answers array" signal
      // (types/subsystems.ts). A host returns it for any reason it could not
      // collect one — window closed, no UI to render into, policy skip — and
      // only the host knows which. Report the mechanical fact, not a motive.
      return outcomeError(
        'no_answer',
        'AskUserQuestion obtained no answer: the host handler returned none. ' +
          "The user's intent on this question is unknown — do not assume they declined.",
      );
    }
    if (!Array.isArray(answers)) {
      return outcomeError(
        'handler_error',
        'AskUserQuestion failed: handler returned an unexpected value.',
      );
    }

    ctx.debug(`AskUserQuestion: ${parsed.value.length} questions -> ${answers.length} answers`);
    const structuredOutput: AskUserQuestionStructuredOutput = { outcome: 'answered', answers };
    return { content: renderAnswers(answers), structuredOutput };
  },
};
