/**
 * Built-in AskUserQuestion tool: pose 1-4 structured multiple-choice questions
 * to the user and return their selected answers.
 *
 * Routes to the host handler wired via options.onUserQuestion (-> ctx.askUser).
 * When no handler is configured the tool returns a not-configured error. A
 * handler returning null (or throwing) is treated as "user declined" and yields
 * an isError result. Answers are rendered per header.
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
import { AbortError, isAbortError } from '../errors.js';
import { ASKUSERQUESTION_DESCRIPTION } from './descriptions.js';

function errorResult(message: string): ToolResultPayload {
  return { content: message, isError: true };
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
    const options: Array<{ label: string; description?: string }> = [];
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
        const normalized: { label: string; description?: string } = { label: o['label'] as string };
        if (typeof o['description'] === 'string') normalized.description = o['description'] as string;
        options.push(normalized);
      } else {
        return {
          ok: false,
          message: `AskUserQuestion failed: questions[${i}].options[${j}] must be a string or {label, description?} object.`,
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
  return answers
    .map((a) => `${a.header}: ${a.answers.join(', ')}`)
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
              description: 'Answer options: a string, or {label, description?}.',
              items: {},
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
    if (!parsed.ok) return errorResult(parsed.message);

    if (!ctx.askUser) {
      return errorResult(
        'AskUserQuestion requires options.onUserQuestion; none configured.',
      );
    }

    let answers: UserQuestionAnswer[] | null;
    try {
      answers = await ctx.askUser(parsed.value, { signal: ctx.signal });
    } catch (e) {
      if (isAbortError(e)) throw new AbortError('AskUserQuestion was aborted');
      return errorResult('User declined to answer.');
    }

    if (answers === null) {
      return errorResult('User declined to answer.');
    }
    if (!Array.isArray(answers)) {
      return errorResult('AskUserQuestion failed: handler returned an unexpected value.');
    }

    ctx.debug(`AskUserQuestion: ${parsed.value.length} questions -> ${answers.length} answers`);
    return { content: renderAnswers(answers) };
  },
};
