/**
 * Built-in tools — gives the AI hands and feet.
 *
 * These tools are always available, independent of MCP server status.
 * They provide: shell execution, file read/write, directory listing, and glob search.
 *
 * Security: all tools require user approval before execution (same as MCP tools).
 */

import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { glob } from 'fast-glob'
import type { AnthropicTool } from '../llm'

// Working directory for commands (can be changed per-session)
let workingDirectory = process.cwd()

export function setWorkingDirectory(dir: string) {
  workingDirectory = dir
}

export function getWorkingDirectory(): string {
  return workingDirectory
}

/**
 * Tool definitions in Anthropic format, sent to the LLM.
 */
export const BUILTIN_TOOLS: AnthropicTool[] = [
  {
    name: 'shell',
    description: 'Execute a shell command and return its output. Use this to run scripts, install packages, check system state, or perform any terminal operation. Commands run in the working directory.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000, max: 300000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Supports text files and returns content as string. Use absolute paths or paths relative to the working directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to read',
        },
        offset: {
          type: 'number',
          description: 'Start reading from this line number (0-based)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does. Creates parent directories as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file. The old_string must match exactly (including whitespace). Use this for surgical edits instead of rewriting the entire file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a given path. Returns names with type indicators (/ for directories).',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: working directory)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files matching a glob pattern. Returns matching file paths relative to working directory.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")',
        },
        cwd: {
          type: 'string',
          description: 'Base directory for search (default: working directory)',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_content',
    description: 'Search file contents for a regex pattern. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'File or directory to search in (default: working directory)',
        },
        glob: {
          type: 'string',
          description: 'File glob filter (e.g. "*.ts")',
        },
      },
      required: ['pattern'],
    },
  },
]

export const BUILTIN_TOOL_NAMES = new Set(BUILTIN_TOOLS.map(t => t.name))

/**
 * Execute a built-in tool. Returns the result as a string.
 */
export async function executeBuiltinTool(
  name: string,
  input: Record<string, any>
): Promise<string> {
  switch (name) {
    case 'shell':
      return executeShell(input.command, input.timeout)
    case 'read_file':
      return readFile(input.path, input.offset, input.limit)
    case 'write_file':
      return writeFile(input.path, input.content)
    case 'edit_file':
      return editFile(input.path, input.old_string, input.new_string)
    case 'list_directory':
      return listDirectory(input.path)
    case 'search_files':
      return searchFiles(input.pattern, input.cwd)
    case 'search_content':
      return searchContent(input.pattern, input.path, input.glob)
    default:
      throw new Error(`Unknown built-in tool: ${name}`)
  }
}

// ============================================================
// Tool implementations
// ============================================================

function resolvePath(p: string): string {
  if (path.isAbsolute(p)) return p
  return path.resolve(workingDirectory, p)
}

function executeShell(command: string, timeout?: number): Promise<string> {
  const timeoutMs = Math.min(timeout || 30000, 300000)

  return new Promise((resolve) => {
    exec(command, {
      cwd: workingDirectory,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 10, // 10MB
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    }, (error, stdout, stderr) => {
      let result = ''
      if (stdout) result += stdout
      if (stderr) result += (result ? '\n--- stderr ---\n' : '') + stderr
      if (error && !result) result = `Error: ${error.message}`
      if (!result) result = '(no output)'
      resolve(result.slice(0, 100000)) // Cap at 100KB
    })
  })
}

function readFile(filePath: string, offset?: number, limit?: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      const resolved = resolvePath(filePath)
      if (!fs.existsSync(resolved)) {
        resolve(`Error: File not found: ${filePath}`)
        return
      }

      const stat = fs.statSync(resolved)
      if (stat.isDirectory()) {
        resolve(`Error: ${filePath} is a directory, not a file`)
        return
      }

      const content = fs.readFileSync(resolved, 'utf-8')

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n')
        const start = offset || 0
        const end = limit ? start + limit : lines.length
        const sliced = lines.slice(start, end)
        const numbered = sliced.map((line, i) => `${start + i + 1}\t${line}`)
        resolve(numbered.join('\n'))
      } else if (content.split('\n').length > 2000) {
        // Large files: show first 2000 lines with line numbers
        const lines = content.split('\n').slice(0, 2000)
        const numbered = lines.map((line, i) => `${i + 1}\t${line}`)
        resolve(numbered.join('\n') + `\n\n[... truncated at 2000 lines, total ${content.split('\n').length} lines]`)
      } else {
        resolve(content)
      }
    } catch (err: any) {
      resolve(`Error reading file: ${err.message}`)
    }
  })
}

