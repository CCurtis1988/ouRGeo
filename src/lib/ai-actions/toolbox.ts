// The Toolbox: 87 geoprocessing tools.
//
// Deliberately NOT in the action registry. A registry action has fixed params;
// a toolbox tool's fields depend on the dataset chosen for it — its columns,
// its bands, whether it is a database proxy. So the toolbox keeps its own pair
// of AI tools: search/describe, then run.
//
// The run path mirrors ToolForm.handleRun (toolboxBuilders.tsx): build the code
// from the tool's own `buildCode`, echo it, execute it, open the result in the
// Data Viewer. `dryRun` stops before executing, which is what a tutorial wants —
// "this is the R that button would produce" — and what makes the toolbox useful
// even with Autopilot off.

import { CATEGORIES, ALL_TOOLS, type ToolDef, type Values, type DatasetMeta } from '@/components/toolbox/tools'
import { rClient } from '@/lib/r-client'
import { useEnvironmentStore } from '@/store/environment'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'

export function findTool(id: string): ToolDef | undefined {
  const want = id.trim().toLowerCase()
  return ALL_TOOLS.find((t) => t.id === id)
    ?? ALL_TOOLS.find((t) => t.id.toLowerCase() === want)
    ?? ALL_TOOLS.find((t) => t.label.toLowerCase() === want)
}

/** Category label for a tool, for listings. */
function categoryOf(tool: ToolDef): string {
  return CATEGORIES.find((c) => c.tools.some((t) => t.id === tool.id))?.label ?? ''
}

/** Search by id, label, description and category. */
export function searchTools(query: string, category?: string): ToolDef[] {
  const q = query.trim().toLowerCase()
  const cat = (category ?? '').trim().toLowerCase()
  return ALL_TOOLS.filter((t) => {
    if (cat && !categoryOf(t).toLowerCase().includes(cat)) return false
    if (!q) return true
    return t.id.toLowerCase().includes(q)
      || t.label.toLowerCase().includes(q)
      || t.description.toLowerCase().includes(q)
  })
}

/** One line per tool, for the search result. */
export function toolLine(tool: ToolDef): string {
  return `${tool.id} — ${tool.label} [${categoryOf(tool)}]: ${tool.description}`
}

/** Field-by-field description of one tool, so the model can fill the form. */
export function describeTool(tool: ToolDef): string {
  const lines = [
    `${tool.id} — ${tool.label}`,
    `Category: ${categoryOf(tool)}`,
    tool.description,
    tool.output === 'raster' ? 'Produces a raster (SpatRaster), so no Data Viewer tab.' : '',
    '',
    'Fields (pass these as `values`, keyed by id):',
  ].filter(Boolean)

  for (const f of tool.fields) {
    const bits: string[] = [`  ${f.id} (${f.type})`]
    if (f.type === 'dataset') {
      bits.push(`— an R object name${f.filter && f.filter !== 'any' ? ` (${f.filter} only)` : ''}`)
      if (f.optional) bits.push('[optional]')
    } else if (f.type === 'column') {
      bits.push(`— a column of the dataset in "${f.datasetField}"${f.multi ? ', comma-separated for several' : ''}`)
    } else if (f.type === 'band') {
      bits.push(`— a band number of the raster in "${f.datasetField}"`)
    } else if (f.type === 'select') {
      bits.push(`— one of: ${f.options.map((o) => o.value).join(', ')}`)
    } else if (f.type === 'output-name') {
      bits.push('— name for the R object this creates')
    } else if (f.type === 'checkbox') {
      bits.push('— "TRUE" or "FALSE"')
    } else if (f.type === 'filter-conditions' || f.type === 'arrange-columns') {
      bits.push('— a structured builder; not settable from here, use execute_r_code for this tool')
    }
    bits.push(`: ${f.label}`)
    lines.push(bits.join(' '))
  }
  return lines.join('\n')
}

/** Dataset metadata the way ToolboxDialog assembles it, so `buildCode` can
 *  decide whether a database-backed input needs collect(). */
function datasetMetaFor(tool: ToolDef, values: Values): DatasetMeta {
  const meta: DatasetMeta = {}
  const envs = useEnvironmentStore.getState().environments
  for (const f of tool.fields) {
    if (f.type !== 'dataset') continue
    const name = values[f.id]
    if (!name) continue
    const obj = envs.filter((e) => !e.isSearchPath)
      .flatMap((e) => e.objects).find((o) => o.name === name)
    if (!obj) continue
    meta[f.id] = { isDbTbl: obj.class.includes('tbl_'), cls: obj.class }
  }
  return meta
}

export interface ToolRunResult {
  ok: boolean
  message: string
  code: string
}

/** Build a tool's R, and unless `dryRun`, run it. */
export async function runToolboxTool(
  tool: ToolDef, values: Values, dryRun: boolean,
): Promise<ToolRunResult> {
  // Missing dataset fields are the common failure and produce nonsense R
  // rather than an error, so catch them before generating anything.
  const missing = tool.fields
    .filter((f) => f.type === 'dataset' && !('optional' in f && f.optional) && !values[f.id])
    .map((f) => f.id)
  if (missing.length > 0) {
    return {
      ok: false,
      code: '',
      message: `"${tool.label}" needs ${missing.map((m) => `"${m}"`).join(', ')}. ` +
        'Call toolbox_tools with this toolId to see every field.',
    }
  }

  let code: string
  try {
    code = tool.buildCode(values, datasetMetaFor(tool, values))
  } catch (e) {
    return { ok: false, code: '', message: `Could not build the code: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (dryRun) {
    return { ok: true, code, message: `The R "${tool.label}" would run (not executed):\n\n${code}` }
  }

  const session = useSessionStore.getState()
  session.addConsoleEntry('input', code)
  session.addInputHistory(code)
  const res = await rClient.execute(code)
  if (res.output) session.addConsoleEntry('output', res.output)
  if (!res.success) {
    session.addConsoleEntry('error', res.error ?? '')
    return { ok: false, code, message: `"${tool.label}" errored: ${res.error ?? 'unknown error'}\n\n${code}` }
  }

  // Open the result the way the dialog does — rasters excepted, they are not tabular.
  const outField = tool.fields.find((f) => f.type === 'output-name')
  const outputName = outField ? values[outField.id] : ''
  if (outputName && tool.output !== 'raster') {
    useEditorStore.getState().addObjectTab(outputName, '.GlobalEnv', 'data.frame', outputName, 'data-viewer')
  }
  return {
    ok: true,
    code,
    message: `Ran "${tool.label}".` +
      (outputName
        ? ` Created \`${outputName}\`${tool.output === 'raster' ? '' : ' and opened it in the Data Viewer'}.`
        : '') +
      (res.output ? `\n\n${res.output}` : ''),
  }
}

/** Category listing, for the model's first orientation. */
export function categoryListing(): string {
  return CATEGORIES.map((c) => `${c.label} (${c.tools.length} tools)`).join('\n')
}
