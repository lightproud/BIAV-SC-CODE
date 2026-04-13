import { useSilverStatus, useBpeStatus, useGear, useTheme } from '../lib/hooks';
import { BPT_VERSION } from '../version';

export default function StatusBar() {
  const silverStatus = useSilverStatus();
  const bpeStatus = useBpeStatus();
  const { gear } = useGear();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-bpt-border
                    bg-bpt-surface text-[10px] text-bpt-text-dim select-none">
      <div className="flex gap-3">
        {/* Silver Core status */}
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${
            silverStatus.mcpConnected ? 'bg-bpt-success' : 'bg-bpt-error'
          }`} />
          MCP: {silverStatus.mcpConnected
            ? `${silverStatus.mcpTools.length} tools`
            : 'disconnected'}
        </span>

        {/* BPE status */}
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${
            bpeStatus.loaded ? 'bg-bpt-success' : 'bg-bpt-warning'
          }`} />
          BPE: {bpeStatus.loaded
            ? `loaded${bpeStatus.hasKeywords ? ' (FTS5)' : ''}`
            : 'no index'}
        </span>

        {/* Gear */}
        <span className={gear === 'work' ? 'text-bpt-warning' : 'text-bpt-accent'}>
          Gear: {gear}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="text-bpt-text-dim hover:text-bpt-gold transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? '[Light]' : '[Dark]'}
        </button>

        <span className="text-bpt-gold-dim">BPT v{BPT_VERSION}</span>
      </div>
    </div>
  );
}
