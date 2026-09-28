import { Component, type ReactNode } from 'react'

import { Button } from './Button'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * The one thing standing between a bug in a deeply nested component and a
 * blank page: without this, an uncaught render error unmounts the whole
 * React tree and leaves nothing on screen until a manual reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="flex max-w-[340px] flex-col items-start gap-3">
            <p className="text-sm text-ink">Something went wrong displaying this page.</p>
            <p className="text-[13px] leading-relaxed text-ink-faint">{this.state.error.message}</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
