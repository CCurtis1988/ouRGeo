// Projects: the .ourgeoproj bundle and the scratch workspace.
//
// Everything here delegates to project-persistence.ts, which already owns the
// order these have to happen in (reset → hydrate stores → /env/load →
// /db/reconnect). Re-implementing any of it for the assistant would produce a
// project that loads *almost* correctly.
//
// New and Open are `confirm`: both discard the current session, and a project
// with unsaved work is exactly the thing a user does not want an assistant to
// decide about on its own.

import { useProjectStore } from '@/store/project'
import {
  saveCurrentProject, saveProjectAs, loadProjectFromPath, newProject, loadProject,
} from '@/lib/project-persistence'
import { ok, fail, argStr, type UiAction } from './types'

export const projectActions: UiAction[] = [
  {
    id: 'project.status',
    group: 'project',
    tier: 'always',
    summary: 'The current project: its name, path, whether it has unsaved changes, and the recents list.',
    params: [],
    run: () => {
      const s = useProjectStore.getState()
      const lines = [
        s.path
          ? `Project "${s.name}" — ${s.path}${s.isDirty ? ' (unsaved changes)' : ''}.`
          : `Scratch workspace ("${s.name}"). It is never saved in place; Save As makes it a real project.`,
      ]
      lines.push(s.recents.length > 0
        ? `Recent projects: ${s.recents.map((r) => `${r.name} (${r.path})`).join('; ')}.`
        : 'No recent projects.')
      return ok(lines.join('\n'))
    },
  },

  {
    id: 'project.save',
    group: 'project',
    tier: 'autopilot',
    summary: 'Save the current project in place. Not available for the scratch workspace.',
    params: [],
    run: async () => {
      const s = useProjectStore.getState()
      if (!s.path) {
        return fail('This is the scratch workspace, which cannot be saved in place. ' +
          'Use project.saveAs to turn it into a real .ourgeoproj.')
      }
      const saved = await saveCurrentProject()
      return saved ? ok(`Saved "${s.name}" to ${s.path}.`) : fail('Save failed.')
    },
  },

  {
    id: 'project.saveAs',
    group: 'project',
    tier: 'autopilot',
    summary: 'Save the session as a new .ourgeoproj bundle. Opens the system save dialog for the user to pick a location.',
    params: [],
    run: async () => {
      const saved = await saveProjectAs()
      if (!saved) return fail('Save As was cancelled or failed.')
      const s = useProjectStore.getState()
      return ok(`Saved as "${s.name}" (${s.path}).`)
    },
  },

  {
    id: 'project.open',
    group: 'project',
    // Loading resets the R session and replaces every open tab and layer.
    tier: 'confirm',
    summary:
      'Open a .ourgeoproj bundle. This resets the R session and replaces the current tabs, ' +
      'layers and plots. Omit the path to let the user pick the file.',
    params: [
      { name: 'path', type: 'string', description: 'Absolute path to the .ourgeoproj file.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      const loaded = path ? await loadProjectFromPath(path) : await loadProject()
      if (!loaded) return fail(path ? `Could not load "${path}".` : 'Open was cancelled or failed.')
      const s = useProjectStore.getState()
      return ok(`Opened project "${s.name}" (${s.path}).`)
    },
  },

  {
    id: 'project.new',
    group: 'project',
    // Clears every user object in R.
    tier: 'confirm',
    summary: 'Start a fresh scratch workspace: a clean R session with the scratch code tabs restored.',
    params: [],
    run: async () => {
      await newProject()
      return ok('Started a new scratch workspace. The R session is clean.')
    },
  },
]
