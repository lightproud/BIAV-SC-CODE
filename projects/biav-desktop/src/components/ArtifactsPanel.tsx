import { useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import type { Artifact } from '../types'

interface Props {
  artifacts: Artifact[]
  onClose: () => void
}

const TYPE_LABELS: Record<Artifact['type'], string> = {
  code: '代码',
  html: 'HTML',
  svg: 'SVG',
  markdown: 'Markdown',
}

const TYPE_COLORS: Record<Artifact['type'], string> = {
  code: 'bg-biav-gold/20 text-biav-gold',
  html: 'bg-blue-500/20 text-blue-400',
  svg: 'bg-green-500/20 text-green-400',
  markdown: 'bg-purple-500/20 text-purple-400',
}

function CodePreview({ artifact }: { artifact: Artifact }) {
  const [copied, setCopied] = useState(false)

  const highlighted = useMemo(() => {
    if (artifact.language) {
      try {
        return hljs.highlight(artifact.content, { language: artifact.language, ignoreIllegals: true }).value
      } catch {
        // fall through
      }
    }
    return hljs.highlightAuto(artifact.content).value
  }, [artifact.content, artifact.language])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [artifact.content])

  const handleDownload = useCallback(() => {
    const ext = artifact.language || 'txt'
    const blob = new Blob([artifact.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${artifact.title.replace(/[^a-zA-Z0-9_.-]/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }, [artifact])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-biav-border">
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 text-xs rounded bg-biav-border text-biav-muted hover:text-biav-gold transition-colors"
        >
          {copied ? '已复制 ✓' : '复制'}
        </button>
        <button
          onClick={handleDownload}
          className="px-2 py-0.5 text-xs rounded bg-biav-border text-biav-muted hover:text-biav-gold transition-colors"
        >
          下载
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="hljs text-sm">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>
    </div>
  )
}

function HtmlPreview({ content }: { content: string }) {
  const srcDoc = useMemo(() => {
    // Wrap in minimal HTML if not already a full doc
    if (content.trimStart().startsWith('<!') || content.trimStart().startsWith('<html')) {
      return content
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#1a1b26;color:#d4c9a8;font-family:sans-serif;}</style></head><body>${content}</body></html>`
  }, [content])

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="w-full h-full border-0 bg-white rounded"
      title="HTML Preview"
    />
  )
}

function SvgPreview({ content }: { content: string }) {
  const srcDoc = useMemo(() => {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1b26;}</style></head><body>${content}</body></html>`
  }, [content])

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox=""
      className="w-full h-full border-0 rounded"
      title="SVG Preview"
    />
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="p-4 overflow-auto h-full text-sm leading-relaxed markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function ArtifactRenderer({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'code':
      return <CodePreview artifact={artifact} />
    case 'html':
      return <HtmlPreview content={artifact.content} />
    case 'svg':
      return <SvgPreview content={artifact.content} />
    case 'markdown':
      return <MarkdownPreview content={artifact.content} />
    default:
      return <CodePreview artifact={artifact} />
  }
}

export default function ArtifactsPanel({ artifacts, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  const current = artifacts[Math.min(activeIndex, artifacts.length - 1)]

  if (!current) return null

  return (
    <div className="flex flex-col h-full bg-biav-surface border-l border-biav-border" style={{ width: '40%', minWidth: 320 }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-biav-border">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-biav-text truncate">{current.title}</span>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${TYPE_COLORS[current.type]}`}>
            {TYPE_LABELS[current.type]}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-biav-border text-biav-muted hover:text-biav-text transition-colors"
          title="关闭面板"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab bar (if multiple artifacts) */}
      {artifacts.length > 1 && (
        <div className="flex gap-0 border-b border-biav-border overflow-x-auto shrink-0">
          {artifacts.map((art, i) => (
            <button
              key={art.id}
              onClick={() => setActiveIndex(i)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                i === Math.min(activeIndex, artifacts.length - 1)
                  ? 'border-biav-gold text-biav-gold'
                  : 'border-transparent text-biav-muted hover:text-biav-text'
              }`}
            >
              {art.title}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0">
        <ArtifactRenderer artifact={current} />
      </div>
    </div>
  )
}
