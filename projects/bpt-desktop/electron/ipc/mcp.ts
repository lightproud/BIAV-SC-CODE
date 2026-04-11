import { ipcMain } from 'electron'
import { MCPManager } from '../mcp/manager'

let manager: MCPManager

export function registerMCPHandlers(mcpManager: MCPManager) {
  manager = mcpManager

  ipcMain.handle('mcp:list-servers', () => {
    return manager.listServers()
  })

  ipcMain.handle('mcp:start', async (_e, name: string) => {
    try {
      await manager.startServer(name)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:stop', async (_e, name: string) => {
    await manager.stopServer(name)
    return { ok: true }
  })

  ipcMain.handle('mcp:list-tools', async (_e, serverName: string) => {
    return manager.listTools(serverName)
  })

  ipcMain.handle('mcp:call-tool', async (_e, serverName: string, toolName: string, args: Record<string, unknown>) => {
    try {
      const result = await manager.callTool(serverName, toolName, args)
      return { ok: true, result }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('mcp:get-config', () => {
    return manager.loadConfig()
  })

  ipcMain.handle('mcp:save-config', (_e, config: any) => {
    manager.saveConfig(config)
    return { ok: true }
  })
}
