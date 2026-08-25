import React, { useEffect, useImperativeHandle, useRef, forwardRef, useCallback } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import { clipboard } from '@milkdown/kit/plugin/clipboard'
import type { MdActionDef } from '@/lib/markdown/actions'
import { applyVisualAction } from './apply-visual'

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
  applyAction(action: MdActionDef): boolean
  focus(): void
}

interface Props {
  /** Body markdown, front matter already split off by the caller. */
  initialValue: string
  onChange: (markdown: string) => void
}

export const VisualEditor = forwardRef<VisualEditorHandle, Props>(
  function VisualEditor({ initialValue, onChange }, ref) {
    const hostRef = useRef<HTMLDivElement>(null)
    const editorRef = useRef<Editor | null>(null)
    const ctxRef = useRef<Ctx | null>(null)
    const latest = useRef(initialValue)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange

    useEffect(() => {
      const host = hostRef.current
      if (!host) return
      let disposed = false

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
        if (ed) void ed.destroy()
      }
      // Mount once per tab; `initialValue` changes are a remount, driven by the
      // `key` the caller sets.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const applyAction = useCallback((action: MdActionDef): boolean => {
      const ctx = ctxRef.current
      if (!ctx) return false
      try {
        return applyVisualAction(ctx, action, latest.current)
      } catch {
        return false
      }
    }, [])

    useImperativeHandle(ref, () => ({
      getMarkdown: () => latest.current,
      applyAction,
      focus: () => {
        const ctx = ctxRef.current
        if (!ctx) return
        try { ctx.get(editorViewCtx).focus() } catch { /* not ready */ }
      },
    }), [applyAction])

    return (
      <div className="h-full overflow-y-auto bg-geo-panel">
        <div ref={hostRef} className="ourgeo-visual prose-ai px-6 py-4 max-w-3xl mx-auto" />
      </div>
    )
  }
)
