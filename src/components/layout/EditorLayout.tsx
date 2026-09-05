import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ThemeStudioDialog } from '../settings/ThemeStudioDialog'
import { PluginManagerDialog } from '../settings/PluginManagerDialog'
import { VoiceModelDialog } from '../voice/VoiceModelDialog'
import { ProjectDropdown } from '../project/ProjectDropdown'
import { LoadDataDialog } from '../editor/LoadDataDialog'
import { RecordingDestinationDialog } from '../editor/RecordingDestinationDialog'
import { DataConnectorDialog } from '../connector/DataConnectorDialog'
import { ToolboxDialog } from '../toolbox/ToolboxDialog'
import { Button } from '../ui/button'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { languageOf } from '@/lib/markdown/doc-kind'
import { useDatabaseStore } from '@/store/database'
import { useThemeStore } from '@/store/theme'
import { useLayoutStore } from '@/store/layout'
import { zoomFocusedTerminal } from '@/lib/terminal/zoom'
import { usePluginRevision } from '@/store/plugins'
import { useUiStore, type DialogId } from '@/store/ui'
import { zoneVisible, type PanelId, type ZoneId } from '@/lib/layout/model'
import { resolveToolbar, type ToolbarButtonDef } from '@/lib/layout/toolbar'
import { actionById } from '@/lib/ai-actions/registry'
import { HighlightOverlay } from './HighlightOverlay'
import { Zone, EmptyZoneTarget, ContentDragLabel } from './Zone'
import { startDragResize } from './resize'
import { useElementSize } from './useElementSize'
import { cn } from '@/lib/utils'

// The workspace, rendered from `useLayoutStore`.
//
// Everything about *where* things are is data now — see lib/layout/model.ts for
// why, and for the invariants `normalize` guarantees this render can rely on:
// every panel in exactly one zone, no panel that does not exist, and always an
// editor somewhere. This component's job is to turn that value into boxes.

