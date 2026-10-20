import type { PanelId, ZoneAxis, ZoneState } from './model'

export type DockNode = { kind: 'panel'; panel: PanelId }
  | { kind: 'tabs'; panels: PanelId[]; active: PanelId }
  | { kind: 'split'; axis: ZoneAxis; children: DockNode[]; weights: number[] }
export type DockPlacement = 'left' | 'right' | 'top' | 'bottom' | 'tab'
export const dockPanels = (node: DockNode): PanelId[] => node.kind === 'panel' ? [node.panel] : node.kind === 'tabs' ? node.panels : node.children.flatMap(dockPanels)
export const containsPanel = (node: DockNode, panel: PanelId): boolean => dockPanels(node).includes(panel)
export function zoneDockTree(zone: ZoneState): DockNode {
  if (zone.tree) return zone.tree
  if (zone.mode === 'tabs' && zone.order.length) return { kind: 'tabs', panels: [...zone.order], active: zone.active ?? zone.order[0] }
  return { kind: 'split', axis: zone.axis, children: zone.order.map(panel => ({ kind: 'panel', panel })), weights: zone.order.map(panel => zone.weights[panel] ?? 1) }
}
function collapse(node: Extract<DockNode, { kind: 'split' }>): DockNode | null {
  return node.children.length === 0 ? null : node.children.length === 1 ? node.children[0] : node
}
export function removeDockPanel(node: DockNode, panel: PanelId): DockNode | null {
  if (node.kind === 'panel') return node.panel === panel ? null : node
  if (node.kind === 'tabs') {
    const panels = node.panels.filter(id => id !== panel)
    return panels.length === 0 ? null : panels.length === 1 ? { kind: 'panel', panel: panels[0] } : { ...node, panels, active: panels.includes(node.active) ? node.active : panels[0] }
  }
  const children: DockNode[] = [], weights: number[] = []
  node.children.forEach((child, i) => { const next = removeDockPanel(child, panel); if (next) { children.push(next); weights.push(node.weights[i] ?? 1) } })
  return collapse({ ...node, children, weights })
}
export function dockBeside(node: DockNode, target: PanelId, panel: PanelId, placement: DockPlacement): DockNode {
  if (node.kind === 'split') return { ...node, children: node.children.map(child => containsPanel(child, target) ? dockBeside(child, target, panel, placement) : child) }
  if (!containsPanel(node, target)) return node
  if (placement === 'tab') return { kind: 'tabs', panels: [...dockPanels(node), panel], active: panel }
  const added: DockNode = { kind: 'panel', panel }
  const first = placement === 'left' || placement === 'top'
  return { kind: 'split', axis: placement === 'left' || placement === 'right' ? 'row' : 'col', children: first ? [added, node] : [node, added], weights: [1, 1] }
}
export function activeDockPanel(node: DockNode, panel: PanelId): DockNode {
  return node.kind === 'split' ? { ...node, children: node.children.map(child => activeDockPanel(child, panel)) }
    : node.kind === 'tabs' && node.panels.includes(panel) ? { ...node, active: panel } : node
}
export function panelTabGroup(node: DockNode, panel: PanelId): Extract<DockNode, { kind: 'tabs' }> | null {
  if (node.kind === 'tabs') return node.panels.includes(panel) ? node : null
  if (node.kind !== 'split') return null
  for (const child of node.children) { const group = panelTabGroup(child, panel); if (group) return group }
  return null
}
/** Imported trees are bounded and subordinate to the canonical zone membership.
 * Unknown/duplicate leaves cannot mount a second editor or strand a real pane. */
