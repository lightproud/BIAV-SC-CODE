/**
 * Content-blind Messages-API emulator - the heart of the conformance suite.
 *
 * Both engines (this SDK and the official @anthropic-ai/claude-agent-sdk,
 * whose spawned claude-code CLI honors ANTHROPIC_BASE_URL - proven by the
 * 2026-07-05 spike, see Public-Info-Pool/Resource/repo-engineering/
 * bpt-sdk-official-arm-protocol-profile-20260705.md) are pointed at this
 * local server. The model side becomes a deterministic shared script, so any
 * difference in the emitted SDKMessage stream is a real engine difference.
 *
 * CLEAN-ROOM / CONTENT-BLIND DISCIPLINE (standing decision, memory/
 * decisions.md 2026-07-05 "净室观测边界"): the official arm's request bodies
 * carry the proprietary system prompt. This server NEVER reads request
 * bodies - `req.resume()` drains them unbuffered - routes purely by
 * (method, path, arrival order), logs header NAMES only, and whitelists just
 * four protocol-metadata header values. `assertContentBlind()` is the
 * mandatory self-audit every consumer must run over its own outputs.
 *
 * Protocol surface implemented per the spike profile: POST /v1/messages
 * (SSE) only; every other path gets a tolerated 404. Fault injection:
 * http429 (param retryAfter), sse-truncated (param cutMarker), http500,
 * http400 and sse-hang script kinds (L4 differential; every fault branch
 * sits after req.resume() - the content-blind boundary is unchanged).
 */

import { createServer } from 'node:http';

const HEADER_VALUE_WHITELIST = new Set([
  'anthropic-version',
  'anthropic-beta',
  'content-type',
  'accept',
]);

/** Serialize scripted stream events as SSE wire frames. */
function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** Standard event sequence for a scripted plain-text assistant reply. */
export function textReply(text, { stopReason = 'end_turn', id = 'msg_conf_text' } = {}) {
  return [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-conformance-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

/**
 * Scripted assistant turn issuing one or more tool_use blocks.
 * calls: Array<{ name, input }> - input is OUR scripted content (safe).
 */
export function toolUseReply(calls, { id = 'msg_conf_tool' } = {}) {
  const events = [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-conformance-1', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
  ];
  calls.forEach((call, i) => {
    events.push(
      { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `toolu_conf_${i + 1}`, name: call.name, input: {} } },
      { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } },
      { type: 'content_block_stop', index: i },
    );
  });
  events.push(
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  );
  return events;
}

/**
 * Start the emulator with a per-run script queue.
 *
 * scripts: consumed one per POST /v1/messages, each one of
 *   { kind: 'sse', events }            - full SSE reply
 *   { kind: 'sse-truncated', events, cutMarker? } - stream cut before the
 *     cutMarker frame (default 'event: message_stop' - byte-identical for
 *     pre-L4 callers); e.g. 'event: message_delta' cuts a tool turn before
 *     stop_reason delivery ("incomplete message" vs "missing terminator")
 *   { kind: 'http429', retryAfter? }   - 429 + retry-after (default '1')
 *   { kind: 'http500' }                - 500 api_error + retry-after: 1
 *     (pinned to 1s so BOTH arms' backoff stays CI-fast on the recover case)
 *   { kind: 'http400' }                - 400 invalid_request_error; scripted
 *     counterpart of the queue-exhaustion fallback so a non-retryable-fault
 *     case does not consume the unscriptedCalls sentinel L4 asserts on
 *   { kind: 'sse-hang', events, hangAfter? } - 200 + SSE frames through the
 *     hangAfter event type (default 'message_start'), then the connection is
 *     held open forever: no end(), no further writes. close() destroys the
 *     registered hung sockets so shutdown cannot deadlock.
 *
 * Returns { url, port, profile, close }.
 */
