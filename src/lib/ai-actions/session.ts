// The console, the R session, recording, plots, and settings.

import { usePlottingStore } from '@/store/plotting'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useMarkdownSettingsStore } from '@/store/markdownSettings'
import { useThemeStore } from '@/store/theme'
import { rClient } from '@/lib/r-client'
import { saveSpatialSettings } from '@/lib/spatial-settings-persistence'
import { saveMarkdownSettings } from '@/lib/markdown-settings-persistence'
import { ok, fail, argStr, argNum, argBool, type UiAction } from './types'

export const plotsActions: UiAction[] = [
  {
    id: 'plots:list',
    group: 'plots',
    tier: 'always',
    summary: 'How many plots are in the history and which one is showing.',
    params: [],
    run: () => {
      const s = usePlottingStore.getState()
      if (s.plots.length === 0) return ok('No plots yet. Anything R draws lands here.')
      return ok(`${s.plots.length} plot(s); showing #${s.currentIndex + 1}.`)
    },
  },

  {
    id: 'plots:show',
    group: 'plots',
    tier: 'always',
    summary: 'Show a particular plot from the history, and open the Plots panel.',
    params: [
      {
        name: 'index', type: 'number',
        description: '1-based position in the history; omit for the most recent.',
      },
    ],
    run: (args) => {
      const s = usePlottingStore.getState()
      if (s.plots.length === 0) return fail('There are no plots to show.')
      const n = argNum(args, 'index', s.plots.length)
      if (n < 1 || n > s.plots.length) {
        return fail(`There ${s.plots.length === 1 ? 'is 1 plot' : `are ${s.plots.length} plots`}; ` +
          `"${n}" is out of range.`)
      }
      s.ensureOpen()
      s.setIndex(n - 1)
      return ok(`Showing plot ${n} of ${s.plots.length}.`)
    },
  },

  {
    id: 'plots:export',
    group: 'plots',
    tier: 'autopilot',
    summary: 'Re-render the current plot at a chosen size and write it to a file.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to write.' },
      { name: 'format', type: 'enum', values: ['png', 'jpg', 'pdf'], default: 'png', description: 'File format.' },
      { name: 'width', type: 'number', default: 1600, description: 'Width in pixels.' },
      { name: 'height', type: 'number', default: 1200, description: 'Height in pixels.' },
      { name: 'dpi', type: 'number', default: 150, description: 'Resolution.' },
    ],
    run: async (args) => {
      const s = usePlottingStore.getState()
      const current = s.plots[s.currentIndex]
      if (!current) return fail('There is no plot to export.')
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      const res = await rClient.exportPlot({
        format: (argStr(args, 'format', 'png') || 'png') as 'png' | 'jpg' | 'pdf',
        widthPx: argNum(args, 'width', 1600),
        heightPx: argNum(args, 'height', 1200),
        dpi: argNum(args, 'dpi', 150),
        plotId: current.plotId,
      })
      if (!res.success || !res.data) {
        return fail(res.error ?? 'The plot could not be re-rendered. Plots restored from a previous ' +
          'session have no recording in R and can only be exported by re-running the code.')
      }
      const base64 = res.data.includes(',') ? res.data.slice(res.data.indexOf(',') + 1) : res.data
      await window.electronAPI.file.writeBinary(path, base64)
      return ok(`Wrote the current plot to ${path}.`)
    },
  },

  {
    id: 'plots:popout',
    group: 'plots',
    tier: 'always',
    summary: 'Open the current plot in its own window.',
    params: [],
    run: async () => {
      const s = usePlottingStore.getState()
      const current = s.plots[s.currentIndex]
      if (!current) return fail('There is no plot to pop out.')
      await window.electronAPI.plot.openPopout({
        dataUrl: current.dataUrl, plotId: current.plotId,
        index: s.currentIndex, total: s.plots.length,
      })
      return ok('Opened the plot in a separate window.')
    },
  },
]

export const sessionActions: UiAction[] = [
  {
    id: 'session:clearConsole',
    group: 'session',
    tier: 'always',
    summary: 'Clear the console display. The R session and its objects are untouched.',
    params: [],
    run: () => {
      useSessionStore.getState().clearConsole()
      return ok('Console cleared. Nothing in the R session changed.')
    },
  },

  {
    id: 'session:workingDir',
    group: 'session',
    tier: 'autopilot',
    summary:
      'Move R\'s working directory — what every relative path in the session means. ' +
      'Omit the path to just report it.',
    params: [
      { name: 'path', type: 'string', description: 'Absolute directory path. Omit to read the current one.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      if (!path) {
        const res = await rClient.getWorkingDir()
        return res.success ? ok(`Working directory: ${res.path}`) : fail('Could not read the working directory.')
      }
      const res = await rClient.setWorkingDir(path)
      if (!res.success) return fail(res.error ?? `Could not move to "${path}".`)
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', `setwd("${path}")`)
      return ok(`Working directory is now ${res.path}.`)
    },
  },

  {
    id: 'session:reset',
    group: 'session',
    // Deletes every user object in R.
    tier: 'confirm',
    summary:
      'Clear the R session: every object the user created, plus database connections. ' +
      'Packages and open documents survive.',
    params: [],
    run: async () => {
      const res = await rClient.sessionReset()
      return res.success
        ? ok('R session reset. Every user object is gone; open documents and packages are untouched.')
        : fail(res.error ?? 'Reset failed.')
    },
  },

  {
    id: 'session:record',
    group: 'session',
    tier: 'autopilot',
    summary:
      'Start or stop console recording, which captures everything run into a document — the way ' +
      'a user turns a session into a runnable script.',
    params: [
      { name: 'state', type: 'enum', values: ['start', 'stop'], required: true, description: 'Which.' },
      { name: 'tab', type: 'string', description: 'For start: the document to record into; defaults to the active one.' },
      { name: 'includeOutput', type: 'boolean', default: false, description: 'For start: also capture console output.' },
    ],
    run: (args) => {
      const session = useSessionStore.getState()
      if (argStr(args, 'state') === 'stop') {
        if (!session.isRecording) return ok('Recording was not running.')
        session.stopRecording()
        return ok('Stopped recording.')
      }
      if (session.isRecording) return ok('Recording is already running.')
      const editor = useEditorStore.getState()
      const wanted = argStr(args, 'tab')
      const tab = wanted
        ? editor.tabs.find((t) => t.fileName === wanted && t.type === 'code')
        : editor.getActiveTab()
      if (!tab || tab.type !== 'code') {
        return fail(wanted
          ? `No open document called "${wanted}" to record into.`
          : 'No active document to record into. Open or create one first.')
      }
      session.startRecording(tab.id, 'current', argBool(args, 'includeOutput'))
      return ok(`Recording the console into "${tab.fileName}".`)
    },
  },
]

