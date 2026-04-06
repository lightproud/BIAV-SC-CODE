import { useState } from 'react'
import type { Project } from '../types'

interface Props {
  project?: Project | null
  onSave: (data: { name: string; description: string; system_prompt: string }) => void
  onClose: () => void
}

export default function ProjectEditor({ project, onSave, onClose }: Props) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [systemPrompt, setSystemPrompt] = useState(project?.system_prompt ?? '')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    onSave({ name: name.trim(), description: description.trim(), system_prompt: systemPrompt.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-biav-surface border border-biav-border rounded-xl w-[480px] max-h-[80vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 border-b border-biav-border">
            <h2 className="text-lg font-semibold text-biav-text">
              {project ? '编辑项目' : '新建项目'}
            </h2>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm text-biav-muted mb-1">项目名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：工作助手"
                autoFocus
                className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm text-biav-muted mb-1">描述（可选）</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简要描述项目用途"
                className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm text-biav-muted mb-1">默认系统提示词（可选）</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="项目中新对话的默认系统提示词..."
                rows={4}
                className="w-full bg-biav-bg border border-biav-border rounded-lg px-3 py-2 text-sm text-biav-text placeholder:text-biav-muted focus:outline-none focus:border-biav-gold transition-colors resize-none"
              />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-biav-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-biav-muted hover:text-biav-text hover:bg-biav-border transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg text-sm bg-biav-gold text-biav-bg font-medium hover:bg-biav-gold-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {project ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
