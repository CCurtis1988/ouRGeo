import React, { useCallback, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ConsoleEntry } from '@/store/session'
import { cn } from '@/lib/utils'

const EntryLine = React.memo(function EntryLine({ entry }: { entry: ConsoleEntry }): React.ReactElement {
  const colour = { input: 'text-geo-accent', output: 'text-foreground', error: 'text-geo-error', info: 'text-geo-muted' }[entry.type]
  return <div className={cn('font-mono text-xs leading-relaxed whitespace-pre-wrap break-all', colour)}>{entry.type === 'input' ? '> ' : ''}{entry.text}</div>
})

/** Keep the complete immutable history in the store, but measure only visible
 * output. Multiline/wrapped entries keep their actual height and colour. */
export function ConsoleHistory({ history }: { history: ConsoleEntry[] }): React.ReactElement {
  const parent = useRef<HTMLDivElement>(null)
  const large = history.length > 2000
  const getItemKey = useCallback((index: number) => history[index].id, [history])
  const rows = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: large ? history.length : 0, getScrollElement: () => parent.current,
    estimateSize: () => 22, getItemKey, overscan: 10, enabled: large,
  })
  useLayoutEffect(() => {
    if (!parent.current) return
    if (!large) { parent.current.scrollTop = parent.current.scrollHeight; return }
    rows.scrollToIndex(history.length - 1, { align: 'end' })
    const frame = requestAnimationFrame(() => rows.scrollToIndex(history.length - 1, { align: 'end' }))
    return () => cancelAnimationFrame(frame)
  }, [history, large, rows])
  return <div ref={parent} role="region" aria-label="R console output" className="flex-1 min-h-0 overflow-auto px-3 py-2">
    {!history.length ? <div className="text-xs text-geo-muted italic">R console ready. Type code below or use the editor above.</div>
      : large ? <div style={{ height: rows.getTotalSize(), position: 'relative', width: '100%' }}>
        {rows.getVirtualItems().map(row => <div key={row.key} data-index={row.index} ref={rows.measureElement} className="pb-0.5" style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}><EntryLine entry={history[row.index]} /></div>)}
      </div> : <div className="space-y-0.5">{history.map(entry => <EntryLine key={entry.id} entry={entry} />)}</div>}
  </div>
}
