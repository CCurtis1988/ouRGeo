import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import MonacoEditor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { Play, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { TabBar } from './TabBar'
import { DataViewer } from './DataViewer'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { useThemeStore } from '@/store/theme'
import { THEMES } from '@/lib/themes'
import { sceneDataUri } from '@/lib/themeScenes'
import { saveSessionDebounced } from '@/lib/session-persistence'
import { useCompletion, type AcceptResult } from '@/hooks/useCompletion'
import { CompletionPopup } from '../completion/CompletionPopup'

loader.config({ monaco })

// Register all custom themes immediately — monaco is available via static import
for (const t of Object.values(THEMES)) {
  monaco.editor.defineTheme(t.monacoTheme, {
    base: t.monacoThemeDef.base,
    inherit: true,
    rules: t.monacoThemeDef.rules,
    colors: t.monacoThemeDef.colors,
  })
}

/** Strip the comment portion of a line (everything from # outside a string). */
function stripComment(line: string, inStringAtLineStart = false): string {
  let inStr = inStringAtLineStart
  let q = ''
  for (let i = 0; i < line.length; i++) {
    if (inStr) {
      if (line[i] === '\\') { i++; continue }
      if (line[i] === q) { inStr = false }
    } else {
      if (line[i] === '#') return line.slice(0, i)
      if (line[i] === '"' || line[i] === "'") { inStr = true; q = line[i] }
    }
  }
  return line
}

/** True if the (comment-stripped) line ends with an operator requiring a RHS on the next line. */
function needsContinuation(line: string, inStringAtLineStart = false): boolean {
  const stripped = stripComment(line, inStringAtLineStart).trimEnd()
  if (!stripped) return false
  return /([+\-*/^~,]|[<>!]=?|&&|\|\||<-|->|\|>|%[^%\s]*%)$/.test(stripped)
}

/** Return the last line number of the complete R expression starting at startLine. */
function findChunkEnd(model: monaco.editor.ITextModel, startLine: number): number {
  const totalLines = model.getLineCount()
  let depth = 0
  let inStr = false
  let q = ''
  let endLine = startLine

  for (let ln = startLine; ln <= totalLines; ln++) {
    const raw = model.getLineContent(ln)
    const inStrAtLineStart = inStr

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (inStr) {
        if (ch === '\\') { i++; continue }
        if (ch === q) inStr = false
      } else {
        if (ch === '#') break                          // rest is comment
        if (ch === '"' || ch === "'") { inStr = true; q = ch }
        else if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth--
      }
    }

    endLine = ln

    if (inStr) continue  // string still open across EOL — need next line

    if (depth <= 0 && !needsContinuation(raw, inStrAtLineStart)) break
  }

  return endLine
}

