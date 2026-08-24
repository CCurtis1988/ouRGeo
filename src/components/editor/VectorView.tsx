import React, { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { AddColumnDialog } from './AddColumnDialog'
import { ROW_HEIGHT, CHUNK_SIZE, editInitialValue } from './dataViewerShared'

export function VectorView({
  name,
  envName,
  accessPath,
  cls,
  tabId
}: {
  name: string
  envName: string
  accessPath: string
  cls: string
  tabId: string
}): React.ReactElement {
  const [values, setValues] = useState<Map<number, string>>(new Map())
  const [vecType, setVecType] = useState(cls)
  const [totalLength, setTotalLength] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ idx: number; value: string; originalValue: string } | null>(null)
  const [addColOpen, setAddColOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const loadedChunks = useRef<Set<number>>(new Set())
  const handledByKeyRef = useRef(false)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)
  const updateTabObjectClass = useEditorStore((s) => s.updateTabObjectClass)

  const fetchChunk = useCallback(
    async (offset: number, sync = false) => {
      // See DataFrameView: `sync` flushSyncs the commit so a mutation-driven
      // re-fetch is not swallowed by a concurrent store re-render.
      const commit = (fn: () => void) => (sync ? flushSync(fn) : fn())
      const chunkKey = Math.floor(offset / CHUNK_SIZE)
      if (loadedChunks.current.has(chunkKey)) return
      loadedChunks.current.add(chunkKey)

      try {
        const res = await rClient.getObjectVector(name, envName, accessPath, offset, CHUNK_SIZE)
        if (res.success) {
          commit(() => {
            setVecType(res.type)
            setTotalLength(res.totalLength)
            setValues((prev) => {
              const next = new Map(prev)
              res.values.forEach((v, i) => next.set(offset + i, v))
              return next
            })
          })
        }
      } catch {
        loadedChunks.current.delete(chunkKey)
      }
    },
    [name, envName, accessPath]
  )

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    setValues(new Map())
    loadedChunks.current.clear()
    fetchChunk(0, true)
      .then(() => setError(null))
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [fetchChunk])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (totalLength === 0) return
    const startRow = Math.floor(scrollTop / ROW_HEIGHT)
    const viewportHeight = scrollRef.current?.clientHeight || 600
    const endRow = Math.min(startRow + Math.ceil(viewportHeight / ROW_HEIGHT) + 5, totalLength - 1)
    const startChunk = Math.floor(startRow / CHUNK_SIZE) * CHUNK_SIZE
    const endChunk = Math.floor(endRow / CHUNK_SIZE) * CHUNK_SIZE
    for (let c = startChunk; c <= endChunk; c += CHUNK_SIZE) fetchChunk(c)
  }, [scrollTop, totalLength, fetchChunk])

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop)
  }, [])

  const setCellValue = useCallback((idx: number, value: string) => {
    setValues((prev) => {
      if (!prev.has(idx)) return prev
      const next = new Map(prev)
      next.set(idx, value)
      return next
    })
  }, [])

  const handleEdit = useCallback(
    async (idx: number, rawValue: string) => {
      // An emptied input means NA, not the literal string "".
      const value = rawValue === '' ? 'NA' : rawValue
      const needsQuote = ['character', 'factor'].includes(vecType)
      const rValue = value === 'NA' ? 'NA' : needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value
      const code = `${accessPath}[${idx + 1}] <- ${rValue}`

      // Optimistically update the cell immediately (no whole-chunk re-fetch);
      // roll back only if R rejects the write.
      const prevValue = values.get(idx) ?? 'NA'
      setCellValue(idx, value)

      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) {
          setCellValue(idx, prevValue)
          addEntry('error', res.error)
        }
      } catch (err) {
        setCellValue(idx, prevValue)
        addEntry('error', String(err))
      }
    },
    [accessPath, vecType, values, addEntry, addInputHistory, setCellValue]
  )

  const handleAddColumn = useCallback(
    async (code: string, newObjectClass?: string) => {
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) { addEntry('error', res.error); return }
        if (newObjectClass) {
          updateTabObjectClass(tabId, newObjectClass)
        }
      } catch (err) {
        addEntry('error', String(err))
      }
    },
    [addEntry, addInputHistory, tabId, updateTabObjectClass]
  )

  const commitAndMove = useCallback(
    (current: { idx: number; value: string; originalValue: string }, direction: 'up' | 'down') => {
      handledByKeyRef.current = true
      if (current.value !== current.originalValue) {
        handleEdit(current.idx, current.value)
      }
      const nextIdx = direction === 'down' ? current.idx + 1 : current.idx - 1
      if (nextIdx >= 0 && nextIdx < totalLength) {
        const val = editInitialValue(values.get(nextIdx))
        setEditing({ idx: nextIdx, value: val, originalValue: val })
      } else {
        setEditing(null)
      }
    },
    [handleEdit, totalLength, values]
  )

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-geo-error gap-2">
        <span className="text-sm">{error}</span>
        <Button variant="ghost" size="sm" onClick={refresh}>
          Retry
        </Button>
      </div>
    )
  }

  const totalHeight = totalLength * ROW_HEIGHT
  const startRow = Math.floor(scrollTop / ROW_HEIGHT)
  const viewportHeight = scrollRef.current?.clientHeight || 600
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 2
  const endRow = Math.min(startRow + visibleCount, totalLength)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b border-geo-border flex-shrink-0">
        <span className="text-xs text-geo-muted">
          {name} — {vecType} — length {totalLength}
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="flex border-b border-geo-border flex-shrink-0 bg-geo-bg">
            <div className="w-12 flex-shrink-0 px-2 py-1 text-[10px] text-geo-muted border-r border-geo-border">
              #
            </div>
            <div className="flex-1 px-2 py-1">
              <div className="text-xs text-foreground">{name}</div>
              <div className="text-[10px] text-geo-accent">{vecType}</div>
            </div>
            <button
              onClick={() => setAddColOpen(true)}
              className="w-8 flex-shrink-0 flex items-center justify-center text-geo-muted hover:text-geo-accent hover:bg-geo-panel border-r border-geo-border text-sm"
              title="Add column"
            >+</button>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={handleScroll}>
            <div style={{ height: totalHeight, position: 'relative' }}>
              {Array.from({ length: endRow - startRow }, (_, i) => {
                const idx = startRow + i
                const value = values.get(idx) ?? ''
                const isEditing = editing?.idx === idx
                const isNA = value === 'NA'
                const top = idx * ROW_HEIGHT

                return (
                  <div
                    key={idx}
                    className="flex absolute w-full border-b border-geo-border/30 hover:bg-geo-bg/30"
                    style={{ top, height: ROW_HEIGHT }}
                  >
                    <div className="w-12 flex-shrink-0 px-2 flex items-center text-[10px] text-geo-muted border-r border-geo-border">
                      [{idx + 1}]
                    </div>
                    <div
                      className="flex-1 px-2 flex items-center text-xs cursor-text"
                      onClick={() => { if (!isEditing) { const init = editInitialValue(value); setEditing({ idx, value: init, originalValue: init }) } }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="w-full bg-geo-bg border border-geo-accent rounded px-1 py-0.5 text-xs text-foreground outline-none"
                          value={editing.value}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitAndMove(editing, 'down')
                            } else if (e.key === 'Tab') {
                              e.preventDefault()
                              commitAndMove(editing, e.shiftKey ? 'up' : 'down')
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault()
                              commitAndMove(editing, 'down')
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault()
                              commitAndMove(editing, 'up')
                            } else if (e.key === 'Escape') {
                              handledByKeyRef.current = true
                              setEditing(null)
                            }
                          }}
                          onBlur={() => {
                            if (handledByKeyRef.current) {
                              handledByKeyRef.current = false
                              return
                            }
                            if (editing && editing.value !== editing.originalValue) {
                              handleEdit(editing.idx, editing.value)
                            }
                            setEditing(null)
                          }}
                        />
                      ) : (
                        <span className={`truncate ${isNA ? 'text-geo-muted italic' : 'text-foreground'}`}>
                          {value}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <AddColumnDialog
        open={addColOpen}
        onOpenChange={setAddColOpen}
        mode="vector"
        accessPath={accessPath}
        onConfirm={handleAddColumn}
      />
    </div>
  )
}
