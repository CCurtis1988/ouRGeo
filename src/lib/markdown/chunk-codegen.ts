// Real R code for the two ouRGeo chunk actions.
//
// "Chunk: current map" and "Chunk: export current plot" used to insert
// scaffolding — a labelled fence with a placeholder body — which put the burden
// of writing the map code back on the user. They now emit the same code the
// Spatial Editor's Export dialogs emit, generated from the layers, symbology,
// view and annotations that are on the map right now.
//
// This is the whole point of the "ouRGeo extras" ribbon group: a chunk that
// reproduces what the user is looking at, echoed as R they can read and re-run.
//
// The generators themselves are shared with the Export dialogs
// (tmap-codegen / ggplot-codegen), so a map written into a document and a map
// exported from the dialog are the same code.

import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useMarkdownSettingsStore, type MapChunkEngine } from '@/store/markdownSettings'
import { mapCodeParams, hasVisibleLayers } from '@/lib/map-export'
import { generateTmapCode } from '@/lib/tmap-codegen'
import { generateGgplotCode } from '@/lib/ggplot-codegen'
import type { MdActionDef } from './actions'

export { hasVisibleLayers } from '@/lib/map-export'

/** The concrete generator to use, resolving `auto` against the export dialogs. */
export function resolveMapEngine(
  setting: MapChunkEngine = useMarkdownSettingsStore.getState().mapChunkEngine,
): 'tmap' | 'ggplot' {
  if (setting === 'auto') return useSpatialSettingsStore.getState().lastExportMode
  return setting
}

export interface MapChunkOptions {
  /** Chunk label — also the figure filename for the export variant. */
  label: string
  /** Override the engine; defaults to the resolved setting. */
  engine?: 'tmap' | 'ggplot'
  /** Also write the figure to `figures/<label>.png` and reference it. */
  saveFigure?: boolean
}

/**
 * A chunk broken into its parts.
 *
 * Structured rather than pre-rendered markdown because Visual mode needs the
 * header and the code separately — it builds a ProseMirror code_block node, not
 * a string of fences.
 */
export interface MapChunkParts {
  /** Everything between the braces of the opening fence. */
  header: string
  code: string
  /** Markdown that follows the chunk (the figure reference, for `saveFigure`). */
  after?: string
}

/**
 * The current map as a chunk. Returns null when nothing is on the map, so the
 * caller can fall back to the static scaffolding rather than emitting a plot of
 * nothing.
 */
export function buildMapChunkParts(opts: MapChunkOptions): MapChunkParts | null {
  if (!hasVisibleLayers()) return null
  const engine = opts.engine ?? resolveMapEngine()
  const params = mapCodeParams()

  if (!opts.saveFigure) {
    const code = engine === 'tmap' ? generateTmapCode(params) : generateGgplotCode(params)
    return {
      header: `r ${opts.label}, echo=FALSE, fig.width=7, fig.height=5`,
      code: code.trimEnd(),
    }
  }

  // The figure variant writes a PNG next to the document and references it, so
  // the knitted output survives being moved somewhere R isn't. Both generators
  // already know how to emit their own save call from `exportOpts`.
  const path = `figures/${opts.label}.png`
  const exportOpts = {
    path, width: 7, height: 5, units: 'in' as const, dpi: 150, format: 'png' as const,
  }
  const code = engine === 'tmap'
    ? generateTmapCode({ ...params, exportOpts })
    : generateGgplotCode({ ...params, exportOpts })
  return {
    // include=FALSE, not echo=FALSE: this chunk's only job is to WRITE the file
    // that the `![](…)` below references. Letting it also render inline would
    // put the same figure in the knitted document twice.
    header: `r ${opts.label}, include=FALSE`,
    code: 'dir.create("figures", showWarnings = FALSE)\n' + code.trimEnd(),
    after: `![](${path})`,
  }
}

/** Render chunk parts as the markdown Source mode inserts. */
export function mapChunkMarkdown(parts: MapChunkParts): string {
  const block = '```{' + parts.header + '}\n' + parts.code + '\n```'
  return parts.after ? `${block}\n\n${parts.after}` : block
}

/** Which variant an action wants, or null if it isn't a generated chunk. */
export function chunkVariantFor(action: MdActionDef): boolean | null {
  if (action.dynamic === 'map') return false
  if (action.dynamic === 'plot') return true
  return null
}

/**
 * Chunk-body generator for `resolveActionBody`.
 *
 * Kept here rather than in actions.ts so the action catalog stays data-only and
 * store-free — that is what lets apply-source.ts be tested with no app running.
 */
export function generateChunkBody(action: MdActionDef, label: string): string | null {
  const saveFigure = chunkVariantFor(action)
  if (saveFigure === null) return null
  const parts = buildMapChunkParts({ label, saveFigure })
  return parts ? mapChunkMarkdown(parts) : null
}
