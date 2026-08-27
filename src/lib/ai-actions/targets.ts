// Controls the assistant can point at.
//
// A closed catalogue, not a free-form selector: a model that could pass any CSS
// selector would sooner or later point at nothing and say "here" to an empty
// corner of the screen. Every id here corresponds to a `data-ourgeo-id`
// attribute in the source, which a test verifies — a renamed button breaks the
// test rather than the tutorial.

export interface UiTarget {
  id: string
  /** What the user sees, so the assistant can name it in prose. */
  label: string
  /** Where it is, for the model's sense of the layout. */
  where: string
}

export const UI_TARGETS: UiTarget[] = [
  // Top toolbar, left to right.
  { id: 'toolbar.environment', label: 'Toggle Environment', where: 'top toolbar' },
  { id: 'toolbar.packages', label: 'Toggle Packages', where: 'top toolbar' },
  { id: 'toolbar.openFile', label: 'Open File (Ctrl+O)', where: 'top toolbar' },
  { id: 'toolbar.save', label: 'Save (Ctrl+S)', where: 'top toolbar' },
  { id: 'toolbar.saveAs', label: 'Save As', where: 'top toolbar' },
  { id: 'toolbar.loadData', label: 'Load Data', where: 'top toolbar' },
  { id: 'toolbar.databases', label: 'Toggle Database Connections', where: 'top toolbar' },
  { id: 'toolbar.dataConnector', label: 'Data Connector', where: 'top toolbar' },
  { id: 'toolbar.toolbox', label: 'Toolbox', where: 'top toolbar' },
  { id: 'toolbar.ai', label: 'AI Assistant', where: 'top toolbar' },
  { id: 'toolbar.record', label: 'Record Console', where: 'top toolbar' },
  { id: 'toolbar.spatial', label: 'Toggle Spatial Editor', where: 'top toolbar' },
  { id: 'toolbar.plots', label: 'Toggle Plotting Preview', where: 'top toolbar' },
  { id: 'toolbar.help', label: 'Help', where: 'top toolbar' },
  { id: 'toolbar.settings', label: 'Settings', where: 'top toolbar, far right' },

  // Spatial editor ribbon.
  { id: 'map.addFeatures', label: 'Add Features', where: 'spatial editor ribbon' },
  { id: 'map.contents', label: 'Contents', where: 'spatial editor ribbon' },
  { id: 'map.select', label: 'Selection mode', where: 'spatial editor ribbon' },
  { id: 'map.basemap', label: 'Change basemap', where: 'spatial editor ribbon' },
  { id: 'map.settings', label: 'Map Settings', where: 'spatial editor ribbon' },
  { id: 'map.export', label: 'Export', where: 'spatial editor ribbon' },
  { id: 'map.saveEdits', label: 'Save Edits', where: 'spatial editor ribbon, when edits are staged' },
  { id: 'map.canvas', label: 'The map itself', where: 'spatial editor' },

  // Editor toolbar and console.
  { id: 'editor.runLine', label: 'Line (Ctrl+Enter)', where: 'editor toolbar' },
  { id: 'editor.runAll', label: 'Run All', where: 'editor toolbar' },
  { id: 'editor.language', label: 'Document type selector', where: 'editor toolbar' },
  { id: 'editor.newTab', label: 'New tab', where: 'tab bar, right end' },
  { id: 'console.workingDir', label: 'Working directory', where: 'console header' },
  { id: 'console.clear', label: 'Clear console', where: 'console header, right' },

  // Project.
  { id: 'project.dropdown', label: 'Project menu', where: 'top toolbar, far right' },
]

export const TARGET_IDS: ReadonlySet<string> = new Set(UI_TARGETS.map((t) => t.id))

export function findTarget(id: string): UiTarget | undefined {
  return UI_TARGETS.find((t) => t.id === id)
}

/** The catalogue as the model sees it in an error or a listing. */
export function targetListing(): string {
  return UI_TARGETS.map((t) => `${t.id} — ${t.label} (${t.where})`).join('\n')
}
