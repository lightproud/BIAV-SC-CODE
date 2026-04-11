import type { UsageData } from '../types'

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function formatCost(cost: number): string {
  if (cost < 0.001) return '<$0.001'
  if (cost < 0.01) return `~$${cost.toFixed(3)}`
  return `~$${cost.toFixed(2)}`
}

interface UsageBarProps {
  usage: UsageData
}

export default function UsageBar({ usage }: UsageBarProps) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-bpt-muted mt-1 ml-10 select-none">
      <span>{`输入 ${formatTokens(usage.inputTokens)}`}</span>
      <span className="opacity-40">·</span>
      <span>{`输出 ${formatTokens(usage.outputTokens)}`}</span>
      <span className="opacity-40">·</span>
      <span>{formatCost(usage.estimatedCost)}</span>
    </div>
  )
}

interface SessionUsageBarProps {
  totalInput: number
  totalOutput: number
  totalCost: number
}

export function SessionUsageBar({ totalInput, totalOutput, totalCost }: SessionUsageBarProps) {
  if (totalInput === 0 && totalOutput === 0) return null

  return (
    <div className="text-[11px] text-bpt-muted px-3 py-1.5 select-none truncate">
      <span className="opacity-60">会话合计</span>{' '}
      <span>{formatTokens(totalInput + totalOutput)} tokens</span>
      <span className="opacity-40"> · </span>
      <span>{formatCost(totalCost)}</span>
    </div>
  )
}
