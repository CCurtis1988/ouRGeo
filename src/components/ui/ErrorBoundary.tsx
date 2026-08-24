import React from 'react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0f1117',
          color: '#f85149', gap: '12px', fontFamily: 'monospace', fontSize: '13px',
          padding: '24px', textAlign: 'center'
        }}>
          <p>Something went wrong rendering the UI.</p>
          <pre style={{ color: '#8b949e', fontSize: '11px', maxWidth: '600px', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            {/* Try again re-renders in place, preserving all in-memory state —
                the right first move for a transient error (e.g. a WebGL hiccup
                after resume). Reload is the last resort and loses unsaved state. */}
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                padding: '6px 16px', background: '#238636',
                border: '1px solid #2ea043', borderRadius: '6px',
                color: '#fff', cursor: 'pointer', fontSize: '12px'
              }}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '6px 16px', background: '#21262d',
                border: '1px solid #30363d', borderRadius: '6px',
                color: '#e6edf3', cursor: 'pointer', fontSize: '12px'
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
