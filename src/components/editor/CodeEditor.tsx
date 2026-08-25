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

import { type DocLanguage, languageOf, monacoLanguageFor, isMarkdownDoc, labelFor, supportsChunks } from '@/lib/markdown/doc-kind'
import { LanguageSelector } from './LanguageSelector'
import { KnitMenu } from './KnitMenu'
import { VisualEditor, type VisualEditorHandle } from './visual/VisualEditor'
import { RoundTripWarningDialog } from './RoundTripWarningDialog'
import { splitFrontMatter, joinFrontMatter } from '@/lib/markdown/front-matter'
import { roundTripReport, shouldWarn, normalize, type RoundTripReport } from '@/lib/markdown/roundtrip'
import { Eye, Code2 } from 'lucide-react'
import { MarkdownRibbon, type MarkdownRibbonBackend } from './MarkdownRibbon'
import { resolveActionBody } from '@/lib/markdown/actions'
import { computeMdEdit } from '@/lib/markdown/apply-source'
import { scanChunks, chunkAtLine, runnableChunks } from '@/lib/markdown/chunks'
import { reconcileChunks, toPrev, type IdentifiedChunk, type PrevChunk } from '@/lib/markdown/chunk-identity'
import { MonacoChunkLayer } from './chunks/monacoChunkLayer'
import { ChunkOutputView } from './chunks/ChunkOutputView'
import { useChunkStore } from '@/store/chunks'
import { createPortal } from 'react-dom'
import { registerRMarkdownLanguage } from '@/lib/markdown/rmarkdown-monarch'

loader.config({ monaco })