export function normaliseDockTree(raw: unknown, order: PanelId[], open: Record<PanelId, boolean>, axis: ZoneAxis): DockNode | undefined {
  const allowed = new Set(order), seen = new Set<string>()
  let count = 0
  const visit = (raw: unknown, depth: number): DockNode | null => {
    if (!raw || typeof raw !== 'object' || depth > 24 || ++count > 512) return null
    const node = raw as Partial<DockNode> & { panel?: unknown; panels?: unknown; active?: unknown; children?: unknown; weights?: unknown; axis?: unknown }
    const take = (id: unknown): id is string => { if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) return false; seen.add(id); return true }
    if (node.kind === 'panel') return take(node.panel) ? { kind: 'panel', panel: node.panel } : null
    if (node.kind === 'tabs' && Array.isArray(node.panels)) {
      const panels = node.panels.filter(take)
      if (!panels.length) return null
      const active = typeof node.active === 'string' && panels.includes(node.active) && open[node.active] ? node.active : panels.find(id => open[id]) ?? panels[0]
      return panels.length === 1 ? { kind: 'panel', panel: panels[0] } : { kind: 'tabs', panels, active }
    }
    if (node.kind === 'split' && Array.isArray(node.children) && (node.axis === 'row' || node.axis === 'col')) {
      const children: DockNode[] = [], weights: number[] = []
      node.children.forEach((child, i) => { const next = visit(child, depth + 1); if (next) { children.push(next); const weight = Array.isArray(node.weights) ? node.weights[i] : 1; weights.push(typeof weight === 'number' && Number.isFinite(weight) ? Math.max(.05, Math.min(20, weight)) : 1) } })
      return collapse({ kind: 'split', axis: node.axis, children, weights })
    }
    return null
  }
  let tree = visit(raw, 0)
  if (!tree) return undefined
  const missing = order.filter(id => !seen.has(id)).map(panel => ({ kind: 'panel' as const, panel }))
  if (missing.length) tree = { kind: 'split', axis, children: [tree, ...missing], weights: [1, ...missing.map(() => 1)] }
  return tree
}
export function evenDockTree(node: DockNode): DockNode {
  return node.kind === 'split' ? { ...node, children: node.children.map(evenDockTree), weights: node.children.map(() => 1) } : node
}
export function resizeDockTree(node: DockNode, path: number[], before: number, after: number, share: number): DockNode {
  if (node.kind !== 'split') return node
  if (path.length) return { ...node, children: node.children.map((child, i) => i === path[0] ? resizeDockTree(child, path.slice(1), before, after, share) : child) }
  if (!node.children[before] || !node.children[after] || !Number.isFinite(share)) return node
  const weights = [...node.weights], total = (weights[before] ?? 1) + (weights[after] ?? 1), ratio = Math.max(.02, Math.min(.98, share))
  weights[before] = total * ratio; weights[after] = total * (1 - ratio)
  return { ...node, weights }
}

/** The nearest visible split owns a pane's size; a tab belongs to its group. */
export function dockShare(node: DockNode, panel: PanelId, open: Record<PanelId, boolean>): number {
  if (node.kind !== 'split') return 1
  const index = node.children.findIndex(child => containsPanel(child, panel))
  if (index < 0) return 0
  const child = node.children[index]
  if (child.kind === 'split' && child.children.filter(part => dockPanels(part).some(id => open[id])).length > 1) return dockShare(child, panel, open)
  const visible = node.children.map((part, i) => dockPanels(part).some(id => open[id]) ? node.weights[i] ?? 1 : 0)
  return (visible[index] ?? 0) / (visible.reduce((sum, value) => sum + value, 0) || 1)
}
export function setDockShare(node: DockNode, panel: PanelId, share: number, open: Record<PanelId, boolean>): DockNode {
  if (node.kind !== 'split') return node
  const index = node.children.findIndex(child => containsPanel(child, panel))
  if (index < 0) return node
  const child = node.children[index]
  if (child.kind === 'split' && child.children.filter(part => dockPanels(part).some(id => open[id])).length > 1) return { ...node, children: node.children.map((part, i) => i === index ? setDockShare(part, panel, share, open) : part) }
  const others = node.children.reduce((sum, part, i) => sum + (i !== index && dockPanels(part).some(id => open[id]) ? node.weights[i] ?? 1 : 0), 0)
  if (!others) return node
  const ratio = Number.isFinite(share) ? Math.max(.02, Math.min(.98, share)) : .5
  return { ...node, weights: node.weights.map((weight, i) => i === index ? others * ratio / (1 - ratio) : weight) }
}
export function describeDockTree(node: DockNode, label: (id: PanelId) => string, open: Record<PanelId, boolean>): string {
  if (node.kind === 'panel') return `${label(node.panel)}${open[node.panel] ? '' : ' (closed)'}`
  if (node.kind === 'tabs') return `tabs [${node.panels.map(id => `${label(id)}${open[id] ? '' : ' (closed)'}`).join(', ')}], showing ${label(node.active)}`
  return `${node.axis === 'row' ? 'left/right' : 'top/bottom'} [${node.children.map(child => describeDockTree(child, label, open)).join('; ')}]`
}