export function EditorLayout(): React.ReactElement {
  // A plugin can contribute a panel or a toolbar button while the app runs.
  usePluginRevision()
  const layout = useLayoutStore((s) => s.layout)
  const initLayout = useLayoutStore((s) => s.init)
  const togglePanel = useLayoutStore((s) => s.togglePanel)
  const setZoneSize = useLayoutStore((s) => s.setZoneSize)

  const requestedLoadFile = useDatabaseStore((s) => s.requestedLoadFile)
  const setRequestedLoadFile = useDatabaseStore((s) => s.setRequestedLoadFile)
  const zoomIn = useThemeStore((s) => s.zoomIn)
  const zoomOut = useThemeStore((s) => s.zoomOut)

  // Dialog visibility lives in the ui store so anything outside this component
  // — the AI assistant walking a user through a workflow, the database panel
  // asking for Load Data — can open one. See src/store/ui.ts.
  const openDialog = useUiStore((s) => s.openDialog)
  const showDialog = useUiStore((s) => s.showDialog)
  const hideDialog = useUiStore((s) => s.hideDialog)
  const dialogToggle = useCallback(
    (id: DialogId) => (o: boolean) => { if (o) showDialog(id); else hideDialog(id) },
    [showDialog, hideDialog],
  )

  const isRecording = useSessionStore((s) => s.isRecording)
  const recordingTargetTabId = useSessionStore((s) => s.recordingTargetTabId)
  const recordingReturnOutput = useSessionStore((s) => s.recordingReturnOutput)
  const consoleHistory = useSessionStore((s) => s.consoleHistory)
  const startRecording = useSessionStore((s) => s.startRecording)
  const stopRecording = useSessionStore((s) => s.stopRecording)
  const recordingHistoryLengthRef = useRef(0)

  /** The panel being dragged, or null. Lifted here so a panel can be dragged
   *  out of one zone and into another. */
  const [drag, setDrag] = useState<PanelId | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const body = useElementSize(bodyRef)

  useEffect(() => { void initLayout() }, [initLayout])

  const handleStartRecording = useCallback((targetTabId: string, destType: Parameters<typeof startRecording>[1], returnOutput: boolean) => {
    recordingHistoryLengthRef.current = useSessionStore.getState().consoleHistory.length
    hideDialog('recording')
    startRecording(targetTabId, destType, returnOutput)
  }, [startRecording, hideDialog])

  // Real-time: append new entries to recording tab as they arrive
  useEffect(() => {
    if (!isRecording || !recordingTargetTabId) {
      recordingHistoryLengthRef.current = consoleHistory.length
      return
    }

    const newEntries = consoleHistory.slice(recordingHistoryLengthRef.current)
    recordingHistoryLengthRef.current = consoleHistory.length

    let lines: string[]
    if (recordingReturnOutput) {
      lines = newEntries
        .filter((e) => e.type === 'input' || e.type === 'output' || e.type === 'error')
        .map((e) =>
          e.type === 'input'
            ? e.text
            : e.text.split('\n').map((l) => `# ${l}`).join('\n')
        )
    } else {
      lines = newEntries.filter((e) => e.type === 'input').map((e) => e.text)
    }

    if (lines.length === 0) return

    const tab = useEditorStore.getState().tabs.find((t) => t.id === recordingTargetTabId)
    if (!tab) return

    const newContent = tab.content ? `${tab.content}\n${lines.join('\n')}` : lines.join('\n')
    useEditorStore.getState().applyExternalContent(recordingTargetTabId, newContent)
  }, [consoleHistory, isRecording, recordingTargetTabId, recordingReturnOutput])

  const handleStopRecording = useCallback(async () => {
    const { destType, targetTabId } = stopRecording()
    if (!targetTabId || destType !== 'saved') return

    const tab = useEditorStore.getState().tabs.find((t) => t.id === targetTabId)
    if (!tab?.filePath) return

    const confirmed = window.confirm(`Save changes to ${tab.fileName}?`)
    if (confirmed) {
      await window.electronAPI.file.write(tab.filePath, tab.content)
      useEditorStore.getState().markTabSaved(targetTabId, tab.filePath, tab.content)
    }
  }, [stopRecording])

  const handleOpen = useCallback(async () => {
    const filePath = await window.electronAPI.dialog.openFile()
    if (!filePath) return
    const content = await window.electronAPI.file.read(filePath)
    useEditorStore.getState().addTab(filePath, content)
  }, [])

  const handleSaveAs = useCallback(async () => {
    const state = useEditorStore.getState()
    const tab = state.getActiveTab()
    if (!tab) return

    const filePath = await window.electronAPI.dialog.saveFile(languageOf(tab))
    if (!filePath) return

    await window.electronAPI.file.write(filePath, tab.content)
    state.markTabSaved(tab.id, filePath, tab.content)
  }, [])

  const handleSave = useCallback(async () => {
    const state = useEditorStore.getState()
    const tab = state.getActiveTab()
    if (!tab) return

    if (tab.filePath) {
      await window.electronAPI.file.write(tab.filePath, tab.content)
      state.markTabSaved(tab.id, tab.filePath, tab.content)
    } else {
      // Fall through to Save As
      await handleSaveAs()
    }
  }, [handleSaveAs])

  // Ctrl+O handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault()
        handleOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [handleOpen])

  // Open the Load Data dialog when the database panel requests it for a specific file
  useEffect(() => {
    if (requestedLoadFile) showDialog('load-data')
  }, [requestedLoadFile, showDialog])

  // Ctrl+Shift+= / Ctrl+Shift+- zoom via IPC (intercepted in main process before Chromium)
  //
  // Routed to the terminal when a terminal has the keyboard, because Ctrl+± is
  // font size in every terminal there is and scaling the whole interface is
  // not what the user meant. It has to be decided here rather than in the
  // terminal: main calls `preventDefault` on these before Chromium sees them,
  // so the keystroke never reaches the focused element at all — only this
  // message does.
  useEffect(() => {
    window.electronAPI.app.onUiZoom((direction) => {
      if (zoomFocusedTerminal(direction)) return
      if (direction === 'in') zoomIn()
      else zoomOut()
    })
  }, [zoomIn, zoomOut])

  // The four things a toolbar button can be. `panel` and `dialog` are
  // declarative and live on the definition; these two are the escapes.
  const commands: Record<string, () => void> = {
    openFile: () => { void handleOpen() },
    save: () => { void handleSave() },
    saveAs: () => { void handleSaveAs() },
    record: () => { if (isRecording) void handleStopRecording(); else showDialog('recording') },
  }

  const buttons = resolveToolbar(layout.toolbar.order, layout.toolbar.hidden)

  const leftOpen = zoneVisible(layout, 'left')
  const rightOpen = zoneVisible(layout, 'right')
  const bottomOpen = zoneVisible(layout, 'bottom')

  // How much room the side zones may take between them, so the centre always
  // keeps a floor. The old layout reserved this by hand on one divider
  // (`innerWidth - 380`); doing it here covers all three zones and every route
  // that changes a size — a drag, a preset, an assistant's call, a window
  // resize. When both sides want more than there is, they are scaled down in
  // proportion rather than one of them being starved.
  const CENTER_MIN_W = 320
  const CENTER_MIN_H = 160
  const caps = ((): { left?: number; right?: number; bottom?: number } => {
    if (body.w === 0) return {}          // not measured yet — no ceiling
    const wantL = leftOpen ? layout.zones.left.size : 0
    const wantR = rightOpen ? layout.zones.right.size : 0
    const room = Math.max(0, body.w - CENTER_MIN_W)
    const total = wantL + wantR
    const scale = total > room && total > 0 ? room / total : 1
    return {
      left: wantL * scale,
      right: wantR * scale,
      bottom: Math.max(0, body.h - CENTER_MIN_H),
    }
  })()

  const zoneDivider = (zone: ZoneId, axis: 'x' | 'y', direction: 1 | -1): React.ReactElement => (
    <div
      className={cn(
        'bg-geo-border hover:bg-geo-accent flex-shrink-0 transition-colors',
        axis === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      )}
      onMouseDown={startDragResize({
        axis,
        from: layout.zones[zone].size,
        direction,
        min: 120,
        max: 2000,
        onResize: (size) => setZoneSize(zone, size),
      })}
    />
  )

  return (
    <div className="flex flex-col h-full w-full bg-geo-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground tracking-wide">ouRGeo</span>
          <div className="flex items-center gap-1">
            {buttons.map((b) => (
              <ToolbarButton
                key={b.id}
                def={b}
                layout={layout}
                isRecording={isRecording}
                onPanel={togglePanel}
                onDialog={showDialog}
                onCommand={commands}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SettingsDialog open={openDialog === 'settings'} onOpenChange={dialogToggle('settings')}>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              title="Settings"
              data-ourgeo-id="toolbar.settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </SettingsDialog>
          <ProjectDropdown />
        </div>
      </div>

      {/* Body: left | (centre over bottom) | right */}
      <div ref={bodyRef} className="flex flex-1 min-h-0">
        {leftOpen ? (
          <>
            <Zone zone="left" layout={layout} drag={drag} setDrag={setDrag} maxSize={caps.left} />
            {zoneDivider('left', 'x', 1)}
          </>
        ) : drag && <EmptyZoneTarget zone="left" />}

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <Zone zone="center" layout={layout} drag={drag} setDrag={setDrag} />
          {bottomOpen ? (
            <>
              {zoneDivider('bottom', 'y', -1)}
              <Zone zone="bottom" layout={layout} drag={drag} setDrag={setDrag} maxSize={caps.bottom} />
            </>
          ) : drag && <EmptyZoneTarget zone="bottom" />}
        </div>

        {rightOpen ? (
          <>
            {zoneDivider('right', 'x', -1)}
            <Zone zone="right" layout={layout} drag={drag} setDrag={setDrag} maxSize={caps.right} />
          </>
        ) : drag && <EmptyZoneTarget zone="right" />}
      </div>

      <LoadDataDialog
        open={openDialog === 'load-data'}
        onOpenChange={(o) => {
          if (o) showDialog('load-data')
          else { hideDialog('load-data'); setRequestedLoadFile(null) }
        }}
        initialFilePath={requestedLoadFile}
      />
      <DataConnectorDialog
        open={openDialog === 'data-connector'}
        onOpenChange={dialogToggle('data-connector')}
      />
      <ToolboxDialog open={openDialog === 'toolbox'} onOpenChange={dialogToggle('toolbox')} />
      {/* A sibling of Settings, not a child. Nesting it inside would put the
          studio's focus trap under Settings' own, and closing the studio would
          then have to decide whether Settings should still be there. */}
      <ThemeStudioDialog
        open={openDialog === 'theme-studio'}
        onOpenChange={dialogToggle('theme-studio')}
      />
      {/* Reads its own visibility from the ui store: it is opened both from
          Settings and from the microphone in the AI panel, and a prop chain
          from either would leave the other unable to show it. */}
      <VoiceModelDialog />
      {/* A sibling of Settings for the same reason the Theme Studio is. */}
      <PluginManagerDialog
        open={openDialog === 'plugins'}
        onOpenChange={dialogToggle('plugins')}
      />
      <RecordingDestinationDialog
        open={openDialog === 'recording'}
        onOpenChange={dialogToggle('recording')}
        onConfirm={handleStartRecording}
      />
      {/* Asked when an object is sent to the map and the workspace has two of
          them. A sibling, like the other dialogs, because the four places that
          send an object must all ask the same question. */}
      <HighlightOverlay />
      {/* Above every panel, so a tab dragged between two editors is not clipped
          by the one it is leaving. */}
      <ContentDragLabel />
    </div>
  )
}

/**
 * A plugin's toolbar button runs one of its registered actions.
 *
 * Through the registry, so the action is the same object the assistant runs —
 * one implementation, one place its result is reported. Failures land in the
 * console rather than a dialog: a toolbar click that quietly did nothing is
 * the failure mode worth avoiding, and the console is where every other
 * operation already reports itself.
 */
async function runToolbarAction(id: string): Promise<void> {
  const action = actionById(id)
  const session = useSessionStore.getState()
  if (!action) {
    session.addConsoleEntry('error', `That button runs "${id}", which is not registered. Is its plugin enabled?`)
    return
  }
  try {
    const res = await action.run({})
    session.addConsoleEntry(res.ok ? 'info' : 'error', res.message)
  } catch (e) {
    session.addConsoleEntry('error', `${id} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function ToolbarButton(
  { def, layout, isRecording, onPanel, onDialog, onCommand }: {
    def: ToolbarButtonDef
    layout: import('@/lib/layout/model').LayoutState
    isRecording: boolean
    onPanel: (p: PanelId) => void
    onDialog: (d: DialogId) => void
    onCommand: Record<string, () => void>
  },
): React.ReactElement {
  const Icon = def.icon
  const recording = def.command === 'record' && isRecording
  const active = def.panel ? layout.open[def.panel] === true : false
  const label = recording ? 'Stop Recording' : def.label

  const onClick = (): void => {
    if (def.panel) onPanel(def.panel)
    else if (def.dialog) onDialog(def.dialog)
    else if (def.command) onCommand[def.command]?.()
    else if (def.action) void runToolbarAction(def.action)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-6 w-6 p-0',
        recording ? 'text-geo-error'
          : active ? 'text-geo-accent'
          : 'text-geo-muted hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
      data-ourgeo-id={def.targetId}
    >
      <Icon className={cn('w-3.5 h-3.5', recording && 'fill-geo-error')} />
    </Button>
  )
}