// R Markdown needs its own grammar: Monaco's stock markdown fence rule can't
// match a `{r label}` chunk header, so chunk bodies would render as prose.
registerRMarkdownLanguage(monaco)

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
  // Commands registered in handleMount capture their closures once, so they read
  // the current document language through a ref rather than a captured value.
  const docLangRef = useRef<DocLanguage>('r')
  // Chunk plumbing. `chunkNodes` holds one detached DOM element per chunk that
  // React portals into; keeping them alive across a detach preserves the
  // output's scroll position and collapsed state when switching tabs.
  const chunkNodes = useRef<Map<string, HTMLElement>>(new Map())
  const prevChunks = useRef<Map<string, PrevChunk[]>>(new Map())
  const [chunks, setChunks] = useState<IdentifiedChunk[]>([])
  // Visual mode. `visualBaseline` is what the document serializes to on entry;
  // if it hasn't changed on exit we write back the ORIGINAL text, so toggling
  // in and straight back out leaves the file byte-identical.
  const visualRef = useRef<VisualEditorHandle>(null)
  const visualBaseline = useRef<{ body: string; original: string; frontMatter: string } | null>(null)
  const [rtWarning, setRtWarning] = useState<RoundTripReport | null>(null)
  const chunksRef = useRef<IdentifiedChunk[]>([])
  chunksRef.current = chunks
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
    // Markdown documents get the markdown analyzer; R tabs and the console
    // never pass a mode, so they keep the default R path.
    compRef.current.query(
      model.getValue(), model.getOffsetAt(position), manual, docLangRef.current,
    )
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

  const chunkLayer = useRef<MonacoChunkLayer | null>(null)
  if (!chunkLayer.current) {
    chunkLayer.current = new MonacoChunkLayer({
      getOutputNode: (chunkId) => {
        let node = chunkNodes.current.get(chunkId)
        if (!node) {
          node = document.createElement('div')
          chunkNodes.current.set(chunkId, node)
        }
        return node
      },
      hasOutput: (chunkId) => {
        const tabId = useEditorStore.getState().activeTabId
        const out = tabId ? useChunkStore.getState().outputs[tabId]?.[chunkId] : undefined
        return !!out && out.status !== 'idle'
      },
      onRun: (chunkId) => { void runChunkRef.current(chunkId) },
    })
  }

  // Ribbon/slash backend. Offset-based edits through executeEdits, exactly like
  // applyAccept above — NOT applyExternalContent, which does a whole-model
  // setValue and would throw away the cursor and the undo stack.
  const mdBackend = useMemo<MarkdownRibbonBackend>(() => ({
    getText: () => editorRef.current?.getModel()?.getValue() ?? '',
    apply: (action) => {
      // In Visual mode the document is a ProseMirror doc, not text — route the
      // same catalog entry through the schema-aware backend instead.
      if (useEditorStore.getState().getActiveTab()?.viewMode === 'visual') {
        const ok = visualRef.current?.applyAction(action)
        if (!ok) {
          useSessionStore.getState().addConsoleEntry(
            'info',
            `"${action.label}" is only available in Source mode.`,
          )
        }
        return
      }
      const editor = editorRef.current
      const model = editor?.getModel()
      const sel = editor?.getSelection()
      if (!editor || !model || !sel) return
      const text = model.getValue()
      const resolved = resolveActionBody(action, text)
      const edit = computeMdEdit(
        text,
        model.getOffsetAt(sel.getStartPosition()),
        model.getOffsetAt(sel.getEndPosition()),
        resolved,
      )
      const start = model.getPositionAt(edit.from)
      const end = model.getPositionAt(edit.to)
      editor.executeEdits('markdown-action', [{
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        text: edit.insertText,
        forceMoveMarkers: true,
      }])
      const selStart = model.getPositionAt(edit.selStart)
      const selEnd = model.getPositionAt(edit.selEnd)
      editor.setSelection(new monaco.Range(
        selStart.lineNumber, selStart.column, selEnd.lineNumber, selEnd.column,
      ))
      editor.focus()
    },
  }), [])

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
  const getOrCreateModel = useCallback((
    id: string, content: string, language: DocLanguage,
  ): monaco.editor.ITextModel => {
    let model = modelsRef.current.get(id)
    if (model && !model.isDisposed()) return model
    model = monaco.editor.createModel(content, monacoLanguageFor(language))
    modelsRef.current.set(id, model)
    return model
  }, [])

  /** Re-scan chunks, reconcile ids against the previous pass, and re-render the
   *  Monaco surfaces. Cheap (a line scan) so it can run on every change. */
  const rescanChunks = useCallback((): void => {
    const tabId = useEditorStore.getState().activeTabId
    const model = editorRef.current?.getModel()
    const tab = tabId ? useEditorStore.getState().tabs.find((t) => t.id === tabId) : undefined
    if (!tabId || !model || !tab || !supportsChunks(languageOf(tab))) {
      if (chunksRef.current.length > 0) setChunks([])
      return
    }
    const prev = prevChunks.current.get(tabId) ?? []
    const next = reconcileChunks(prev, scanChunks(model.getValue()))
    prevChunks.current.set(tabId, toPrev(next))

    // An edited chunk keeps its id and its output, but the output is now
    // evidence of code that no longer exists — mark it, don't drop it.
    const changed = next.filter((c) => c.codeChanged).map((c) => c.id)
    if (changed.length > 0) useChunkStore.getState().markStale(tabId, changed)
    useChunkStore.getState().prune(tabId, new Set(next.map((c) => c.id)))

    setChunks(next)
  }, [])
  const rescanRef = useRef(rescanChunks)
  rescanRef.current = rescanChunks

  // Switch to active tab's model
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeTabId) return

    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return

    const model = getOrCreateModel(tab.id, tab.content, languageOf(tab))
    const currentModel = editor.getModel()

    if (currentModel !== model) {
      // View zones, content widgets and decorations belong to the EDITOR, not
      // the model. Tear them down BEFORE the swap or the previous tab's outputs
      // float inside this tab's text at meaningless line numbers.
      chunkLayer.current?.detach()
      suppressChangeRef.current = true
      editor.setModel(model)
      suppressChangeRef.current = false
      chunkLayer.current?.attach(editor, tab.id)
      rescanRef.current()
    }
  }, [activeTabId, tabs, getOrCreateModel])

  // Push the reconciled chunk list into Monaco whenever it changes.
  useEffect(() => { chunkLayer.current?.render(chunks) }, [chunks])

  // …and whenever a chunk's OUTPUT changes. A zone only exists once its chunk
  // has output, so without this the layer never learns that a run finished and
  // no zone is ever created.
  useEffect(() => {
    if (!activeTabId) return
    return useChunkStore.subscribe((state, prev) => {
      if (state.outputs[activeTabId] === prev.outputs[activeTabId]) return
      chunkLayer.current?.render(chunksRef.current)
      // Output content just changed size; re-measure on the next frame.
      requestAnimationFrame(() => chunkLayer.current?.relayout())
    })
  }, [activeTabId])

  // Re-language a model when the user switches an open tab's type. Done in an
  // effect rather than during render — setModelLanguage retokenizes the model.
  useEffect(() => {
    if (!activeTabId) return
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const model = modelsRef.current.get(tab.id)
    if (!model || model.isDisposed()) return
    const next = monacoLanguageFor(languageOf(tab))
    if (model.getLanguageId() !== next) monaco.editor.setModelLanguage(model, next)
  }, [activeTabId, tabs])

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
        // Chunk outputs hold base64 PNGs — dropping the tab must drop those too.
        useChunkStore.getState().clearTab(id)
        prevChunks.current.delete(id)
      }
    }
  }, [tabs])

  // Apply Monaco theme on change
  useEffect(() => {
    monaco.editor.setTheme(monacoTheme)
  }, [monacoTheme])

  // ── Chunk execution ──────────────────────────────────────────────────────
  const runChunkById = useCallback(async (chunkId: string): Promise<void> => {
    const tabId = useEditorStore.getState().activeTabId
    if (!tabId) return
    const chunk = chunksRef.current.find((c) => c.id === chunkId)
    if (!chunk || !chunk.runnable || chunk.unterminated) return

    const store = useChunkStore.getState()
    store.set(tabId, chunkId, { status: 'running', stale: false, error: null })
    // Echo to the console so it stays a complete record of what ran.
    addEntry('input', chunk.code)
    try {
      const res = await rClient.executeChunk(chunk.code, chunk.header.options)
      if (res.output) addEntry('output', res.output)
      if (res.error) addEntry('error', res.error)
      store.set(tabId, chunkId, {
        status: res.success ? 'done' : 'error',
        stdout: res.output ?? '',
        error: res.error ?? null,
        plots: (res.plots ?? []).map((dataUrl, i) => ({
          dataUrl, plotId: res.plotIds?.[i] ?? null,
        })),
        skipped: !!res.skipped,
        durationMs: res.durationMs ?? null,
        stale: false,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      addEntry('error', msg)
      store.set(tabId, chunkId, { status: 'error', error: msg, stale: false })
    }
  }, [addEntry])
  const runChunkRef = useRef(runChunkById)
  runChunkRef.current = runChunkById
  const runChunkAtCursorRef = useRef<() => Promise<void>>(async () => {})

  /** Run the chunk containing the caret. */
  const runChunkAtCursor = useCallback(async (): Promise<void> => {
    const line = editorRef.current?.getPosition()?.lineNumber
    if (line == null) return
    const chunk = chunkAtLine(chunksRef.current, line)
    if (chunk) await runChunkRef.current(chunk.id)
  }, [])
  runChunkAtCursorRef.current = runChunkAtCursor

  /** Run every runnable chunk, in document order.
   *  Sequential on purpose: R executes serially, so Promise.all would just
   *  queue them at the server while the UI claimed they were all running. */
  const runAllChunks = useCallback(async (): Promise<void> => {
    const tabId = useEditorStore.getState().activeTabId
    if (!tabId) return
    const list = runnableChunks(chunksRef.current)
    const store = useChunkStore.getState()
    for (const c of list) store.set(tabId, c.id, { status: 'queued' })
    for (const c of list) await runChunkRef.current(c.id)
  }, [])

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
      const model = getOrCreateModel(activeTab.id, activeTab.content, languageOf(activeTab))
      suppressChangeRef.current = true
      editor.setModel(model)
      suppressChangeRef.current = false
      chunkLayer.current?.attach(editor, activeTab.id)
      rescanRef.current()
    }

    // Track content changes
    editor.onDidChangeModelContent(() => {
      if (suppressChangeRef.current) return
      const currentTabId = useEditorStore.getState().activeTabId
      if (!currentTabId) return
      const value = editor.getValue()
      updateTabContent(currentTabId, value)
      saveSessionDebounced()
      rescanRef.current()
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

    // Run the chunk under the caret. Registered unconditionally; the handler
    // no-ops outside a markdown document.
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => { void runChunkAtCursorRef.current() },
    )

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

  /** Save before knitting and hand back the path. rmarkdown::render works on a
   *  file, so an unsaved buffer has no directory for its relative paths to
   *  resolve against. Mirrors RStudio, and avoids a class of "can't find my
   *  data" failures. */
  const handleSaveForKnit = useCallback(async (): Promise<string | null> => {
    const state = useEditorStore.getState()
    const tab = state.getActiveTab()
    if (!tab) return null
    const content = modelsRef.current.get(tab.id)?.getValue() ?? tab.content
    let path = tab.filePath
    if (!path) {
      path = await window.electronAPI.dialog.saveFile(languageOf(tab))
      if (!path) return null
    }
    await window.electronAPI.file.write(path, content)
    state.markTabSaved(tab.id, path, content)
    return path
  }, [])

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
      const filePath = await window.electronAPI.dialog.saveFile(languageOf(tab))
      if (filePath) {
        await window.electronAPI.file.write(filePath, content)
        state.markTabSaved(tab.id, filePath, content)
      }
    }
  }, [addEntry, addInputHistory])

  const runCurrentLine = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    // Prose is not R. Inside a chunk, run that chunk; in prose, do nothing
    // rather than firing the surrounding text at the interpreter.
    if (isMarkdownDoc(docLangRef.current)) { await runChunkAtCursorRef.current(); return }
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
    if (isMarkdownDoc(docLangRef.current)) return

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
    // Guard: on a markdown document getValue() is prose, not R. Without this,
    // Run All would send the entire document to the interpreter.
    if (isMarkdownDoc(docLangRef.current)) return
    const code = editor.getValue().trim()
    if (code) await executeCode(code)
  }, [executeCode])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const isDataViewer = activeTab?.type === 'data-viewer'
  const isVisual = activeTab?.viewMode === 'visual'

  /** Enter Visual mode, warning first when the round trip would rewrite the file. */
  const enterVisual = useCallback((force = false): void => {
    const tab = useEditorStore.getState().getActiveTab()
    const model = tab ? modelsRef.current.get(tab.id) : undefined
    if (!tab || !model) return
    const original = model.getValue()
    const { frontMatter, body } = splitFrontMatter(original)

    if (!force) {
      const report = roundTripReport(body)
      if (shouldWarn(report)) { setRtWarning(report); return }
    }
    visualBaseline.current = { body: normalize(body), original, frontMatter }
    useEditorStore.getState().setTabViewMode(tab.id, 'visual')
  }, [])

  /** Leave Visual mode, writing the document back into the Monaco model. */
  const exitVisual = useCallback((): void => {
    const tab = useEditorStore.getState().getActiveTab()
    const model = tab ? modelsRef.current.get(tab.id) : undefined
    const base = visualBaseline.current
    if (!tab || !model) return

    const edited = visualRef.current?.getMarkdown() ?? null
    if (edited != null && base) {
      // Unchanged in Visual → restore the original text verbatim. Without this,
      // a look-and-leave would reformat the file and mark it dirty.
      const next = edited === base.body
        ? base.original
        : joinFrontMatter(base.frontMatter, edited)
      if (next !== model.getValue()) {
        // pushEditOperations, not setValue: setValue resets Monaco's undo stack,
        // which would make the whole Visual session unundoable.
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: next }],
          () => null,
        )
        useEditorStore.getState().updateTabContent(tab.id, next)
      }
    }
    visualBaseline.current = null
    useEditorStore.getState().setTabViewMode(tab.id, 'source')
  }, [])
  const docLang = languageOf(activeTab)
  const isMarkdown = isMarkdownDoc(docLang)
  // Keep the ref the once-registered Monaco commands read in sync.
  docLangRef.current = docLang

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
            {isMarkdown ? (
              supportsChunks(docLang) ? (
                <>
                  <kbd className="px-1 py-0.5 rounded border border-geo-border text-[10px]">Ctrl+Enter</kbd> run chunk at cursor
                </>
              ) : labelFor(docLang)
            ) : (
              <>
                <kbd className="px-1 py-0.5 rounded border border-geo-border text-[10px]">Ctrl+Enter</kbd> run line &nbsp;
                <kbd className="px-1 py-0.5 rounded border border-geo-border text-[10px]">Shift+Enter</kbd> run selection
              </>
            )}
          </span>
          <div className="flex gap-1 items-center">
            {isMarkdown && activeTab && (
              <Button
                variant="ghost" size="sm" className="h-6 text-xs gap-1"
                onClick={() => (isVisual ? exitVisual() : enterVisual())}
                title={isVisual
                  ? 'Edit the markdown source'
                  : 'Edit the rendered document'}
              >
                {isVisual ? <Code2 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {isVisual ? 'Source' : 'Visual'}
              </Button>
            )}
            {activeTab && (
              <LanguageSelector
                tabId={activeTab.id}
                language={docLang}
                disabled={activeTab.type !== 'code'}
              />
            )}
            {!isMarkdown && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => runCurrentLine()}>
              <ChevronRight className="w-3 h-3" />
              Line
            </Button>
            )}
            {!isMarkdown && (
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={runAll}>
              <Play className="w-3 h-3" />
              Run All
            </Button>
            )}
            {supportsChunks(docLang) && activeTab && (
              <KnitMenu
                filePath={activeTab.filePath}
                isDirty={activeTab.isDirty}
                onSaveRequest={handleSaveForKnit}
                onRevealLine={(line) => {
                  const editor = editorRef.current
                  if (!editor) return
                  editor.setPosition({ lineNumber: line, column: 1 })
                  editor.revealLineInCenter(line)
                  editor.focus()
                }}
              />
            )}
            {supportsChunks(docLang) && (
            <Button
              variant="ghost" size="sm" className="h-6 text-xs gap-1"
              onClick={() => { void runAllChunks() }}
              disabled={runnableChunks(chunks).length === 0}
              title="Run every chunk in document order"
            >
              <Play className="w-3 h-3" />
              Run All Chunks
            </Button>
            )}
          </div>
        </div>

        {/* Visual mode replaces the editor rather than splitting it, so only
            one of the two is ever mounted and there is no sync loop. */}
        {isVisual && activeTab && (
          <VisualEditor
            key={activeTab.id}
            ref={visualRef}
            initialValue={splitFrontMatter(
              modelsRef.current.get(activeTab.id)?.getValue() ?? activeTab.content
            ).body}
            onChange={() => { /* written back on exit; see exitVisual */ }}
          />
        )}

        {/* Monaco editor */}
        <div className={`flex-1 min-h-0 relative ${isVisual ? 'hidden' : ''}`}>
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

        {/* Chunk outputs. Rendered from THIS tree via portals into the view
            zones' DOM nodes, so they keep React context (theme, stores) —
            a createRoot per zone would lose it and leak. */}
        {activeTabId && chunks.map((c) => {
          const node = chunkNodes.current.get(c.id)
          return node
            ? createPortal(
                <ChunkOutputView tabId={activeTabId} chunkId={c.id} />,
                node,
                c.id,
              )
            : null
        })}

        {/* Markdown insert ribbon — last child of the editor column, so it takes
            height from the editor box and never disturbs the console split. */}
        {isMarkdown && (
          <MarkdownRibbon supportsChunks={supportsChunks(docLang)} backend={mdBackend} />
        )}
      </div>

      <RoundTripWarningDialog
        open={rtWarning !== null}
        report={rtWarning}
        onOpenChange={(o) => { if (!o) setRtWarning(null) }}
        onConfirm={() => { setRtWarning(null); enterVisual(true) }}
      />
    </div>
  )
}
