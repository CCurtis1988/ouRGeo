import * as monaco from 'monaco-editor'
import type { IdentifiedChunk } from '@/lib/markdown/chunk-identity'

// Owns the three Monaco surfaces that make chunks visible in Source mode:
// background decorations, a Run affordance per chunk, and an output view zone.
//
// The single most important thing here: view zones, content widgets and
// decorations belong to the EDITOR, not the model. There is one editor and tabs
// swap via editor.setModel(), so leaving these attached would float tab A's
// outputs inside tab B's text at nonsense line numbers. Hence attach/detach.

export interface ChunkLayerHost {
  /** DOM node to mount this chunk's output into (React portals into it). */
  getOutputNode(chunkId: string): HTMLElement
  /** Whether a chunk currently has output worth showing a zone for. */
  hasOutput(chunkId: string): boolean
  onRun(chunkId: string): void
}

interface ZoneRec {
  zoneId: string
  /** The very object handed to addZone. Monaco reads its fields on layoutZone,
   *  so height and position updates must MUTATE this, not a copy. */
  zone: monaco.editor.IViewZone
  domNode: HTMLElement
  /** The wrapper we observe. Never observe the zone's own node — the height we
   *  set from the measurement would feed back into the measurement. */
  inner: HTMLElement
  heightPx: number
  afterLineNumber: number
}

export class MonacoChunkLayer {
  private editor: monaco.editor.IStandaloneCodeEditor | null = null
  private tabId: string | null = null
  private host: ChunkLayerHost
  private decorations: monaco.editor.IEditorDecorationsCollection | null = null
  private widgets = new Map<string, monaco.editor.IContentWidget>()
  private zones = new Map<string, ZoneRec>()
  private observers = new Map<string, ResizeObserver>()
  private chunks: IdentifiedChunk[] = []
  private rafPending = false

  constructor(host: ChunkLayerHost) {
    this.host = host
  }

  attach(editor: monaco.editor.IStandaloneCodeEditor, tabId: string): void {
    if (this.editor === editor && this.tabId === tabId) return
    this.detach()
    this.editor = editor
    this.tabId = tabId
    this.decorations = editor.createDecorationsCollection([])
  }

  /** Must be called BEFORE editor.setModel() when switching tabs. */
  detach(): void {
    const editor = this.editor
    if (editor) {
      for (const w of this.widgets.values()) editor.removeContentWidget(w)
      if (this.zones.size > 0) {
        editor.changeViewZones((acc) => {
          for (const z of this.zones.values()) acc.removeZone(z.zoneId)
        })
      }
    }
    for (const o of this.observers.values()) o.disconnect()
    this.observers.clear()
    this.widgets.clear()
    this.zones.clear()
    this.decorations?.clear()
    this.decorations = null
    this.chunks = []
    this.editor = null
    this.tabId = null
  }

  /** Re-sync all three surfaces to a freshly-scanned chunk list. */
  render(chunks: IdentifiedChunk[]): void {
    const editor = this.editor
    const model = editor?.getModel()
    if (!editor || !model) return
    this.chunks = chunks
    const live = new Set(chunks.map((c) => c.id))

    // 1. Background + gutter accent over each chunk.
    this.decorations?.set(chunks.map((c) => ({
      range: new monaco.Range(c.startLine, 1, c.endLine, 1),
      options: {
        isWholeLine: true,
        className: 'ourgeo-chunk-bg',
        linesDecorationsClassName: c.runnable
          ? 'ourgeo-chunk-bar'
          : 'ourgeo-chunk-bar ourgeo-chunk-bar-muted',
      },
    })))

    // 2. Run affordance. A CONTENT widget, anchored at the end of the fence
    //    line: content widgets scroll with the text, overlay widgets are
    //    viewport-fixed, and CodeLens would need a language-service provider
    //    (which this codebase deliberately has none of) plus a whole line.
    //    Anchored left-at-end rather than right-aligned because wordWrap is on.
    for (const [id, w] of this.widgets) {
      if (!live.has(id)) { editor.removeContentWidget(w); this.widgets.delete(id) }
    }
    for (const chunk of chunks) {
      if (!chunk.runnable || chunk.unterminated) {
        const existing = this.widgets.get(chunk.id)
        if (existing) { editor.removeContentWidget(existing); this.widgets.delete(chunk.id) }
        continue
      }
      const existing = this.widgets.get(chunk.id)
      if (existing) {
        ;(existing as MutableWidget).line = chunk.startLine
        editor.layoutContentWidget(existing)
        continue
      }
      const widget = this.makeRunWidget(chunk, model)
      this.widgets.set(chunk.id, widget)
      editor.addContentWidget(widget)
    }

    // 3. Output zones.
    for (const [id, z] of this.zones) {
      if (!live.has(id) || !this.host.hasOutput(id)) this.removeZone(id, z)
    }
    for (const chunk of chunks) {
      if (!this.host.hasOutput(chunk.id)) continue
      const after = chunk.endLine
      const existing = this.zones.get(chunk.id)
      if (existing) {
        if (existing.afterLineNumber !== after) {
          // Mutate the existing zone rather than remove+add: re-adding would
          // discard the DOM node and lose the output's scroll position.
          existing.afterLineNumber = after
          existing.zone.afterLineNumber = after
          editor.changeViewZones((acc) => acc.layoutZone(existing.zoneId))
        }
        continue
      }
      this.addZone(chunk.id, after)
    }
  }

