interface Props {
  onClose: () => void
}

interface Shortcut {
  keys: string[]
  description: string
}

interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
const mod = isMac ? '⌘' : 'Ctrl'

const groups: ShortcutGroup[] = [
  {
    title: '导航',
    shortcuts: [
      { keys: [mod, 'K'], description: '搜索对话' },
      { keys: [mod, ','], description: '打开设置' },
      { keys: [mod, '?'], description: '显示快捷键' },
    ],
  },
  {
    title: '对话',
    shortcuts: [
      { keys: [mod, 'N'], description: '新对话' },
      { keys: [mod, 'E'], description: '导出对话' },
      { keys: ['Escape'], description: '关闭弹窗' },
    ],
  },
  {
    title: '系统',
    shortcuts: [
      { keys: [mod, 'Shift', 'B'], description: '显示/隐藏窗口' },
      { keys: ['Alt', 'Space'], description: 'Quick Entry' },
    ],
  },
]

function KeyBadge({ children }: { children: string }) {
  return (
    <span className="inline-block bg-bpt-border rounded px-1.5 py-0.5 text-xs font-mono text-bpt-text">
      {children}
    </span>
  )
}

export default function ShortcutsModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto bg-bpt-surface border border-bpt-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bpt-border">
          <h2 className="font-serif text-bpt-gold-bright text-lg">快捷键</h2>
          <button onClick={onClose} className="text-bpt-muted hover:text-bpt-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-6">
          {groups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs text-bpt-muted uppercase tracking-wider mb-3">{group.title}</h3>
              <table className="w-full">
                <tbody>
                  {group.shortcuts.map((shortcut) => (
                    <tr key={shortcut.description} className="h-9">
                      <td className="text-sm text-bpt-text">{shortcut.description}</td>
                      <td className="text-right space-x-1">
                        {shortcut.keys.map((k, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-bpt-muted text-xs mx-0.5">+</span>}
                            <KeyBadge>{k}</KeyBadge>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
