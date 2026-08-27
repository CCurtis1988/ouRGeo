import React, { useRef, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, ChevronDown, Table2, Braces, FileCode, FileText } from 'lucide-react'
import { useEditorStore, type TabType, type TabState } from '@/store/editor'
import { languageOf, isMarkdownDoc } from '@/lib/markdown/doc-kind'
import { cn } from '@/lib/utils'
import { CreateDataDialog, type CreateDataType } from './CreateDataDialog'

function TabIcon({ tab }: { tab: TabState }): React.ReactElement | null {
  const type: TabType | undefined = tab.type
  switch (type) {
    case 'data-viewer':
      return <Table2 className="w-3 h-3 text-geo-accent flex-shrink-0" />
    case 'function-editor':
      return <Braces className="w-3 h-3 text-geo-accent flex-shrink-0" />
    default:
      return isMarkdownDoc(languageOf(tab))
        ? <FileText className="w-3 h-3 text-geo-muted flex-shrink-0" />
        : <FileCode className="w-3 h-3 text-geo-muted flex-shrink-0" />
  }
}

export function TabBar(): React.ReactElement {
  const tabs = useEditorStore((s) => s.tabs)
  const activeTabId = useEditorStore((s) => s.activeTabId)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const closeTab = useEditorStore((s) => s.closeTab)
  const addTab = useEditorStore((s) => s.addTab)
  const newMarkdownTab = useEditorStore((s) => s.newMarkdownTab)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const [dialogType, setDialogType] = useState<CreateDataType | null>(null)
  const chevronRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current) return
    const active = scrollRef.current.querySelector('[data-active="true"]')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (
        chevronRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return
      setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const handleChevronClick = () => {
    if (chevronRef.current) {
      const rect = chevronRef.current.getBoundingClientRect()
      setDropdownPos({ top: rect.bottom + 2, left: rect.right - 140 })
    }
    setDropdownOpen((o) => !o)
  }

  return (
    <div className="flex items-center bg-geo-bg border-b border-geo-border flex-shrink-0">
      <div ref={scrollRef} className="flex overflow-x-auto flex-1 min-w-0 scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-active={tab.id === activeTabId}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap border-r border-geo-border min-w-0 max-w-[180px]',
              tab.id === activeTabId
                ? 'bg-geo-panel border-t-2 border-t-geo-accent text-foreground'
                : 'bg-geo-bg text-geo-muted hover:bg-geo-panel/50 border-t-2 border-t-transparent'
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            <TabIcon tab={tab} />
            <span className="truncate">
              {tab.fileName}
              {tab.isDirty && <span className="text-geo-muted ml-0.5">*</span>}
            </span>
            <span
              className="opacity-0 group-hover:opacity-100 hover:text-geo-error transition-opacity flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
      </div>

      {/* Split button: Plus + Chevron */}
      <div className="flex items-center flex-shrink-0 border-l border-geo-border">
        <button
          className="flex items-center justify-center w-7 h-8 text-geo-muted hover:text-foreground"
          onClick={() => addTab()}
          title="New blank .R file"
          data-ourgeo-id="editor.newTab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          ref={chevronRef}
          className="flex items-center justify-center w-4 h-8 text-geo-muted hover:text-foreground border-l border-geo-border/50"
          onClick={handleChevronClick}
          title="New document or data object"
        >
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Portal dropdown */}
      {dropdownOpen && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left }}
          className="z-[9999] w-[152px] bg-geo-panel border border-geo-border rounded shadow-lg py-0.5"
        >
          <button
            className="block w-full text-left text-xs px-3 py-1.5 text-foreground hover:bg-geo-bg/50"
            onClick={() => { setDropdownOpen(false); newMarkdownTab('markdown') }}
          >
            New Markdown
          </button>
          <button
            className="block w-full text-left text-xs px-3 py-1.5 text-foreground hover:bg-geo-bg/50"
            onClick={() => { setDropdownOpen(false); newMarkdownTab('rmarkdown') }}
          >
            New R Markdown
          </button>
          <div className="h-px bg-geo-border my-0.5" />
          {(['vector', 'matrix', 'data.frame', 'tibble', 'data.table'] as const).map((type) => (
            <button
              key={type}
              className="block w-full text-left text-xs px-3 py-1.5 text-foreground hover:bg-geo-bg/50"
              onClick={() => {
                setDropdownOpen(false)
                setDialogType(type)
              }}
            >
              Create {type}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Dialog */}
      {dialogType !== null && (
        <CreateDataDialog
          open={dialogType !== null}
          onOpenChange={(open) => { if (!open) setDialogType(null) }}
          type={dialogType}
        />
      )}
    </div>
  )
}
