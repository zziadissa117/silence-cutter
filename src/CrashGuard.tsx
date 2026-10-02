// If anything on the page fails while drawing, React clears the whole screen
// - a blank page with no way to tell what happened. This catches it, says
// so, offers a reload, and reports it.

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { report } from './report'

export class CrashGuard extends Component<{ children: ReactNode }, { crashed: string | null }> {
  state: { crashed: string | null } = { crashed: null }

  static getDerivedStateFromError(error: unknown): { crashed: string } {
    return { crashed: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const where = info.componentStack?.trim().split('\n').slice(0, 3).join(' < ') ?? ''
    report({ kind: 'crash', phase: 'screen', message: `${error instanceof Error ? error.message : String(error)} | ${where}` })
  }

  render(): ReactNode {
    if (this.state.crashed === null) return this.props.children
    return (
      <main>
        <div className="error">
          Something went wrong on this page ({this.state.crashed}). The details were sent so it can be fixed. Your
          videos that were waiting come back when you reload.
        </div>
        <button type="button" className="btn primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    )
  }
}
