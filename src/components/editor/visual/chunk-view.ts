// Chunks in Visual mode.
//
// Milkdown's stock code_block renders a bare <pre> with no idea that
// ```` ```{r label, echo=FALSE} ```` means anything, so in Visual mode an .Rmd
// lost everything that makes a chunk a chunk: the label and options weren't
// shown, there was nothing to run, and the output computed in Source mode
// vanished the moment you switched.
//
// Two things are fixed here.
//
// 1. **Options survive the round trip.** mdast splits ```` ```{r a, echo=FALSE} ````
//    into `lang: "{r"` + `meta: "a, echo=FALSE}"`, and Milkdown's schema keeps
//    only `lang`. Everything after the first space was therefore DROPPED on the
//    way back to markdown — a silent edit to the user's document just for
//    looking at it in Visual mode. `chunkAwareCodeBlock` carries `meta` through
//    both directions.
//
// 2. **Chunks get their chrome back**: header, run button, inline output, and
//    syntax highlighting.
//
// The highlighted layer is a plain <pre> that hljs renders, shown while the
// caret is elsewhere; the real editable contentDOM takes over as soon as the
// selection enters the chunk. That is the plan's "upgrade on focus": a 50-chunk
// document costs 50 cheap <pre>s, not 50 editors.

import type { Ctx } from '@milkdown/kit/ctx'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import {
  Decoration, DecorationSet,
  type EditorView, type NodeView, type ViewMutationRecord,
} from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import hljs from 'highlight.js/lib/core'
import rLang from 'highlight.js/lib/languages/r'
import { parseChunkHeader, hashCode, type ChunkHeader } from '@/lib/markdown/chunks'

hljs.registerLanguage('r', rLang)

/** Class the focus plugin puts on the chunk holding the selection. */
const ACTIVE_CLASS = 'is-active'

/**
 * code_block that keeps its info-string tail.
 *
 * Without this, `{r setup, include=FALSE}` comes back as `{r}` — see the header
 * comment. Registered after the commonmark preset so it replaces the stock
 * schema for the same node id.
 */
export const chunkAwareCodeBlock = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const base = prev(ctx)
  return {
    ...base,
    attrs: {
      ...base.attrs,
      // Everything after the first token of the info string.
      meta: { default: '', validate: 'string' },
    },
    parseMarkdown: {
      match: ({ type }) => type === 'code',
      runner: (state, node, type) => {
        const language = (node.lang as string | null) ?? ''
        const meta = (node.meta as string | null) ?? ''
        state.openNode(type, { language, meta })
        const value = node.value as string
        if (value) state.addText(value)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'code_block',
      runner: (state, node) => {
        state.addNode('code', undefined, node.content.firstChild?.text || '', {
          lang: node.attrs.language,
          meta: node.attrs.meta || null,
        })
      },
    },
  }
})

/** Rebuild the full info string a chunk fence would carry. */
function infoString(node: ProseNode): string {
  const lang = String(node.attrs.language ?? '')
  const meta = String(node.attrs.meta ?? '')
  return meta ? `${lang} ${meta}` : lang
}

/** Parse a code block's info string as a knitr chunk header, or null. */
export function chunkHeaderOf(node: ProseNode): ChunkHeader | null {
  // parseChunkHeader wants the braces, exactly as the fence carries them.
  return parseChunkHeader(infoString(node).trim())
}

/**
 * The id this chunk's output is stored under.
 *
 * Mirrors chunk-identity.ts so a chunk run in Source mode still shows its output
 * in Visual mode and back. A label is the stable key — which is exactly why the
 * ribbon auto-labels every chunk it creates.
 */
export function visualChunkId(header: ChunkHeader, code: string, ordinal: number): string {
  return header.label ? `label:${header.label}` : `anon:${hashCode(code + ':' + ordinal)}`
}