  private makeRunWidget(
    chunk: IdentifiedChunk, model: monaco.editor.ITextModel,
  ): monaco.editor.IContentWidget {
    const dom = document.createElement('button')
    dom.className = 'ourgeo-chunk-run'
    dom.title = 'Run chunk (Ctrl+Shift+Enter)'
    dom.textContent = '▶'
    const id = chunk.id
    dom.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation() })
    dom.addEventListener('click', (e) => { e.preventDefault(); this.host.onRun(id) })

    const widget: MutableWidget = {
      line: chunk.startLine,
      getId: () => `ourgeo.chunk.run.${id}`,
      getDomNode: () => dom,
      getPosition: () => ({
        position: { lineNumber: widget.line, column: model.getLineMaxColumn(widget.line) },
        preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
      }),
    }
    return widget
  }

  private addZone(chunkId: string, afterLineNumber: number): void {
    const editor = this.editor
    if (!editor) return
    const domNode = document.createElement('div')
    domNode.className = 'ourgeo-chunk-zone'
    const inner = this.host.getOutputNode(chunkId)
    domNode.appendChild(inner)

    const zone: monaco.editor.IViewZone = {
      afterLineNumber,
      // heightInPx only — heightInLines is wrong under wordWrap: 'on'.
      heightInPx: 24,
      domNode,
    }
    let zoneId = ''
    editor.changeViewZones((acc) => { zoneId = acc.addZone(zone) })
    const rec: ZoneRec = { zoneId, zone, domNode, inner, heightPx: 24, afterLineNumber }
    this.zones.set(chunkId, rec)

    const ro = new ResizeObserver(() => this.scheduleLayout(chunkId))
    ro.observe(inner)
    this.observers.set(chunkId, ro)
    this.scheduleLayout(chunkId)
  }

  private removeZone(chunkId: string, rec: ZoneRec): void {
    this.editor?.changeViewZones((acc) => acc.removeZone(rec.zoneId))
    this.observers.get(chunkId)?.disconnect()
    this.observers.delete(chunkId)
    this.zones.delete(chunkId)
  }

  private scheduleLayout(_chunkId: string): void {
    // Coalesce: a burst of ResizeObserver callbacks during a render would
    // otherwise thrash changeViewZones.
    if (this.rafPending) return
    this.rafPending = true
    requestAnimationFrame(() => {
      this.rafPending = false
      for (const id of this.zones.keys()) this.layoutZone(id)
    })
  }

  private layoutZone(chunkId: string): void {
    const editor = this.editor
    const rec = this.zones.get(chunkId)
    if (!editor || !rec) return
    // The editor is hidden (not unmounted) when a data-viewer tab is active;
    // measuring then reports 0 and would collapse every zone.
    if (rec.inner.offsetParent === null && rec.inner.getClientRects().length === 0) return
    const next = Math.max(24, Math.ceil(rec.inner.scrollHeight))
    if (next === rec.heightPx) return
    rec.heightPx = next
    rec.zone.heightInPx = next
    editor.changeViewZones((acc) => acc.layoutZone(rec.zoneId))
  }

  /** Re-measure everything, e.g. after the editor becomes visible again. */
  relayout(): void {
    for (const id of this.zones.keys()) this.layoutZone(id)
  }

  getChunks(): IdentifiedChunk[] {
    return this.chunks
  }
}

interface MutableWidget extends monaco.editor.IContentWidget {
  line: number
}
