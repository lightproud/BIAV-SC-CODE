interface Props {
  onClose: () => void
}

export default function AboutModal({ onClose }: Props) {
  const isMac = window.biav.platform === 'darwin'
  const versions = window.biav.versions ?? {} as Record<string, string>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[420px] bg-biav-surface border border-biav-border rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-biav-border">
          <h2 className="font-serif text-biav-gold-bright text-lg">关于</h2>
          <button onClick={onClose} className="text-biav-muted hover:text-biav-text">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center text-center space-y-4">
          {/* App name */}
          <h1 className="text-3xl font-serif text-biav-gold-bright tracking-wide">
            Brain in a Vat
          </h1>

          {/* Version */}
          <span className="text-sm text-biav-muted">v0.1.0</span>

          {/* Description */}
          <p className="text-sm text-biav-text">
            缸中之脑 &middot; AI 桌面对话应用
          </p>

          {/* Tech stack badges */}
          <div className="flex items-center gap-2">
            {['Electron', 'React', 'TypeScript'].map((tech) => (
              <span
                key={tech}
                className="px-2.5 py-0.5 rounded-full text-xs bg-biav-gold/10 text-biav-gold border border-biav-gold/20"
              >
                {tech}
              </span>
            ))}
          </div>

          {/* Build info */}
          <div className="w-full bg-biav-bg rounded-lg border border-biav-border px-4 py-3 text-left space-y-1.5">
            <p className="text-xs text-biav-muted">
              <span className="text-biav-text">Electron</span>{' '}
              {versions.electron ?? 'N/A'}
            </p>
            <p className="text-xs text-biav-muted">
              <span className="text-biav-text">Chrome</span>{' '}
              {versions.chrome ?? 'N/A'}
            </p>
            <p className="text-xs text-biav-muted">
              <span className="text-biav-text">Node</span>{' '}
              {versions.node ?? 'N/A'}
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 text-xs">
            <button
              onClick={() => window.biav.openExternal?.('https://github.com/nicekid1/brain-in-a-vat')}
              className="text-biav-muted hover:text-biav-gold transition-colors underline underline-offset-2"
            >
              GitHub
            </button>
            <button
              onClick={() => window.biav.openExternal?.('https://biav.studio')}
              className="text-biav-muted hover:text-biav-gold transition-colors underline underline-offset-2"
            >
              BIAV Studio
            </button>
          </div>

          {/* Keyboard shortcut hint */}
          <p className="text-xs text-biav-muted/60">
            {isMac ? '\u2318' : 'Ctrl'}+/ 查看快捷键
          </p>
        </div>
      </div>
    </div>
  )
}