export function startEmulator(scripts) {
  const profile = {
    requests: [], // "METHOD /path" in arrival order - never content
    otherEndpoints: {},
    headerNames: new Set(),
    protocolMeta: {},
    unscriptedCalls: 0,
  };
  let messagesCalls = 0;
  // sse-hang responses deliberately held open; close() destroys them FIRST
  // so server.close() cannot deadlock waiting on a hung stream.
  const hungResponses = new Set();

  const server = createServer((req, res) => {
    req.resume(); // content-blind: drain the body without buffering a byte
    for (const name of Object.keys(req.headers)) {
      profile.headerNames.add(name);
      if (HEADER_VALUE_WHITELIST.has(name)) profile.protocolMeta[name] = req.headers[name];
    }
    const path = (req.url ?? '/').split('?')[0];
    profile.requests.push(`${req.method} ${path}`);

    if (req.method === 'POST' && path === '/v1/messages') {
      const script = scripts[messagesCalls++];
      if (!script) {
        profile.unscriptedCalls += 1;
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'conformance emulator: script queue exhausted' } }));
        return;
      }
      if (script.kind === 'http429') {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': script.retryAfter ?? '1' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'emulated rate limit' } }));
        return;
      }
      if (script.kind === 'http500') {
        // retry-after: 1 deliberately bounds BOTH arms' exponential backoff
        // so the 5xx-recover differential stays CI-fast.
        res.writeHead(500, { 'content-type': 'application/json', 'retry-after': '1' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'emulated internal error' } }));
        return;
      }
      if (script.kind === 'http400') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'emulated invalid request' } }));
        return;
      }
      if (script.kind === 'sse-hang') {
        // Frames through the hangAfter event type, then silence forever -
        // the client sees a live but stalled stream. The response is
        // registered for forced destruction at close() time.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const upTo = script.events.findIndex((e) => e.type === (script.hangAfter ?? 'message_start'));
        res.write(sse(script.events.slice(0, upTo === -1 ? script.events.length : upTo + 1)));
        hungResponses.add(res);
        res.on('close', () => hungResponses.delete(res));
        return;
      }
      const body = sse(script.events);
      if (script.kind === 'sse-truncated') {
        const cut = body.lastIndexOf(script.cutMarker ?? 'event: message_stop');
        if (cut === -1) {
          // Review major (2026-07-05): a mistyped or upstream-renamed
          // cutMarker must never silently convert the fault into a healthy
          // complete reply - fail LOUD so the scenario dies visibly.
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `emulator: sse-truncated cutMarker not found: ${script.cutMarker ?? 'event: message_stop'}` } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write(body.slice(0, cut));
        setTimeout(() => res.destroy(), 100);
      } else {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.end(body);
      }
      return;
    }

    // Any other endpoint: profile it and 404 (tolerated per the spike).
    profile.otherEndpoints[`${req.method} ${path}`] =
      (profile.otherEndpoints[`${req.method} ${path}`] ?? 0) + 1;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'conformance emulator: unknown endpoint' } }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        profile,
        close: () =>
          new Promise((r) => {
            // Destroy deliberately-hung streams (sse-hang) before close():
            // server.close() waits on active responses and would deadlock.
            for (const hung of hungResponses) hung.destroy();
            hungResponses.clear();
            server.close(r);
          }),
      });
    });
  });
}

/**
 * Mandatory self-audit (standing-decision clause 2): assert a serialized
 * output artifact contains no request-body-derived content. We never read
 * bodies, so the strongest structural markers of a leak are the system/
 * messages fields of a Messages API request. Throws on failure.
 */
export function assertContentBlind(artifactJsonString) {
  const markers = ['"system":', '"messages":', 'You are Claude'];
  const hits = markers.filter((m) => artifactJsonString.includes(m));
  if (hits.length > 0) {
    throw new Error(`content-blind self-audit FAILED: found ${hits.join(', ')} in output artifact`);
  }
  return true;
}
