import type { PendingToolUse } from '../types'

interface Props {
  tool: PendingToolUse
  onApprove: (toolUseId: string, approved: boolean, alwaysAllow?: boolean) => void
}

export default function ToolApproval({ tool, onApprove }: Props) {
  const isPending = tool.status === 'pending'
  const isExecuting = tool.status === 'executing' || tool.status === 'approved'
  const isDone = tool.status === 'done'
  const isDenied = tool.status === 'denied'

  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-lg border border-bpt-border bg-bpt-bg/50 p-3">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-amber-400">工具调用</span>
            <span className="text-xs text-bpt-muted">
              {tool.serverName} / {tool.toolName}
            </span>
          </div>

          {/* Arguments */}
          <div className="mb-3">
            <pre className="text-xs bg-bpt-border/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto text-bpt-text/80">
              {JSON.stringify(tool.toolArgs, null, 2)}
            </pre>
          </div>

          {/* Action buttons */}
          {isPending && (
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(tool.toolUseId, true)}
                className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                允许
              </button>
              <button
                onClick={() => onApprove(tool.toolUseId, false)}
                className="px-3 py-1 text-xs rounded bg-red-600/80 hover:bg-red-500 text-white transition-colors"
              >
                拒绝
              </button>
              <button
                onClick={() => onApprove(tool.toolUseId, true, true)}
                className="px-3 py-1 text-xs rounded bg-bpt-border hover:bg-bpt-border/80 text-bpt-text/70 transition-colors"
              >
                始终允许
              </button>
            </div>
          )}

          {/* Executing spinner */}
          {isExecuting && (
            <div className="flex items-center gap-2 text-xs text-bpt-muted">
              <svg className="animate-spin h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              执行中...
            </div>
          )}

          {/* Denied */}
          {isDenied && (
            <div className="text-xs text-red-400">
              已拒绝
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
