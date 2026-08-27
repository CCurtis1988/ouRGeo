// Files and editor tabs.
//
// Content is not here: `write_document` and `edit_document` own what is IN a
// document. These are the operations around it — opening a path, saving,
// running the file, knitting it — the things the toolbar buttons do.
//
// Nothing opens a native file dialog. A picker the assistant cannot see or
// dismiss would strand the tool call waiting on a modal the model has no way to
// answer, so every action takes an explicit path and the assistant asks the
// user for one when it doesn't have it.

import { useEditorStore, type TabState } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { rClient } from '@/lib/r-client'
import { languageForPath, languageOf, labelFor, starterContentFor, type DocLanguage } from '@/lib/markdown/doc-kind'
import { ok, fail, argStr, type UiAction, type ActionResult } from './types'

const KNIT_FORMATS = ['html', 'pdf', 'word', 'md'] as const

function docTabs(): TabState[] {
  return useEditorStore.getState().tabs.filter((t) => t.type === 'code')
}

function tabListing(): string {
  const tabs = docTabs()
  return tabs.length > 0 ? tabs.map((t) => `"${t.fileName}"`).join(', ') : '(no documents open)'
}

/** Resolve a tab by file name, path basename, or full path; active when unnamed. */
function findTab(name: string): TabState | null {
  const want = name.trim()
  if (want === '') {
    const active = useEditorStore.getState().getActiveTab()
    return active && active.type === 'code' ? active : null
  }
  const base = (p: string | null): string => (p ? p.split(/[\\/]/).pop() ?? '' : '')
  const tabs = docTabs()
  return tabs.find((t) => t.fileName === want)
    ?? tabs.find((t) => base(t.filePath) === want)
    ?? tabs.find((t) => t.filePath === want)
    ?? tabs.find((t) => t.fileName.toLowerCase() === want.toLowerCase())
    ?? null
}

function requireTab(name: string): TabState | ActionResult {
  const tab = findTab(name)
  if (tab) return tab
  return fail(name.trim()
    ? `No open document called "${name}". Open documents: ${tabListing()}.`
    : `No active document. Open documents: ${tabListing()}.`)
}

const isResult = (v: unknown): v is ActionResult =>
  typeof v === 'object' && v !== null && 'ok' in v && 'message' in v

