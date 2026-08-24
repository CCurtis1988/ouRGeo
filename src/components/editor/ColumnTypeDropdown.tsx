import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

const COLUMN_TYPES = ['character', 'numeric', 'integer', 'logical', 'factor', 'Date'] as const

interface ColumnTypeDropdownProps {
  currentType: string
  onTypeChange: (newType: string) => void
}

export function ColumnTypeDropdown({
  currentType,
  onTypeChange
}: ColumnTypeDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 2, left: rect.left })
    }
    setOpen((o) => !o)
  }

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        className="text-[10px] text-geo-accent hover:text-geo-accent/80 px-1 py-0.5 rounded hover:bg-geo-bg/50 cursor-pointer"
        onDoubleClick={handleOpen}
        title="Double-click to change type"
      >
        {currentType}
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] bg-geo-panel border border-geo-border rounded shadow-lg py-0.5 min-w-[100px]"
        >
          {COLUMN_TYPES.map((type) => (
            <button
              key={type}
              className={`block w-full text-left text-xs px-2 py-1 hover:bg-geo-bg/50 ${
                type === currentType ? 'text-geo-accent' : 'text-foreground'
              }`}
              onClick={() => {
                if (type !== currentType) onTypeChange(type)
                setOpen(false)
              }}
            >
              {type}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
