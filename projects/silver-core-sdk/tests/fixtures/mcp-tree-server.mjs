#!/usr/bin/env node
/**
 * Test fixture: an MCP stdio server that, on startup, spawns a long-lived
 * GRANDCHILD process (a plain `node` that sleeps forever) — modelling the real
 * shape where an MCP server is launched through a wrapper (`npx`/`cmd`/`uvx`)
 * and the actual server lives one level deeper. It reports the grandchild pid
 * via `initialize` serverInfo.version so the test can assert the whole tree is
 * reaped by StdioMcpConnection.close(), not just the direct wrapper.
 *
 * A bare `child.kill()` on this fixture would leave the grandchild orphaned
 * and alive; a process-group / taskkill-tree termination reaps it too.
 */

import process from 'node:process';
import { spawn } from 'node:child_process';

// Long-lived grandchild: an idle timer keeps it alive until its tree is
// signalled. stdio ignored so it inherits none of the fixture's MCP pipes.
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
  stdio: 'ignore',
});
const grandchildPid = grandchild.pid;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications get no reply

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion:
          typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: {},
        // Carry the grandchild pid out where the test can read it.
        serverInfo: { name: 'tree-fixture', version: String(grandchildPid) },
      },
    });
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
