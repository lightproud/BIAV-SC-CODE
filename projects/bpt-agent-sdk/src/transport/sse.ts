/**
 * BPT Agent SDK - Server-Sent Events (SSE) stream parser.
 *
 * Implements the subset of WHATWG EventSource framing the Anthropic Messages
 * API streaming endpoint uses:
 *   - events are delimited by blank lines
 *   - `event:` names the event, `data:` carries the payload
 *   - multi-line `data:` fields are concatenated with '\n'
 *   - lines starting with ':' are comments and ignored
 *   - '\r\n' line endings are tolerated (trailing '\r' stripped)
 *   - `id:` / `retry:` / unknown fields are ignored
 *
 * Clean-room implementation from the public SSE specification.
 */

import { AbortError } from '../errors.js';

/** One parsed SSE frame: optional event name plus the joined data payload. */
export type SSEFrame = { event?: string; data: string };

/**
 * Parse a byte stream into SSE frames.
 *
 * Frames are dispatched on their terminating blank line. On stream end, a
 * trailing frame that is missing only its blank-line terminator is flushed
 * as long as all of its lines were complete (newline-terminated); leftover
 * partial-line text is discarded.
 *
 * Aborting `signal` rejects with `AbortError` and cancels the reader.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let eventName: string | undefined;
  let dataLines: string[] = [];
  const pending: SSEFrame[] = [];

  const handleLine = (rawLine: string): void => {
    // Tolerate CRLF line endings.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      // Blank line: dispatch the accumulated frame (only when it has data).
      if (dataLines.length > 0) {
        pending.push(
          eventName === undefined
            ? { data: dataLines.join('\n') }
            : { event: eventName, data: dataLines.join('\n') },
        );
      }
      eventName = undefined;
      dataLines = [];
      return;
    }
    if (line.startsWith(':')) return; // comment line
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    // A single leading space after the colon is not part of the value.
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      eventName = value;
    } else if (field === 'data') {
      dataLines.push(value);
    }
    // 'id', 'retry' and unknown fields are intentionally ignored.
  };

  /** Consume every complete (newline-terminated) line currently buffered. */
  const drainBuffer = (): void => {
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      handleLine(line);
    }
  };

  // Reject a pending read() promptly when the caller aborts; the underlying
  // reader is cancelled in the finally block.
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => reject(new AbortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // Pre-attach a handler so an abort that fires while no read is racing does
  // not surface as an unhandled rejection.
  abortPromise.catch(() => undefined);

  try {
    if (signal?.aborted) throw new AbortError();
    for (;;) {
      const result = signal
        ? await Promise.race([reader.read(), abortPromise])
        : await reader.read();
      if (signal?.aborted) throw new AbortError();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      drainBuffer();
      while (pending.length > 0) {
        yield pending.shift() as SSEFrame;
        if (signal?.aborted) throw new AbortError();
      }
    }
    // Stream ended: flush any bytes held by the decoder, then process the
    // remaining complete lines. Whatever is left in `buffer` afterwards is a
    // partial (un-terminated) line and is discarded per the SSE spec.
    buffer += decoder.decode();
    drainBuffer();
    if (dataLines.length > 0) {
      pending.push(
        eventName === undefined
          ? { data: dataLines.join('\n') }
          : { event: eventName, data: dataLines.join('\n') },
      );
      eventName = undefined;
      dataLines = [];
    }
    while (pending.length > 0) {
      yield pending.shift() as SSEFrame;
    }
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    // Release the underlying stream whether we finished, threw, or the
    // consumer stopped iterating early.
    await reader.cancel().catch(() => undefined);
  }
}
