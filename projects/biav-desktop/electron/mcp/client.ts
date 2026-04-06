import { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: { code: number; message: string; data?: any }
}

export interface MCPToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export class MCPClient extends EventEmitter {
  private process: ChildProcess
  private nextId = 1
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private buffer = ''
  private serverCapabilities: Record<string, unknown> = {}

  constructor(childProcess: ChildProcess) {
    super()
    this.process = childProcess
    this.setupStdio()
  }

  private setupStdio() {
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.processBuffer()
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString())
    })

    this.process.on('exit', (code) => {
      this.emit('exit', code)
      // Reject all pending requests
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`Process exited with code ${code}`))
      }
      this.pending.clear()
    })
  }

  private processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg: JSONRPCResponse = JSON.parse(trimmed)
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if (msg.error) {
            p.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`))
          } else {
            p.resolve(msg.result)
          }
        }
      } catch {
        // Ignore non-JSON lines (e.g. debug output)
      }
    }
  }

  private send(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      }
      this.pending.set(id, { resolve, reject })

      const data = JSON.stringify(request) + '\n'
      const ok = this.process.stdin?.write(data)
      if (ok === false) {
        this.pending.delete(id)
        reject(new Error('Failed to write to stdin'))
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Request timed out: ${method}`))
        }
      }, 30_000)
    })
  }

  async initialize(): Promise<Record<string, unknown>> {
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'biav-desktop', version: '1.0.0' },
    })
    this.serverCapabilities = result?.capabilities || {}

    // Send initialized notification (no id, no response expected)
    const notification = JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n'
    this.process.stdin?.write(notification)

    return result
  }

  async listTools(): Promise<MCPToolDefinition[]> {
    const result = await this.send('tools/list', {})
    return result?.tools || []
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await this.send('tools/call', { name, arguments: args })
    return result
  }

  getCapabilities(): Record<string, unknown> {
    return this.serverCapabilities
  }

  destroy() {
    this.process.stdin?.end()
    this.process.kill()
    this.pending.clear()
  }
}
