import React, {
  useEffect, useImperativeHandle, useRef, useState, forwardRef, useCallback,
} from 'react'
import { createPortal } from 'react-dom'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import { $view, getMarkdown } from '@milkdown/kit/utils'
import type { MdActionDef } from '@/lib/markdown/actions'
import { minimizeEscapes } from '@/lib/markdown/escapes'
import { applyVisualAction } from './apply-visual'
import {
  chunkAwareCodeBlock, chunkCodeBlockView, activeChunkPlugin, type ChunkViewHooks,
} from './chunk-view'
import { ChunkOutputView } from '../chunks/ChunkOutputView'
import { CompletionPopup } from '@/components/completion/CompletionPopup'
import { markdownSlashMenu } from '@/lib/completion/engine'
import { MD_ACTION_BY_ID } from '@/lib/markdown/actions'
import type { CompletionCandidate } from '@/lib/completion/types'
import type { DocAnchor } from '@/lib/markdown/doc-position'
import {
  anchorFromView, caretAnchorFromView, setCaretAtAnchor, scrollAnchorToTop,
} from './anchor'
import { slashPlugin, type SlashSession, type SlashControl } from './slash'

// Visual (WYSIWYG) mode.
//
// Every Milkdown import in the app lives in this directory, behind
// VisualEditorHandle. The action catalog, chunk model, stores and ribbon never
// import it — so if Milkdown ever has to be swapped out, the blast radius is
// this folder.
//
// The markdown text always owns the truth. This is a projection: it is seeded
// from the text and reports changes back. Because entering Visual mode
// *replaces* the editor rather than splitting, only one of the two is ever
// mounted, so there is no two-way sync loop to get wrong.

export interface VisualEditorHandle {
  getMarkdown(): string
  /** What is on screen, in the form Source mode can honour. */
  getAnchor(): DocAnchor | null
  /** Where the cursor is. Only written back if the reader moved it. */
  getCaretAnchor(): DocAnchor | null
  /** Selected text, for seeding an action's prompt dialog. */
  getSelectionText(): string
  applyAction(action: MdActionDef, values?: Record<string, string>): boolean
  focus(): void
}

interface Props {
  /** Body markdown, front matter already split off by the caller. */
  initialValue: string
  onChange: (markdown: string) => void
  /** Owning tab — the key chunk output is stored under. */
  tabId: string
  /** Run a chunk. Same execution path as the Source-mode run button. */
  onRunChunk: (chunkId: string, code: string, options: Record<string, string>) => void
  /** `.Rmd`/`.qmd` — offers the chunk actions in the `/` menu. */
  supportsChunks: boolean
  /** What Source mode had on screen, so Visual opens at the same place. */
  initialAnchor?: DocAnchor | null
  /** Where Source mode's cursor was, so a toggle does not move it. */
  initialCaret?: DocAnchor | null
  /** An action needing a prompt dialog (link) — the host owns those. */
  onPromptAction: (actionId: string) => void
}

