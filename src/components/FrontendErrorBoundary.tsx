import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { reportFrontendError } from '../services/diagnostics'

export class FrontendErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    reportFrontendError('frontend_render_error', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="mx-auto max-w-lg p-6 text-slate-800">
          <h1 className="text-xl font-semibold">This screen could not be displayed</h1>
          <p className="mt-2 text-sm text-slate-600">Reload the page and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white"
          >
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
