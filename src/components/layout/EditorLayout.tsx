import React, { useState, useCallback, useRef, useEffect } from 'react'
import { FolderOpen, Save, SaveAll, Package, Layers, Globe, Settings, FolderInput, Circle, ImageIcon, Cloud, Bot, Wrench, HelpCircle, Database } from 'lucide-react'
import { CodeEditor } from '../editor/CodeEditor'
import { Console } from '../console/Console'
import { PackagePanel } from '../packages/PackagePanel'
import { EnvironmentPanel } from '../environment/EnvironmentPanel'
import { DatabasePanel } from '../database/DatabasePanel'
import { SpatialEditor } from '../spatial/SpatialEditor'
import { PlottingPanel } from '../plotting/PlottingPanel'
import { SettingsDialog } from '../settings/SettingsDialog'
import { ProjectDropdown } from '../project/ProjectDropdown'
import { LoadDataDialog } from '../editor/LoadDataDialog'
import { RecordingDestinationDialog } from '../editor/RecordingDestinationDialog'
import { DataConnectorDialog } from '../connector/DataConnectorDialog'
import { AiChatPanel } from '../ai/AiChatPanel'
import { ToolboxDialog } from '../toolbox/ToolboxDialog'
import { HelpPanel } from '../help/HelpPanel'
import { useAiStore } from '@/store/ai'
import { useHelpStore } from '@/store/help'
import { Button } from '../ui/button'
import { useSessionStore } from '@/store/session'
import { useEditorStore } from '@/store/editor'
import { languageOf } from '@/lib/markdown/doc-kind'
import { usePackagesStore } from '@/store/packages'
import { useEnvironmentStore } from '@/store/environment'
import { useDatabaseStore } from '@/store/database'
import { useSpatialStore } from '@/store/spatial'
import { usePlottingStore } from '@/store/plotting'
import { useThemeStore } from '@/store/theme'
import { useUiStore, type DialogId } from '@/store/ui'
import { HighlightOverlay } from './HighlightOverlay'
import { cn } from '@/lib/utils'

// When help is open the right column has a fixed width. This handler makes the
// divider between two adjacent panels resize the LEFT panel while the last
// panel (flex-1) absorbs the slack.
function helpModePanelDivider(
  leftSetWidth: (w: number) => void,
  leftCurrent: number,
  leftMin: number,
  leftMax: number,
) {
  return (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftCurrent
    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX  // positive = dragged right = left panel grows
      leftSetWidth(Math.min(Math.max(startW + delta, leftMin), leftMax))
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }
}

