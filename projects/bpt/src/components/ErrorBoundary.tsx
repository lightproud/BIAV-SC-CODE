/**
 * ErrorBoundary.tsx — Global error boundary for the React app.
 *
 * Why: Unhandled errors in React components crash the entire app. This
 * catches them and shows a recovery UI instead of a white screen.
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo: errorInfo.componentStack ?? '' });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: '' });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-bpt-bg text-bpt-text p-8">
          <div className="max-w-lg text-center">
            <h1 className="text-lg text-bpt-error font-bold mb-2">BPT encountered an error</h1>
            <p className="text-sm text-bpt-text-dim mb-4">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            {this.state.errorInfo && (
              <pre className="text-[10px] text-bpt-text-dim bg-bpt-surface rounded p-3 mb-4 max-h-40 overflow-auto text-left">
                {this.state.errorInfo}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-bpt-gold/20 text-bpt-gold rounded text-sm hover:bg-bpt-gold/30"
            >
              Try to recover
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
