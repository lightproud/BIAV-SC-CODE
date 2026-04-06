import { useState, useRef, useEffect } from 'react'
import type { Style } from '../types'

interface Props {
  styles: Style[]
  activeStyleId: string | null
  onSelect: (style: Style | null) => void
  onSave: (style: Omit<Style, 'isBuiltin'>) => void
  onDelete: (id: string) => void
}

export default function StyleSelector({ styles, activeStyleId, onSelect, onSave, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editPrompt, setEditPrompt] = useState('')
  const [editIcon, setEditIcon] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const activeStyle = styles.find((s) => s.id === activeStyleId)

  function handleStartCreate() {
    setEditId(null)
    setEditName('')
    setEditDesc('')
    setEditPrompt('')
    setEditIcon('')
    setEditing(true)
  }

  function handleStartEdit(style: Style) {
    setEditId(style.id)
    setEditName(style.name)
    setEditDesc(style.description)
    setEditPrompt(style.prompt)
    setEditIcon(style.icon || '')
    setEditing(true)
  }

  function handleSaveEdit() {
    if (!editName.trim() || !editPrompt.trim()) return
    const id = editId || `custom-${Date.now()}`
    onSave({
      id,
      name: editName.trim(),
      description: editDesc.trim(),
      prompt: editPrompt.trim(),
      icon: editIcon.trim() || undefined,
    })
    setEditing(false)
    setEditId(null)
  }

  if (editing) {
    return (
      <div ref={ref} className="relative titlebar-no-drag">
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-biav-gold hover:bg-biav-border transition-colors"
        >
          {activeStyle ? `${activeStyle.icon || ''} ${activeStyle.name}` : '风格'}
        </button>
        <div className="absolute right-0 top-full mt-1 w-80 bg-biav-surface border border-biav-border rounded-xl shadow-xl z-50 p-3 overflow-hidden">
          <div className="text-sm font-medium text-biav-text mb-2">
            {editId ? '编辑风格' : '自定义风格'}
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={editIcon}
                onChange={(e) => setEditIcon(e.target.value)}
                placeholder="图标"
                className="w-12 px-2 py-1 text-sm rounded-lg bg-biav-bg border border-biav-border text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold/50"
              />
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="风格名称"
                className="flex-1 px-2 py-1 text-sm rounded-lg bg-biav-bg border border-biav-border text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold/50"
              />
            </div>
            <input
              type="text"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              placeholder="简短描述"
              className="w-full px-2 py-1 text-sm rounded-lg bg-biav-bg border border-biav-border text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold/50"
            />
            <textarea
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="风格提示词（将作为系统级指令注入）"
              rows={4}
              className="w-full px-2 py-1.5 text-sm rounded-lg bg-biav-bg border border-biav-border text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold/50 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setEditing(false); setEditId(null) }}
                className="px-3 py-1 text-xs rounded-lg text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editName.trim() || !editPrompt.trim()}
                className="px-3 py-1 text-xs rounded-lg bg-biav-gold/20 text-biav-gold hover:bg-biav-gold/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative titlebar-no-drag">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
        title="风格预设"
      >
        {activeStyle ? (
          <>
            <span>{activeStyle.icon}</span>
            <span className="text-biav-gold">{activeStyle.name}</span>
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span>风格</span>
          </>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-biav-surface border border-biav-border rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          {/* No style option */}
          <button
            onClick={() => { onSelect(null); setOpen(false) }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
              !activeStyleId
                ? 'text-biav-gold bg-biav-border/50'
                : 'text-biav-text hover:bg-biav-border/30'
            }`}
          >
            <span className="w-5 text-center text-base">-</span>
            <div>
              <div className="text-sm">默认</div>
              <div className="text-xs text-biav-muted">无风格预设</div>
            </div>
          </button>

          <div className="border-t border-biav-border my-1" />

          {/* Style list */}
          {styles.map((style) => (
            <div
              key={style.id}
              className={`group w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                style.id === activeStyleId
                  ? 'text-biav-gold bg-biav-border/50'
                  : 'text-biav-text hover:bg-biav-border/30'
              }`}
            >
              <button
                className="flex items-center gap-2 flex-1 min-w-0"
                onClick={() => { onSelect(style); setOpen(false) }}
              >
                <span className="w-5 text-center text-base shrink-0">{style.icon || ''}</span>
                <div className="min-w-0">
                  <div className="text-sm truncate">{style.name}</div>
                  <div className="text-xs text-biav-muted truncate">{style.description}</div>
                </div>
              </button>
              {!style.isBuiltin && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStartEdit(style) }}
                    className="p-0.5 rounded hover:bg-biav-border text-biav-muted hover:text-biav-text"
                    title="编辑"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(style.id)
                      if (style.id === activeStyleId) onSelect(null)
                    }}
                    className="p-0.5 rounded hover:bg-biav-border text-biav-muted hover:text-biav-danger"
                    title="删除"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          ))}

          <div className="border-t border-biav-border my-1" />

          {/* Create custom */}
          <button
            onClick={handleStartCreate}
            className="w-full text-left px-3 py-2 text-sm text-biav-muted hover:text-biav-text hover:bg-biav-border/30 transition-colors flex items-center gap-2"
          >
            <span className="w-5 text-center">+</span>
            <span>自定义风格</span>
          </button>
        </div>
      )}
    </div>
  )
}
