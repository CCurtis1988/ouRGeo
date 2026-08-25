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
import { applyVisualAction } from './apply-visual'
import {
  chunkAwareCodeBlock, chunkCodeBlockView, activeChunkPlugin, type ChunkViewHooks,
} from './chunk-view'
import { ChunkOutputView } from '../chunks/ChunkOutputView'

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
}

export const VisualEditor = forwardRef<VisualEditorHandle, Props>(
  function VisualEditor({ initialValue, onChange, tabId, onRunChunk }, ref) {
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
        .use(history)
        .use(listener)
        .use(clipboard)
        .create()
        .then((editor) => {
          if (disposed) { void editor.destroy(); return }
          editorRef.current = editor
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
        const md = ed.action(getMarkdown())
        latest.current = md
        return md
      } catch {
        return latest.current
      }
    }, [])

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

    useImperativeHandle(ref, () => ({
      getMarkdown: readMarkdown,
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
      </div>
    )
  }
)