export const editorActions: UiAction[] = [
  {
    id: 'editor.listTabs',
    group: 'editor',
    tier: 'always',
    summary: 'List the open editor tabs, marking the active one.',
    params: [],
    run: () => {
      const { tabs, activeTabId } = useEditorStore.getState()
      if (tabs.length === 0) return ok('No tabs are open.')
      const lines = tabs.map((t) => {
        const bits = [`"${t.fileName}"`, t.type === 'code' ? labelFor(languageOf(t)) : t.type]
        bits.push(t.filePath ?? 'not saved to disk')
        if (t.isDirty) bits.push('unsaved changes')
        return `${t.id === activeTabId ? '* ' : '  '}${bits.join(' — ')}`
      })
      return ok(`${tabs.length} tab(s) open:\n${lines.join('\n')}`)
    },
  },

  {
    id: 'editor.openFile',
    group: 'editor',
    tier: 'autopilot',
    summary: 'Open a file from disk in the code editor (what the Open File button does).',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to the file.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      try {
        const content = await window.electronAPI.file.read(path)
        useEditorStore.getState().addTab(path, content)
        return ok(`Opened "${path}" (${labelFor(languageForPath(path))}).`)
      } catch (e) {
        return fail(`Could not open "${path}": ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  },

  {
    id: 'editor.newTab',
    group: 'editor',
    tier: 'autopilot',
    summary: 'Create a new empty document tab. Use write_document when you have content for it.',
    params: [
      {
        name: 'language', type: 'enum', values: ['r', 'markdown', 'rmarkdown'], default: 'r',
        description: 'What kind of document.',
      },
      { name: 'name', type: 'string', description: 'File name for the tab; defaults to Untitled-N.' },
    ],
    run: (args) => {
      const lang = (argStr(args, 'language', 'r') || 'r') as DocLanguage
      const name = argStr(args, 'name')
      const store = useEditorStore.getState()
      if (name) {
        store.newDocumentTab(name, starterContentFor(lang, name.replace(/\.[^.]+$/, '')), lang)
        return ok(`Created "${name}" (${labelFor(lang)}).`)
      }
      if (lang === 'r') {
        store.addTab()
        return ok('Created a new R script tab.')
      }
      store.newMarkdownTab(lang)
      return ok(`Created a new ${labelFor(lang)} document.`)
    },
  },

  {
    id: 'editor.activateTab',
    group: 'editor',
    tier: 'always',
    summary: 'Bring an open tab to the front.',
    params: [{ name: 'name', type: 'string', required: true, description: 'Tab file name.' }],
    run: (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      useEditorStore.getState().setActiveTab(tab.id)
      return ok(`"${tab.fileName}" is now the active tab.`)
    },
  },

  {
    id: 'editor.closeTab',
    group: 'editor',
    tier: 'autopilot',
    summary: 'Close a tab. Unsaved changes in it are lost, so check editor.listTabs first.',
    params: [{ name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' }],
    run: (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      const dirty = tab.isDirty
      useEditorStore.getState().closeTab(tab.id)
      return ok(`Closed "${tab.fileName}"${dirty ? ' — it had unsaved changes' : ''}.`)
    },
  },

  {
    id: 'editor.save',
    group: 'editor',
    tier: 'autopilot',
    summary: 'Save a tab to the file it came from. Fails for a tab that has no path — use editor.saveAs.',
    params: [{ name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' }],
    run: async (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      if (!tab.filePath) {
        return fail(`"${tab.fileName}" has never been saved, so there is no path to save it to. ` +
          'Use editor.saveAs with a path, or ask the user to press Ctrl+S and pick one.')
      }
      await window.electronAPI.file.write(tab.filePath, tab.content)
      useEditorStore.getState().markTabSaved(tab.id, tab.filePath, tab.content)
      return ok(`Saved "${tab.fileName}" to ${tab.filePath}.`)
    },
  },

  {
    id: 'editor.saveAs',
    group: 'editor',
    // Writing to a path the assistant chose can overwrite a file the user cares
    // about, and nothing in the app undoes that.
    tier: 'confirm',
    summary: 'Save a tab to a specific path on disk.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to write to.' },
      { name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' },
    ],
    run: async (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      await window.electronAPI.file.write(path, tab.content)
      useEditorStore.getState().markTabSaved(tab.id, path, tab.content)
      return ok(`Saved "${tab.fileName}" to ${path}.`)
    },
  },

  {
    id: 'editor.runTab',
    group: 'editor',
    tier: 'autopilot',
    summary: 'Run a whole document in the R console (the Run All button).',
    params: [{ name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' }],
    run: async (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      const code = tab.content.trim()
      if (!code) return fail(`"${tab.fileName}" is empty.`)
      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (res.output) session.addConsoleEntry('output', res.output)
      if (res.error) session.addConsoleEntry('error', res.error)
      return res.success
        ? ok(`Ran "${tab.fileName}".`, res.output ?? '')
        : fail(`"${tab.fileName}" errored: ${res.error ?? 'unknown error'}`)
    },
  },

  {
    id: 'editor.setLanguage',
    group: 'editor',
    tier: 'always',
    summary: 'Change a tab\'s document type (the editor toolbar\'s selector).',
    params: [
      {
        name: 'language', type: 'enum', values: ['r', 'markdown', 'rmarkdown'], required: true,
        description: 'What to treat the document as.',
      },
      { name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' },
    ],
    run: (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      const lang = argStr(args, 'language') as DocLanguage
      useEditorStore.getState().setTabLanguage(tab.id, lang)
      return ok(`"${tab.fileName}" is now edited as ${labelFor(lang)}.`)
    },
  },

  {
    id: 'editor.viewMode',
    group: 'editor',
    tier: 'always',
    summary: 'Switch a markdown document between Source and Visual editing.',
    params: [
      {
        name: 'mode', type: 'enum', values: ['source', 'visual'], required: true,
        description: 'Which editor to show.',
      },
      { name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' },
    ],
    run: (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      const lang = languageOf(tab)
      if (lang === 'r') return fail(`"${tab.fileName}" is an R script; Visual mode is for markdown documents.`)
      const mode = argStr(args, 'mode') as 'source' | 'visual'
      useEditorStore.getState().setTabViewMode(tab.id, mode)
      return ok(`"${tab.fileName}" is now in ${mode} mode.`)
    },
  },

  {
    id: 'editor.knit',
    group: 'editor',
    tier: 'autopilot',
    summary:
      'Knit an R Markdown document. Renders in a CLEAN R session, so the document must build ' +
      'everything it uses. The file must already be saved to disk.',
    params: [
      {
        name: 'format', type: 'enum', values: KNIT_FORMATS, default: 'html',
        description: 'Output format. pdf needs LaTeX; all formats need pandoc.',
      },
      { name: 'name', type: 'string', description: 'Tab file name; omit for the active tab.' },
    ],
    run: async (args) => {
      const tab = requireTab(argStr(args, 'name'))
      if (isResult(tab)) return tab
      if (languageOf(tab) === 'r') return fail(`"${tab.fileName}" is an R script, not a document.`)
      if (!tab.filePath) {
        return fail(`"${tab.fileName}" is not saved to disk. rmarkdown::render works on a file — ` +
          'relative paths inside the document resolve against its directory. Save it first.')
      }
      if (tab.isDirty) {
        return fail(`"${tab.fileName}" has unsaved changes. Knit renders the file on disk, not the ` +
          'buffer, so save it first (editor.save) or you will knit the previous version.')
      }
      const format = argStr(args, 'format', 'html') || 'html'
      const session = useSessionStore.getState()
      session.addConsoleEntry('info', `Knitting ${tab.fileName} to ${format.toUpperCase()}…`)
      const res = await window.electronAPI.knit.render({
        id: crypto.randomUUID(), filePath: tab.filePath, format,
      })
      if (res.success && res.outputPath) {
        session.addConsoleEntry('info', `Knit complete: ${res.outputPath}`)
        return ok(`Knitted "${tab.fileName}" to ${res.outputPath}.`)
      }
      const detail = [res.error, res.hint, res.errorLine ? `(line ${res.errorLine})` : null]
        .filter(Boolean).join(' — ')
      session.addConsoleEntry('error', res.error ?? 'Knit failed.')
      return fail(`Knit failed: ${detail || 'unknown error'}`)
    },
  },
]
