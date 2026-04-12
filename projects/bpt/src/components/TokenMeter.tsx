import { useState } from 'react';
import type { TokenUsage } from '../types';

interface TokenMeterProps {
  usage: TokenUsage | null;
}

/**
 * TokenMeter — Layered token usage display.
 *
 * Why layered: Day-0 requirement #2 (额度透明). Full 6-dimension display
 * overwhelms non-technical users. Compact mode shows what matters at a glance
 * (total, cache health, cost). Click to expand for full breakdown.
 */
export default function TokenMeter({ usage }: TokenMeterProps) {
  const [expanded, setExpanded] = useState(false);

  if (!usage) {
    return (
      <div className="px-4 py-1 border-b border-bpt-border text-[10px] text-bpt-text-dim flex gap-4">
        <span>Tokens: waiting for first message...</span>
      </div>
    );
  }

  const total = usage.system + usage.tools + usage.history + usage.generation;
  const inputTotal = usage.system + usage.tools + usage.history;
  const cacheRate = inputTotal > 0
    ? ((usage.cacheHit / inputTotal) * 100)
    : 0;

  const cacheHealthy = cacheRate >= 80;
  const costCny = usage.estimatedCostUsd * 7.2;

  return (
    <div
      className="px-4 py-1 border-b border-bpt-border text-[10px] cursor-pointer
                 hover:bg-bpt-surface/50 transition-colors select-none"
      onClick={() => setExpanded(!expanded)}
      title={expanded ? 'Click to collapse' : 'Click to expand token details'}
    >
      {/* Compact view: always visible */}
      <div className="flex gap-3 items-center">
        <span className="text-bpt-text-dim">
          {total.toLocaleString()} tokens
        </span>

        <span className={cacheHealthy ? 'text-bpt-success' : 'text-bpt-error font-bold'}>
          cache {cacheRate.toFixed(0)}%{!cacheHealthy && ' !!!'}
        </span>

        <span className="text-bpt-gold">
          ${usage.estimatedCostUsd.toFixed(4)} / ¥{costCny.toFixed(3)}
        </span>

        <span className="text-bpt-text-dim ml-auto text-[9px]">
          {expanded ? '[-]' : '[+]'}
        </span>
      </div>

      {/* Expanded: 6-dimensional breakdown */}
      {expanded && (
        <div className="flex gap-3 items-center mt-0.5 flex-wrap">
          <TokenItem label="sys" value={usage.system} color="text-bpt-accent" />
          <TokenItem label="tools" value={usage.tools} color="text-bpt-warning" />
          <TokenItem label="hist" value={usage.history} color="text-bpt-text-dim" />
          <TokenItem label="gen" value={usage.generation} color="text-bpt-success" />
          <TokenItem label="cache-hit" value={usage.cacheHit} color="text-bpt-gold" />
          <TokenItem label="cache-write" value={usage.cacheWrite} color="text-bpt-gold-dim" />
        </div>
      )}
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