export interface ChunkViewHooks {
  /** Run a chunk. `id` is the output key; `options` are the header options. */
  onRun(id: string, code: string, options: Record<string, string>): void
  /** Hand the caller a DOM node to portal this chunk's output into. */
  mountOutput(id: string, host: HTMLElement): void
  unmountOutput(id: string): void
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const n = document.createElement(tag)
  if (className) n.className = className
  if (text !== undefined) n.textContent = text
  return n
}

class ChunkCodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement

  private head: HTMLElement | null = null
  private labelEl: HTMLElement | null = null
  private optsEl: HTMLElement | null = null
  private highlight: HTMLElement
  private outputHost: HTMLElement | null = null
  private mountedId: string | null = null
  private lastCode = ''
  private lastLang = ''

  constructor(
    private node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private hooks: ChunkViewHooks,
  ) {
    this.dom = el('div', 'ourgeo-vchunk')
    this.highlight = el('pre', 'ourgeo-vchunk-hl')
    this.highlight.appendChild(el('code'))
    this.contentDOM = el('code')
    const srcPre = el('pre', 'ourgeo-vchunk-src')
    srcPre.appendChild(this.contentDOM)

    // Clicking the read-only layer must still place the caret where the user
    // clicked, since the editable layer is hidden at that moment.
    this.highlight.addEventListener('mousedown', (e) => this.focusFromPoint(e))

    this.dom.appendChild(this.highlight)
    this.dom.appendChild(srcPre)
    this.render(true)
  }

  /** Rebuild chrome + highlighting. `force` skips the did-anything-change test. */
  private render(force: boolean): void {
    const header = chunkHeaderOf(this.node)
    const code = this.node.textContent
    const lang = header?.engine ?? String(this.node.attrs.language ?? '')
    if (!force && code === this.lastCode && lang === this.lastLang) return
    this.lastCode = code
    this.lastLang = lang

    this.dom.classList.toggle('is-chunk', !!header)
    if (header) this.ensureChrome(header, code)
    else this.dropChrome()

    // hljs only knows the languages we register; anything else stays plain.
    const codeEl = this.highlight.firstElementChild as HTMLElement
    if (lang === 'r' && code) {
      codeEl.innerHTML = hljs.highlight(code, { language: 'r', ignoreIllegals: true }).value
    } else {
      codeEl.textContent = code
    }
  }

  /** Ordinal among the document's code blocks — the unlabelled-chunk fallback key. */
  private ordinal(): number {
    const pos = this.getPos()
    if (pos == null) return 0
    let n = 0
    this.view.state.doc.descendants((child, childPos) => {
      if (childPos >= pos) return false
      if (child.type.name === 'code_block') n++
      return true
    })
    return n
  }

  private chunkId(header: ChunkHeader): string {
    return visualChunkId(header, this.node.textContent, this.ordinal())
  }

  private ensureChrome(header: ChunkHeader, code: string): void {
    if (!this.head) {
      this.head = el('div', 'ourgeo-vchunk-head')
      const engine = el('span', 'ourgeo-vchunk-engine')
      this.labelEl = el('span', 'ourgeo-vchunk-label')
      this.optsEl = el('span', 'ourgeo-vchunk-opts')
      const run = el('button', 'ourgeo-vchunk-run', '▶')
      run.title = 'Run this chunk'
      run.addEventListener('mousedown', (e) => e.preventDefault())
      run.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const h = chunkHeaderOf(this.node)
        if (!h) return
        this.hooks.onRun(this.chunkId(h), this.node.textContent, h.options)
      })
      this.head.append(engine, this.labelEl, this.optsEl, run)
      this.dom.insertBefore(this.head, this.dom.firstChild)

      this.outputHost = el('div', 'ourgeo-vchunk-out')
      this.dom.appendChild(this.outputHost)
    }
    const engineEl = this.head.firstElementChild as HTMLElement
    engineEl.textContent = header.engine
    this.labelEl!.textContent = header.label ?? ''
    const opts = Object.entries(header.options).map(([k, v]) => `${k}=${v}`).join(', ')
    this.optsEl!.textContent = opts
    this.optsEl!.title = opts

    // The output host is keyed by chunk id; re-key when a label changes so the
    // portal follows the chunk rather than stranding output on a dead id.
    const id = visualChunkId(header, code, this.ordinal())
    if (id !== this.mountedId && this.outputHost) {
      if (this.mountedId) this.hooks.unmountOutput(this.mountedId)
      this.mountedId = id
      this.hooks.mountOutput(id, this.outputHost)
    }
  }

  private dropChrome(): void {
    if (this.head) { this.head.remove(); this.head = null }
    if (this.mountedId) { this.hooks.unmountOutput(this.mountedId); this.mountedId = null }
    if (this.outputHost) { this.outputHost.remove(); this.outputHost = null }
  }

  /**
   * Place the caret where the user clicked on the read-only layer.
   *
   * The highlighted layer renders exactly the chunk's text, so a character
   * offset within it maps 1:1 onto a ProseMirror position inside the node.
   */
  private focusFromPoint(e: MouseEvent): void {
    const pos = this.getPos()
    if (pos == null) return
    e.preventDefault()
    const offset = this.offsetFromPoint(e.clientX, e.clientY)
    const max = this.node.textContent.length
    const target = pos + 1 + Math.max(0, Math.min(offset, max))
    const { state } = this.view
    this.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)))
    this.view.focus()
  }

  private offsetFromPoint(x: number, y: number): number {
    // caretRangeFromPoint is the Chromium spelling; Electron always has it, but
    // the standards-track name is checked first so this isn't a trap elsewhere.
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    let container: Node | null = null
    let offset = 0
    const cp = doc.caretPositionFromPoint?.(x, y)
    if (cp) { container = cp.offsetNode; offset = cp.offset }
    else {
      const r = doc.caretRangeFromPoint?.(x, y)
      if (r) { container = r.startContainer; offset = r.startOffset }
    }
    if (!container || !this.highlight.contains(container)) return this.node.textContent.length

    // Measure by spanning the highlighted text from its start to the hit point.
    // Doing it with a Range rather than walking text nodes matters: a click in
    // the <pre>'s padding resolves to the ELEMENT, not a text node, and a walk
    // would never match it — every such click would land the caret at the end.
    try {
      const range = document.createRange()
      range.setStart(this.highlight, 0)
      range.setEnd(container, offset)
      return range.toString().length
    } catch {
      return this.node.textContent.length
    }
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(false)
    return true
  }

  /** PM must not try to read the highlight layer or the chrome as content. */
  ignoreMutation(m: ViewMutationRecord): boolean {
    return !this.contentDOM.contains(m.target)
  }

  /** Header clicks (the Run button) are ours, not ProseMirror's. */
  stopEvent(e: Event): boolean {
    const t = e.target as Node | null
    return !!(t && this.head?.contains(t))
  }

  destroy(): void {
    if (this.mountedId) this.hooks.unmountOutput(this.mountedId)
  }
}

/** Node-view factory for Milkdown's `$view`. */
export function chunkCodeBlockView(hooks: ChunkViewHooks) {
  return (_ctx: Ctx) =>
    (node: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView =>
      new ChunkCodeBlockView(node, view, getPos, hooks)
}

const activeChunkKey = new PluginKey('ourgeo-active-chunk')

/**
 * Marks the code block containing the selection.
 *
 * This is what "upgrade on focus" rides on: the class flips the node view from
 * its cheap highlighted <pre> to the real editable contentDOM in CSS, with no
 * per-chunk editor to construct or tear down.
 */
export const activeChunkPlugin = $prose(() => new Plugin({
  key: activeChunkKey,
  props: {
    decorations(state) {
      const { from, to } = state.selection
      const decos: Decoration[] = []
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name === 'code_block') {
          decos.push(Decoration.node(pos, pos + node.nodeSize, { class: ACTIVE_CLASS }))
        }
        return true
      })
      return decos.length ? DecorationSet.create(state.doc, decos) : null
    },
  },
}))
