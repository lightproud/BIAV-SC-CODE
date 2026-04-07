import { useState } from 'react'
import type { PendingToolUse } from '../types'

interface Props {
  tool: PendingToolUse
}

export default function ToolResult({ tool }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isError = !!tool.error

  const resultContent = isError
    ? tool.error
    : typeof tool.result === 'string'
      ? tool.result
      : JSON.stringify(tool.result, null, 2)

  // Extract text content from MCP tool results
  const displayContent = (() => {
    if (isError) return tool.error || ''
    if (!tool.result) return '(empty result)'
    // MCP results often have { content: [{ type: 'text', text: '...' }] }
    if (tool.result?.content && Array.isArray(tool.result.content)) {
      return tool.result.content
        .map((c: any) => c.text || JSON.stringify(c))
        .join('\n')
    }
    return typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)
  })()

  // Truncated preview
  const preview = displayContent.length > 120
    ? displayContent.slice(0, 120) + '...'
    : displayContent

  return (
    <div className="flex gap-3">
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 ${
        isError ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
      }`}>
        {isError ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left rounded-lg border border-biav-border bg-biav-bg/50 p-3 hover:bg-biav-border/20 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium ${isError ? 'text-red-400' : 'text-emerald-400'}`}>
              {isError ? '工具错误' : '工具结果'}
            </span>
            <span className="text-xs text-biav-muted">{tool.toolName}</span>
            <svg
              className={`ml-auto w-3.5 h-3.5 text-biav-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {!expanded && (
            <pre className={`text-xs truncate ${isError ? 'text-red-300/70' : 'text-biav-text/60'}`}>
              {preview}
            </pre>
          )}

          {expanded && (
            <pre className={`text-xs whitespace-pre-wrap break-words max-h-80 overflow-y-auto rounded p-2 mt-1 ${
              isError ? 'bg-red-500/10 text-red-300/80' : 'bg-biav-border/30 text-biav-text/80'
            }`}>
              {displayContent}
            </pre>
          )}
        </button>
      </div>
    </div>
  )
}
