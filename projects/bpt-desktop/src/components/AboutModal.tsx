interface Props {
  onClose: () => void
}

export default function AboutModal({ onClose }: Props) {
  const isMac = window.bpt.platform === 'darwin'
  const versions = window.bpt.versions ?? {} as Record<string, string>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[420px] bg-bpt-surface border border-bpt-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-bpt-border">
          <h2 className="font-serif text-bpt-gold-bright text-lg">关于</h2>
          <button onClick={onClose} className="text-bpt-muted hover:text-bpt-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center text-center space-y-4">
          {/* App name */}
          <h1 className="text-3xl font-serif text-bpt-gold-bright tracking-wide">
            黑池终端
          </h1>

          {/* Version */}
          <span className="text-sm text-bpt-muted">BPT-DESKTOP v0.1.0</span>

          {/* Description */}
          <p className="text-sm text-bpt-text">
            Black Pool Terminal &middot; 开源版桌面对话终端
          </p>

          {/* Tech stack badges */}
          <div className="flex items-center gap-2">
            {['Electron', 'React', 'TypeScript'].map((tech) => (
              <span
                key={tech}
                className="px-2.5 py-0.5 rounded-full text-xs bg-bpt-gold/10 text-bpt-gold border border-bpt-gold/20"
              >
                {tech}
              </span>
            ))}
          </div>

          {/* Build info */}
          <div className="w-full bg-bpt-bg rounded-lg border border-bpt-border px-4 py-3 text-left space-y-1.5">
            <p className="text-xs text-bpt-muted">
              <span className="text-bpt-text">Electron</span>{' '}
              {versions.electron ?? 'N/A'}
            </p>
            <p className="text-xs text-bpt-muted">
              <span className="text-bpt-text">Chrome</span>{' '}
              {versions.chrome ?? 'N/A'}
            </p>
            <p className="text-xs text-bpt-muted">
              <span className="text-bpt-text">Node</span>{' '}
              {versions.node ?? 'N/A'}
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 text-xs">
            <button
              onClick={() => window.bpt.openExternal?.('https://github.com/nicekid1/brain-in-a-vat')}
              className="text-bpt-muted hover:text-bpt-gold transition-colors underline underline-offset-2"
            >
              GitHub
            </button>
            <button
              onClick={() => window.bpt.openExternal?.('https://biav.studio')}
              className="text-bpt-muted hover:text-bpt-gold transition-colors underline underline-offset-2"
            >
              B.I.A.V. Studio
            </button>
          </div>

          {/* Keyboard shortcut hint */}
          <p className="text-xs text-bpt-muted/60">
            {isMac ? '\u2318' : 'Ctrl'}+/ 查看快捷键
          </p>
        </div>
      </div>
    </div>
  )
}
