/**
 * mcp-client.ts — MCP stdio client for Silver Core.
 *
 * Why MCP over direct script calls: scripts/mcp_server.py already exposes
 * 9 tools via FastMCP. One long-lived subprocess is cheaper than spawning
 * a Python process per tool call. The MCP JSON-RPC protocol is standard.
 *
 * Why only 4 tools via MCP: Token economy discipline (plan §3 T4).
 * memory_search / graph_query / graph_related_files / store_facts are the
 * only tools where LLM agency adds value. The other 5 are direct-only
 * (see direct-client.ts).
 */

import { spawn, ChildProcess } from 'node:child_process';
import { BPT_VERSION } from '../../src/version';
import { logger } from '../core/logger';

/** MCP JSON-RPC message structure. */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type PendingResolve = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

export class McpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingResolve>();
  private buffer = '';
  private connected = false;
  private tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

  constructor(
    private pythonPath: string,
    private serverScriptPath: string,
    private cwd: string,
  ) {}

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.pythonPath, [this.serverScriptPath], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          logger.warn('mcp-client', `MCP stderr: ${text}`);
        }
      });

      this.process.on('error', (err: Error) => {
        logger.error('mcp-client', 'MCP process error', { error: err.message });
        this.connected = false;
        reject(err);
      });

      this.process.on('exit', (code: number | null) => {
        logger.info('mcp-client', `MCP process exited with code ${code}`);
        this.connected = false;
        // Reject all pending requests — callers shouldn't hang forever
        for (const [id, { reject }] of this.pending) {
          reject(new Error(`MCP process exited (code ${code}) with request ${id} pending`));
        }
        this.pending.clear();
      });

      // Initialize the MCP session
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'bpt', version: BPT_VERSION },
      })
        .then(() => {
          this.connected = true;
          // Send initialized notification
          this.sendNotification('notifications/initialized', {});
          return this.listTools();
        })
        .then((tools) => {
          this.tools = tools;
          logger.info('mcp-client', `MCP connected, ${tools.length} tools available`, {
            tools: tools.map((t) => t.name),
          });
          resolve();
        })
        .catch(reject);
    });
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;

    // MCP uses Content-Length header framing for stdio transport
    while (this.buffer.length > 0) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        // Not a valid MCP message, try parsing as raw JSON (some servers skip headers)
        const newlineIdx = this.buffer.indexOf('\n');
        if (newlineIdx === -1) break;
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (line) this.tryParseResponse(line);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);
      this.tryParseResponse(body);
    }
  }

  private tryParseResponse(text: string): void {
    try {
      const msg = JSON.parse(text) as JsonRpcResponse;
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
      }
    } catch {
      // Not valid JSON — ignore (could be debug output from Python)
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error('MCP process not running'));
        return;
      }

      const id = this.nextId++;
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const body = JSON.stringify(msg);
      const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(frame);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    const msg = { jsonrpc: '2.0', method, params };
    const body = JSON.stringify(msg);
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    this.process.stdin.write(frame);
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
    const result = (await this.sendRequest('tools/list', {})) as {
      tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
    };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  getTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.tools;
  }

  isConnected(): boolean {
    return this.connected;
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.connected = false;
    }
  }
}
