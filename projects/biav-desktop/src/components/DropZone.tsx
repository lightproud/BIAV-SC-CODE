import { useState, useCallback, type DragEvent, type ReactNode } from 'react'
import type { Attachment } from '../types'

const ACCEPTED_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.py', '.js', '.ts', '.tsx', '.css', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.pdf',
])

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif'])

function getExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

async function readFileAsAttachment(file: File): Promise<Attachment | null> {
  const ext = getExtension(file.name)
  if (!ACCEPTED_EXTENSIONS.has(ext)) return null

  if (ext === '.pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      )
      const result = await window.biav.parsePdf(base64, file.name)
      if (result.ok && result.content) {
        return {
          name: file.name,
          path: '',
          type: file.type || 'application/pdf',
          content: result.content,
        }
      }
      // Parsing failed — show error as content
      return {
        name: file.name,
        path: '',
        type: file.type || 'application/pdf',
        content: result.error || `[PDF 解析失败: ${file.name}]`,
      }
    } catch {
      return {
        name: file.name,
        path: '',
        type: file.type || 'application/pdf',
        content: `[PDF 解析失败: ${file.name}]`,
      }
    }
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    const content = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    return { name: file.name, path: '', type: file.type, content }
  }

  // Text files
  const content = await file.text()
  return { name: file.name, path: '', type: file.type || 'text/plain', content }
}

interface Props {
  children: ReactNode
  onFilesDropped: (attachments: Attachment[]) => void
}

export default function DropZone({ children, onFilesDropped }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useState({ current: 0 })[0]

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (dragCounter.current === 1) setIsDragging(true)
  }, [dragCounter])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }, [dragCounter])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const results = await Promise.all(files.map(readFileAsAttachment))
    const valid = results.filter((a): a is Attachment => a !== null)
    if (valid.length > 0) onFilesDropped(valid)
  }, [dragCounter, onFilesDropped])

  return (
    <div
      className="relative flex-1 flex flex-col min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-biav-bg/80 border-2 border-dashed border-biav-gold/50 rounded-lg pointer-events-none">
          <div className="text-biav-gold text-lg font-medium">
            拖放文件到此处
          </div>
        </div>
      )}
    </div>
  )
}

export { readFileAsAttachment, ACCEPTED_EXTENSIONS }
