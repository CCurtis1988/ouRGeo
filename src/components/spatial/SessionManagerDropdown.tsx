import React, { useState, useRef, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import {
  useGeometryEditStore, selectActiveSession, computeOrphanedLayerIds,
  sessionsForPanel, PRIMARY_MAP,
} from '@/store/geometryEdit'
import type { NamedSession } from '@/store/geometryEdit'
import { useSpatialStore } from '@/store/spatial'
import { useLayoutStore } from '@/store/layout'
import { mapPanels } from '@/lib/panel-content'
import { panelInfo } from '@/lib/layout/panel-meta'
import { startContentDrag } from '@/lib/content-drag'
import { usePanelId } from '../layout/panel-context'
import { ArrowRightLeft } from 'lucide-react'

export function SessionManagerDropdown(): React.ReactElement {
  const panelId = usePanelId(PRIMARY_MAP)
  const allSessions = useGeometryEditStore((s) => s.namedSessions)
  // This map's sessions only. Two maps each have their own set, and a session
  // list that showed the other map's would offer to switch to a session this
  // canvas cannot draw.
  const namedSessions = sessionsForPanel(allSessions, panelId)
  const activeSessionId = useGeometryEditStore((s) => s.activeByPanel[panelId] ?? null)
  const activeSession = useGeometryEditStore(selectActiveSession)
  const moveSessionToPanel = useGeometryEditStore((s) => s.moveSessionToPanel)
  // See TabBar: a selector that builds an array re-renders for ever.
  const layout = useLayoutStore((s) => s.layout)
  const otherMaps = mapPanels(layout).filter((p) => p !== panelId)
  const createNamedSession = useGeometryEditStore((s) => s.createNamedSession)
  const switchNamedSession = useGeometryEditStore((s) => s.switchNamedSession)
  const deleteNamedSession = useGeometryEditStore((s) => s.deleteNamedSession)
  const renameNamedSession = useGeometryEditStore((s) => s.renameNamedSession)
  const setActiveTool = useGeometryEditStore((s) => s.setActiveTool)
  const removeSpatialLayer = useSpatialStore((s) => s.removeLayer)

  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Close on click-outside
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setRenamingId(null)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (renamingId) {
          setRenamingId(null)
        } else {
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, renamingId])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  const startRename = useCallback((ns: NamedSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(ns.id)
    setRenameValue(ns.name)
  }, [])

  const commitRename = useCallback(() => {
    if (!renamingId) return
    const trimmed = renameValue.trim()
    if (trimmed) renameNamedSession(renamingId, trimmed)
    setRenamingId(null)
  }, [renamingId, renameValue, renameNamedSession])

  const handleRenameKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { e.stopPropagation(); setRenamingId(null) }
  }, [commitRename])

  const activeNs = namedSessions.find((ns) => ns.id === activeSessionId)
  const buttonLabel = activeNs?.name ?? 'Sessions'
  const hasActive = !!activeSession

  const deletingNs = allSessions.find((ns) => ns.id === deletingId)

  return (
    <div className="relative flex-shrink-0" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        className={`flex items-center gap-1 px-2 py-1 text-xs rounded border ${
          hasActive
            ? 'bg-geo-accent/10 text-geo-accent border-geo-accent'
            : 'border-geo-border text-foreground hover:bg-geo-bg'
        }`}
        onClick={() => setOpen((v) => !v)}
        title="Session Manager"
      >
        <span className="max-w-[120px] truncate">{buttonLabel}</span>
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-geo-panel border border-geo-border rounded shadow-lg z-50 flex flex-col">
          {namedSessions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-geo-muted">No sessions yet</div>
          ) : (
            <ul className="flex flex-col max-h-64 overflow-y-auto">
              {namedSessions.map((ns) => {
                const isActive = ns.id === activeSessionId
                const isRenaming = ns.id === renamingId

                return (
                  <li
                    key={ns.id}
                    className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-geo-bg group ${
                      isActive ? 'bg-geo-accent/5' : ''
                    }`}
                    // A session can be dragged straight out of this list onto
                    // the other map. The dropdown closes as the drag starts —
                    // it is drawn above the map that would otherwise be the
                    // drop target, and aiming through it is impossible.
                    onMouseDown={otherMaps.length > 0 && !isRenaming ? startContentDrag({
                      kind: 'session',
                      id: ns.id,
                      from: panelId,
                      label: ns.name,
                      onStart: () => setOpen(false),
                      onDrop: (to) => moveSessionToPanel(ns.id, to),
                    }) : undefined}
                    onClick={() => {
                      if (!isRenaming) {
                        switchNamedSession(ns.id)
                        setActiveTool('select')
                        setRenamingId(null)
                      }
                    }}
                  >
                    {/* Active indicator */}
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isActive ? 'bg-geo-accent' : 'bg-transparent'
                      }`}
                    />

                    {/* Name / rename input */}
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        className="flex-1 min-w-0 bg-geo-bg border border-geo-accent text-xs text-foreground rounded px-1 py-0 outline-none"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={handleRenameKey}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className={`flex-1 min-w-0 truncate text-xs ${isActive ? 'text-geo-accent' : 'text-foreground'}`}>
                        {ns.name}
                        {!ns.session && (
                          <span className="text-geo-muted ml-1">(empty)</span>
                        )}
                      </span>
                    )}

                    {/* Rename button */}
                    {!isRenaming && (
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-foreground flex-shrink-0"
                        title="Rename session"
                        onClick={(e) => startRename(ns, e)}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}

                    {/* Confirm rename */}
                    {isRenaming && (
                      <button
                        className="p-0.5 text-geo-muted hover:text-foreground flex-shrink-0"
                        onMouseDown={(e) => { e.preventDefault(); commitRename() }}
                      >
                        <Check className="w-3 h-3" />
                      </button>
                    )}

                    {/* Send to the other map. The drag is faster once it is
                        known about; this is how it becomes known about. */}
                    {!isRenaming && otherMaps.length === 1 && (
                      <button
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-foreground flex-shrink-0"
                        title={`Move to ${panelInfo(otherMaps[0])?.label ?? 'the other map'}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveSessionToPanel(ns.id, otherMaps[0])
                          setOpen(false)
                        }}
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-geo-muted hover:text-geo-error flex-shrink-0"
                      title="Delete session"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeletingId(ns.id)
                        setOpen(false)
                        setRenamingId(null)
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Divider + New Session */}
          <div className="border-t border-geo-border">
            <button
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-geo-muted hover:text-foreground hover:bg-geo-bg"
              onClick={() => {
                createNamedSession(undefined, panelId)
                setOpen(false)
              }}
            >
              <Plus className="w-3 h-3" />
              New Session
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog.Root open={!!deletingId} onOpenChange={(v) => { if (!v) setDeletingId(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-geo-panel border border-geo-border rounded-lg shadow-xl p-5 flex flex-col gap-4">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Delete Session
            </Dialog.Title>
            <p className="text-xs text-geo-muted leading-relaxed">
              Are you sure you want to delete{' '}
              <span className="text-foreground font-medium">"{deletingNs?.name}"</span>?
              Any uncommitted drawing will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <button className="px-3 py-1.5 text-xs rounded border border-geo-border text-foreground hover:bg-geo-bg">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                className="px-3 py-1.5 text-xs rounded border border-geo-error/50 bg-geo-error/10 text-geo-error hover:bg-geo-error/20"
                onClick={() => {
                  if (deletingId) {
                    const orphaned = computeOrphanedLayerIds(allSessions, deletingId)
                    deleteNamedSession(deletingId)
                    orphaned.forEach((id) => removeSpatialLayer(id))
                  }
                  setDeletingId(null)
                }}
              >
                Delete
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
