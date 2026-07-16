/**
 * Test helper: scripted global-fetch stub speaking the Messages API SSE
 * wire format.
 *
 * makeSSEFetch(scripts) returns a vi.fn-backed fetch replacement. Each call
 * consumes the next script (an array of raw Messages-API stream event
 * payload objects) and answers with an HTTP 200 Response whose body is a
 * ReadableStream of `event: <type>\ndata: <json>\n\n` frames. Every request
 * is recorded (url, init, lower-cased headers, parsed JSON body) on the
 * stub's `requests` array for assertions.
 *
 * Including the HANG_STREAM sentinel in a script keeps the response stream
 * open after the listed events (it never closes) - used to exercise
 * interrupt()/close() paths. A fetch call past the end of the script list
 * gets a non-retryable HTTP 400 error response so tests fail fast instead
 * of triggering the transport's backoff retries.
 */

import { vi } from 'vitest';
import type { Mock } from 'vitest';

/** Sentinel: when present in a script, the response stream never closes. */
export const HANG_STREAM: { readonly __hang: true } = { __hang: true };

export type RecordedRequest = {
  url: string;
  init: RequestInit | undefined;
  /** Header names lower-cased (transport passes a plain object). */
  headers: Record<string, string>;
  /** JSON.parse of init.body when it is a string; the raw value otherwise. */
  body: Record<string, any>;
};

type FetchImpl = (input: unknown, init?: RequestInit) => Promise<Response>;

export type SSEFetchStub = Mock<FetchImpl> & { requests: RecordedRequest[] };

function extractHeaders(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers;
  if (headers === undefined || headers === null) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[String(key).toLowerCase()] = String(value);
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
}

/** Encode one raw event payload as an SSE wire frame. */
export function encodeSSEFrame(event: object): Uint8Array {
  const type = (event as { type?: unknown }).type;
  const name = typeof type === 'string' ? type : 'message';
  return new TextEncoder().encode(
    `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

/**
 * Build the scripted fetch stub. `scripts[i]` answers the (i+1)-th fetch
 * call; each entry is an array of raw stream-event payloads (optionally
 * containing the HANG_STREAM sentinel to leave the stream open).
 */
export function makeSSEFetch(scripts: ReadonlyArray<readonly object[]>): SSEFetchStub {
  const requests: RecordedRequest[] = [];
  let calls = 0;

  const impl: FetchImpl = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as { url?: unknown })?.url ?? input);
    let body: Record<string, any>;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body) as Record<string, any>;
      } catch {
        body = { __unparsed: init.body };
      }
    } else {
      body = { __unparsed: init?.body };
    }
    requests.push({ url, init, headers: extractHeaders(init), body });

    const idx = calls;
    calls += 1;
    const script = scripts[idx];
    if (script === undefined) {
      // Non-retryable 4xx: the transport surfaces it immediately instead of
      // backing off, so an over-consuming test fails fast and legibly.
      return new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `sse-fetch: unexpected fetch call #${idx + 1} (only ${scripts.length} script(s) provided)`,
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }

    const hang = script.includes(HANG_STREAM);
    const events = script.filter((e) => e !== HANG_STREAM);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeSSEFrame(event));
        if (!hang) controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };

  return Object.assign(vi.fn<FetchImpl>(impl), { requests });
}
