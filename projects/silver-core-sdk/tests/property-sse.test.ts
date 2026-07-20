/**
 * Property tests: SSE parser (src/transport/sse.ts) under byte-level hostility.
 *
 * Three invariants a streaming transport must hold no matter how the network
 * fragments the bytes:
 *  P1 CHUNKING INVARIANCE - for any SSE document and ANY partition of its
 *     bytes (including cuts inside multi-byte UTF-8 sequences), the parsed
 *     frame sequence is identical to parsing the document in one chunk.
 *  P2 NOISE IMMUNITY - comment lines and ignored fields (id/retry/unknown)
 *     injected anywhere between fields never change the frames.
 *  P3 TRUNCATION SAFETY - parsing ANY byte-prefix of a document never throws,
 *     yields exactly the frames whose terminator made it into the prefix,
 *     plus (per the documented end-of-stream flush) at most one final frame
 *     built from the complete data lines received - a prefix of the full
 *     frame's data.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseSSE, type SSEFrame } from '../src/transport/sse.js';

// --- generators ---------------------------------------------------------------

/** Line-safe text: no \n / \r (they would change framing by construction). */
const lineText = (maxLength: number) =>
  fc
    .string({ maxLength, unit: 'grapheme' })
    .map((s) => s.replace(/[\r\n]/g, ' '));

/** data-line text additionally must not carry a leading space (the parser
 *  strips ONE space after the colon; our serializer always writes one). */
const dataText = lineText(24);

const eventText = fc.option(
  lineText(12).map((s) => s.replace(/:/g, ';')),
  { nil: undefined },
);

type GenFrame = { event?: string; dataLines: string[] };

const frameArb: fc.Arbitrary<GenFrame> = fc.record({
  event: eventText,
  dataLines: fc.array(dataText, { minLength: 1, maxLength: 3 }),
});

const docArb = fc.array(frameArb, { minLength: 0, maxLength: 6 });

const NOISE = [': keep-alive comment', 'id: 42', 'retry: 1000', 'x-unknown: v', ':'];

function serialize(frames: GenFrame[], opts: { crlf?: boolean; noiseAt?: number[] } = {}): string {
  const nl = opts.crlf ? '\r\n' : '\n';
  const lines: string[] = [];
  for (const f of frames) {
    if (f.event !== undefined) lines.push(`event: ${f.event}`);
    for (const d of f.dataLines) lines.push(`data: ${d}`);
    lines.push('');
  }
  // Inject noise lines at requested positions (never inside a field line).
  const withNoise = [...lines];
  const spots = [...(opts.noiseAt ?? [])].sort((a, b) => b - a);
  for (const s of spots) {
    withNoise.splice(s % (withNoise.length + 1), 0, NOISE[s % NOISE.length]!);
  }
  return withNoise.map((l) => l + nl).join('');
}

function expectedFrames(frames: GenFrame[]): SSEFrame[] {
  return frames.map((f) =>
    f.event === undefined
      ? { data: f.dataLines.join('\n') }
      : { event: f.event, data: f.dataLines.join('\n') },
  );
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

function cutBytes(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => c % (bytes.length + 1)))].sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let prev = 0;
  for (const p of points) {
    if (p > prev) chunks.push(bytes.subarray(prev, p));
    prev = p;
  }
  if (prev < bytes.length) chunks.push(bytes.subarray(prev));
  return chunks;
}

async function parseAll(chunks: Uint8Array[]): Promise<SSEFrame[]> {
  const out: SSEFrame[] = [];
  for await (const f of parseSSE(streamOf(chunks))) out.push(f);
  return out;
}

// --- properties -----------------------------------------------------------------

describe('SSE parser properties (fast-check)', () => {
  it('P1: frame sequence is invariant under arbitrary byte chunking (incl. mid-UTF-8 cuts)', async () => {
    await fc.assert(
      fc.asyncProperty(
        docArb,
        fc.boolean(),
        fc.array(fc.nat(4096), { maxLength: 10 }),
        async (frames, crlf, cuts) => {
          const doc = serialize(frames, { crlf });
          const bytes = new TextEncoder().encode(doc);
          const whole = await parseAll([bytes]);
          const chunked = await parseAll(cutBytes(bytes, cuts));
          expect(chunked).toEqual(whole);
          expect(whole).toEqual(expectedFrames(frames));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('P2: comment / id / retry / unknown-field noise lines never change the frames', async () => {
    await fc.assert(
      fc.asyncProperty(
        docArb,
        fc.array(fc.nat(64), { maxLength: 6 }),
        fc.array(fc.nat(4096), { maxLength: 6 }),
        async (frames, noiseAt, cuts) => {
          const doc = serialize(frames, { noiseAt });
          const bytes = new TextEncoder().encode(doc);
          const parsed = await parseAll(cutBytes(bytes, cuts));
          expect(parsed).toEqual(expectedFrames(frames));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('P3: any byte-prefix parses without throwing; complete frames match; a flushed tail frame is a data-prefix of the real one', async () => {
    await fc.assert(
      fc.asyncProperty(docArb, fc.nat(8192), fc.boolean(), async (frames, cutSeed, crlf) => {
        const doc = serialize(frames, { crlf });
        const bytes = new TextEncoder().encode(doc);
        const full = expectedFrames(frames);
        const cut = cutSeed % (bytes.length + 1);
        const partial = await parseAll([bytes.subarray(0, cut)]); // must not throw
        expect(partial.length).toBeLessThanOrEqual(full.length);
        for (let i = 0; i < partial.length - 1; i++) {
          expect(partial[i]).toEqual(full[i]);
        }
        if (partial.length > 0) {
          const k = partial.length - 1;
          const got = partial[k]!;
          const want = full[k]!;
          expect(got.event).toEqual(want.event);
          expect(want.data === got.data || want.data.startsWith(got.data + '\n')).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
