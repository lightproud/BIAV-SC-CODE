import { useState, useRef, useCallback } from 'react'
import type { Attachment } from '../types'
import { ACCEPTED_EXTENSIONS, readFileAsAttachment } from './DropZone'

interface Props {
  onSend: (content: string, attachments: Attachment[]) => void
  onStop: () => void
  isStreaming: boolean
  disabled: boolean
  attachments: Attachment[]
  onAttachmentsChange: (attachments: Attachment[]) => void
}

export default function ChatInput({ onSend, onStop, isStreaming, disabled, attachments, onAttachmentsChange }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  function handleSubmit() {
    const trimmed = text.trim()
    if ((!trimmed && attachments.length === 0) || isStreaming || disabled) return
    onSend(trimmed, attachments)
    setText('')
    onAttachmentsChange([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    const results = await Promise.all(files.map(readFileAsAttachment))
    const valid = results.filter((a): a is Attachment => a !== null)
    if (valid.length > 0) {
      onAttachmentsChange([...attachments, ...valid])
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  function removeAttachment(index: number) {
    onAttachmentsChange(attachments.filter((_, i) => i !== index))
  }

  return (
    <div className="border-t border-bpt-border px-4 py-3">
      <div className="max-w-3xl mx-auto">
        {/* Attachment pills */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bpt-surface border border-bpt-border text-xs text-bpt-text"
              >
                <span className="truncate max-w-[150px]">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="text-bpt-muted hover:text-bpt-text ml-0.5"
                  title="移除"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={Array.from(ACCEPTED_EXTENSIONS).join(',')}
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            className="shrink-0 w-10 h-10 rounded-xl bg-bpt-surface border border-bpt-border text-bpt-muted flex items-center justify-center hover:text-bpt-text hover:border-bpt-gold-dim disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="添加附件"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              adjustHeight()
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none bg-bpt-surface border border-bpt-border rounded-xl px-4 py-2.5 text-sm text-bpt-text placeholder-bpt-muted focus:outline-none focus:border-bpt-gold-dim transition-colors"
          />
          {isStreaming ? (
            <button
              onClick={onStop}
              className="shrink-0 w-10 h-10 rounded-xl bg-bpt-danger/20 text-bpt-danger flex items-center justify-center hover:bg-bpt-danger/30 transition-colors"
              title="停止"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!text.trim() && attachments.length === 0) || disabled}
              className="shrink-0 w-10 h-10 rounded-xl bg-bpt-gold/20 text-bpt-gold flex items-center justify-center hover:bg-bpt-gold/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="发送"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
