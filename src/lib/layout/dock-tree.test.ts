import { expect, it } from 'vitest'
import { defaultLayout, dockPanel, normalize, dropPanel, movePanel, setActivePanel, setPanelOpen, setPanelShare, shareOf, forgetWeights, describeLayout } from './model'
import { BUILTIN_PANEL_INFO } from './panel-meta'
import { dockPanels, panelTabGroup, resizeDockTree, zoneDockTree } from './dock-tree'
const initial = () => {
  let layout = defaultLayout([...BUILTIN_PANEL_INFO])
  for (const id of ['console', 'terminal', 'environment', 'packages', 'plots']) layout = setPanelOpen(layout, id, true)
  return normalize(layout, [...BUILTIN_PANEL_INFO])
}
const settle = (layout: ReturnType<typeof initial>) => normalize(layout, [...BUILTIN_PANEL_INFO])
it('supports every side and leaves unrelated zones untouched', () => {
  const original = initial()
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const next = settle(dockPanel(original, 'console', 'editor', side))
    const root = next.zones.center.tree!
    expect(root.kind).toBe('split')
    if (root.kind !== 'split') continue
    expect(root.axis).toBe(side === 'left' || side === 'right' ? 'row' : 'col')
    expect(dockPanels(root)).toEqual(side === 'left' || side === 'top' ? ['console', 'editor'] : ['editor', 'console'])
    expect(next.zones.left).toEqual(original.zones.left)
    expect(next.zones.right).toEqual(original.zones.right)
    expect(original.zones.bottom.order).toContain('console')
  }
})
it('nests an opposite-axis split around its target while keeping the neighbouring pane', () => {
  const row = settle(dockPanel(initial(), 'console', 'editor', 'right'))
  const mixed = settle(dockPanel(row, 'environment', 'editor', 'bottom'))
  const root = mixed.zones.center.tree!
  expect(root.kind === 'split' && root.axis).toBe('row')
  if (root.kind !== 'split') return
  expect(root.children[1]).toEqual({ kind: 'panel', panel: 'console' })
  expect(root.children[0].kind === 'split' && root.children[0].axis).toBe('col')
  expect(new Set(dockPanels(root)).size).toBe(3)
})
it('joins and splits existing tab groups without pulling their other tabs apart', () => {
  let layout = settle(dockPanel(initial(), 'console', 'editor', 'tab'))
  layout = settle(dockPanel(layout, 'environment', 'console', 'tab'))
  expect(panelTabGroup(layout.zones.center.tree!, 'editor')?.panels).toEqual(['editor', 'console', 'environment'])
  expect(panelTabGroup(layout.zones.center.tree!, 'editor')?.active).toBe('environment')
  layout = settle(setActivePanel(layout, 'editor'))
  expect(panelTabGroup(layout.zones.center.tree!, 'console')?.active).toBe('editor')
  layout = settle(dockPanel(layout, 'packages', 'editor', 'left'))
  expect(panelTabGroup(layout.zones.center.tree!, 'editor')?.panels).toEqual(['editor', 'console', 'environment'])
})
it('can extract a tab from its own group and cleans up removed or closed panes', () => {
  const tabs = settle(dockPanel(initial(), 'console', 'editor', 'tab'))
  const split = settle(dockPanel(tabs, 'console', 'editor', 'bottom'))
  expect(dockPanels(split.zones.center.tree!)).toEqual(['editor', 'console'])
  const closed = settle(setPanelOpen(tabs, 'console', false))
  expect(panelTabGroup(closed.zones.center.tree!, 'editor')?.active).toBe('editor')
  const moved = settle(movePanel(split, 'console', 'left'))
  expect(dockPanels(moved.zones.center.tree!)).toEqual(['editor'])
  expect(moved.zones.left.order).toContain('console')
  const removed = dropPanel(split, 'console')
  expect(dockPanels(removed.zones.center.tree!)).toEqual(['editor'])
})
it('normalises corrupt or duplicate trees without losing canonical panels', () => {
  const layout = initial()
  layout.zones.center.order.push('console')
  layout.zones.bottom.order = layout.zones.bottom.order.filter(id => id !== 'console')
  layout.zones.center.tree = { kind: 'split', axis: 'row', children: [{ kind: 'panel', panel: 'editor' }, { kind: 'panel', panel: 'editor' }, { kind: 'panel', panel: 'missing-plugin' }], weights: [0, NaN, 1000] }
  const next = settle(layout)
  expect(dockPanels(next.zones.center.tree!)).toEqual(['editor', 'console'])
  expect(next.open.editor).toBe(true)
})
it('preserves group structure through serialisation, while resetting session weights', () => {
  const layout = settle(dockPanel(initial(), 'console', 'editor', 'right'))
  layout.zones.center.tree = resizeDockTree(layout.zones.center.tree!, [], 0, 1, .7)
  const reopened = settle(JSON.parse(JSON.stringify(forgetWeights(layout))))
  expect(dockPanels(reopened.zones.center.tree!)).toEqual(['editor', 'console'])
  expect(reopened.zones.center.tree!.kind === 'split' && reopened.zones.center.tree!.weights).toEqual([1, 1])
  expect(describeLayout(reopened, [...BUILTIN_PANEL_INFO], {})).toContain('left/right [editor; console]')
})
it('sizes the nearest split and refuses self-drops without mutation', () => {
  const layout = settle(dockPanel(initial(), 'console', 'editor', 'right'))
  const sized = settle(setPanelShare(layout, 'console', .7))
  expect(shareOf(sized, 'console')).toBeCloseTo(.7)
  expect(dockPanel(layout, 'editor', 'editor', 'tab')).toBe(layout)
  expect(zoneDockTree(initial().zones.bottom).kind).toBe('tabs')
})
