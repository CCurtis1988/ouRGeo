// @vitest-environment jsdom
import React, { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelContent } from './PanelContent'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function Player(): React.ReactElement {
  const [count, setCount] = useState(0)
  React.useEffect(() => {}, [])
  return <button onClick={() => setCount(count + 1)}>Track {count}</button>
}
function Workspace({ enabled, renderer = Player }: { enabled: boolean; renderer?: () => React.ReactElement }): React.ReactElement {
  const [count, setCount] = useState(0)
  return <><button onClick={() => setCount(count + 1)}>Workspace {count}</button>{enabled && <PanelContent render={renderer} label="Media" />}</>
}
describe('panel component boundaries', () => {
  it('enables, disables and replaces a hook-using plugin without changing workspace hooks or state', () => {
    const view = render(<Workspace enabled={false} />)
    fireEvent.click(screen.getByText('Workspace 0'))
    view.rerender(<Workspace enabled />)
    fireEvent.click(screen.getByText('Track 0'))
    expect(screen.getByText('Track 1')).toBeTruthy()
    const Replacement = (): React.ReactElement => { useState('extra'); return <Player /> }
    view.rerender(<Workspace enabled renderer={Replacement} />)
    expect(screen.getByText('Workspace 1')).toBeTruthy()
    expect(screen.getByText('Track 0')).toBeTruthy()
    view.rerender(<Workspace enabled={false} />)
    view.rerender(<Workspace enabled />)
    expect(screen.getByText('Workspace 1')).toBeTruthy()
  })
  it('contains render errors and recovers when the plugin is reloaded', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = (): React.ReactElement => { throw new Error('Media failed') }
    const view = render(<Workspace enabled renderer={broken} />)
    expect(screen.getByRole('alert').textContent).toContain('Media failed')
    fireEvent.click(screen.getByText('Workspace 0'))
    expect(screen.getByText('Workspace 1')).toBeTruthy()
    view.rerender(<Workspace enabled />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Track 0')).toBeTruthy()
  })
})