function writeFile(filePath: string, content: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const resolved = resolvePath(filePath)
      // Create parent directories
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, content, 'utf-8')
      resolve(`Written ${content.length} bytes to ${filePath}`)
    } catch (err: any) {
      resolve(`Error writing file: ${err.message}`)
    }
  })
}

function editFile(filePath: string, oldString: string, newString: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const resolved = resolvePath(filePath)
      if (!fs.existsSync(resolved)) {
        resolve(`Error: File not found: ${filePath}`)
        return
      }
      const content = fs.readFileSync(resolved, 'utf-8')
      const count = content.split(oldString).length - 1
      if (count === 0) {
        resolve(`Error: old_string not found in ${filePath}`)
        return
      }
      if (count > 1) {
        resolve(`Error: old_string found ${count} times in ${filePath}, must be unique. Provide more context.`)
        return
      }
      const newContent = content.replace(oldString, newString)
      fs.writeFileSync(resolved, newContent, 'utf-8')
      resolve(`Edited ${filePath} (1 replacement)`)
    } catch (err: any) {
      resolve(`Error editing file: ${err.message}`)
    }
  })
}

function listDirectory(dirPath?: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const resolved = resolvePath(dirPath || '.')
      if (!fs.existsSync(resolved)) {
        resolve(`Error: Directory not found: ${dirPath}`)
        return
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
      const lines = entries
        .sort((a, b) => {
          // Directories first, then files
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })
        .map(e => e.isDirectory() ? e.name + '/' : e.name)
      resolve(lines.join('\n') || '(empty directory)')
    } catch (err: any) {
      resolve(`Error listing directory: ${err.message}`)
    }
  })
}

async function searchFiles(pattern: string, cwd?: string): Promise<string> {
  try {
    const basePath = cwd ? resolvePath(cwd) : workingDirectory
    const results = await glob(pattern, {
      cwd: basePath,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      onlyFiles: true,
    })
    if (results.length === 0) {
      return `No files matching "${pattern}"`
    }
    return results.slice(0, 200).join('\n') +
      (results.length > 200 ? `\n\n[... ${results.length - 200} more files]` : '')
  } catch (err: any) {
    return `Error searching files: ${err.message}`
  }
}

async function searchContent(
  pattern: string,
  searchPath?: string,
  fileGlob?: string,
): Promise<string> {
  // Use grep/ripgrep if available, fallback to manual search
  const resolved = resolvePath(searchPath || '.')
  const rgArgs = ['rg', '--line-number', '--max-count', '50']
  if (fileGlob) rgArgs.push('--glob', fileGlob)
  rgArgs.push(pattern, resolved)

  return new Promise((resolve) => {
    exec(rgArgs.join(' '), {
      cwd: workingDirectory,
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 5,
    }, (error, stdout, stderr) => {
      if (stdout) {
        const lines = stdout.split('\n').filter(Boolean).slice(0, 100)
        resolve(lines.join('\n'))
      } else if (error?.code === 1) {
        // rg returns exit code 1 when no matches
        resolve(`No matches for pattern "${pattern}"`)
      } else if (error) {
        // rg not available, try grep
        const grepArgs = ['grep', '-rn', '--max-count=50']
        if (fileGlob) grepArgs.push(`--include=${fileGlob}`)
        grepArgs.push(pattern, resolved)

        exec(grepArgs.join(' '), {
          cwd: workingDirectory,
          timeout: 15000,
          maxBuffer: 1024 * 1024 * 5,
        }, (_err2, stdout2) => {
          if (stdout2) {
            resolve(stdout2.split('\n').filter(Boolean).slice(0, 100).join('\n'))
          } else {
            resolve(`No matches for pattern "${pattern}"`)
          }
        })
      } else {
        resolve(`No matches for pattern "${pattern}"`)
      }
    })
  })
}