export function CodeEditor(): React.ReactElement {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map())
  const suppressChangeRef = useRef(false)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  // --- Autocomplete: our custom popup driven over Monaco -------------------
  const comp = useCompletion()
  const compRef = useRef(comp)
  compRef.current = comp
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; height: number } | null>(null)

  const queryCompletion = useCallback((manual = false) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    const position = editor?.getPosition()
    if (!editor || !model || !position) return
    const vis = editor.getScrolledVisiblePosition(position)
    const node = editor.getDomNode()
    if (vis && node) {
      const r = node.getBoundingClientRect()
      const lh = editor.getOption(monaco.editor.EditorOption.lineHeight)
      setMenuPos({ left: r.left + vis.left, top: r.top + vis.top, height: lh })
    }
    compRef.current.query(model.getValue(), model.getOffsetAt(position), manual)
  }, [])
  const queryRef = useRef(queryCompletion)
  queryRef.current = queryCompletion

  const applyAccept = useCallback((res: AcceptResult) => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    const start = model.getPositionAt(res.from)
    const end = model.getPositionAt(res.to)
    suppressChangeRef.current = false
    editor.executeEdits('completion', [
      {
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        text: res.insertText,
        forceMoveMarkers: true,
      },
    ])
    editor.setPosition(model.getPositionAt(res.from + res.caret))
    editor.focus()
    queryRef.current(false) // chain (e.g. args right after inserting `fn(`)
  }, [])
  const applyRef = useRef(applyAccept)
  applyRef.current = applyAccept

  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const updateTabContent = useEditorStore((s) => s.updateTabContent)
  const externalContentUpdate = useEditorStore((s) => s.externalContentUpdate)
  const monacoTheme = useThemeStore((s) => s.monacoTheme)
  const themeId = useThemeStore((s) => s.current)
  const uiScale = useThemeStore((s) => s.uiScale)

  // Faint, grey-scaled themed scene painted behind the editor text.
  const artUri = useMemo(() => sceneDataUri(themeId), [themeId])

  // Get or create a Monaco model for a tab
  const getOrCreateModel = useCallback((id: string, content: string): monaco.editor.ITextModel => {
    let model = modelsRef.current.get(id)
    if (model && !model.isDisposed()) return model
    model = monaco.editor.createModel(content, 'r')
    modelsRef.current.set(id, model)
    return model
  }, [])

  // Switch to active tab's model
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeTabId) return

    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return

    const model = getOrCreateModel(tab.id, tab.content)
    const currentModel = editor.getModel()

    if (currentModel !== model) {
      suppressChangeRef.current = true
      editor.setModel(model)
      suppressChangeRef.current = false
    }
  }, [activeTabId, tabs, getOrCreateModel])

  // Sync externally-applied content (e.g. from recording stop) into Monaco model
  useEffect(() => {
    if (!externalContentUpdate) return
    const { tabId, content } = externalContentUpdate

    const model = modelsRef.current.get(tabId)
    if (model && !model.isDisposed() && model.getValue() !== content) {
      suppressChangeRef.current = true
      model.setValue(content)
      suppressChangeRef.current = false
    }

    useEditorStore.setState({ externalContentUpdate: null })
  }, [externalContentUpdate])

  // Clean up disposed tab models
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id))
    for (const [id, model] of modelsRef.current) {
      if (!tabIds.has(id)) {
        model.dispose()
        modelsRef.current.delete(id)
      }
    }
  }, [tabs])

  // Apply Monaco theme on change
  useEffect(() => {
    monaco.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  const executeCode = useCallback(async (code: string) => {
    addEntry('input', code)
    addInputHistory(code)
    try {
      const res = await rClient.execute(code)
      if (!res.success && res.error) {
        addEntry('error', res.error)
      }
    } catch (err) {
      addEntry('error', String(err))
    }
  }, [addEntry, addInputHistory])

  const advanceCursor = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const pos = editor.getPosition()
    const model = editor.getModel()
    if (!pos || !model) return
    const lineCount = model.getLineCount()
    if (pos.lineNumber < lineCount) {
      editor.setPosition({ lineNumber: pos.lineNumber + 1, column: 1 })
      editor.revealLine(pos.lineNumber + 1)
    }
  }, [])

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor

    // Set initial model for active tab
    const activeTab = useEditorStore.getState().getActiveTab()
    if (activeTab) {
      const model = getOrCreateModel(activeTab.id, activeTab.content)
      suppressChangeRef.current = true
      editor.setModel(model)
      suppressChangeRef.current = false
    }

    // Track content changes
    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return
      const currentTabId = useEditorStore.getState().activeTabId
      if (!currentTabId) return
      const value = editor.getValue()
      updateTabContent(currentTabId, value)
      saveSessionDebounced()
      queryRef.current(false)
    })

    // Autocomplete popup: intercept navigation keys while it is open, and
    // dismiss it on explicit caret moves / blur.
    editor.onKeyDown((e) => {
      const c = compRef.current
      if (!c.state.open) return
      const K = monaco.KeyCode
      const stop = (): void => { e.preventDefault(); e.stopPropagation() }
      if (e.keyCode === K.DownArrow) { stop(); c.move(1) }
      else if (e.keyCode === K.UpArrow) { stop(); c.move(-1) }
      else if (e.keyCode === K.Enter || e.keyCode === K.Tab) {
        stop()
        const res = c.accept()
        if (res) applyRef.current(res)
      } else if (e.keyCode === K.Escape) { stop(); c.close() }
      else if ([K.LeftArrow, K.RightArrow, K.Home, K.End].includes(e.keyCode)) c.close()
    })
    editor.onMouseDown(() => compRef.current.close())
    editor.onDidBlurEditorText(() => compRef.current.close())

    // Ctrl/Cmd+Space: manual trigger
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => queryRef.current(true))

    // Ctrl+Enter: run current line
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => runCurrentLine()
    )

    // Shift+Enter: run selection or current line
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => runSelection()
    )

    // Ctrl+S: save
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSave()
    )

    // Ctrl+N: new tab
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN,
      () => useEditorStore.getState().addTab()
    )

    // Ctrl+W: close tab
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW,
      () => {
        const id = useEditorStore.getState().activeTabId
        if (id) useEditorStore.getState().closeTab(id)
      }
    )
  }

  const handleSave = useCallback(async () => {
    const state = useEditorStore.getState()
    const tab = state.getActiveTab()
    if (!tab) return

    const editor = editorRef.current
    const content = editor ? editor.getValue() : tab.content

    // Function editor: execute the code in R instead of saving to disk
    if (tab.type === 'function-editor') {
      addEntry('input', content)
      addInputHistory(content)
      try {
        const res = await rClient.execute(content)
        if (!res.success && res.error) {
          addEntry('error', res.error)
        } else {
          // Mark as saved
          useEditorStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tab.id ? { ...t, savedContent: content, isDirty: false } : t
            )
          }))
        }
      } catch (err) {
        addEntry('error', String(err))
      }
      return
    }

    if (tab.filePath) {
      await window.electronAPI.file.write(tab.filePath, content)
      state.markTabSaved(tab.id, tab.filePath, content)
    } else {
      const filePath = await window.electronAPI.dialog.saveFile()
      if (filePath) {
        await window.electronAPI.file.write(filePath, content)
        state.markTabSaved(tab.id, filePath, content)
      }
    }
  }, [addEntry, addInputHistory])

  const runCurrentLine = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const position = editor.getPosition()
    if (!position) return

    const startLine = position.lineNumber
    const totalLines = model.getLineCount()

    // Skip all consecutive blank lines and land on the next non-blank line
    if (!model.getLineContent(startLine).trim()) {
      let next = startLine + 1
      while (next <= totalLines && !model.getLineContent(next).trim()) next++
      next = Math.min(next, totalLines)
      editor.setPosition({ lineNumber: next, column: 1 })
      editor.revealLine(next)
      return
    }

    const endLine = findChunkEnd(model, startLine)

    const code = model.getValueInRange({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: model.getLineMaxColumn(endLine),
    }).trim()

    if (code) await executeCode(code)

    // Advance cursor past the entire chunk
    const next = Math.min(endLine + 1, totalLines)
    editor.setPosition({ lineNumber: next, column: 1 })
    editor.revealLine(next)
  }, [executeCode])

  const runSelection = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    const selection = editor.getSelection()
    if (!selection) return

    const model = editor.getModel()
    if (!model) return

    let code: string
    if (selection.isEmpty()) {
      code = model.getLineContent(selection.startLineNumber).trim()
    } else {
      code = model.getValueInRange(selection).trim()
    }

    if (code) await executeCode(code)
  }, [executeCode])

  const runAll = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const code = editor.getValue().trim()
    if (code) await executeCode(code)
  }, [executeCode])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isDataViewer = activeTab?.type === 'data-viewer'

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <TabBar />

      {/* DataViewer overlay — shown when active tab is data-viewer */}
      {isDataViewer && activeTab && (
        <div className="flex-1 min-h-0">
          {/* key by tab identity so switching datasets remounts a fresh viewer
              instead of reusing one instance whose row/column state would
              otherwise show the previously viewed dataset until a refresh. */}
          <DataViewer key={activeTab.id} tab={activeTab} />
        </div>
      )}

      {/* Editor toolbar + Monaco — hidden (not unmounted) when data-viewer is active */}
      <div className={`flex flex-col flex-1 min-h-0 ${isDataViewer ? 'hidden' : ''}`}>
        {/* Editor toolbar */}
        <div className="flex items-center justify-between px-3 py-1 border-b border-geo-border flex-shrink-0">
          <span className="text-xs text-geo-muted">
            <kbd className="px-1 py-0.5 rounded border border-geo-border text-[10px]">Ctrl+Enter</kbd> run line &nbsp;
            <kbd className="px-1 py-0.5 rounded border border-geo-border text-[10px]">Shift+Enter</kbd> run selection
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => runCurrentLine()}>
              <ChevronRight className="w-3 h-3" />
              Line
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={runAll}>
              <Play className="w-3 h-3" />
              Run All
            </Button>
          </div>
        </div>

        {/* Monaco editor */}
        <div className="flex-1 min-h-0 relative">
          {/* Base panel colour + faint themed artwork behind the (transparent)
              editor. The scoped `.ourgeo-editor-canvas` class makes Monaco's own
              background transparent so this shows through beneath the code. */}
          <div className="absolute inset-0 bg-geo-panel" />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url("${artUri}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'grayscale(1)',
              opacity: 0.15,
            }}
          />
          <div className="absolute inset-0 ourgeo-editor-canvas">
          <MonacoEditor
            height="100%"
            theme={monacoTheme}
            options={{
              fontSize: Math.round(13 * uiScale),
              fontFamily: 'JetBrains Mono, Fira Code, monospace',
              minimap: { enabled: false },
              lineNumbers: 'on',
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
              padding: { top: 8 },
              // Our custom completion popup replaces Monaco's native suggest.
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              wordBasedSuggestions: 'off',
              parameterHints: { enabled: false },
              tabCompletion: 'off'
            }}
            onMount={handleMount}
          />
          {comp.state.open && menuPos && (
            <CompletionPopup
              candidates={comp.state.candidates}
              selected={comp.state.selected}
              left={menuPos.left}
              top={menuPos.top}
              lineHeight={menuPos.height}
              onPick={(i) => {
                const res = comp.accept(i)
                if (res) applyAccept(res)
              }}
              onHover={(i) => comp.setSelected(i)}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
