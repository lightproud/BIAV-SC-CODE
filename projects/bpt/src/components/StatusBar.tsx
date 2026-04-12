import { useSilverStatus, useBpeStatus, useGear } from '../lib/hooks';

export default function StatusBar() {
  const silverStatus = useSilverStatus();
  const bpeStatus = useBpeStatus();
  const { gear } = useGear();

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-bpt-border
                    bg-bpt-surface text-[10px] text-bpt-text-dim">
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

      <span className="text-bpt-gold-dim">BPT v0.2.0</span>
    </div>
  );
}
