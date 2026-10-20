import React, { useEffect, useLayoutEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Columns2, Rows2, PanelsTopLeft, X } from 'lucide-react'
import { usePanelDragStore, type PendingPaneDrop } from '@/store/panelDrag'
import { useLayoutStore } from '@/store/layout'
import { panelInfo } from '@/lib/layout/panel-meta'
import type { DockPlacement } from '@/lib/layout/dock-tree'
import { cn } from '@/lib/utils'

export function PaneDropDialog(): React.ReactElement | null {
  const pending = usePanelDragStore(state => state.pending)
  const layout = useLayoutStore(state => state.layout)
  const enabled = useLayoutStore(state => state.dragEnabled)
  const cancel = usePanelDragStore(state => state.cancel)
  const valid = pending && pending.layout === layout && enabled && layout.open[pending.panel] && layout.open[pending.target]
  useEffect(() => { if (pending && !valid) cancel() }, [pending, valid, cancel])
  // A changed preset, closed pane or project switch invalidates the proposal.
  // There is no layout mutation to undo: choices are committed only at the end.
  if (!pending || !valid) return null
  return <DropChoice key={`${pending.panel}:${pending.target}`} pending={pending} />
}
function DropChoice({ pending }: { pending: PendingPaneDrop }): React.ReactElement {
  const [mode, setMode] = useState<'choose' | 'vertical' | 'horizontal'>('choose')
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const source = panelInfo(pending.panel)?.label ?? pending.panel, target = panelInfo(pending.target)?.label ?? pending.target
  const cancel = usePanelDragStore(state => state.cancel)
  useLayoutEffect(() => {
    const element = document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(pending.target)}"]`)
    if (!element) { cancel(); return }
    const group = element.closest<HTMLElement>('[data-pane-group]') ?? element
    const measure = (): void => { const rect = group.getBoundingClientRect(); setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }) }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(group)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [pending, cancel])
  useLayoutEffect(() => {
    if (mode !== 'choose') document.querySelector<HTMLElement>(`[data-ourgeo-id="layout.drop.${mode === 'vertical' ? 'left' : 'top'}"]`)?.focus()
  }, [mode])
  const commit = (placement: DockPlacement): void => {
    const state = useLayoutStore.getState()
    if (state.layout === pending.layout && state.dragEnabled) state.dockPanel(pending.panel, pending.target, placement)
    cancel()
  }
  const horizontal = mode === 'horizontal'
  const buttonClass = 'rounded-md border border-geo-border bg-geo-bg px-3 py-3 text-xs text-foreground hover:border-geo-accent hover:bg-geo-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent'
  return <Dialog.Root open onOpenChange={open => { if (!open) cancel() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-geo-bg/20" />
      <Dialog.Content data-ourgeo-id="layout.dropDialog" aria-describedby="pane-drop-description"
        className={cn('fixed z-50 overflow-hidden rounded-lg border border-geo-accent bg-geo-panel shadow-xl focus:outline-none', mode !== 'choose' && 'flex flex-col')}
        style={mode === 'choose' ? { left: Math.max(8, Math.min(pending.x - 160, window.innerWidth - 336)), top: Math.max(8, Math.min(pending.y + 12, window.innerHeight - 200)), width: Math.min(320, window.innerWidth - 16) } : box}
        onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(pending.panel)}"] button`)?.focus() }}>
        <div className="flex items-center gap-2 border-b border-geo-border px-3 py-2">
          {mode !== 'choose' && <button className="rounded p-1 text-geo-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-geo-accent" aria-label="Back to arrangement choices" onClick={() => setMode('choose')}><ArrowLeft size={14} /></button>}
          <Dialog.Title className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{mode === 'choose' ? `Arrange ${source}` : `Place ${source}`}</Dialog.Title>
          <button className="rounded p-1 text-geo-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-geo-accent" aria-label="Cancel pane move" onClick={cancel}><X size={14} /></button>
        </div>
        {mode === 'choose' ? <div className="p-3">
          <Dialog.Description id="pane-drop-description" className="mb-3 text-[11px] text-geo-muted">Choose how to arrange it with {target}.</Dialog.Description>
          <div className="grid grid-cols-3 gap-2">
            <button data-ourgeo-id="layout.dropVertical" className={buttonClass} onClick={() => setMode('vertical')}><Columns2 className="mx-auto mb-2" size={20} />Vertical<span className="mt-1 block text-[10px] text-geo-muted">Left / right</span></button>
            <button data-ourgeo-id="layout.dropHorizontal" className={buttonClass} onClick={() => setMode('horizontal')}><Rows2 className="mx-auto mb-2" size={20} />Horizontal<span className="mt-1 block text-[10px] text-geo-muted">Top / bottom</span></button>
            <button data-ourgeo-id="layout.dropTabs" className={buttonClass} onClick={() => commit('tab')}><PanelsTopLeft className="mx-auto mb-2" size={20} />Tab group<span className="mt-1 block text-[10px] text-geo-muted">Share a pane</span></button>
          </div>
        </div> : <>
          <Dialog.Description id="pane-drop-description" className="px-3 py-2 text-[11px] text-geo-muted">Choose a section. {target} stays in the other section.</Dialog.Description>
          <div className={cn('grid flex-1 min-h-0 gap-1 p-2', horizontal ? 'grid-rows-2' : 'grid-cols-2')}>
            {(horizontal ? ['top', 'bottom'] as const : ['left', 'right'] as const).map(side => <button key={side} data-ourgeo-id={`layout.drop.${side}`} aria-label={`Place ${source} ${side}`} onClick={() => commit(side)}
              className="flex min-w-0 min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border-2 border-dashed border-geo-accent/40 bg-geo-accent/5 p-2 text-foreground hover:border-geo-accent hover:bg-geo-accent/20 focus-visible:outline-none focus-visible:border-geo-accent focus-visible:bg-geo-accent/20">
              <span className="text-sm font-medium capitalize">{side}</span><span className="max-w-full truncate text-[11px] text-geo-muted">Move {source} here</span>
            </button>)}
          </div>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
