/**
 * Side-channel carrying a batch's structured tool results from the engine loop
 * (which builds the API user turn) to the query layer (which emits the
 * SDKUserMessage), added 2026-07-27 with the structured-output surface.
 *
 * A WeakMap keyed by the turn object rather than a field on it, for one
 * reason: `APIMessageParam` is the ANTHROPIC WIRE SHAPE. Every entry in
 * `history` is serialized into the next request, and an extra property riding
 * along would either be sent to the API (rejected, or worse, silently billed
 * as unknown content) or force a strip-before-send step that every future call
 * site has to remember. Keying off the object identity keeps the wire type
 * exactly what its name says it is.
 *
 * WeakMap, not Map: entries die with the turn objects, so a long session
 * cannot accumulate a second copy of every tool result it ever produced.
 */

import type { APIMessageParam } from '../types.js';
import type { ToolUseResults } from '../types/tool-outputs.js';

const RESULTS = new WeakMap<object, ToolUseResults>();

/** Attach a batch's structured results to the user turn that carries them. */
export function attachToolUseResults(turn: APIMessageParam, results: ToolUseResults): void {
  RESULTS.set(turn as unknown as object, results);
}

/** Read back what `attachToolUseResults` stored, or undefined for a turn that
 *  carried none (a plain user message, or a batch where no tool produced a
 *  structured result). */
export function readToolUseResults(turn: APIMessageParam): ToolUseResults | undefined {
  return RESULTS.get(turn as unknown as object);
}