export function EditorLayout(): React.ReactElement {
  const packagesOpen = usePackagesStore((s) => s.isOpen)
  const togglePackages = usePackagesStore((s) => s.toggleOpen)
  const envOpen = useEnvironmentStore((s) => s.isOpen)
  const toggleEnv = useEnvironmentStore((s) => s.toggleOpen)
  const dbOpen = useDatabaseStore((s) => s.isOpen)
  const toggleDb = useDatabaseStore((s) => s.toggleOpen)
  const requestedLoadFile = useDatabaseStore((s) => s.requestedLoadFile)
  const setRequestedLoadFile = useDatabaseStore((s) => s.setRequestedLoadFile)
  const spatialOpen = useSpatialStore((s) => s.isOpen)
  const toggleSpatial = useSpatialStore((s) => s.toggleOpen)
  const plotOpen = usePlottingStore((s) => s.isOpen)
  const togglePlot = usePlottingStore((s) => s.toggleOpen)
  const aiOpen = useAiStore((s) => s.isOpen)
  const toggleAi = useAiStore((s) => s.toggleOpen)
  const [aiWidthPx, setAiWidthPx] = useState(360)
  const aiDragging = useRef(false)
  const helpOpen = useHelpStore((s) => s.isOpen)
  const toggleHelp = useHelpStore((s) => s.toggleOpen)
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
  const [splitPercent, setSplitPercent] = useState(60)
  const [spatialWidthPx, setSpatialWidthPx] = useState(460)
  const [plotWidthPx, setPlotWidthPx] = useState(360)
  const [helpSplitPercent, setHelpSplitPercent] = useState(40)
  const [helpWidthPx, setHelpWidthPx] = useState(420)
  const containerRef = useRef<HTMLDivElement>(null)
  const rightColRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const spatialDragging = useRef(false)
  const plotDragging = useRef(false)
  const helpDragging = useRef(false)
  const helpWidthDragging = useRef(false)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      // Subtract header height (36px)
      const contentTop = rect.top + 36
      const contentHeight = rect.height - 36
      const y = e.clientY - contentTop
      const pct = Math.min(Math.max((y / contentHeight) * 100, 20), 80)
      setSplitPercent(pct)
    }

    const onMouseUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const onSpatialDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    spatialDragging.current = true
    const startX = e.clientX
    const startW = spatialWidthPx
    const onMouseMove = (e: MouseEvent) => {
      if (!spatialDragging.current) return
      const delta = startX - e.clientX
      // Allow the spatial editor to grow to ~2/3 of the window — a bigger map/
      // editing area, especially on small screens — while always leaving the
      // code-editor column at least LEFT_MIN so it stays usable.
      const LEFT_MIN = 380
      const maxW = Math.max(300, Math.min(Math.round(window.innerWidth * (2 / 3)), window.innerWidth - LEFT_MIN))
      setSpatialWidthPx(Math.min(Math.max(startW + delta, 300), maxW))
    }
    const onMouseUp = () => {
      spatialDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [spatialWidthPx])

  const onPlotDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    plotDragging.current = true
    const startX = e.clientX
    const startW = plotWidthPx
    const onMouseMove = (e: MouseEvent) => {
      if (!plotDragging.current) return
      const delta = startX - e.clientX
      setPlotWidthPx(Math.min(Math.max(startW + delta, 240), 700))
    }
    const onMouseUp = () => {
      plotDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [plotWidthPx])

  const onAiDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    aiDragging.current = true
    const startX = e.clientX
    const startW = aiWidthPx
    const onMouseMove = (e: MouseEvent) => {
      if (!aiDragging.current) return
      const delta = startX - e.clientX
      setAiWidthPx(Math.min(Math.max(startW + delta, 280), 700))
    }
    const onMouseUp = () => {
      aiDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [aiWidthPx])

  const onHelpDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    helpDragging.current = true
    const onMouseMove = (e: MouseEvent) => {
      if (!helpDragging.current || !rightColRef.current) return
      const rect = rightColRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.min(Math.max((y / rect.height) * 100, 15), 70)
      setHelpSplitPercent(pct)
    }
    const onMouseUp = () => {
      helpDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  const onHelpWidthDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    helpWidthDragging.current = true
    const startX = e.clientX
    const startW = helpWidthPx
    const onMouseMove = (e: MouseEvent) => {
      if (!helpWidthDragging.current) return
      const delta = startX - e.clientX
      setHelpWidthPx(Math.min(Math.max(startW + delta, 300), 900))
    }
    const onMouseUp = () => {
      helpWidthDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [helpWidthPx])

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
  useEffect(() => {
    window.electronAPI.app.onUiZoom((direction) => {
      if (direction === 'in') zoomIn()
      else zoomOut()
    })
  }, [zoomIn, zoomOut])

  // Panel metadata used for help-mode resize logic
  type PanelId = 'plot' | 'spatial' | 'ai'
  const PANEL_META: Record<PanelId, { min: number; width: number; setWidth: (w: number) => void }> = {
    plot:    { min: 240, width: plotWidthPx,    setWidth: setPlotWidthPx    },
    spatial: { min: 300, width: spatialWidthPx, setWidth: setSpatialWidthPx },
    ai:      { min: 280, width: aiWidthPx,      setWidth: setAiWidthPx      },
  }
  const openPanelIds = (['plot', 'spatial', 'ai'] as PanelId[]).filter((id) =>
    (id === 'plot' && plotOpen) ||
    (id === 'spatial' && spatialOpen) || (id === 'ai' && aiOpen)
  )
  const lastPanelId = openPanelIds[openPanelIds.length - 1] as PanelId | undefined
  const lastPanelMin = lastPanelId ? PANEL_META[lastPanelId].min : 0
  // When help is open, any explicit-width panel must leave at least lastPanelMin for the flex-1 panel
  const helpPanelLeftMax = helpWidthPx - lastPanelMin

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full bg-geo-bg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-geo-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground tracking-wide">ouRGeo</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                envOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleEnv}
              title="Toggle Environment"
              data-ourgeo-id="toolbar.environment"
            >
              <Layers className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                packagesOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={togglePackages}
              title="Toggle Packages"
              data-ourgeo-id="toolbar.packages"
            >
              <Package className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={handleOpen}
              title="Open File (Ctrl+O)"
              data-ourgeo-id="toolbar.openFile"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={handleSave}
              title="Save (Ctrl+S)"
              data-ourgeo-id="toolbar.save"
            >
              <Save className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={handleSaveAs}
              title="Save As"
              data-ourgeo-id="toolbar.saveAs"
            >
              <SaveAll className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={() => showDialog('load-data')}
              title="Load Data"
              data-ourgeo-id="toolbar.loadData"
            >
              <FolderInput className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                dbOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleDb}
              title="Toggle Database Connections"
              data-ourgeo-id="toolbar.databases"
            >
              <Database className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={() => showDialog('data-connector')}
              title="Data Connector"
              data-ourgeo-id="toolbar.dataConnector"
            >
              <Cloud className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-geo-muted hover:text-foreground"
              onClick={() => showDialog('toolbox')}
              title="Toolbox"
              data-ourgeo-id="toolbar.toolbox"
            >
              <Wrench className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                aiOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleAi}
              title="AI Assistant"
              data-ourgeo-id="toolbar.ai"
            >
              <Bot className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                isRecording ? 'text-geo-error' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={isRecording ? handleStopRecording : () => showDialog('recording')}
              title={isRecording ? 'Stop Recording' : 'Record Console'}
              data-ourgeo-id="toolbar.record"
            >
              <Circle className={cn('w-3.5 h-3.5', isRecording && 'fill-geo-error')} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                spatialOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleSpatial}
              title="Toggle Spatial Editor"
              data-ourgeo-id="toolbar.spatial"
            >
              <Globe className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                plotOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={togglePlot}
              title="Toggle Plotting Preview"
              data-ourgeo-id="toolbar.plots"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-6 w-6 p-0',
                helpOpen ? 'text-geo-accent' : 'text-geo-muted hover:text-foreground'
              )}
              onClick={toggleHelp}
              title="Help"
              data-ourgeo-id="toolbar.help"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </Button>
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

      {/* Body: sidebar + editor/console */}
      <div className="flex flex-1 min-h-0">
        {(envOpen || packagesOpen || dbOpen) && (
          <div className="w-[260px] flex-shrink-0 flex flex-col h-full border-r border-geo-border">
            {envOpen && <EnvironmentPanel />}
            {envOpen && (packagesOpen || dbOpen) && <div className="h-px bg-geo-border flex-shrink-0" />}
            {packagesOpen && <PackagePanel />}
            {packagesOpen && dbOpen && <div className="h-px bg-geo-border flex-shrink-0" />}
            {dbOpen && <DatabasePanel />}
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          {/* Editor panel */}
          <div style={{ flex: splitPercent }} className="min-h-0 overflow-hidden">
            <CodeEditor />
          </div>

          {/* Draggable divider */}
          <div
            className="h-1 bg-geo-border hover:bg-geo-accent cursor-row-resize flex-shrink-0 transition-colors"
            onMouseDown={onMouseDown}
          />

          {/* Console panel */}
          <div style={{ flex: 100 - splitPercent }} className="min-h-0 overflow-hidden">
            <Console />
          </div>
        </div>

        {(helpOpen || plotOpen || spatialOpen || aiOpen) && (
          <>
            {/* Left divider before the right column */}
            <div
              className={cn(
                'w-1 bg-geo-border flex-shrink-0 transition-colors',
                helpOpen && 'hover:bg-geo-accent cursor-col-resize'
              )}
              onMouseDown={helpOpen ? onHelpWidthDividerMouseDown : undefined}
            />
            <div
              ref={rightColRef}
              className="flex flex-col flex-shrink-0 h-full overflow-hidden"
              style={{
                width: helpOpen ? helpWidthPx : undefined,
                minWidth: helpOpen ? 300 : undefined,
              }}
            >
              {/* Help panel */}
              {helpOpen && (
                <div
                  className="overflow-hidden flex-shrink-0"
                  style={{ height: (plotOpen || spatialOpen || aiOpen) ? `${helpSplitPercent}%` : '100%' }}
                >
                  <HelpPanel />
                </div>
              )}

              {/* Horizontal divider between help and panels */}
              {helpOpen && (plotOpen || spatialOpen || aiOpen) && (
                <div
                  className="h-1 bg-geo-border hover:bg-geo-accent cursor-row-resize flex-shrink-0 transition-colors"
                  onMouseDown={onHelpDividerMouseDown}
                />
              )}

              {/* Panels row */}
              {(plotOpen || spatialOpen || aiOpen) && (
                <div className={cn('flex min-w-0 overflow-hidden', helpOpen ? 'flex-1 min-h-0' : 'h-full')}>
                  {plotOpen && (() => {
                    const idx = openPanelIds.indexOf('plot')
                    const isFirst = idx === 0
                    const isLast = idx === openPanelIds.length - 1
                    const prevId = idx > 0 ? openPanelIds[idx - 1] : null
                    return (
                      <>
                        {(!helpOpen || !isFirst) && (
                          <div
                            className="w-1 bg-geo-border hover:bg-geo-accent cursor-col-resize flex-shrink-0 transition-colors"
                            onMouseDown={helpOpen && prevId
                              ? helpModePanelDivider(PANEL_META[prevId].setWidth, PANEL_META[prevId].width, PANEL_META[prevId].min, helpPanelLeftMax)
                              : onPlotDividerMouseDown}
                          />
                        )}
                        <div
                          style={{ width: helpOpen && isLast ? undefined : plotWidthPx }}
                          className={cn('h-full', helpOpen && isLast ? 'flex-1 min-w-0' : 'flex-shrink-0 min-w-[240px]')}
                        >
                          <PlottingPanel />
                        </div>
                      </>
                    )
                  })()}
                  {spatialOpen && (() => {
                    const idx = openPanelIds.indexOf('spatial')
                    const isFirst = idx === 0
                    const isLast = idx === openPanelIds.length - 1
                    const prevId = idx > 0 ? openPanelIds[idx - 1] : null
                    return (
                      <>
                        {(!helpOpen || !isFirst) && (
                          <div
                            className="w-1 bg-geo-border hover:bg-geo-accent cursor-col-resize flex-shrink-0 transition-colors"
                            onMouseDown={helpOpen && prevId
                              ? helpModePanelDivider(PANEL_META[prevId].setWidth, PANEL_META[prevId].width, PANEL_META[prevId].min, helpPanelLeftMax)
                              : onSpatialDividerMouseDown}
                          />
                        )}
                        <div
                          style={{ width: helpOpen && isLast ? undefined : spatialWidthPx }}
                          className={cn('h-full', helpOpen && isLast ? 'flex-1 min-w-0' : 'flex-shrink-0 min-w-[300px]')}
                        >
                          <SpatialEditor />
                        </div>
                      </>
                    )
                  })()}
                  {aiOpen && (() => {
                    const idx = openPanelIds.indexOf('ai')
                    const isFirst = idx === 0
                    const isLast = idx === openPanelIds.length - 1
                    const prevId = idx > 0 ? openPanelIds[idx - 1] : null
                    return (
                      <>
                        {(!helpOpen || !isFirst) && (
                          <div
                            className="w-1 bg-geo-border hover:bg-geo-accent cursor-col-resize flex-shrink-0 transition-colors"
                            onMouseDown={helpOpen && prevId
                              ? helpModePanelDivider(PANEL_META[prevId].setWidth, PANEL_META[prevId].width, PANEL_META[prevId].min, helpPanelLeftMax)
                              : onAiDividerMouseDown}
                          />
                        )}
                        <div
                          style={{ width: helpOpen && isLast ? undefined : aiWidthPx }}
                          className={cn('h-full', helpOpen && isLast ? 'flex-1 min-w-0' : 'flex-shrink-0 min-w-[280px]')}
                        >
                          <AiChatPanel />
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
          </>
        )}
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
      <RecordingDestinationDialog
        open={openDialog === 'recording'}
        onOpenChange={dialogToggle('recording')}
        onConfirm={handleStartRecording}
      />
      <HighlightOverlay />
    </div>
  )
}
