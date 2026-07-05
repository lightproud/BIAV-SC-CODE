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
 * http429 and sse-truncated script kinds.
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
 *   { kind: 'sse-truncated', events }  - stream cut before message_stop
 *   { kind: 'http429' }                - 429 + retry-after: 1
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
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'emulated rate limit' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const body = sse(script.events);
      if (script.kind === 'sse-truncated') {
        const cut = body.lastIndexOf('event: message_stop');
        res.write(body.slice(0, cut === -1 ? body.length : cut));
        setTimeout(() => res.destroy(), 100);
      } else {
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
        close: () => new Promise((r) => server.close(r)),
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
