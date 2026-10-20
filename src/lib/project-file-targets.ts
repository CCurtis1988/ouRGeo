// How R names a project file. Pure, and shared: main resolves the names R
// sends over the project-files bridge, and the renderer builds the same names
// into the code an export dialog echoes, so the two cannot disagree about what
// "figures/map.png" means.
//
// A project file is named the way the Project Files pane shows it: its display
// name, optionally after its logical folder. Logical folders classify, they do
// not nest, so "figures/map.png" is folder "figures" + name "map.png" — never a
// path into the bundle. Embedded names are unique across the library (the
// import de-duplicates them), so a bare name normally finds one file; a linked
// file can also be named by its relative path inside its folder.
import type { ProjectFileCatalogue, ProjectFileEntry } from './project-files'

export interface ProjectFileTarget { folder: string; name: string }

// A code-point test rather than /[\0-\x1f]/, which the linter rightly flags.
const CONTROL = { test: (value: string): boolean => [...value].some(c => c.charCodeAt(0) < 32) }

/** Split "folder/sub/name.csv" into its logical folder and display name.
 *  Refuses what could not round-trip as a display name or folder. */
export function parseProjectFileTarget(target: string, folder?: string): ProjectFileTarget {
  if (typeof target !== 'string' || !target.trim()) throw new Error('Name the project file, for example "tables/summary.csv".')
  const normalised = target.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '')
  if (CONTROL.test(normalised) || normalised.length > 740) throw new Error('Use a project file name without control characters, under 740 characters.')
  const parts = normalised.split('/').filter(Boolean)
  if (parts.some(part => part === '..' || part === '.')) throw new Error(`"${target}" steps outside the project. Name a file such as "figures/map.png"; folders are labels, not locations on disk.`)
  const name = parts.pop() ?? ''
  if (!name || name.length > 240) throw new Error('Give the file a name of up to 240 characters, ending with its extension (".csv", ".png").')
  const prefix = parts.join('/')
  const explicit = folder?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') ?? ''
  if (explicit.split('/').some(part => part === '..') || CONTROL.test(explicit)) throw new Error('Choose a logical folder name without ".." or control characters.')
  const combined = [explicit, prefix].filter(Boolean).join('/')
  if (combined.length > 500) throw new Error('Keep the logical folder below 500 characters.')
  return { folder: combined, name }
}

export const formatProjectFileTarget = (target: ProjectFileTarget): string => target.folder ? `${target.folder}/${target.name}` : target.name

const same = (a: string, b: string): boolean => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

/** Where a file lives, in the words R uses for `location =`: "project" for an
 *  embedded original, otherwise the linked folder's label. */
export function projectFileLocationName(file: ProjectFileEntry, catalogue: ProjectFileCatalogue): string {
  if (!file.storage) return 'project'
  return catalogue.linkedFolders?.find(folder => folder.id === file.storage!.folderId)?.name ?? 'linked'
}

/** Every file a name could mean. Exact display names first; then folder +
 *  name; then a linked file's relative path. Ambiguity is the caller's to
 *  report, because only it knows whether it is reading or replacing. */
export function matchProjectFiles(catalogue: ProjectFileCatalogue, target: string, location?: string): ProjectFileEntry[] {
  const parsed = parseProjectFileTarget(target)
  const files = catalogue.files.filter(file => !location || same(projectFileLocationName(file, catalogue), location))
  const whole = formatProjectFileTarget(parsed)
  const byName = files.filter(file => same(file.name, whole))
  if (byName.length) return byName
  const byFolder = files.filter(file => same(file.name, parsed.name) && (!parsed.folder || same(file.folder, parsed.folder)))
  if (byFolder.length) return byFolder
  return files.filter(file => file.storage && same(file.storage.relativePath.replace(/\\/g, '/'), whole))
}

/** One file, or an error that says how to get one. */
export function resolveProjectFile(catalogue: ProjectFileCatalogue, target: string, location?: string): ProjectFileEntry {
  const matches = matchProjectFiles(catalogue, target, location)
  if (matches.length === 1) return matches[0]
  if (!matches.length) {
    const near = catalogue.files.filter(file => file.name.toLowerCase().includes(parseProjectFileTarget(target).name.toLowerCase().replace(/\.[^.]+$/, ''))).slice(0, 5)
    throw new Error(`No project file is named "${target}"${location ? ` in ${location}` : ''}.${near.length ? ` Did you mean ${near.map(file => `"${formatProjectFileTarget(file)}"`).join(', ')}?` : ''} Run ourgeo_project_files() to list them.`)
  }
  const places = matches.map(file => `"${formatProjectFileTarget(file)}" (${projectFileLocationName(file, catalogue)})`)
  throw new Error(`"${target}" names ${matches.length} project files: ${places.join(', ')}. Add location = "project" or the linked folder's name.`)
}

/** The embedded file a write of `target` would replace, by the rule
 *  `ProjectFileLibrary.put` applies: the same display name, in any folder.
 *  The export dialogs ask before replacing, so they must ask about exactly the
 *  file the library will overwrite — not the one a folder-qualified lookup
 *  would find. A linked file of that name is not replaced (put refuses it). */
export function replacedProjectFile(catalogue: ProjectFileCatalogue, target: string): ProjectFileEntry | undefined {
  const { name } = parseProjectFileTarget(target)
  return catalogue.files.find(file => !file.storage && same(file.name, name))
}
