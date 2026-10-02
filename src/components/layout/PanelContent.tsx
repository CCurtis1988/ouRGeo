import React from 'react'
import type { PanelRender } from '@/lib/layout/panel-render'

/** Give every renderer its own hook sequence and contain failures to its panel. */
export class PanelContent extends React.Component<
  { render: PanelRender; label: string }, { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } { return { error } }

  componentDidUpdate(previous: Readonly<{ render: PanelRender; label: string }>): void {
    if (previous.render !== this.props.render && this.state.error) this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error) return (
      <section role="alert" className="p-4 text-xs text-foreground bg-geo-panel h-full overflow-auto">
        <p className="font-medium">{this.props.label} could not be displayed.</p>
        <p className="text-geo-muted my-2 break-words">{this.state.error.message}</p>
        <button className="border border-geo-border rounded px-2 py-1" onClick={() => this.setState({ error: null })}>Reload panel</button>
      </section>
    )
    const Renderer = this.props.render
    return <Renderer />
  }
}
