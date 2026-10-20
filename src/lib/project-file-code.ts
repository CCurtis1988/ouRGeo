// The R an export dialog writes when its destination is Project Files.
//
// Every dialog that saves a file emits the same R the user would type, with
// one change: the path argument becomes `ourgeo_project_path("figures/map.png")`
// (r/lib/project-files.R). The writer stays the writer — `write.csv`, `ggsave`,
// `tmap_save` — so the echoed line is ordinary R that runs in the console, in a
// chunk, and when the document is knitted, and a user who reads it learns the
// one function they need to do the same from a script.
import { rStr } from './r-identifier'
import { formatProjectFileTarget, parseProjectFileTarget } from './project-file-targets'

/** Where a dialog saves. A union, not a flag: the third destination (a linked
 *  folder by name, say) must fail to compile everywhere a path is emitted. */
export type FileDestination =
  | { kind: 'disk'; path: string }
  | { kind: 'project'; name: string }

/** "figures" + "map.png" → "figures/map.png", validated as R will validate it. */
export function projectFileName(folder: string, file: string): string {
  return formatProjectFileTarget(parseProjectFileTarget(file, folder))
}

export const projectPathCall = (name: string): string => `ourgeo_project_path(${rStr(name)})`
export const projectFileCall = (name: string): string => `ourgeo_project_file(${rStr(name)})`

/** The R expression for a writer's file argument. */
export function destinationExpr(destination: FileDestination): string {
  return destination.kind === 'disk' ? rStr(destination.path.replace(/\\/g, '/')) : projectPathCall(destination.name)
}

/** Words for the result line a dialog shows after saving. */
export function destinationLabel(destination: FileDestination): string {
  return destination.kind === 'disk' ? destination.path : `Project Files: ${destination.name}`
}

export interface PlotSaveOptions { width: number; height: number; units: 'in' | 'cm' | 'px'; dpi: number; plotId?: string | null }

/** The plot-export dialog's R: replay the plot on screen into a file. */
export function savePlotCode(destination: FileDestination, options: PlotSaveOptions): string {
  const args = [destinationExpr(destination), `width = ${options.width}`, `height = ${options.height}`, `units = ${rStr(options.units)}`, `dpi = ${options.dpi}`]
  if (options.plotId) args.push(`plot = ${rStr(options.plotId)}`)
  return `ourgeo_save_plot(${args.join(', ')})`
}

export type TableFormat = 'csv' | 'txt' | 'xlsx'
export const TABLE_EXTENSION: Record<TableFormat, string> = { csv: 'csv', txt: 'txt', xlsx: 'xlsx' }

/** Write a data frame expression in one of the table formats. */
export function writeTableCode(expr: string, format: TableFormat, destination: FileDestination): string {
  const file = destinationExpr(destination)
  switch (format) {
    case 'csv': return `write.csv(${expr}, ${file}, row.names = FALSE)`
    case 'txt': return `write.table(${expr}, ${file}, sep = "\\t", row.names = FALSE, quote = FALSE)`
    case 'xlsx': return `writexl::write_xlsx(${expr}, ${file})`
  }
}
