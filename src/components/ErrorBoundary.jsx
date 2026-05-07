import React from 'react'

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL ?? ''

/**
 * Top-level React Error Boundary. Catches render-phase exceptions, renders a
 * minimal recovery UI, and posts a crash report to the backend (best-effort).
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.handleReset = this.handleReset.bind(this)
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Best-effort: POST crash details to the backend error-reporting endpoint.
    try {
      const token = localStorage.getItem('authToken')
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      fetch(`${API_BASE_URL}/api/errors`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          timestamp: new Date().toISOString(),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {
        // Ignore — error reporting must never cause additional errors.
      })
    } catch {
      // Ignore — same reason.
    }
  }

  handleReset() {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white gap-6 p-6">
          <div className="text-center max-w-sm">
            <div className="text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-slate-400 text-sm mb-6">
              StreetSmart encountered an unexpected error. Your session data is safe.
            </p>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
