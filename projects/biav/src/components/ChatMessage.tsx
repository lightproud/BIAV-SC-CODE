'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export default function ChatMessage({ role, content, isStreaming }: Props) {
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-tr-sm
                        bg-biav-card border border-biav-border text-biav-text">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="flex gap-3 max-w-[85%]">
        {/* Avatar */}
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-biav-card border border-biav-gold-dark
                        flex items-center justify-center mt-1">
          <span className="text-biav-gold text-xs font-serif font-bold">B</span>
        </div>
        {/* Content */}
        <div className={`markdown-content text-sm leading-relaxed min-w-0 ${isStreaming ? 'typing-cursor' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
