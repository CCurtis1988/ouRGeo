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
  { id: 'settings.themeBackgrounds', label: 'Background images…', where: 'Settings → Appearance, under the app theme cards' },
  { id: 'settings.fieldThemes', label: 'Field collection', where: 'Settings → Appearance → App theme collection tabs' },
  { id: 'settings.illustratedThemes', label: 'Illustrated', where: 'Settings → Appearance → App theme collection tabs' },
  { id: 'settings.legacyThemes', label: 'Legacy', where: 'Settings → Appearance → App theme collection tabs' },
  { id: 'settings.customThemes', label: 'Custom', where: 'Settings → Appearance → App theme collection tabs' },
  { id: 'themeBackgrounds.dialog', label: 'Theme background images', where: 'the theme background selection dialog' },
  { id: 'themeBackgrounds.interval', label: 'Switch every', where: 'Theme backgrounds → slideshow timing' },
  { id: 'themeBackgrounds.visibility', label: 'Background visibility', where: 'Settings → Appearance and the theme background gallery' },
  { id: 'themeBackgrounds.resetVisibility', label: 'Theme default', where: 'the Background visibility control in Appearance or the theme gallery' },
  { id: 'themeBackgrounds.reset', label: 'Restore default selection', where: 'Theme backgrounds → Theme artwork' },
  { id: 'themeBackgrounds.linkFolder', label: 'Link image folder…', where: 'Theme backgrounds → Linked image folders' },
  { id: 'settings.plugins', label: 'Plugins…', where: 'Settings → Plugins' },
  { id: 'settings.projectFilesAskReplace', label: 'Ask before an export replaces a project file', where: 'Settings → Prompts' },
  { id: 'settings.promptsScratchSave', label: 'Offer to save scratch as a project when leaving it', where: 'Settings → Prompts' },
  { id: 'settings.promptsAutopilotWarning', label: 'Warn before turning on Autopilot', where: 'Settings → Prompts' },
  { id: 'settings.promptsNotRestored', label: 'Warn when R objects could not be restored', where: 'Settings → Prompts' },
  { id: 'settings.projectsCheckpointInterval', label: 'R snapshot interval', where: 'Settings → Projects' },
  { id: 'settings.projectsSaveDocuments', label: 'Save document edits when saving the project', where: 'Settings → Projects' },
  { id: 'settings.projectsDrafts', label: 'Stored unsaved changes', where: 'Settings → Projects' },
  { id: 'settings.projectsDeleteOld', label: 'Delete drafts older than…', where: 'Settings → Projects → Stored unsaved changes' },
  { id: 'projectFiles.replaceConfirm', label: 'Replace', where: 'Replace a project file? — asked when an export would overwrite a Project Files entry' },
  { id: 'settings.documentModelMode', label: 'Document analysis model', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelMode', label: 'Image interpretation model', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.documentModelProvider', label: 'Document analysis provider', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelProvider', label: 'Image interpretation provider', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.documentModelChoices', label: 'Available document analysis models', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelChoices', label: 'Available image interpretation models', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.documentModelId', label: 'Document analysis model ID', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelId', label: 'Image interpretation model ID', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.documentModelRefresh', label: 'Refresh document models', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelRefresh', label: 'Refresh image models', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.documentModelApply', label: 'Apply document model', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.imageModelApply', label: 'Apply image model', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.taskModelsRetry', label: 'Retry loading file analysis settings', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.taskModelsReset', label: 'Reset file analysis models', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'settings.analyseFilesOnImport', label: 'Generate AI descriptions on import and rescan', where: 'Settings → AI Assistant → File analysis models' },
  { id: 'projectFiles.cancelAnalysis', label: 'Cancel AI file descriptions', where: 'Project Files → background analysis status' },
  { id: 'context.providerMigrations', label: 'Provider migrations', where: 'Settings → AI Assistant → Advanced → Mnemosyne and Hindsight connections' },
  { id: 'context.pluginProviders', label: 'Plugin memory profiles', where: 'Settings → AI Assistant → Advanced → Mnemosyne and Hindsight connections' },
  { id: 'context.hindsightLocalProfile', label: 'Dedicated Hindsight server', where: 'Settings → AI Assistant → Advanced → Mnemosyne and Hindsight connections' },
  { id: 'context.localServer', label: 'Authenticated local memory server', where: 'Settings → AI Assistant → Advanced → Mnemosyne on this device' },
  { id: 'settings.pluginStore', label: 'Plugin Store…', where: 'Settings → Plugins' },
  { id: 'plugins.browseStore', label: 'Browse the store…', where: 'the Plugin Manager, top row' },
  { id: 'pluginStore.dialog', label: 'the Plugin Store', where: 'the Plugin Store dialog' },
  { id: 'pluginStore.search', label: 'Search plugins', where: 'the Plugin Store, top row' },
  { id: 'pluginStore.install', label: 'Install', where: 'the Plugin Store, bottom of the right pane' },
  { id: 'pluginSubmit.dialog', label: 'Publish a plugin', where: 'the publish dialog' },
  { id: 'pluginSubmit.summary', label: 'Summary', where: 'the publish dialog' },
  { id: 'pluginSubmit.screenshots', label: 'Screenshots', where: 'the publish dialog' },
  { id: 'pluginSubmit.addScreenshots', label: 'Add screenshots', where: 'the publish dialog, beside "Screenshots"' },
  { id: 'pluginSubmit.submit', label: 'Submit for review', where: 'the publish dialog, bottom right' },
  { id: 'settings.terminalPlacement', label: 'Give the terminal its own pane', where: 'Settings → Terminal' },
  { id: 'settings.terminalShell', label: 'Terminal shell', where: 'Settings → Terminal' },
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

  // The Distance & Bearing entry strip, under the map while that tool is up.
  { id: 'draw.traverse', label: 'Distance & Bearing entry', where: 'under the map, with the Distance & Bearing tool' },
  { id: 'draw.traverse.start', label: 'Start coordinate', where: 'Distance & Bearing strip, before the first point' },
  { id: 'draw.traverse.reference', label: 'New reference point', where: 'Distance & Bearing strip, on a point layer' },
  { id: 'draw.traverse.distance', label: 'Leg distance', where: 'Distance & Bearing strip' },
  { id: 'draw.traverse.unit', label: 'Distance unit', where: 'Distance & Bearing strip' },
  { id: 'draw.traverse.bearing', label: 'Leg bearing', where: 'Distance & Bearing strip' },
  { id: 'draw.traverse.mode', label: 'Bearing notation', where: 'Distance & Bearing strip' },
  { id: 'draw.traverse.basis', label: 'What the numbers are measured on', where: 'Distance & Bearing strip, right' },
  { id: 'draw.traverse.legs', label: 'The courses entered so far', where: 'Distance & Bearing strip, right' },
  { id: 'draw.traverse.course', label: 'Course type — straight or curve', where: 'Distance & Bearing strip, left of the fields' },
  { id: 'draw.traverse.turn.left', label: 'Curve to the left', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.turn.right', label: 'Curve to the right', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.curve.aId', label: 'First curve element', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.curve.a', label: 'First curve element value', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.curve.bId', label: 'Second curve element', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.curve.b', label: 'Second curve element value', where: 'Distance & Bearing strip, on a curve course' },
  { id: 'draw.traverse.curve.degreeDef', label: 'Degree of curve definition', where: 'Distance & Bearing strip, when a degree of curve is being entered' },
  { id: 'draw.traverse.curve.orientKind', label: 'How a non-tangent curve is oriented', where: 'Distance & Bearing strip, on a Curve course' },
  { id: 'draw.traverse.curve.orient', label: 'Chord or radial bearing', where: 'Distance & Bearing strip, on a Curve course' },
  { id: 'draw.traverse.spiral.in', label: 'Entry spiral', where: 'Distance & Bearing strip, on a Spiral course' },
  { id: 'draw.traverse.spiral.out', label: 'Exit spiral', where: 'Distance & Bearing strip, on a Spiral course' },
  { id: 'draw.traverse.spiral.length', label: 'Spiral length', where: 'Distance & Bearing strip, on a transition course' },
  { id: 'draw.traverse.spiral.radius', label: 'Radius the spiral reaches', where: 'Distance & Bearing strip, on a transition course' },
  { id: 'draw.traverse.spiral.delta', label: 'Total deflection', where: 'Distance & Bearing strip, on a spiral–curve–spiral' },
  { id: 'draw.traverse.spiral.lengthOut', label: 'Exit spiral length', where: 'Distance & Bearing strip, on a spiral–curve–spiral' },
  { id: 'draw.traverse.bezier.arrive', label: 'Heading to arrive on', where: 'Distance & Bearing strip, on a free curve' },
  { id: 'draw.traverse.bezier.tension', label: 'How hard the free curve bends', where: 'Distance & Bearing strip, on a free curve' },

  // Data viewer.
  { id: 'dataViewer.addToMap', label: 'Add to Map', where: 'data viewer header, right — spatial datasets only' },

  // AI panel. Pointable, but there is deliberately no action that presses it:
  // the microphone is the user's, and an assistant that can arm it is on the
  // same list as one that can close its own panel.
  { id: 'ai.voice', label: 'Dictate a message', where: 'AI panel, beside Send' },

  // Environment panel.
  { id: 'dataViewer.dataChecks', label: 'Data checks', where: 'Data Viewer header; opens read-only inspection' },
  { id: 'dataViewer.exportVector', label: 'Export layer', where: 'Spatial Data Viewer header; opens checked vector export' },
  { id: 'dataViewer.exportVector.save', label: 'Check and save', where: 'Vector export dialog; validates, reviews and verifies output' },
  { id: 'environment.export', label: 'Export', where: 'Environment panel, action bar' },
  { id: 'export.destination', label: 'Save to (Folder / Project Files)', where: 'Plot, map image and map code export dialogs' },
  { id: 'environment.load', label: 'Load', where: 'Environment panel, action bar' },

  // Editor toolbar and console.
  { id: 'editor.runLine', label: 'Line (Ctrl+Enter)', where: 'editor toolbar' },
  { id: 'editor.runAll', label: 'Run All', where: 'editor toolbar' },
  { id: 'editor.language', label: 'Document type selector', where: 'editor toolbar' },
  { id: 'editor.newTab', label: 'New tab', where: 'tab bar, right end' },
  { id: 'console.workingDir', label: 'Working directory', where: 'console header' },
  { id: 'console.workingEnv', label: 'Working environment', where: 'console prompt, shown only while working inside an environment' },
  { id: 'console.clear', label: 'Clear console', where: 'console header, right' },
  { id: 'console.copyOutput', label: 'Copy all console output', where: 'console header, right; copies complete history including output outside the viewport' },

  { id: 'ai.terminalSwitch', label: 'Terminal switch', where: 'AI panel footer, beside Autopilot' },
  // Pointable, never pressable — the same rule the microphone follows. An
  // assistant that can switch its own chat can walk out of the conversation.
  { id: 'ai.chatSwitcher', label: 'Chat switcher', where: 'AI panel header, right of the token bar' },
  { id: 'settings.checkUpdates', label: 'Check for updates', where: 'Settings → Updates' },
  { id: 'updates.automatic', label: 'Check for updates when ouRGeo starts', where: 'Settings → Updates' },
  { id: 'updates.checkAgain', label: 'Check again', where: 'update dialog' },
  { id: 'updates.officialDownloads', label: 'Official downloads', where: 'update dialog' },
  { id: 'updates.dialog', label: 'ouRGeo updates', where: 'startup notification or Settings → Updates' },
  { id: 'updates.download', label: 'Download update', where: 'update dialog when a newer compatible installer is published' },
  { id: 'updates.skipVersion', label: 'Skip this version', where: 'update dialog' },
  { id: 'updates.releaseNotes', label: 'Release notes', where: 'update dialog' },
  { id: 'updates.saveProject', label: 'Save project', where: 'update dialog after opening the download' },
  { id: 'updates.closeApp', label: 'Close ouRGeo', where: 'update dialog after opening the download' },
  { id: 'updates.later', label: 'Remind me next time', where: 'update dialog' },
  { id: 'layout.dropDialog', label: 'Arrange pane', where: 'drop a pane over another pane while pane dragging is enabled' },
  { id: 'layout.dropVertical', label: 'Vertical split', where: 'pane drop arrangement dialog' },
  { id: 'layout.dropHorizontal', label: 'Horizontal split', where: 'pane drop arrangement dialog' },
  { id: 'layout.dropTabs', label: 'Tab group', where: 'pane drop arrangement dialog' },
  ...['left', 'right', 'top', 'bottom'].map(side => ({ id: `layout.drop.${side}`, label: `Place pane ${side}`, where: 'pane split placement preview' })),
  { id: 'ai.thinkingEffort', label: 'Thinking effort', where: 'AI Assistant footer, when the selected model supports thinking controls' },
  { id: 'ai.newChat', label: 'New chat', where: 'AI panel header, far right' },

  // Terminal.
  { id: 'terminal.tab', label: 'Terminal tab', where: 'Terminal panel, tab strip' },
  { id: 'terminal.new', label: 'New terminal', where: 'Terminal panel, right of the tab strip' },
  { id: 'terminal.profiles', label: 'Choose a shell', where: 'Terminal panel, right of the New terminal button' },
  { id: 'terminal.workingDir', label: 'Terminal directory', where: 'Terminal panel header' },
  { id: 'terminal.screen', label: 'Terminal screen', where: 'Terminal panel, where commands are typed' },

  // Project.
  { id: 'project.dropdown', label: 'Project menu', where: 'top toolbar, far right' },
  { id: 'project.files', label: 'Project Files', where: 'Project menu' },
  { id: 'project.revert', label: 'Revert to Saved…', where: 'Project menu' },
  { id: 'project.keptLocally', label: 'Unsaved changes, kept on this computer', where: 'Project menu, at the top, while the project has unsaved changes' },
  { id: 'project.recentlyClosed', label: 'Recently Closed Files', where: 'Project menu, files dropped when scratch was left' },
  { id: 'project.ask', label: 'Question', where: 'the dialog ouRGeo is asking in — closing a document, leaving scratch, a changed project file' },
  { id: 'project.mergeDialog', label: 'Resolve conflicts', where: 'opened from "was changed elsewhere" when a project file changed outside this window' },
  { id: 'project.mergeFinish', label: 'Finish and save', where: 'Resolve conflicts dialog, bottom right' },
  { id: 'projectFiles.panel', label: 'Project Files pane', where: 'Console and Terminal tab group by default' },
  { id: 'projectFiles.add', label: 'Add files', where: 'Project Files pane header' },
  { id: 'projectFiles.search', label: 'Search project files', where: 'Project Files pane header' },
  { id: 'projectFiles.menu', label: 'Project files actions', where: 'Project Files pane header' },
  { id: 'projectFiles.reindex', label: 'Reindex project files', where: 'Project Files pane actions menu' },
  { id: 'projectFiles.attach', label: 'Attach to chat', where: 'Project Files file details' },
  { id: 'projectFiles.linkedFolders', label: 'Linked folders', where: 'Project Files pane header' },
  { id: 'projectFiles.linkedFoldersDialog', label: 'Linked folders manager', where: 'the Linked folders dialog' },
  { id: 'projectFiles.linkFolder', label: 'Link folder…', where: 'Linked folders dialog, top actions' },
  { id: 'projectFiles.createFolder', label: 'Create linked folder…', where: 'Linked folders dialog, top actions' },
  { id: 'projectFiles.newFolderName', label: 'New folder name', where: 'Linked folders dialog, create form' },
  { id: 'projectFiles.createFolderConfirm', label: 'Choose parent and create folder…', where: 'Linked folders dialog, create form' },
  { id: 'projectFiles.rescanFolders', label: 'Rescan linked folders', where: 'Linked folders dialog, top actions' },
  { id: 'projectFiles.rescanFolder', label: 'Rescan folder', where: 'a linked folder card in the Linked folders dialog' },
  { id: 'projectFiles.relinkFolder', label: 'Relink folder…', where: 'a linked folder card in the Linked folders dialog' },
  { id: 'projectFiles.renameLinkedFolder', label: 'Save folder label', where: 'a linked folder card in the Linked folders dialog' },
  { id: 'projectFiles.forgetFolder', label: 'Forget link…', where: 'a linked folder card in the Linked folders dialog' },
  { id: 'projectFiles.forgetFolderConfirm', label: 'Forget linked folder', where: 'the linked folder removal confirmation' },
  { id: 'ai.addFiles', label: 'Add files', where: 'AI Assistant attachment selector' },
  { id: 'ai.chooseProjectFiles', label: 'Choose project files', where: 'AI Assistant attachment selector' },
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