export const VisualEditor = forwardRef<VisualEditorHandle, Props>(
  function VisualEditor(
    {
      initialValue, onChange, tabId, onRunChunk, supportsChunks,
      initialAnchor, initialCaret, onPromptAction,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const ctxRef = useRef<Ctx | null>(null)
    const latest = useRef(initialValue)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onRunChunkRef = useRef(onRunChunk)
    onRunChunkRef.current = onRunChunk

    // Output hosts handed over by the chunk node views. React portals into them
    // from THIS tree rather than mounting a root per chunk, so the output keeps
    // its context (theme, stores) and is torn down with the editor.
    const [outputHosts, setOutputHosts] = useState<{ id: string; host: HTMLElement }[]>([])

    // `/` menu. The plugin owns detection and the navigation keys; this owns
    // which row is highlighted and what the list looks like, so the popup is
    // the same component the Source editor and the console use.
    const [slash, setSlash] = useState<SlashSession | null>(null)
    const [slashItems, setSlashItems] = useState<CompletionCandidate[]>([])
    const [slashSelected, setSlashSelected] = useState(0)
    const slashRef = useRef<{ session: SlashSession | null; items: CompletionCandidate[]; selected: number }>(
      { session: null, items: [], selected: 0 }
    )
    const slashControl = useRef<SlashControl>({ close: () => {} })
    const onPromptRef = useRef(onPromptAction)
    onPromptRef.current = onPromptAction
    const supportsChunksRef = useRef(supportsChunks)
    supportsChunksRef.current = supportsChunks
    // Read once, at mount: these are where Source mode was when the switch
    // happened, not something that keeps tracking it.
    const anchorRef = useRef(initialAnchor ?? null)
    const caretRef = useRef(initialCaret ?? null)

    const readMarkdownRef = useRef<() => string>(() => initialValue)
    const applyActionRef = useRef<(a: MdActionDef) => boolean>(() => false)

    const closeSlash = useCallback((): void => {
      slashControl.current.close()
      slashRef.current = { session: null, items: [], selected: 0 }
      setSlash(null)
      setSlashItems([])
      setSlashSelected(0)
    }, [])

    /** Apply the highlighted row: remove the typed `/query`, then run the action. */
    const acceptSlash = useCallback((): void => {
      const { session, items, selected } = slashRef.current
      const candidate = items[selected]
      if (!session || !candidate) { closeSlash(); return }
      const id = candidate.id.startsWith('markdown:')
        ? candidate.id.slice('markdown:'.length)
        : candidate.id
      session.consume()
      closeSlash()
      const action = MD_ACTION_BY_ID[id]
      if (!action) return
      // Link needs a URL before there is anything to insert; the host owns that
      // dialog, and routing through it keeps `/link` identical to the button.
      if (action.prompt) { onPromptRef.current(action.id); return }
      applyActionRef.current(action)
    }, [closeSlash])
    const acceptSlashRef = useRef(acceptSlash)
    acceptSlashRef.current = acceptSlash

    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      let disposed = false

      const hooks: ChunkViewHooks = {
        onRun: (id, code, options) => onRunChunkRef.current(id, code, options),
        mountOutput: (id, node) =>
          setOutputHosts((prev) =>
            prev.some((p) => p.id === id) ? prev : [...prev, { id, host: node }]),
        unmountOutput: (id) => setOutputHosts((prev) => prev.filter((p) => p.id !== id)),
      }

      const seed = initialValue
      void Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, host)
          ctx.set(defaultValueCtx, seed)
          ctx.get(listenerCtx).markdownUpdated((_c, markdown) => {
            latest.current = markdown
            onChangeRef.current(markdown)
          })
        })
        .config((ctx) => { ctxRef.current = ctx })
        .use(commonmark)
        .use(gfm)
        // After the preset: replaces the stock code_block so a chunk's options
        // survive the round trip, then gives it the chunk node view.
        .use(chunkAwareCodeBlock)
        .use($view(chunkAwareCodeBlock.node, chunkCodeBlockView(hooks)))
        .use(activeChunkPlugin)
        .use(slashPlugin({
          onSession: (session) => {
            if (!session) {
              slashRef.current = { session: null, items: [], selected: 0 }
              setSlash(null); setSlashItems([]); setSlashSelected(0)
              return
            }
            const items = markdownSlashMenu(
              readMarkdownRef.current(), supportsChunksRef.current, session.filter,
            )
            slashRef.current = { session, items, selected: 0 }
            setSlash(session); setSlashItems(items); setSlashSelected(0)
          },
          move: (delta) => {
            const { items, selected } = slashRef.current
            if (items.length === 0) return
            const next = (selected + delta + items.length) % items.length
            slashRef.current = { ...slashRef.current, selected: next }
            setSlashSelected(next)
          },
          accept: () => acceptSlashRef.current(),
        }, slashControl.current))
        .use(history)
        .use(listener)
        .use(clipboard)
        .create()
        .then((editor) => {
          if (disposed) { void editor.destroy(); return }
          editorRef.current = editor
          // Open where Source mode was looking, rather than at the top. Two
          // frames out: `create()` resolves before the view has been laid out,
          // and scrolling to a position in a box with no height does nothing.
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const ctx = ctxRef.current
            if (!ctx || disposed) return
            try {
              const view = ctx.get(editorViewCtx)
              // Cursor first and scroll second, and never the other way round:
              // the scroll is what the reader asked for, the cursor is only
              // being carried over so it does not silently jump to the top.
              if (caretRef.current) setCaretAtAnchor(view, caretRef.current)
              if (anchorRef.current) scrollAnchorToTop(view, anchorRef.current)
              view.focus()
            } catch { /* torn down, or an empty document */ }
          }))
        })
        .catch((e) => {
          // A failed Visual mount must not take the tab down — the caller falls
          // back to Source.
          console.error('Visual mode failed to initialise:', e)
        })

      return () => {
        disposed = true
        const ed = editorRef.current
        editorRef.current = null
        ctxRef.current = null
        setOutputHosts([])
        if (ed) void ed.destroy()
      }
      // Mount once per tab; `initialValue` changes are a remount, driven by the
      // `key` the caller sets.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /**
     * Serialize the CURRENT document.
     *
     * Not `latest.current`: Milkdown's listener debounces markdownUpdated by
     * 200 ms, so a snapshot taken from it silently drops whatever the user typed
     * in the last fifth of a second — including, reliably, the edit made just
     * before clicking "Source". The exit path must read the live doc.
     */
    const readMarkdown = useCallback((): string => {
      const ed = editorRef.current
      if (!ed) return latest.current
      try {
        // The serializer escapes defensively — every `_`, `*` and `~` in a text
        // node comes back with a backslash. Left alone, a document that merely
        // VISITED Visual mode returns with `geom\_line()` where the author
        // wrote `geom_line()`. minimizeEscapes takes back the ones that were
        // not carrying meaning, and only those.
        const md = minimizeEscapes(ed.action(getMarkdown()))
        latest.current = md
        return md
      } catch {
        return latest.current
      }
    }, [])
    readMarkdownRef.current = readMarkdown

    const applyAction = useCallback(
      (action: MdActionDef, values?: Record<string, string>): boolean => {
        const ctx = ctxRef.current
        if (!ctx) return false
        try {
          return applyVisualAction(ctx, action, readMarkdown(), values)
        } catch {
          return false
        }
      }, [readMarkdown])
    applyActionRef.current = applyAction

    useImperativeHandle(ref, () => ({
      getMarkdown: readMarkdown,
      getAnchor: () => {
        const ctx = ctxRef.current
        if (!ctx) return null
        try { return anchorFromView(ctx.get(editorViewCtx)) } catch { return null }
      },
      getCaretAnchor: () => {
        const ctx = ctxRef.current
        if (!ctx) return null
        try { return caretAnchorFromView(ctx.get(editorViewCtx)) } catch { return null }
      },
      // The Monaco selection is meaningless here — the document on screen is a
      // ProseMirror doc — so the prompt dialog has to ask this side for it.
      getSelectionText: () => {
        const ctx = ctxRef.current
        if (!ctx) return ''
        try {
          const { state } = ctx.get(editorViewCtx)
          const { from, to } = state.selection
          return from === to ? '' : state.doc.textBetween(from, to, ' ')
        } catch {
          return ''
        }
      },
      applyAction,
      focus: () => {
        const ctx = ctxRef.current
        if (!ctx) return
        try { ctx.get(editorViewCtx).focus() } catch { /* not ready */ }
      },
    }), [applyAction, readMarkdown])

    return (
      <div className="h-full overflow-y-auto bg-geo-panel">
        <div ref={hostRef} className="ourgeo-visual prose-ai px-6 py-4 max-w-3xl mx-auto" />
        {outputHosts.map(({ id, host }) =>
          createPortal(<ChunkOutputView tabId={tabId} chunkId={id} />, host, id)
        )}
        {slash && slashItems.length > 0 && (
          <CompletionPopup
            candidates={slashItems}
            selected={slashSelected}
            left={slash.coords.left}
            top={slash.coords.top}
            lineHeight={slash.coords.height}
            onPick={(i) => {
              slashRef.current = { ...slashRef.current, selected: i }
              acceptSlash()
            }}
            onHover={(i) => {
              slashRef.current = { ...slashRef.current, selected: i }
              setSlashSelected(i)
            }}
          />
        )}
      </div>
    )
  }
)
