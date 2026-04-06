import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { MCPClient, MCPToolDefinition } from './client'

export type MCPServerStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface MCPServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

interface ServerEntry {
  config: MCPServerConfig
  process: ChildProcess | null
  client: MCPClient | null
  status: MCPServerStatus
  error?: string
  tools: MCPToolDefinition[]
}

export class MCPManager {
  private servers = new Map<string, ServerEntry>()
  private configPath: string

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'mcp_config.json')
  }

  loadConfig(): MCPConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8')
        const config = JSON.parse(raw) as MCPConfig
        return config
      }
    } catch (err) {
      console.error('[MCP] Failed to load config:', err)
    }
    return { mcpServers: {} }
  }

  saveConfig(config: MCPConfig): void {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  async startServer(name: string): Promise<void> {
    const config = this.loadConfig()
    const serverConfig = config.mcpServers[name]
    if (!serverConfig) {
      throw new Error(`MCP server "${name}" not found in config`)
    }

    // Stop existing instance if running
    if (this.servers.has(name)) {
      await this.stopServer(name)
    }

    const entry: ServerEntry = {
      config: serverConfig,
      process: null,
      client: null,
      status: 'starting',
      tools: [],
    }
    this.servers.set(name, entry)

    try {
      const env = { ...process.env, ...(serverConfig.env || {}) }
      const child = spawn(serverConfig.command, serverConfig.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        shell: process.platform === 'win32',
      })

      entry.process = child

      child.on('error', (err) => {
        console.error(`[MCP] Server "${name}" process error:`, err)
        entry.status = 'error'
        entry.error = err.message
      })

      child.on('exit', (code) => {
        console.log(`[MCP] Server "${name}" exited with code ${code}`)
        if (entry.status !== 'stopped') {
          entry.status = code === 0 ? 'stopped' : 'error'
          entry.error = code !== 0 ? `Exited with code ${code}` : undefined
        }
        entry.client = null
        entry.process = null
      })

      const client = new MCPClient(child)
      entry.client = client

      client.on('stderr', (data: string) => {
        console.warn(`[MCP] Server "${name}" stderr:`, data)
      })

      // Initialize the MCP handshake
      await client.initialize()
      entry.status = 'running'

      // Fetch available tools
      try {
        entry.tools = await client.listTools()
      } catch {
        entry.tools = []
      }

      console.log(`[MCP] Server "${name}" started with ${entry.tools.length} tools`)
    } catch (err: any) {
      entry.status = 'error'
      entry.error = err.message
      // Clean up process if it was spawned
      if (entry.process) {
        entry.process.kill()
        entry.process = null
      }
      entry.client = null
      throw err
    }
  }

  async stopServer(name: string): Promise<void> {
    const entry = this.servers.get(name)
    if (!entry) return

    entry.status = 'stopped'
    if (entry.client) {
      entry.client.destroy()
      entry.client = null
    }
    if (entry.process) {
      entry.process.kill()
      entry.process = null
    }
    entry.tools = []
  }

  listServers(): { name: string; status: MCPServerStatus; error?: string; toolCount: number }[] {
    const config = this.loadConfig()
    const result: { name: string; status: MCPServerStatus; error?: string; toolCount: number }[] = []

    for (const name of Object.keys(config.mcpServers)) {
      const entry = this.servers.get(name)
      result.push({
        name,
        status: entry?.status || 'stopped',
        error: entry?.error,
        toolCount: entry?.tools.length || 0,
      })
    }
    return result
  }

  getServerStatus(name: string): { status: MCPServerStatus; error?: string; tools: MCPToolDefinition[] } {
    const entry = this.servers.get(name)
    return {
      status: entry?.status || 'stopped',
      error: entry?.error,
      tools: entry?.tools || [],
    }
  }

  async listTools(name: string): Promise<MCPToolDefinition[]> {
    const entry = this.servers.get(name)
    if (!entry || !entry.client || entry.status !== 'running') {
      return []
    }
    return entry.tools
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown> = {}): Promise<any> {
    const entry = this.servers.get(serverName)
    if (!entry || !entry.client || entry.status !== 'running') {
      throw new Error(`MCP server "${serverName}" is not running`)
    }
    return entry.client.callTool(toolName, args)
  }

  async stopAll(): Promise<void> {
    const names = [...this.servers.keys()]
    await Promise.all(names.map((n) => this.stopServer(n)))
  }
}
