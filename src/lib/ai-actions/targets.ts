// Controls the assistant can point at.
//
// A closed catalogue, not a free-form selector: a model that could pass any CSS
// selector would sooner or later point at nothing and say "here" to an empty
// corner of the screen. Every id here corresponds to a `data-ourgeo-id`
// attribute in the source, which a test verifies — a renamed button breaks the
// test rather than the tutorial.
//
// The toolbar half is DERIVED from `lib/layout/toolbar.ts` rather than written
// out again. It used to be written out again, and that was fine only for as
// long as the buttons were fourteen literal JSX blocks: now that the toolbar is
// data, a hand-kept copy of it here would be a second list to forget — and the
// failure mode is the assistant confidently pointing at a button that was
// renamed or hidden.

import { toolbarButtons } from '@/lib/layout/toolbar'

export interface UiTarget {
  id: string
  /** What the user sees, so the assistant can name it in prose. */
  label: string
  /** Where it is, for the model's sense of the layout. */
  where: string
}

/** Everything except the toolbar, which is derived below. */
const FIXED_TARGETS: UiTarget[] = [
  { id: 'toolbar.settings', label: 'Settings', where: 'top toolbar, far right' },
  { id: 'settings.themeStudio', label: 'Theme Studio…', where: 'Settings → Appearance, under the app theme cards' },
  { id: 'settings.plugins', label: 'Plugins…', where: 'Settings → Plugins' },
  { id: 'settings.panelDrag', label: 'Drag panels to rearrange them', where: 'Settings → Workspace' },
  { id: 'settings.panelInstances', label: 'Add or remove a second editor or map', where: 'Settings → Workspace' },
  { id: 'settings.layoutName', label: 'Name this arrangement', where: 'Settings → Workspace' },
  { id: 'settings.layoutImport', label: 'Import…', where: 'Settings → Workspace' },
  { id: 'settings.layoutReset', label: 'Restore default arrangement', where: 'Settings → Workspace' },
  { id: 'settings.voiceDevice', label: 'Input device', where: 'Settings → Voice input' },
  { id: 'settings.voiceService', label: 'Transcribed by', where: 'Settings → Voice input' },
  { id: 'settings.voiceTest', label: 'Test microphone', where: 'Settings → Voice input' },
  { id: 'settings.voiceModels', label: 'Manage models…', where: 'Settings → Voice input' },
  { id: 'settings.voiceAutoSend', label: 'Send as soon as the transcript arrives', where: 'Settings → Voice input' },

  // Spatial editor ribbon.
  { id: 'map.addFeatures', label: 'Add Features', where: 'spatial editor ribbon' },
  { id: 'map.contents', label: 'Contents', where: 'spatial editor ribbon' },
  { id: 'map.select', label: 'Selection mode', where: 'spatial editor ribbon' },
  { id: 'map.basemap', label: 'Change basemap', where: 'spatial editor ribbon' },
  { id: 'map.settings', label: 'Map Settings', where: 'spatial editor ribbon' },
  { id: 'map.export', label: 'Export', where: 'spatial editor ribbon' },
  { id: 'map.saveEdits', label: 'Save Edits', where: 'spatial editor ribbon, when edits are staged' },
  { id: 'map.canvas', label: 'The map itself', where: 'spatial editor' },
  { id: 'map.addAgain', label: 'Add again', where: 'the "Already on the map" prompt' },

  // Data viewer.
  { id: 'dataViewer.addToMap', label: 'Add to Map', where: 'data viewer header, right — spatial datasets only' },

  // AI panel. Pointable, but there is deliberately no action that presses it:
  // the microphone is the user's, and an assistant that can arm it is on the
  // same list as one that can close its own panel.
  { id: 'ai.voice', label: 'Dictate a message', where: 'AI panel, beside Send' },

  // Environment panel.
  { id: 'environment.export', label: 'Export', where: 'Environment panel, action bar' },
  { id: 'environment.load', label: 'Load', where: 'Environment panel, action bar' },

  // Editor toolbar and console.
  { id: 'editor.runLine', label: 'Line (Ctrl+Enter)', where: 'editor toolbar' },
  { id: 'editor.runAll', label: 'Run All', where: 'editor toolbar' },
  { id: 'editor.language', label: 'Document type selector', where: 'editor toolbar' },
  { id: 'editor.newTab', label: 'New tab', where: 'tab bar, right end' },
  { id: 'console.workingDir', label: 'Working directory', where: 'console header' },
  { id: 'console.workingEnv', label: 'Working environment', where: 'console prompt, shown only while working inside an environment' },
  { id: 'console.clear', label: 'Clear console', where: 'console header, right' },

  // Project.
  { id: 'project.dropdown', label: 'Project menu', where: 'top toolbar, far right' },
]

/**
 * The live catalogue — the toolbar as it is actually configured, then the rest.
 *
 * A function, not a const, for the same reason the action registry is: a
 * plugin's toolbar button has to be pointable at, and a button the user has
 * hidden has to stop being. Pointing at a control that is not on screen is
 * exactly the failure the catalogue exists to prevent.
 */
export function uiTargets(): UiTarget[] {
  const toolbar = toolbarButtons().map((b) => ({
    id: b.targetId, label: b.label, where: 'top toolbar',
  }))
  return [...toolbar, ...FIXED_TARGETS]
}

export function hasTarget(id: string): boolean {
  return uiTargets().some((t) => t.id === id)
}

export function findTarget(id: string): UiTarget | undefined {
  return uiTargets().find((t) => t.id === id)
}

/** The catalogue as the model sees it in an error or a listing. */
export function targetListing(): string {
  return uiTargets().map((t) => `${t.id} — ${t.label} (${t.where})`).join('\n')
}
