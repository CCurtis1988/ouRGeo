import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useEditorStore } from '@/store/editor'
import { type DocLanguage, labelFor } from '@/lib/markdown/doc-kind'
import { cn } from '@/lib/utils'

const LANGUAGES: DocLanguage[] = ['r', 'markdown', 'rmarkdown']

interface Props {
  tabId: string
  language: DocLanguage
  /** Object-backed tabs (data viewer, function editor) aren't documents. */
  disabled?: boolean
}

/**
 * Switches an open tab between R, Markdown and R Markdown. Follows the portalled
 * dropdown pattern used by TabBar's "+" chevron so it escapes the toolbar's
 * overflow clipping.
 */
export function LanguageSelector({ tabId, language, disabled }: Props): React.ReactElement {
  const setTabLanguage = useEditorStore((s) => s.setTabLanguage)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 2, left: r.left })
    setOpen((v) => !v)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        title="Document type"
        className={cn(
          'flex items-center gap-0.5 h-6 px-1.5 rounded text-[11px] transition-colors',
          'text-geo-muted hover:text-foreground hover:bg-white/5',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        {labelFor(language)}
        <ChevronDown className="w-2.5 h-2.5" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          className="z-[9999] w-[128px] bg-geo-panel border border-geo-border rounded shadow-lg py-0.5"
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              className={cn(
                'block w-full text-left text-xs px-3 py-1.5 hover:bg-geo-bg/50',
                lang === language ? 'text-geo-accent' : 'text-foreground'
              )}
              onClick={() => { setTabLanguage(tabId, lang); setOpen(false) }}
            >
              {labelFor(lang)}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
