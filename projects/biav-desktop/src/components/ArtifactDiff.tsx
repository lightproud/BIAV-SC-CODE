import { useMemo } from 'react'
import { computeDiff } from '../lib/diffUtil'

interface Props {
  oldContent: string
  newContent: string
  onClose: () => void
}

export default function ArtifactDiff({ oldContent, newContent, onClose }: Props) {
  const diffLines = useMemo(() => computeDiff(oldContent, newContent), [oldContent, newContent])

  // Compute line numbers for old/new sides
  const numberedLines = useMemo(() => {
    let oldNum = 0
    let newNum = 0
    return diffLines.map((d) => {
      if (d.type === 'same') {
        oldNum++
        newNum++
        return { ...d, oldNum, newNum }
      } else if (d.type === 'remove') {
        oldNum++
        return { ...d, oldNum, newNum: null }
      } else {
        newNum++
        return { ...d, oldNum: null, newNum }
      }
    })
  }, [diffLines])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-biav-border">
        <span className="text-xs font-medium text-biav-muted">差异对比</span>
        <div className="flex-1" />
        <span className="text-[10px] text-red-400 mr-1">
          -{diffLines.filter((d) => d.type === 'remove').length}
        </span>
        <span className="text-[10px] text-green-400 mr-2">
          +{diffLines.filter((d) => d.type === 'add').length}
        </span>
        <button
          onClick={onClose}
          className="px-2 py-0.5 text-xs rounded bg-biav-border text-biav-muted hover:text-biav-text transition-colors"
        >
          关闭
        </button>
      </div>
      <div className="flex-1 overflow-auto font-mono text-xs leading-5">
        {numberedLines.map((line, i) => {
          const bgClass =
            line.type === 'add'
              ? 'bg-green-500/10'
              : line.type === 'remove'
                ? 'bg-red-500/10'
                : ''
          const textClass =
            line.type === 'add'
              ? 'text-green-400'
              : line.type === 'remove'
                ? 'text-red-400'
                : 'text-biav-text'
          const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '

          return (
            <div key={i} className={`flex ${bgClass}`}>
              <span className="w-10 shrink-0 text-right pr-1 text-biav-muted/50 select-none border-r border-biav-border/50">
                {line.oldNum ?? ''}
              </span>
              <span className="w-10 shrink-0 text-right pr-1 text-biav-muted/50 select-none border-r border-biav-border/50">
                {line.newNum ?? ''}
              </span>
              <span className={`px-2 whitespace-pre ${textClass}`}>
                {prefix} {line.line}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
