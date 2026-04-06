import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import type { Message } from '../types'

interface Props {
  message: Message
  isStreaming?: boolean
  onEdit?: (id: string, content: string) => void
  onRegenerate?: (id: string) => void
}

function CodeBlock({ className, children }: { className?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children).replace(/\n$/, '')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  const highlighted = match
    ? hljs.highlight(code, { language: match[1], ignoreIllegals: true }).value
    : hljs.highlightAuto(code).value

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-0.5 text-xs rounded bg-biav-border/80 text-biav-text/70 hover:text-biav-gold opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {copied ? '已复制✓' : '复制'}
      </button>
      <pre className="hljs">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  )
}

export default function ChatMessage({ message, isStreaming, onEdit, onRegenerate }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)

  if (message.role === 'user') {
    if (isEditing) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] w-full flex flex-col gap-2">
            <textarea
              className="w-full bg-biav-border rounded-2xl px-4 py-2.5 text-sm leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-biav-gold"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className="text-xs text-biav-muted hover:text-biav-gold px-2 py-1"
                onClick={() => {
                  setIsEditing(false)
                  setEditContent(message.content)
                }}
              >
                取消
              </button>
              <button
                className="text-xs text-biav-muted hover:text-biav-gold px-2 py-1"
                onClick={() => {
                  setIsEditing(false)
                  onEdit?.(message.id, editContent)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="group flex justify-end">
        <div className="max-w-[80%] flex flex-col items-end gap-1">
          <div className="bg-biav-border rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">
            {message.content}
          </div>
          {onEdit && (
            <button
              className="text-xs text-biav-muted hover:text-biav-gold opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => {
                setEditContent(message.content)
                setIsEditing(true)
              }}
            >
              编辑
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="group flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-biav-gold/20 flex items-center justify-center text-biav-gold text-xs font-bold mt-0.5">
        B
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-sm leading-relaxed markdown-content ${isStreaming ? 'typing-cursor' : ''}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const isBlock = /language-/.test(className || '') ||
                  (props.node?.position && String(children).includes('\n'))
                if (isBlock) {
                  return <CodeBlock className={className}>{String(children)}</CodeBlock>
                }
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                )
              },
              // Let the outer pre be handled by CodeBlock's own <pre>
              pre({ children }) {
                return <>{children}</>
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {onRegenerate && !isStreaming && (
          <button
            className="text-xs text-biav-muted hover:text-biav-gold opacity-0 group-hover:opacity-100 transition-opacity mt-1"
            onClick={() => onRegenerate(message.id)}
          >
            重新生成
          </button>
        )}
      </div>
    </div>
  )
}
