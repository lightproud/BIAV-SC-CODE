import { useState, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import type { Artifact } from '../types'
import ArtifactDiff from './ArtifactDiff'

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

function formatTimestamp(ts: number): string {
  if (ts < 1000) return '' // index-based timestamp from streaming
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function VersionControls({
  artifact,
  onVersionChange,
  onShowDiff,
}: {
  artifact: Artifact
  onVersionChange: (index: number) => void
  onShowDiff: () => void
}) {
  const { versions, currentVersion } = artifact
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const isLatest = currentVersion === versions.length - 1
  const hasMultipleVersions = versions.length > 1

  if (!hasMultipleVersions) return null

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-biav-border">
      {/* Non-latest indicator */}
      {!isLatest && (
        <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400 font-medium">
          旧版本
        </span>
      )}

      {/* Left arrow */}
      <button
        onClick={() => onVersionChange(Math.max(0, currentVersion - 1))}
        disabled={currentVersion === 0}
        className="p-0.5 rounded hover:bg-biav-border text-biav-muted hover:text-biav-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="上一版本"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {/* Version indicator / dropdown trigger */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="px-1.5 py-0.5 text-xs rounded hover:bg-biav-border text-biav-muted hover:text-biav-text transition-colors"
        >
          v{currentVersion + 1} / {versions.length}
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
            <div className="absolute top-full left-0 mt-1 z-20 bg-biav-surface border border-biav-border rounded shadow-lg min-w-[160px] py-1">
              {versions.map((v, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onVersionChange(i)
                    setDropdownOpen(false)
                  }}
                  className={`w-full text-left px-3 py-1 text-xs hover:bg-biav-border transition-colors flex items-center gap-2 ${
                    i === currentVersion ? 'text-biav-gold' : 'text-biav-text'
                  }`}
                >
                  <span>v{i + 1}</span>
                  <span className="text-biav-muted">{formatTimestamp(v.timestamp)}</span>
                  {i === versions.length - 1 && (
                    <span className="text-[10px] text-biav-muted ml-auto">最新</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => onVersionChange(Math.min(versions.length - 1, currentVersion + 1))}
        disabled={isLatest}
        className="p-0.5 rounded hover:bg-biav-border text-biav-muted hover:text-biav-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="下一版本"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {/* Diff button */}
      {currentVersion > 0 && (
        <button
          onClick={onShowDiff}
          className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-biav-border text-biav-muted hover:text-biav-gold transition-colors"
          title="与上一版本对比"
        >
          Diff
        </button>
      )}
    </div>
  )
}

export default function ArtifactsPanel({ artifacts, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)
  // Track per-artifact version overrides (artifact id -> version index)
  const [versionOverrides, setVersionOverrides] = useState<Record<string, number>>({})
  const [showDiff, setShowDiff] = useState(false)

  const current = artifacts[Math.min(activeIndex, artifacts.length - 1)]

  // Apply version override to get the displayed artifact
  const displayArtifact = useMemo(() => {
    if (!current) return null
    const overrideVersion = versionOverrides[current.id]
    if (overrideVersion !== undefined && overrideVersion !== current.currentVersion) {
      return {
        ...current,
        content: current.versions[overrideVersion].content,
        currentVersion: overrideVersion,
      }
    }
    return current
  }, [current, versionOverrides])

  const handleVersionChange = useCallback(
    (index: number) => {
      if (!current) return
      setVersionOverrides((prev) => ({ ...prev, [current.id]: index }))
      setShowDiff(false)
    },
    [current],
  )

  if (!displayArtifact) return null

  const isNotLatest =
    displayArtifact.versions.length > 1 &&
    displayArtifact.currentVersion < displayArtifact.versions.length - 1

  return (
    <div
      className={`flex flex-col h-full bg-biav-surface border-l transition-colors ${
        isNotLatest ? 'border-yellow-500/50' : 'border-biav-border'
      }`}
      style={{ width: '40%', minWidth: 320 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-biav-border">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-biav-text truncate">{displayArtifact.title}</span>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${TYPE_COLORS[displayArtifact.type]}`}>
            {TYPE_LABELS[displayArtifact.type]}
          </span>
          {displayArtifact.versions.length > 1 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-biav-border text-biav-muted">
              {displayArtifact.versions.length} 版本
            </span>
          )}
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
              onClick={() => {
                setActiveIndex(i)
                setShowDiff(false)
              }}
              className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 transition-colors ${
                i === Math.min(activeIndex, artifacts.length - 1)
                  ? 'border-biav-gold text-biav-gold'
                  : 'border-transparent text-biav-muted hover:text-biav-text'
              }`}
            >
              {art.title}
              {art.versions.length > 1 && (
                <span className="ml-1 text-[10px] text-biav-muted">v{art.versions.length}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Version controls */}
      <VersionControls
        artifact={displayArtifact}
        onVersionChange={handleVersionChange}
        onShowDiff={() => setShowDiff(!showDiff)}
      />

      {/* Content */}
      <div className="flex-1 min-h-0">
        {showDiff && displayArtifact.currentVersion > 0 ? (
          <ArtifactDiff
            oldContent={displayArtifact.versions[displayArtifact.currentVersion - 1].content}
            newContent={displayArtifact.versions[displayArtifact.currentVersion].content}
            onClose={() => setShowDiff(false)}
          />
        ) : (
          <ArtifactRenderer artifact={displayArtifact} />
        )}
      </div>
    </div>
  )
}
