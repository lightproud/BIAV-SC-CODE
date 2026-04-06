import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.py', '.js', '.ts', '.csv',
  '.jsx', '.tsx', '.html', '.css', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.sh', '.bash', '.zsh',
])

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
  }
  return map[ext] || 'application/octet-stream'
}

export function registerFileHandlers() {
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const ext = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const mimeType = getMimeType(ext)

    if (TEXT_EXTENSIONS.has(ext)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { name, content, mimeType }
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      const buffer = fs.readFileSync(filePath)
      const base64 = buffer.toString('base64')
      const content = `data:${mimeType};base64,${base64}`
      return { name, content, mimeType }
    }

    if (ext === '.pdf') {
      const stats = fs.statSync(filePath)
      const content = `[PDF: ${name}, ${stats.size} bytes]`
      return { name, content, mimeType }
    }

    // Fallback: try reading as text
    const content = fs.readFileSync(filePath, 'utf-8')
    return { name, content, mimeType: 'text/plain' }
  })
}
