// Emulator server half of replay-exit-repro (runs as a separate process so
// no in-process server handle can mask the event-loop drain under test).
import http from 'node:http';

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

let calls = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    calls += 1;
    let model = 'emu';
    try {
      model = JSON.parse(body).model ?? 'emu';
    } catch {
      /* keep default */
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: `msg_${calls}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 0 },
      },
    });
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'REPLAYED-OK' },
    });
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 5 },
    });
    sse(res, 'message_stop', { type: 'message_stop' });
    res.end();
  });
});

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT=${server.address().port}`);
});
