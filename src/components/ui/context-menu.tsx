import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  onClick?: () => void
  disabled?: boolean
  separator?: boolean
  submenu?: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [activeSubmenu, setActiveSubmenu] = useState<number | null>(null)

  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const nx = x + rect.width > window.innerWidth ? x - rect.width : x
    const ny = y + rect.height > window.innerHeight ? y - rect.height : y
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) })
  }, [x, y])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[140px]"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="h-px bg-geo-border my-1" />
        }
        const hasSubmenu = item.submenu && item.submenu.length > 0
        return (
          <div
            key={i}
            className="relative"
            onMouseEnter={() => hasSubmenu && setActiveSubmenu(i)}
            onMouseLeave={() => hasSubmenu && setActiveSubmenu(null)}
          >
            <button
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 ${
                item.disabled
                  ? 'text-geo-muted cursor-default'
                  : 'text-foreground hover:bg-geo-bg/50'
              }`}
              onClick={() => {
                if (item.disabled || hasSubmenu) return
                item.onClick?.()
                onClose()
              }}
              disabled={item.disabled}
            >
              <span>{item.label}</span>
              {hasSubmenu && <ChevronRight className="w-3 h-3 text-geo-muted" />}
            </button>
            {hasSubmenu && activeSubmenu === i && (
              <div className="absolute left-full top-0 bg-geo-panel border border-geo-border rounded shadow-lg py-1 min-w-[140px]">
                {item.submenu!.map((sub, j) => (
                  <button
                    key={j}
                    className={`w-full text-left px-3 py-1.5 text-xs ${
                      sub.disabled
                        ? 'text-geo-muted cursor-default'
                        : 'text-foreground hover:bg-geo-bg/50'
                    }`}
                    onClick={() => {
                      if (sub.disabled) return
                      sub.onClick?.()
                      onClose()
                    }}
                    disabled={sub.disabled}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
