import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useSessionStore, type ConsoleEntry } from '@/store/session'
import { rClient } from '@/lib/r-client'
import { cn } from '@/lib/utils'
import { useCompletion, type AcceptResult } from '@/hooks/useCompletion'
import { CompletionPopup } from '../completion/CompletionPopup'
import { getTextareaCaretRect } from '@/lib/caret-coords'
import { WorkingDirBar } from './WorkingDirBar'

function EntryLine({ entry }: { entry: ConsoleEntry }): React.ReactElement {
  const textColor = {
    input: 'text-geo-accent',
    output: 'text-foreground',
    error: 'text-geo-error',
    info: 'text-geo-muted'
  }[entry.type]

  const prefix = entry.type === 'input' ? '> ' : ''

  return (
    <div className={cn('font-mono text-xs leading-relaxed whitespace-pre-wrap break-all', textColor)}>
      {prefix}{entry.text}
    </div>
  )
}

const TEN_MIN_S = 10 * 60

export function Console(): React.ReactElement {
  const history = useSessionStore((s) => s.consoleHistory)
  const clearConsole = useSessionStore((s) => s.clearConsole)
  const wsConnected = useSessionStore((s) => s.wsConnected)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)
  const inputHistory = useSessionStore((s) => s.consoleInputHistory)
  const addInputHistory = useSessionStore((s) => s.addInputHistory)
  const isExecuting = useSessionStore((s) => s.isExecuting)
  const executingStartTime = useSessionStore((s) => s.executingStartTime)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputValue, setInputValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)
  const historyNavPending = useRef(false)
  const caretPending = useRef<number | null>(null)
  const comp = useCompletion()
  const compRef = useRef(comp)
  compRef.current = comp
  const [elapsed, setElapsed] = useState(0)
  const [ctxOpen, setCtxOpen] = useState(false)
  const ctxRef = useRef<HTMLDivElement>(null)

  // Tick elapsed seconds while executing
  useEffect(() => {
    if (!isExecuting || executingStartTime === null) {
      setElapsed(0)
      return
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - executingStartTime) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isExecuting, executingStartTime])

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxOpen) return
    const handler = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setCtxOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctxOpen])

  const dotColorClass = !isExecuting
    ? 'bg-geo-success'
    : elapsed >= TEN_MIN_S
      ? 'bg-geo-error animate-pulse'
      : 'bg-orange-400'
  const dotTitle = !isExecuting
    ? 'Idle'
    : elapsed >= TEN_MIN_S
      ? `Running — ${Math.floor(elapsed / 60)}m ${elapsed % 60}s (long running)`
      : `Running — ${elapsed}s`

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  const executeCode = useCallback(async (code: string) => {
    if (!code.trim()) return

    addEntry('input', code)
    addInputHistory(code)

    try {
      const res = await rClient.execute(code)
      // Output comes via WebSocket, but also handle direct response for errors
      if (!res.success && res.error) {
        addEntry('error', res.error)
      }
    } catch (err) {
      addEntry('error', String(err))
    }
  }, [addEntry, addInputHistory])

  // Resize textarea to fit its content
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    if (historyNavPending.current) {
      historyNavPending.current = false
      el.setSelectionRange(el.value.length, el.value.length)
    } else if (caretPending.current != null) {
      const c = caretPending.current
      caretPending.current = null
      el.setSelectionRange(c, c)
      el.focus()
    }
  }, [inputValue])

  // Apply an accepted completion into the input buffer.
  const applyAccept = useCallback((res: AcceptResult) => {
    setInputValue((prev) => {
      const next = prev.slice(0, res.from) + res.insertText + prev.slice(res.to)
      const caret = res.from + res.caret
      caretPending.current = caret
      // Re-query at the new caret so e.g. `fn(` chains into argument completion.
      requestAnimationFrame(() => compRef.current.query(next, caret))
      return next
    })
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Space: manually trigger completion.
    if (e.code === 'Space' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      const el = e.currentTarget
      compRef.current.query(el.value, el.selectionStart ?? el.value.length, true)
      return
    }
    // When the completion popup is open, it owns the navigation keys.
    if (compRef.current.state.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); compRef.current.move(1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); compRef.current.move(-1); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const res = compRef.current.accept()
        if (res) applyAccept(res)
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); compRef.current.close(); return }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) compRef.current.close()
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const code = inputValue.trim()
      if (code) {
        executeCode(code)
        setInputValue('')
        setHistoryIndex(-1)
      }
    } else if (e.key === 'ArrowUp') {
      const el = e.currentTarget
      const beforeCursor = el.value.slice(0, el.selectionStart)
      if (beforeCursor.includes('\n')) return  // let cursor move up within multiline
      e.preventDefault()
      if (inputHistory.length === 0) return
      const newIndex = historyIndex === -1
        ? inputHistory.length - 1
        : Math.max(0, historyIndex - 1)
      historyNavPending.current = true
      setHistoryIndex(newIndex)
      setInputValue(inputHistory[newIndex])
    } else if (e.key === 'ArrowDown') {
      const el = e.currentTarget
      const afterCursor = el.value.slice(el.selectionEnd)
      if (afterCursor.includes('\n')) return  // let cursor move down within multiline
      e.preventDefault()
      if (historyIndex === -1) return
      const newIndex = historyIndex + 1
      historyNavPending.current = true
      if (newIndex >= inputHistory.length) {
        setHistoryIndex(-1)
        setInputValue('')
      } else {
        setHistoryIndex(newIndex)
        setInputValue(inputHistory[newIndex])
      }
    }
  }, [inputValue, inputHistory, historyIndex, executeCode, applyAccept])

  const cs = comp.state
  const caretRect = cs.open && inputRef.current ? getTextareaCaretRect(inputRef.current, cs.from) : null

  return (
    <div className="flex flex-col h-full">
      {/* Console header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-geo-border flex-shrink-0">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-shrink-0 text-xs text-geo-muted">R Console</span>
          <div
            className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', wsConnected ? 'bg-geo-success' : 'bg-geo-muted')}
            title={wsConnected ? 'Connected' : 'Disconnected'}
          />
          {/* Where relative paths resolve, next to where they are typed. */}
          <WorkingDirBar />
        </div>
        <div className="flex items-center gap-1">
          {/* Execution status dot */}
          <div className="relative" ref={ctxRef}>
            <div
              className={cn('w-2.5 h-2.5 rounded-full cursor-pointer', dotColorClass)}
              title={dotTitle}
              onContextMenu={(e) => { e.preventDefault(); setCtxOpen((v) => !v) }}
            />
            {ctxOpen && (
              <div className="absolute right-0 top-4 z-50 bg-geo-panel border border-geo-border rounded shadow-lg min-w-[120px]">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-geo-error hover:bg-geo-bg transition-colors"
                  onClick={() => { rClient.interrupt(); setCtxOpen(false) }}
                >
                  Kill process
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-geo-muted hover:bg-geo-bg transition-colors"
                  onClick={() => setCtxOpen(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {/* Clear console */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clearConsole}
            title="Clear console"
            data-ourgeo-id="console.clear"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-3 py-2 space-y-0.5"
      >
        {history.length === 0 ? (
          <div className="text-xs text-geo-muted italic">R console ready. Type code below or use the editor above.</div>
        ) : (
          history.map((entry) => <EntryLine key={entry.id} entry={entry} />)
        )}
      </div>

      {/* Input line */}
      <div className="flex items-start px-3 py-1.5 border-t border-geo-border flex-shrink-0 gap-1">
        <span className="text-xs font-mono text-geo-accent select-none leading-relaxed">&gt;</span>
        <textarea
          ref={inputRef}
          rows={1}
          value={inputValue}
          onChange={(e) => {
            const el = e.target
            const val = el.value
            const caret = el.selectionStart ?? val.length
            setInputValue(val)
            setHistoryIndex(-1)
            comp.query(val, caret)
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => comp.close()}
          className="flex-1 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-geo-muted resize-none overflow-hidden leading-relaxed"
          placeholder="Type R code here... (Shift+Enter for newline)"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {cs.open && caretRect && (
        <CompletionPopup
          candidates={cs.candidates}
          selected={cs.selected}
          left={caretRect.left}
          top={caretRect.top}
          lineHeight={caretRect.height}
          onPick={(i) => {
            const res = comp.accept(i)
            if (res) applyAccept(res)
          }}
          onHover={(i) => comp.setSelected(i)}
        />
      )}
    </div>
  )
}
