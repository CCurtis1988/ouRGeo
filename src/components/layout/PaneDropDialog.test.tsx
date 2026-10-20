// @vitest-environment jsdom
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { defaultLayout, dockPanel, type LayoutState } from '@/lib/layout/model'
import { BUILTIN_PANEL_INFO } from '@/lib/layout/panel-meta'
vi.mock('@/store/layout', async () => {
  const { create } = await import('zustand')
  return { useLayoutStore: create<{ layout: LayoutState; dragEnabled: boolean; dockPanel: (source: string, target: string, placement: Parameters<typeof dockPanel>[3]) => void }>((set, get) => ({ layout: defaultLayout([...BUILTIN_PANEL_INFO]), dragEnabled: true, dockPanel: (source, target, placement) => set({ layout: dockPanel(get().layout, source, target, placement) }) })) }
})
import { useLayoutStore } from '@/store/layout'
import { usePanelDragStore } from '@/store/panelDrag'
import { PaneDropDialog } from './PaneDropDialog'
import { startPanelDrag } from './panel-drag'
let original: LayoutState
beforeEach(() => {
  original = defaultLayout([...BUILTIN_PANEL_INFO]); original.open.console = true
  useLayoutStore.setState({ layout: original, dragEnabled: true })
  usePanelDragStore.setState({ panel: null, pending: null })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('CSS', { escape: (value: string) => value })
})
function offer() {
  render(<><div data-panel-id="editor" /><PaneDropDialog /></>)
  act(() => usePanelDragStore.getState().offer({ panel: 'console', target: 'editor', x: 200, y: 100, layout: original }))
}
it('previews either split direction without moving anything until a section is chosen', async () => {
  offer()
  fireEvent.click(screen.getByRole('button', { name: /Vertical/ }))
  expect(useLayoutStore.getState().layout).toBe(original)
  expect(screen.getByRole('button', { name: 'Place R console left' })).toHaveAttribute('data-ourgeo-id', 'layout.drop.left')
  expect(screen.getByRole('button', { name: 'Place R console right' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Back to arrangement choices' }))
  fireEvent.click(screen.getByRole('button', { name: /Horizontal/ }))
  expect(screen.getByRole('button', { name: 'Place R console top' })).toHaveAttribute('data-ourgeo-id', 'layout.drop.top')
  fireEvent.click(screen.getByRole('button', { name: 'Place R console bottom' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const tree = useLayoutStore.getState().layout.zones.center.tree!
  expect(tree.kind === 'split' && tree.axis).toBe('col')
})
it('cancels without a layout change and discards a proposal after another arrangement is applied', async () => {
  offer()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel pane move' }))
  expect(useLayoutStore.getState().layout).toBe(original)
  act(() => usePanelDragStore.getState().offer({ panel: 'console', target: 'editor', x: 200, y: 100, layout: original }))
  act(() => useLayoutStore.setState({ layout: { ...original } }))
  await waitFor(() => expect(usePanelDragStore.getState().pending).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('commits a tab group in one choice', () => {
  offer()
  fireEvent.click(screen.getByRole('button', { name: /Tab group/ }))
  const tree = useLayoutStore.getState().layout.zones.center.tree!
  expect(tree.kind === 'tabs' && tree.panels).toEqual(['editor', 'console'])
  expect(tree.kind === 'tabs' && tree.active).toBe('console')
})
it('offers the drop once on real mouse release and Escape cancels an in-flight drag', () => {
  const overlay = document.createElement('div'); overlay.dataset.dropPanel = 'editor'; document.body.append(overlay)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => overlay })
  const setDrag = (panel: string | null) => panel ? usePanelDragStore.getState().begin(panel) : usePanelDragStore.getState().end()
  const down = { button: 0, clientX: 1, clientY: 1, preventDefault: vi.fn() } as unknown as React.MouseEvent
  startPanelDrag('console', setDrag)(down)
  fireEvent.mouseMove(window, { clientX: 20, clientY: 20 }); fireEvent.mouseUp(window, { clientX: 30, clientY: 30 })
  expect(usePanelDragStore.getState().pending?.target).toBe('editor')
  expect(useLayoutStore.getState().layout).toBe(original)
  usePanelDragStore.getState().cancel()
  startPanelDrag('console', setDrag)(down)
  fireEvent.mouseMove(window, { clientX: 20, clientY: 20 }); fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.mouseUp(window, { clientX: 30, clientY: 30 })
  expect(usePanelDragStore.getState().pending).toBeNull()
  expect(document.body.style.cursor).toBe('')
  overlay.remove()
})
