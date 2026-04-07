/**
 * Hook Engine — automatic actions on session events.
 *
 * Reads hook configuration from app data (hooks.json) and executes
 * shell commands when specific events fire.
 *
 * Events:
 *   - SessionStart: fires when a new conversation begins
 *   - SessionEnd: fires when a conversation is closed or app quits
 *   - PreToolUse: fires before a tool is executed (can inject context)
 *   - PostToolUse: fires after a tool completes
 *
 * Config format (hooks.json):
 * {
 *   "SessionStart": [{ "command": "python scripts/boot_snapshot.py" }],
 *   "SessionEnd": [{ "command": "python scripts/memory_writeback.py" }]
 * }
 */

import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export type HookEvent = 'SessionStart' | 'SessionEnd' | 'PreToolUse' | 'PostToolUse'

interface HookAction {
  command: string
  timeout?: number  // ms, default 30000
}

type HookConfig = Partial<Record<HookEvent, HookAction[]>>

let hookConfig: HookConfig = {}
let projectDir: string = process.cwd()

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'hooks.json')
}

/**
 * Load hook configuration from disk.
 */
export function loadHooks(projectDirectory?: string): void {
  if (projectDirectory) {
    projectDir = projectDirectory
  }

  // Check project-level hooks first, then app-level
  const projectHooksPath = path.join(projectDir, '.biav', 'hooks.json')
  const appHooksPath = getConfigPath()

  const configPath = fs.existsSync(projectHooksPath) ? projectHooksPath : appHooksPath

  if (fs.existsSync(configPath)) {
    try {
      hookConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch {
      hookConfig = {}
    }
  }
}

/**
 * Save hook configuration to disk.
 */
export function saveHooks(config: HookConfig): void {
  hookConfig = config
  const configPath = getConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Get current hook configuration.
 */
export function getHooks(): HookConfig {
  return hookConfig
}

/**
 * Fire a hook event. Executes all configured commands for the event.
 * Returns combined output from all commands.
 */
export async function fireHook(
  event: HookEvent,
  context?: Record<string, string>,
): Promise<string> {
  const actions = hookConfig[event]
  if (!actions || actions.length === 0) return ''

  const outputs: string[] = []

  for (const action of actions) {
    try {
      const output = await runHookCommand(action.command, action.timeout, context)
      if (output.trim()) {
        outputs.push(output.trim())
      }
    } catch (err: any) {
      outputs.push(`[Hook error: ${err.message}]`)
    }
  }

  return outputs.join('\n---\n')
}

function runHookCommand(
  command: string,
  timeout?: number,
  context?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...context }

    exec(command, {
      cwd: projectDir,
      timeout: timeout || 30000,
      maxBuffer: 1024 * 1024,
      env,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    }, (error, stdout, stderr) => {
      if (error && !stdout && !stderr) {
        reject(error)
      } else {
        resolve(stdout || stderr || '')
      }
    })
  })
}
