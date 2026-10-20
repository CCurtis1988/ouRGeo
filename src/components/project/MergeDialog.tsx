import React, { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../ui/button'
import { cn } from '@/lib/utils'
import { useMergeStore, type MergeChoices } from '@/lib/project-merge-flow'
import type { MergeItem, WholeChoice, ItemKind } from '@/lib/project-merge'
import type { HunkChoice, MergeSegment } from '@/lib/text-diff'
import type { MergeEnvItem } from '@/lib/r-client'
import type { TabState } from '@/store/editor'
import type { SpatialLayer } from '@/store/spatial'
import type { PlotEntry } from '@/store/plotting'
import type { AiChat } from '@/store/ai'
import type { ProjectFileEntry } from '@/lib/project-files'
import { fileSize } from '@/lib/project-files-ui'

// Resolve conflicts (docs/project-persistence-spec.md §1.9). Every changed
// item is listed; the ones changed on only one side say which and need
// nothing; the rest wait for a choice, and Finish waits for all of them.
// Everything can be inspected first — you cannot choose well between two
// versions you cannot see.

const KIND_LABEL: Record<ItemKind, string> = { doc: 'Document', r: 'R object', layer: 'Map layer', plot: 'Plot', chat: 'Chat', file: 'Project file' }
const keyOf = (item: MergeItem): string => `${item.kind}:${item.key}`
const conflicts = (item: MergeItem): number => item.segments?.filter(s => s.kind === 'conflict').length ?? 0

function decided(item: MergeItem, choices: MergeChoices): boolean {
  if (item.status !== 'conflict') return true
  const choice = choices[keyOf(item)]
  if (item.segments) return Array.isArray(choice) && choice.length === conflicts(item) && choice.every(Boolean)
  return typeof choice === 'string'
}

function statusText(item: MergeItem): string {
  switch (item.status) {
    case 'auto-mine': return item.mine === undefined ? 'You deleted it; theirs left it as it was. Removed.' : 'Only you changed it. Your version is kept.'
    case 'auto-theirs': return item.theirs === undefined ? 'They deleted it; you left it as it was. Removed.' : 'Only they changed it. Their version is taken.'
    case 'combined': return 'Both changed it, in different places. The changes are combined.'
    default: return item.segments ? 'Both changed the same lines. Choose for each highlighted part.' : 'Both changed it. Choose which to keep.'
  }
}

export function MergeDialog(): React.ReactElement | null {
  const session = useMergeStore(s => s.session)
  if (!session) return null
  return <MergeDialogBody key={session.path} />
}

function MergeDialogBody(): React.ReactElement {
  const session = useMergeStore(s => s.session)!
  const { items, rUnavailable } = session
  const [choices, setChoices] = useState<MergeChoices>({})
  const ordered = useMemo(() => [...items.filter(i => i.status === 'conflict'), ...items.filter(i => i.status !== 'conflict')], [items])
  const [selected, setSelected] = useState<string | null>(ordered[0] ? keyOf(ordered[0]) : null)
  const current = ordered.find(i => keyOf(i) === selected) ?? null
  const remaining = ordered.filter(i => !decided(i, choices)).length
  const pending = items.filter(i => i.status === 'conflict').length

  const setWhole = (item: MergeItem, choice: WholeChoice): void => setChoices(c => ({ ...c, [keyOf(item)]: choice }))
  const setHunk = (item: MergeItem, index: number, choice: HunkChoice): void => setChoices(c => {
    const list = Array.isArray(c[keyOf(item)]) ? [...(c[keyOf(item)] as HunkChoice[])] : new Array(conflicts(item)).fill(undefined)
    list[index] = choice
    return { ...c, [keyOf(item)]: list }
  })

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) session.resolve(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[305]" />
        <Dialog.Content data-ourgeo-id="project.mergeDialog" className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[305] w-[980px] max-w-[96vw] h-[82vh] flex flex-col bg-geo-panel border border-geo-border rounded-lg shadow-xl focus:outline-none">
          <div className="px-4 py-3 border-b border-geo-border shrink-0">
            <Dialog.Title className="text-sm font-semibold text-foreground">Resolve conflicts</Dialog.Title>
            <Dialog.Description className="text-xs text-geo-muted mt-1">
              Your version of {session.path.split(/[\\/]/).pop()} and the one saved elsewhere, compared with the version you opened.
              Nothing is written until Finish; Cancel leaves your version open and asks again next time.
              {rUnavailable && ' R was unavailable, so R objects are not compared: yours are kept.'}
            </Dialog.Description>
          </div>
          <div className="flex min-h-0 flex-1">
            <ul className="w-72 shrink-0 overflow-y-auto border-r border-geo-border py-1" aria-label="Changed items">
              {ordered.length === 0 && <li className="px-3 py-2 text-xs text-geo-muted">The two versions are the same.</li>}
              {ordered.map((item, index) => {
                const firstAuto = index === pending && item.status !== 'conflict'
                return <React.Fragment key={keyOf(item)}>
                  {index === 0 && pending > 0 && <li className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-geo-muted">Needs your choice</li>}
                  {firstAuto && <li className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-geo-muted">Combined automatically</li>}
                  <li>
                    <button type="button" onClick={() => setSelected(keyOf(item))}
                      className={cn('w-full text-left px-3 py-1.5 text-xs flex items-center gap-2', selected === keyOf(item) ? 'bg-geo-accent/15 text-foreground' : 'text-geo-muted hover:bg-white/5 hover:text-foreground')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', item.status !== 'conflict' ? 'bg-geo-muted' : decided(item, choices) ? 'bg-geo-success' : 'bg-geo-error')} />
                      <span className="truncate flex-1">{item.label}</span>
                      <span className="text-[10px] text-geo-muted shrink-0">{KIND_LABEL[item.kind]}</span>
                    </button>
                  </li>
                </React.Fragment>
              })}
            </ul>
            <div className="min-w-0 flex-1 overflow-y-auto p-4 space-y-3">
              {current ? <ItemDetail item={current} choices={choices} setWhole={setWhole} setHunk={setHunk} /> : <p className="text-xs text-geo-muted">Nothing differs.</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 border-t border-geo-border shrink-0">
            <span className="text-xs text-geo-muted flex-1">{remaining ? `${remaining} of ${pending} still need a choice` : `${items.length} change${items.length === 1 ? '' : 's'} ready to save`}</span>
            <Button variant="ghost" size="sm" onClick={() => session.resolve(null)}>Cancel</Button>
            <Button size="sm" disabled={remaining > 0} onClick={() => session.resolve(choices)} className="bg-geo-accent hover:bg-geo-accent/80 text-white" data-ourgeo-id="project.mergeFinish">Finish and save</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ItemDetail({ item, choices, setWhole, setHunk }: {
  item: MergeItem; choices: MergeChoices
  setWhole: (item: MergeItem, choice: WholeChoice) => void
  setHunk: (item: MergeItem, index: number, choice: HunkChoice) => void
}): React.ReactElement {
  const choice = choices[keyOf(item)]
  return <>
    <div>
      <h3 className="text-sm font-semibold text-foreground">{item.label} <span className="text-xs font-normal text-geo-muted">· {KIND_LABEL[item.kind]}</span></h3>
      <p className="text-xs text-geo-muted mt-1">{statusText(item)}</p>
    </div>
    {item.segments ? <TextMerge item={item} choice={Array.isArray(choice) ? choice : []} setHunk={setHunk} /> : <>
      <div className="grid grid-cols-2 gap-3">
        <Side title="Mine" present={item.mine !== undefined}><Inspect item={item} side="mine" /></Side>
        <Side title="Theirs" present={item.theirs !== undefined}><Inspect item={item} side="theirs" /></Side>
      </div>
      {item.status === 'conflict' && <div className="flex flex-wrap gap-2">
        {(['mine', 'theirs', 'both'] as const).map(c => (
          <Button key={c} size="sm" variant="ghost" onClick={() => setWhole(item, c)}
            className={cn('border', choice === c ? 'border-geo-accent bg-geo-accent/15 text-foreground' : 'border-geo-border')}>
            {c === 'mine' ? (item.mine === undefined ? 'Mine (deleted)' : 'Keep mine') : c === 'theirs' ? (item.theirs === undefined ? 'Theirs (deleted)' : 'Take theirs') : 'Keep both'}
          </Button>
        ))}
        <span className="text-[11px] text-geo-muted self-center">Keep both renames yours with a _mine suffix.</span>
      </div>}
    </>}
  </>
}

function Side({ title, present, children }: { title: string; present: boolean; children: React.ReactNode }): React.ReactElement {
  return <div className="rounded border border-geo-border p-2 min-w-0">
    <p className="text-[10px] uppercase tracking-wider text-geo-muted mb-1">{title}</p>
    {present ? children : <p className="text-xs text-geo-muted italic">Deleted in this version.</p>}
  </div>
}

function Inspect({ item, side }: { item: MergeItem; side: 'mine' | 'theirs' }): React.ReactElement | null {
  const value = item[side]
  if (value === undefined) return null
  if (item.kind === 'r') {
    const description = (value as MergeEnvItem).describe.find(d => d.side === side)
    if (!description) return <p className="text-xs text-geo-muted italic">Not in this version.</p>
    return <div className="text-xs space-y-1"><p className="text-foreground">{description.class} · {description.size}</p><pre className="text-[11px] whitespace-pre-wrap break-all text-geo-muted max-h-64 overflow-auto">{description.str}</pre></div>
  }
  if (item.kind === 'layer') {
    const layer = value as SpatialLayer
    const fields = Object.keys(layer.geojson?.features?.[0]?.properties ?? {})
    return <div className="text-xs space-y-1 text-geo-muted">
      <p className="text-foreground">{layer.kind === 'raster' ? 'Raster' : `${layer.geojson?.features?.length ?? 0} features · ${layer.geometryType}`}</p>
      {layer.kind !== 'raster' && <p>Fields: {fields.length ? fields.join(', ') : 'none'}</p>}
      <p>From R object <span className="font-mono">{layer.name}</span>{layer.envName ? ` in ${layer.envName}` : ''}; shown in WGS 84 (EPSG:4326)</p>
    </div>
  }
  if (item.kind === 'plot') return <img src={(value as PlotEntry).dataUrl} alt={`${side} plot`} className="max-w-full max-h-64 object-contain bg-white rounded" />
  if (item.kind === 'chat') {
    const chat = value as AiChat
    const last = [...chat.messages].reverse().find(m => m.role === 'user')
    return <div className="text-xs text-geo-muted space-y-1"><p className="text-foreground">{chat.messages.length} messages</p>{last && <p className="line-clamp-4">Last question: {String(last.content).slice(0, 300)}</p>}</div>
  }
  if (item.kind === 'file') {
    const file = value as ProjectFileEntry
    return <div className="text-xs text-geo-muted space-y-1"><p className="text-foreground">{file.folder ? `${file.folder}/` : ''}{file.name}</p><p>{fileSize(file.bytes)} · changed {new Date(file.updatedAt || file.importedAt).toLocaleString()}</p>{file.userDescription && <p>{file.userDescription}</p>}</div>
  }
  const doc = value as TabState
  return <pre className="text-[11px] whitespace-pre-wrap break-all text-geo-muted max-h-64 overflow-auto">{doc.content.slice(0, 4000)}</pre>
}

function TextMerge({ item, choice, setHunk }: { item: MergeItem; choice: HunkChoice[]; setHunk: (item: MergeItem, index: number, choice: HunkChoice) => void }): React.ReactElement {
  let hunk = -1
  return <div className="space-y-2">
    {(item.segments as MergeSegment[]).map((segment, i) => {
      if (segment.kind === 'text') return <pre key={i} className="text-[11px] whitespace-pre-wrap break-all text-geo-muted/70 max-h-32 overflow-auto border-l-2 border-geo-border pl-2">{segment.lines.join('\n') || ' '}</pre>
      const index = ++hunk
      const current = choice[index]
      const edited = typeof current === 'object' ? current.edited : null
      return <div key={i} className="rounded border border-geo-error/50 p-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><p className="text-[10px] uppercase tracking-wider text-geo-muted">Mine</p><pre className="text-[11px] whitespace-pre-wrap break-all text-foreground bg-geo-bg rounded p-1 max-h-48 overflow-auto">{segment.mine.join('\n') || '(nothing)'}</pre></div>
          <div><p className="text-[10px] uppercase tracking-wider text-geo-muted">Theirs</p><pre className="text-[11px] whitespace-pre-wrap break-all text-foreground bg-geo-bg rounded p-1 max-h-48 overflow-auto">{segment.theirs.join('\n') || '(nothing)'}</pre></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(['mine', 'theirs', 'both'] as const).map(c => (
            <Button key={c} size="sm" variant="ghost" onClick={() => setHunk(item, index, c)} className={cn('border', current === c ? 'border-geo-accent bg-geo-accent/15 text-foreground' : 'border-geo-border')}>
              {c === 'mine' ? 'Mine' : c === 'theirs' ? 'Theirs' : 'Both (mine first)'}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setHunk(item, index, { edited: [...segment.mine, ...segment.theirs].join('\n') })} className={cn('border', edited !== null ? 'border-geo-accent bg-geo-accent/15 text-foreground' : 'border-geo-border')}>Edit by hand</Button>
        </div>
        {edited !== null && <textarea aria-label="Edited text" value={edited} onChange={e => setHunk(item, index, { edited: e.target.value })} className="w-full h-32 font-mono text-[11px] bg-geo-bg border border-geo-border rounded p-1 text-foreground" />}
      </div>
    })}
  </div>
}
