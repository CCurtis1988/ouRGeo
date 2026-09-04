import { useEffect } from 'react'
import { useGeometryEditStore, selectActiveSession } from '@/store/geometryEdit'
import { useDrawPreviewStore } from '@/store/drawPreview'
import { canStartNextPart, canStartHole } from '@/lib/draw/draft'
import { flipActiveTraceDirection } from '@/lib/draw/tools/trace'
import { useDrawActions } from './useDrawActions'
import { useAddFeature } from './useAddFeature'

/**
 * Global drawing keyboard shortcuts. Active only while an edit session or
 * edit mode is live; ignores keystrokes aimed at inputs and Monaco.
 *
 *   Enter          finish feature / accept "add another" prompt
 *   Escape         cancel drawing / dismiss prompt or context menu
 *   Backspace      remove last placed vertex (draw tool)
 *   Ctrl+Z         undo draft edit
 *   Ctrl+Y / Ctrl+Shift+Z  redo draft edit
 *   Delete         remove selected vertex (edit-vertices tool)
 *   N              start next part (MULTI* drafts)
 *   H              start polygon hole
 *   S / D / E / M  switch tool: select / draw / edit vertices / move
 */
export function useDrawHotkeys() {
  const { finish, cancel, undoLast } = useDrawActions()
  const { confirmPendingRowAdd, declinePendingRowAdd } = useAddFeature()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = useGeometryEditStore.getState()
      const session = selectActiveSession(store)
      // Commit-level undo stays reachable after a session ends (staged edits outlive it)
      if (!session && !store.isEditMode && store.commitLog.length === 0) return

      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
        if (target.closest('.monaco-editor')) return
      }

      const preview = useDrawPreviewStore.getState()
      if (e.key === 'Escape' && preview.contextMenu) {
        e.preventDefault()
        preview.closeContextMenu()
        return
      }

      if (store.pendingRowAdd) {
        if (e.key === 'Enter') {
          e.preventDefault()
          void confirmPendingRowAdd()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          declinePendingRowAdd()
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redoDraft()
        else void undoLast()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redoDraft()
        return
      }

      if (!session) {
        if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 's' && store.isEditMode) {
          store.setActiveTool('select')
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        void finish()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
        return
      }
      if (e.key === 'Backspace' && store.activeToolId === 'draw') {
        e.preventDefault()
        store.undoVertex()
        return
      }
      if (e.key === 'Delete' && store.activeToolId === 'edit-vertices' && store.selectedVertex) {
        e.preventDefault()
        store.removeVertexAt(store.selectedVertex)
        store.setSelectedVertex(null)
        return
      }

      if (e.key === 'Tab' && (store.activeToolId === 'trace' || store.activeToolId === 'offset-trace')) {
        e.preventDefault()
        flipActiveTraceDirection(store.activeToolId)
        return
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase()
        const gt = session.geometryType
        const isPolygon = gt === 'POLYGON' || gt === 'MULTIPOLYGON'
        const isLine = gt === 'LINESTRING' || gt === 'MULTILINESTRING'
        if (k === 's') store.setActiveTool('select')
        else if (k === 'd') store.setActiveTool('draw')
        else if (k === 'e') store.setActiveTool('edit-vertices')
        else if (k === 'm') store.setActiveTool('move-feature')
        else if (k === 'r' && isPolygon) store.setActiveTool('rectangle')
        else if (k === 'c' && isPolygon) store.setActiveTool('circle')
        else if (k === 'f' && (isPolygon || isLine)) store.setActiveTool('freehand')
        else if (k === 't' && (isPolygon || isLine)) store.setActiveTool('trace')
        else if (k === 'o' && (isPolygon || isLine)) store.setActiveTool('offset-trace')
        else if (k === 'a' && (isPolygon || isLine) && store.activeToolId === 'draw') store.setCurveType(store.curveType === 'arc' ? 'none' : 'arc')
        else if (k === 'n' && canStartNextPart(session)) store.startNextPart()
        else if (k === 'h' && canStartHole(session)) store.startNewHole()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [finish, cancel, undoLast, confirmPendingRowAdd, declinePendingRowAdd])
}
