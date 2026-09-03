// Where a plugin's panel renderers live.
//
// React-free on purpose — it holds functions that RETURN React elements, and a
// type-only import of React is erased at compile time. The plugin loader has to
// register panels, and if it reached them through panels.tsx it would pull in
// CodeEditor, then Monaco, which touches `window` at import time and killed
// eight node-environment test files the first time this import existed.
//
// panels.tsx owns the shipped renderers and consults this for the rest.

import type { ReactElement } from 'react'
import { registerPluginPanelInfo, type PanelInfo } from './panel-meta'
import type { PanelId } from './model'

export type PanelRender = () => ReactElement

/** A plugin's panel: the metadata, plus what to draw. */
export interface PluginPanelDef extends PanelInfo {
  render: PanelRender
}

let pluginRenderers: Record<PanelId, PanelRender> = {}

export function pluginPanelRender(id: PanelId): PanelRender | undefined {
  return pluginRenderers[id]
}

/**
 * Register a plugin's panels — metadata and renderer together, in one pass, so
 * the two halves can never be registered separately and disagree.
 *
 * A panel whose id was refused by the metadata registry (because it shadowed a
 * shipped one) does not get its renderer either.
 */
export function registerPluginPanels(panels: PluginPanelDef[]): void {
  registerPluginPanelInfo(panels)
  const next: Record<PanelId, PanelRender> = {}
  for (const p of panels) next[p.id] = p.render
  pluginRenderers = next
}
