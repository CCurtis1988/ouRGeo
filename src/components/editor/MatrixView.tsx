import React, { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { rClient } from '@/lib/r-client'
import { useSessionStore } from '@/store/session'
import { AddColumnDialog } from './AddColumnDialog'
import {
  type EditingCell,
  nextCell,
  editInitialValue,
  estimateColWidth,
  ROW_HEIGHT,
  CHUNK_SIZE,
  ROW_NUM_WIDTH,
  ADD_BTN_WIDTH,
  MIN_COL_WIDTH,
} from './dataViewerShared'

export function MatrixView({
  name,
  envName,
  accessPath
}: {
  name: string
  envName: string
  accessPath: string
}): React.ReactElement {
  const [nrow, setNrow] = useState(0)
  const [ncol, setNcol] = useState(0)
  const [matType, setMatType] = useState('')
  const [rows, setRows] = useState<Map<number, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)
  const [addColOpen, setAddColOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerInnerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [colWidths, setColWidths] = useState<number[]>([])
  const colInitialized = useRef(false)
  const loadedChunks = useRef<Set<number>>(new Set())
  const handledByKeyRef = useRef(false)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)

  const fetchChunk = useCallback(
    async (offset: number, sync = false) => {
      // See DataFrameView: `sync` flushSyncs the commit so a mutation-driven
      // re-fetch is not swallowed by a concurrent store re-render.
      const commit = (fn: () => void) => (sync ? flushSync(fn) : fn())
      const chunkKey = Math.floor(offset / CHUNK_SIZE)
      if (loadedChunks.current.has(chunkKey)) return
      loadedChunks.current.add(chunkKey)

      try {
        const res = await rClient.getObjectMatrix(name, envName, accessPath, offset, CHUNK_SIZE)
        if (res.success) {
          commit(() => {
            setNrow(res.nrow)
            setNcol(res.ncol)
            setMatType(res.type)
            setRows((prev) => {
              const next = new Map(prev)
              res.rows.forEach((row, i) => next.set(offset + i, row))
              return next
            })
            if (!colInitialized.current && res.ncol > 0) {
              colInitialized.current = true
              const widths = Array.from({ length: res.ncol }, (_, i) =>
                estimateColWidth(`[${i + 1}]`, res.rows.map(row => row[i] ?? ''))
              )
              setColWidths(widths)
            }
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
    loadedChunks.current.clear()
    colInitialized.current = false
    fetchChunk(0, true)
      .then(() => setError(null))
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [fetchChunk])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (nrow === 0) return
    const startRow = Math.floor(scrollTop / ROW_HEIGHT)
    const viewportHeight = scrollRef.current?.clientHeight || 600
    const endRow = Math.min(startRow + Math.ceil(viewportHeight / ROW_HEIGHT) + 5, nrow - 1)
    const startChunk = Math.floor(startRow / CHUNK_SIZE) * CHUNK_SIZE
    const endChunk = Math.floor(endRow / CHUNK_SIZE) * CHUNK_SIZE
    for (let c = startChunk; c <= endChunk; c += CHUNK_SIZE) fetchChunk(c)
  }, [scrollTop, nrow, fetchChunk])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    setScrollTop(scrollRef.current.scrollTop)
    if (headerInnerRef.current) {
      headerInnerRef.current.style.transform = `translateX(-${scrollRef.current.scrollLeft}px)`
    }
  }, [])

  const startResize = (e: React.MouseEvent, pos: number) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = colWidths[pos]
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      setColWidths(prev => {
        const next = [...prev]
        next[pos] = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
        return next
      })
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const setCellValue = useCallback((rowIdx: number, colIdx: number, value: string) => {
    setRows((prev) => {
      const existing = prev.get(rowIdx)
      if (!existing) return prev
      const nextRow = existing.slice()
      nextRow[colIdx] = value
      const next = new Map(prev)
      next.set(rowIdx, nextRow)
      return next
    })
  }, [])

  const handleCellEdit = useCallback(
    async (rowIdx: number, colIdx: number, rawValue: string) => {
      // An emptied input means NA, not the literal string "".
      const value = rawValue === '' ? 'NA' : rawValue
      const rValue = value === 'NA' ? 'NA' : isNaN(Number(value)) ? `"${value.replace(/"/g, '\\"')}"` : value
      const code = `${accessPath}[${rowIdx + 1}, ${colIdx + 1}] <- ${rValue}`

      // Optimistically update the cell immediately (no whole-chunk re-fetch);
      // roll back only if R rejects the write.
      const prevValue = rows.get(rowIdx)?.[colIdx] ?? 'NA'
      setCellValue(rowIdx, colIdx, value)

      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) {
          setCellValue(rowIdx, colIdx, prevValue)
          addEntry('error', res.error)
        }
      } catch (err) {
        setCellValue(rowIdx, colIdx, prevValue)
        addEntry('error', String(err))
      }
    },
    [accessPath, rows, addEntry, addInputHistory, setCellValue]
  )

  const handleAddColumn = useCallback(
    async (code: string) => {
      addEntry('input', code)
      addInputHistory(code)
      try {
        const res = await rClient.execute(code)
        if (!res.success && res.error) addEntry('error', res.error)
      } catch (err) {
        addEntry('error', String(err))
      } finally {
        refresh()
      }
    },
    [addEntry, addInputHistory, refresh]
  )

  const commitAndMove = useCallback(
    (current: EditingCell, direction: 'up' | 'down' | 'left' | 'right') => {
      handledByKeyRef.current = true
      if (current.value !== current.originalValue) {
        handleCellEdit(current.row, current.col, current.value)
      }
      const next = nextCell(current.row, current.col, nrow, ncol, direction)
      if (next) {
        const row = rows.get(next.row)
        const val = editInitialValue(row ? row[next.col] : '')
        setEditing({ row: next.row, col: next.col, value: val, originalValue: val })
      } else {
        setEditing(null)
      }
    },
    [handleCellEdit, nrow, ncol, rows]
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

  const totalHeight = nrow * ROW_HEIGHT
  const startRow = Math.floor(scrollTop / ROW_HEIGHT)
  const viewportHeight = scrollRef.current?.clientHeight || 600
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 2
  const endRow = Math.min(startRow + visibleCount, nrow)
  const colIndices = Array.from({ length: ncol }, (_, i) => i)
  const totalWidth = colWidths.length > 0
    ? ROW_NUM_WIDTH + colWidths.reduce((s, w) => s + w, 0) + ADD_BTN_WIDTH
    : undefined

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1 border-b border-geo-border flex-shrink-0">
        <span className="text-xs text-geo-muted">
          {name} — matrix [{matType}] — {nrow} x {ncol}
        </span>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full flex flex-col">
          {/* Column headers — translated to sync with horizontal scroll */}
          <div className="border-b border-geo-border flex-shrink-0 bg-geo-bg overflow-hidden">
            <div ref={headerInnerRef} style={{ display: 'flex', width: totalWidth }}>
              <div style={{ width: ROW_NUM_WIDTH, flexShrink: 0 }} className="px-2 py-1 text-[10px] text-geo-muted border-r border-geo-border">
                #
              </div>
              {colIndices.map((i) => {
                const w = colWidths[i] ?? 100
                return (
                  <div
                    key={i}
                    style={{ width: w, flexShrink: 0, position: 'relative' }}
                    className="px-2 py-1 border-r border-geo-border text-xs text-foreground"
                  >
                    [{i + 1}]
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-geo-accent/50 z-10"
                      onMouseDown={(e) => startResize(e, i)}
                    />
                  </div>
                )
              })}
              <button
                onClick={() => setAddColOpen(true)}
                style={{ width: ADD_BTN_WIDTH, flexShrink: 0 }}
                className="flex items-center justify-center text-geo-muted hover:text-geo-accent hover:bg-geo-panel border-r border-geo-border text-sm"
                title="Add column"
              >+</button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto" onScroll={handleScroll}>
            <div style={{ height: totalHeight, position: 'relative', width: totalWidth }}>
              {Array.from({ length: endRow - startRow }, (_, i) => {
                const rowIdx = startRow + i
                const row = rows.get(rowIdx)
                const top = rowIdx * ROW_HEIGHT

                return (
                  <div key={rowIdx} className="flex absolute border-b border-geo-border/30 hover:bg-geo-bg/30" style={{ top, height: ROW_HEIGHT, width: totalWidth }}>
                    <div style={{ width: ROW_NUM_WIDTH, flexShrink: 0 }} className="px-2 flex items-center text-[10px] text-geo-muted border-r border-geo-border">
                      [{rowIdx + 1}]
                    </div>
                    {colIndices.map((colIdx) => {
                      const w = colWidths[colIdx] ?? 100
                      const value = row ? row[colIdx] ?? '' : ''
                      const isEditing = editing?.row === rowIdx && editing?.col === colIdx
                      const isNA = value === 'NA'

                      return (
                        <div
                          key={colIdx}
                          style={{ width: w, flexShrink: 0 }}
                          className="px-2 flex items-center border-r border-geo-border/30 text-xs cursor-text overflow-hidden"
                          onClick={() => { if (!isEditing && row) { const init = editInitialValue(value); setEditing({ row: rowIdx, col: colIdx, value: init, originalValue: init }) } }}
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
                                  commitAndMove(editing, e.shiftKey ? 'left' : 'right')
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
                                  handleCellEdit(editing.row, editing.col, editing.value)
                                }
                                setEditing(null)
                              }}
                            />
                          ) : (
                            <span className={`truncate ${isNA ? 'text-geo-muted italic' : 'text-foreground'}`}>
                              {row ? value : ''}
                            </span>
                          )}
                        </div>
                      )
                    })}
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
        mode="matrix"
        accessPath={accessPath}
        onConfirm={handleAddColumn}
      />
    </div>
  )
}
