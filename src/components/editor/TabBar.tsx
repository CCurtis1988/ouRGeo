import React, { useRef, useEffect, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, ChevronDown, Table2, Braces, FileCode, FileText } from 'lucide-react'
import {
  useEditorStore, tabsForPanel, PRIMARY_EDITOR, type TabType, type TabState,
} from '@/store/editor'
import { languageOf, isMarkdownDoc } from '@/lib/markdown/doc-kind'
import { panelInfo } from '@/lib/layout/panel-meta'
import { startContentDrag } from '@/lib/content-drag'
import { tabTooltip } from '@/lib/tab-tooltip'
import { usePanelId } from '../layout/panel-context'
import { editorPanels } from '@/lib/panel-content'
import { useLayoutStore } from '@/store/layout'
import { ContextMenu, type ContextMenuItem } from '../ui/context-menu'
import { cn } from '@/lib/utils'
import { CreateDataDialog, type CreateDataType } from './CreateDataDialog'
import { editorTabWindow, EDITOR_TAB_WIDTH } from '@/lib/editor-tab-window'
import { closeTab, closeAllTabs } from '@/lib/document-close'

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
  const panelId = usePanelId(PRIMARY_EDITOR)
  const allTabs = useEditorStore((s) => s.tabs)
  const tabs = useMemo(() => tabsForPanel(allTabs, panelId), [allTabs, panelId])
  const activeTabId = useEditorStore((s) => s.activeByPanel[panelId] ?? null)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const moveTabToPanel = useEditorStore((s) => s.moveTabToPanel)
  const newMarkdownTab = useEditorStore((s) => s.newMarkdownTab)
  // The other editors this document could be sent to. Read from the layout
  // rather than from the tabs, so a second editor that is currently EMPTY is
  // still offered — an empty panel is exactly the one a user wants to fill.
  // Selecting `layout` (a stable reference) and deriving outside the
  // selector: a selector that BUILDS an array returns a new one every call,
  // which zustand reads as a change and re-renders for ever.
  const layout = useLayoutStore((s) => s.layout)
  const others = editorPanels(layout).filter((p) => p !== panelId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualized = tabs.length > 200
  const [viewport, setViewport] = useState({ offset: 0, width: 600 })
  const activeIndex = useMemo(() => tabs.findIndex(tab => tab.id === activeTabId), [tabs, activeTabId])
  const range = virtualized ? editorTabWindow(tabs.length, viewport.offset, viewport.width) : { start: 0, end: tabs.length }
  const visibleTabs = virtualized ? tabs.slice(range.start, range.end) : tabs
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tab: TabState } | null>(null)

  /** Anything that opens a document opens it HERE, not in whichever editor
   *  happened to be focused — the button that was clicked is in this one. */
  const openHere = (make: () => void): void => {
    useEditorStore.getState().focusEditor(panelId)
    make()
  }

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const [dialogType, setDialogType] = useState<CreateDataType | null>(null)
  const chevronRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Scroll active tab into view
  useEffect(() => {
    if (!scrollRef.current) return
    if (virtualized && activeIndex >= 0) {
      const node = scrollRef.current, left = activeIndex * EDITOR_TAB_WIDTH, right = left + EDITOR_TAB_WIDTH
      if (left < node.scrollLeft) node.scrollLeft = left
      else if (right > node.scrollLeft + node.clientWidth) node.scrollLeft = Math.max(0, right - node.clientWidth)
      const offset = node.scrollLeft, width = node.clientWidth
      setViewport(previous => previous.offset === offset && previous.width === width ? previous : { offset, width })
      return
    }
    const active = scrollRef.current.querySelector('[data-active="true"]')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, activeIndex, virtualized, viewport.width])

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !virtualized) return
    const measure = (): void => {
      const offset = node.scrollLeft, width = node.clientWidth
      setViewport(previous => previous.offset === offset && previous.width === width ? previous : { offset, width })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node); node.addEventListener('scroll', measure, { passive: true }); measure()
    return () => { observer.disconnect(); node.removeEventListener('scroll', measure) }
  }, [virtualized])

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
      <div ref={scrollRef} role="region" aria-label="Open document tabs" className="flex overflow-x-auto flex-1 min-w-0 scrollbar-none">
        {virtualized && <div aria-hidden="true" style={{ width: range.start * EDITOR_TAB_WIDTH, flexShrink: 0 }} />}
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            data-active={tab.id === activeTabId}
            style={virtualized ? { width: EDITOR_TAB_WIDTH, minWidth: EDITOR_TAB_WIDTH, flexShrink: 0 } : undefined}
            className={cn(
              'group flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap border-r border-geo-border min-w-0 max-w-[180px]',
              tab.id === activeTabId
                ? 'bg-geo-panel border-t-2 border-t-geo-accent text-foreground'
                : 'bg-geo-bg text-geo-muted hover:bg-geo-panel/50 border-t-2 border-t-transparent'
            )}
            // Pressing selects, dragging past 4px moves. Both from one handler,
            // so a tab can be picked up from wherever the eye found it without
            // first having to make it the active one.
            onMouseDown={others.length > 0 ? startContentDrag({
              kind: 'tab',
              id: tab.id,
              from: panelId,
              label: tab.fileName,
              onPress: () => setActiveTab(tab.id),
              onDrop: (to) => moveTabToPanel(tab.id, to),
            }) : undefined}
            onContextMenu={(e) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, tab }) }}
            onClick={() => setActiveTab(tab.id)}
            // The label is truncated at 180px; this is where the whole name —
            // and the path or R expression behind it — can still be read.
            title={tabTooltip(tab)}
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
                void closeTab(tab.id)
              }}
            >
              <X className="w-3 h-3" />
            </span>
          </button>
        ))}
        {virtualized && <div aria-hidden="true" style={{ width: (tabs.length - range.end) * EDITOR_TAB_WIDTH, flexShrink: 0 }} />}
      </div>

      {/* Split button: Plus + Chevron */}
      <div className="flex items-center flex-shrink-0 border-l border-geo-border">
        <button
          className="flex items-center justify-center w-7 h-8 text-geo-muted hover:text-foreground"
          onClick={() => openHere(() => useEditorStore.getState().addTab())}
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
            onClick={() => { setDropdownOpen(false); openHere(() => newMarkdownTab('markdown')) }}
          >
            New Markdown
          </button>
          <button
            className="block w-full text-left text-xs px-3 py-1.5 text-foreground hover:bg-geo-bg/50"
            onClick={() => { setDropdownOpen(false); openHere(() => newMarkdownTab('rmarkdown')) }}
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
                useEditorStore.getState().focusEditor(panelId)
                setDialogType(type)
              }}
            >
              Create {type}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* A drag is the fast way to move a document; this is the discoverable
          one. Neither is the only one, because a drag inside a scrolling strip
          is easy to start by accident and easy to miss entirely. */}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={[
            ...(others.length > 0 ? [{
              label: 'Move to',
              submenu: others.map((p): ContextMenuItem => ({
                label: panelInfo(p)?.label ?? p,
                onClick: () => moveTabToPanel(tabMenu.tab.id, p),
              })),
            }, { separator: true, label: '' }] : []),
            // Each asks about every document with unsaved edits, one at a
            // time, with "Apply to all remaining" (lib/document-close.tsx).
            { label: 'Close', onClick: () => { void closeTab(tabMenu.tab.id) } },
            { label: 'Close Others', onClick: () => { void closeAllTabs(tabs.map(t => t.id), tabMenu.tab.id) } },
            { label: 'Close All', onClick: () => { void closeAllTabs(tabs.map(t => t.id)) } },
          ]}
        />
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