export const settingsActions: UiAction[] = [
  {
    id: 'settings:get',
    group: 'settings',
    tier: 'always',
    summary: 'Read the settings that affect analysis: CRS defaults, map extent, snapping, map-chunk engine.',
    params: [],
    run: () => {
      const sp = useSpatialSettingsStore.getState()
      const md = useMarkdownSettingsStore.getState()
      const theme = useThemeStore.getState()
      return ok([
        `Default CRS for new geometry: ${sp.defaultCrs || '(none set)'}.`,
        `Calculation CRS: ${sp.calcCrs || 'default'}.`,
        `Initial map extent: ${sp.initialExtentMode}.`,
        `Attribute popup on draw: ${sp.showAttributePopup ? 'on' : 'off'}.`,
        `Snapping: ${Object.entries(sp.snapSettings.kinds).filter(([, on]) => on).map(([k]) => k).join(', ') || 'off'} within ${sp.snapSettings.tolerancePx}px.`,
        `Map chunk engine for R Markdown: ${md.mapChunkEngine}.`,
        `Theme: ${theme.current}; interface scale ${theme.uiScale}.`,
      ].join('\n'))
    },
  },

  {
    id: 'settings:spatial',
    group: 'settings',
    tier: 'autopilot',
    summary: 'Change a Spatial Editor setting. Pass only what you want to change.',
    params: [
      { name: 'defaultCrs', type: 'string', description: 'EPSG code for new geometry, e.g. "4326".' },
      { name: 'calcCrs', type: 'string', description: 'CRS spatial tools calculate in, e.g. "auto" or an EPSG code.' },
      {
        name: 'initialExtent', type: 'enum', values: ['world', 'user'],
        description: 'Where the map opens: the whole world, or the saved user extent.',
      },
      { name: 'attributePopup', type: 'boolean', description: 'Prompt for attributes after drawing a feature.' },
      { name: 'snapTolerance', type: 'number', description: 'Snapping radius in pixels while drawing.' },
    ],
    run: async (args) => {
      const s = useSpatialSettingsStore.getState()
      const changed: string[] = []
      if ('defaultCrs' in args) { s.setDefaultCrs(argStr(args, 'defaultCrs')); changed.push('default CRS') }
      if ('calcCrs' in args) { s.setCalcCrs(argStr(args, 'calcCrs')); changed.push('calculation CRS') }
      if ('initialExtent' in args) {
        const mode = argStr(args, 'initialExtent')
        if (!['world', 'user'].includes(mode)) {
          return fail('initialExtent must be world or user.')
        }
        s.setInitialExtentMode(mode as 'world' | 'user')
        changed.push('initial extent')
      }
      if ('attributePopup' in args) {
        s.setShowAttributePopup(argBool(args, 'attributePopup')); changed.push('attribute popup')
      }
      if ('snapTolerance' in args) {
        s.setSnapSettings({ ...s.snapSettings, tolerancePx: argNum(args, 'snapTolerance', s.snapSettings.tolerancePx) })
        changed.push('snap tolerance')
      }
      if (changed.length === 0) return fail('Nothing to change — pass at least one setting.')
      const next = useSpatialSettingsStore.getState()
      await saveSpatialSettings(next.initialExtentMode, next.userExtent)
      return ok(`Updated: ${changed.join(', ')}.`)
    },
  },

  {
    id: 'settings:mapChunkEngine',
    group: 'settings',
    tier: 'autopilot',
    summary: 'Which generator R Markdown map chunks use.',
    params: [
      {
        name: 'engine', type: 'enum', values: ['tmap', 'ggplot', 'auto'], required: true,
        description: '"auto" follows whichever Export dialog was used last.',
      },
    ],
    run: async (args) => {
      const engine = argStr(args, 'engine')
      if (!['tmap', 'ggplot', 'auto'].includes(engine)) {
        return fail('engine must be tmap, ggplot or auto.')
      }
      useMarkdownSettingsStore.getState().setMapChunkEngine(engine as 'tmap' | 'ggplot' | 'auto')
      await saveMarkdownSettings({ mapChunkEngine: engine as 'tmap' | 'ggplot' | 'auto' })
      return ok(`Map chunks will use ${engine}.`)
    },
  },
]
