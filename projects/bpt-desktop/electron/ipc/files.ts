import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { PDFParse } from 'pdf-parse'

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

const MAX_PDF_PAGES = 50

async function extractPdfText(buffer: Buffer, name: string): Promise<string> {
  const pdf = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const textResult = await pdf.getText()
    const totalPages = textResult.total
    let text = textResult.text?.trim() || ''

    if (!text) {
      return `[PDF: ${name} — ${totalPages} 页，无可提取的文本内容（可能是扫描件或纯图片 PDF）]`
    }

    // For very large PDFs, only include first MAX_PDF_PAGES pages
    if (totalPages > MAX_PDF_PAGES) {
      const pageTexts = textResult.pages
        .filter((p) => p.num <= MAX_PDF_PAGES)
        .map((p) => p.text)
      text = pageTexts.join('\n\n')
      text += `\n\n[... 已截断：仅显示前 ${MAX_PDF_PAGES} 页内容，共 ${totalPages} 页 ...]`
    }

    return '```pdf\n' + text + '\n```'
  } finally {
    await pdf.destroy().catch(() => {})
  }
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
      try {
        const buffer = fs.readFileSync(filePath)
        const content = await extractPdfText(buffer, name)
        return { name, content, mimeType }
      } catch (err: any) {
        const content = `[PDF 解析失败: ${name} — ${err.message || '未知错误'}]`
        return { name, content, mimeType }
      }
    }

    // Fallback: try reading as text
    const content = fs.readFileSync(filePath, 'utf-8')
    return { name, content, mimeType: 'text/plain' }
  })

  // Parse PDF from raw bytes (used by renderer when file comes from drag-and-drop / file picker)
  ipcMain.handle('file:parse-pdf', async (_event, base64Data: string, fileName: string) => {
    try {
      const buffer = Buffer.from(base64Data, 'base64')
      const content = await extractPdfText(buffer, fileName)
      return { ok: true, content }
    } catch (err: any) {
      const message = err.message || '未知错误'
      // Detect common PDF errors
      if (message.includes('password') || message.includes('encrypted')) {
        return { ok: false, error: `PDF 受密码保护，无法解析: ${fileName}` }
      }
      return { ok: false, error: `PDF 解析失败: ${fileName} — ${message}` }
    }
  })
}
