// The other half of the panel registry: what each panel actually renders.
//
// Split from panel-meta.ts on purpose — see the header there. Only the render
// path imports this file, so nothing that merely reasons about the layout ends
// up importing Monaco or MapLibre.

import React from 'react'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { Console } from '@/components/console/Console'
import { EnvironmentPanel } from '@/components/environment/EnvironmentPanel'
import { PackagePanel } from '@/components/packages/PackagePanel'
import { DatabasePanel } from '@/components/database/DatabasePanel'
import { SpatialEditor } from '@/components/spatial/SpatialEditor'
import { PlottingPanel } from '@/components/plotting/PlottingPanel'
import { AiChatPanel } from '@/components/ai/AiChatPanel'
import { HelpPanel } from '@/components/help/HelpPanel'
import { pluginPanelRender, type PanelRender } from './panel-render'
import type { PanelId } from './model'

const BUILTIN_RENDERERS: Record<PanelId, PanelRender> = {
  environment: () => <EnvironmentPanel />,
  packages: () => <PackagePanel />,
  databases: () => <DatabasePanel />,
  editor: () => <CodeEditor />,
  console: () => <Console />,
  plots: () => <PlottingPanel />,
  spatial: () => <SpatialEditor />,
  ai: () => <AiChatPanel />,
  help: () => <HelpPanel />,
}

/** What to draw for a panel, or undefined if nothing claims it.
 *
 *  Shipped renderers first, so a plugin can never substitute its own component
 *  for the map even if it somehow got its metadata registered. A panel with
 *  metadata but no renderer is possible only mid-reload; `normalize` drops it
 *  before the next render. */
export function panelRender(id: PanelId): PanelRender | undefined {
  return BUILTIN_RENDERERS[id] ?? pluginPanelRender(id)
}

// `registerPluginPanels`, `PluginPanelDef` and `PanelRender` deliberately are
// NOT re-exported from here: the plugin loader must import them from
// panel-render.ts, which has no React in it. A convenience re-export would put
// this file — and therefore Monaco — back on the loader's import path.
