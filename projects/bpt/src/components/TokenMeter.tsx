import type { TokenUsage } from '../types';

interface TokenMeterProps {
  usage: TokenUsage | null;
}

/**
 * TokenMeter — 6-dimensional token usage display.
 *
 * Why always visible: Day-0 差异化 #2 (额度透明). Users must see where
 * their tokens go at a glance. This bar sits at the top of the chat view.
 */
export default function TokenMeter({ usage }: TokenMeterProps) {
  if (!usage) {
    return (
      <div className="px-4 py-1 border-b border-bpt-border text-[10px] text-bpt-text-dim flex gap-4">
        <span>Tokens: waiting for first message...</span>
      </div>
    );
  }

  const total = usage.system + usage.tools + usage.history + usage.generation;
  const cacheRate = (usage.system + usage.tools + usage.history) > 0
    ? ((usage.cacheHit / (usage.system + usage.tools + usage.history)) * 100)
    : 0;

  const cacheHealthy = cacheRate >= 80;
  const costCny = usage.estimatedCostUsd * 7.2; // Rough USD → CNY

  return (
    <div className="px-4 py-1 border-b border-bpt-border text-[10px] flex gap-3 items-center flex-wrap">
      <TokenItem label="sys" value={usage.system} color="text-bpt-accent" />
      <TokenItem label="tools" value={usage.tools} color="text-bpt-warning" />
      <TokenItem label="hist" value={usage.history} color="text-bpt-text-dim" />
      <TokenItem label="gen" value={usage.generation} color="text-bpt-success" />
      <TokenItem label="cache-hit" value={usage.cacheHit} color="text-bpt-gold" />
      <TokenItem label="cache-write" value={usage.cacheWrite} color="text-bpt-gold-dim" />

      <span className="text-bpt-text-dim">|</span>

      <span className="text-bpt-text-dim">total: {total.toLocaleString()}</span>

      <span className={cacheHealthy ? 'text-bpt-success' : 'text-bpt-error font-bold'}>
        cache: {cacheRate.toFixed(0)}%{!cacheHealthy && ' !!!'}
      </span>

      <span className="text-bpt-gold">
        ${usage.estimatedCostUsd.toFixed(4)} / ¥{costCny.toFixed(3)}
      </span>
    </div>
  );
}

function TokenItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className={color}>
      {label}: {value.toLocaleString()}
    </span>
  );
}
