import React from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const { error } = this.state
      const isDev = (import.meta as any).env?.DEV

      return (
        <div className="flex h-screen w-screen items-center justify-center bg-bpt-surface p-8">
          <div className="max-w-lg w-full rounded-lg border border-bpt-danger bg-bpt-surface p-6 shadow-lg">
            <h1 className="mb-2 text-xl font-bold text-bpt-danger">
              出现了错误
            </h1>
            <p className="mb-4 text-sm text-bpt-text">
              {error?.message || '应用遇到了未知错误'}
            </p>

            {isDev && error?.stack && (
              <details className="mb-4">
                <summary className="cursor-pointer text-xs text-bpt-text/60 hover:text-bpt-text/80">
                  查看堆栈追踪
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/20 p-3 text-xs text-bpt-text/70 whitespace-pre-wrap break-all">
                  {error.stack}
                </pre>
              </details>
            )}

            <button
              onClick={this.handleReload}
              className="rounded bg-bpt-danger/20 px-4 py-2 text-sm text-bpt-danger hover:bg-bpt-danger/30 transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
