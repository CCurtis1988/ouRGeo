import { AppUpdateController } from '@/components/settings/AppUpdateController'
import { initProjectFileAiInvalidation } from '@/lib/project-file-ai'
import { initProjectFiles } from '@/store/project-files'
import { startProjectFileAutoAnalysis } from '@/lib/project-file-auto-analysis'
import React, { useEffect, useRef } from 'react'
import { EditorLayout } from './components/layout/EditorLayout'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { rClient, type REnvironmentInfo, type RLibrary } from './lib/r-client'
import { wsClient } from './lib/ws-client'
import { refreshWorkingDir } from '@/lib/working-dir'
import { useSessionStore } from './store/session'
import { usePackagesStore } from './store/packages'
import { usePlottingStore } from './store/plotting'
import { useWidgetsStore } from './store/widgets'
import { loadChats, setupChatsAutosave } from './lib/ai-chats-persistence'
import { setupContextLifecycle } from './lib/context/lifecycle'
import { useContextStore } from './store/context'
import { flushLayout } from './store/layout'
import { loadPlugins } from './lib/plugins/loader'
import { APP_VERSION } from './components/settings/versionHistory'
import { loadPlots, setupPlotsAutosave } from './lib/plots-persistence'
import { setupPlotPopoutSync } from './lib/plot-popout-sync'
import { PlotPopoutView } from './components/plotting/PlotPopoutView'
import { loadWorkspace, setupWorkspaceAutosave } from './lib/workspace-persistence'
import { rehydrateRasterLayers, createRasterLayerInfo } from './lib/raster-layers'
import { useSpatialStore } from './store/spatial'
import {
  loadRecentProjects,
  setupProjectTracking,
  enableDirtyTracking,
  loadProjectFromPath,
  restoreScratchDocuments,
  lastOpenLostDocuments,
} from './lib/project-persistence'
import { startDraftWriter, startCheckpointScheduler, flushDraft, useDraftStatus } from './lib/project-draft'
import { leaveCurrentWorkspace } from './lib/project-leave'
import { reportCrash } from './lib/crash-report'
import { hasUnsavedEdits } from './lib/document-close'
import { loadProjectSettings } from './store/project-settings'
import { loadPromptPreferences } from './store/prompt-preferences'
import { loadRecentlyClosed } from './store/recently-closed'
import { useEditorStore } from './store/editor'
import { useProjectStore } from './store/project'
import { AskDialog } from './components/project/AskDialog'
import { MergeDialog } from './components/project/MergeDialog'
import type { LaunchState } from './lib/project-draft-types'
import { reconnectToR, pruneStaleObjectTabs } from './lib/reconnect-r'
import { loadTheme, loadUiScale, loadEditorThemes } from './lib/theme-persistence'
import { loadCustomThemes } from './lib/custom-themes-persistence'
import { useCustomThemeStore } from './store/custom-themes'
import { applyTheme } from './lib/themes'
import { applyEditorTheme } from './lib/editor-themes'
import { useThemeStore, applyUiScale } from './store/theme'
import { useThemeBackgroundStore } from './store/theme-backgrounds'
import { startThemeBackgroundPlayback } from './lib/theme-background-playback'
import { loadSpatialSettings } from './lib/spatial-settings-persistence'
import { useSpatialSettingsStore } from './store/spatialSettings'
import { loadMarkdownSettings } from './lib/markdown-settings-persistence'
import { useMarkdownSettingsStore } from './store/markdownSettings'
import { loadBasemap } from './lib/basemap-persistence'
import { loadEnvironmentPreferences } from './lib/environment-preferences'
import { useBasemapStore } from './store/basemap'
import { useEnvironmentStore } from './store/environment'
import { useVoiceStore } from './store/voice'
import { HealthCheckDialog } from './components/settings/HealthCheckDialog'

// Detect if this window is the plot popout
const isPopout = typeof window !== 'undefined' && window.location.hash === '#plot-popout'

export default function App(): React.ReactElement {
  if (isPopout) return <PlotPopoutView />

  return <MainApp />
}

function MainApp(): React.ReactElement {
  const setRStatus = useSessionStore((s) => s.setRStatus)
  const setRPort = useSessionStore((s) => s.setRPort)
  const setWsConnected = useSessionStore((s) => s.setWsConnected)
  const addEntry = useSessionStore((s) => s.addConsoleEntry)

  const initialized = useRef(false)

  useEffect(() => {
    // Register handlers even when first-run R startup fails. The health check
    // can repair packages and connect R later without reloading the renderer.
    const cleanupWsStatus = wsClient.onStatus((connected) => {
      setWsConnected(connected)
    })

    const cleanupWsMessages = wsClient.onMessage((type, text, data) => {
      if (type === 'install_complete') {
        usePackagesStore.getState().refreshPackages()
        return
      }
      if (type === 'plot' && data && typeof data === 'object' && 'dataUrl' in (data as object)) {
        // The popout window is fed by setupPlotPopoutSync, which mirrors
        // the store — no direct push needed here.
        const { dataUrl, plotId } = data as { dataUrl: string; plotId?: string }
        usePlottingStore.getState().addPlot(dataUrl, plotId ?? null)
        return
      }
      if (type === 'env' && data && typeof data === 'object' && 'name' in (data as object)) {
        useEnvironmentStore.getState().mergeEnvironment(data as REnvironmentInfo)
        return
      }
      if (type === 'packages' && data && typeof data === 'object' && 'libraries' in (data as object)) {
        usePackagesStore.getState().setLibraries((data as { libraries: RLibrary[] }).libraries)
        return
      }
      if (type === 'wd' && data && typeof data === 'object' && 'path' in (data as object)) {
        useSessionStore.getState().setWorkingDir((data as { path: string }).path)
        return
      }
      if (type === 'widget' && data && typeof data === 'object' && 'id' in (data as object)) {
        useWidgetsStore.getState().addWidget((data as { id: string }).id)
        usePlottingStore.getState().ensureOpen()
        return
      }
      if (type === 'raster_layer_invalidated' && data && typeof data === 'object' && 'layerId' in (data as object)) {
        // The backing R object changed or vanished — re-register the map
        // layer (fresh warp) or drop it when the object is gone.
        const staleId = (data as { layerId: string }).layerId
        const spatial = useSpatialStore.getState()
        const target = spatial.layers.find(
          (l) => l.kind === 'raster' && l.raster?.layerId === staleId
        )
        if (target?.raster) {
          void createRasterLayerInfo(target.name, target.envName, target.raster.symbology)
            .then((info) => useSpatialStore.getState().updateRasterInfo(target.id, info))
            .catch(() => useSpatialStore.getState().removeLayer(target.id))
        }
        return
      }
      if (text.trim()) {
        addEntry(type === 'stderr' ? 'error' : 'output', text)
      }
    })

    async function init() {
      if (initialized.current) return
      initialized.current = true

      // How the last session ended, and what to reopen
      // (docs/project-persistence-spec.md §1.3, §3). A renderer reload is not
      // a launch: R and the main process kept everything.
      let launch: LaunchState = { firstLoad: true, crashed: false, project: null }
      try { launch = await window.electronAPI.drafts.launch() } catch { /* older main: scratch */ }
      await loadProjectSettings()
      void loadPromptPreferences()
      void loadRecentlyClosed()
      let scratchRestore: { restored: string[]; lost: string[] } = { restored: [], lost: [] }

      if (!launch.project) {
        // Scratch's documents. A fresh launch keeps only the untitled ones
        // (§2.1); a reload keeps them all, since scratch was never left.
        scratchRestore = await restoreScratchDocuments({ keepFileBacked: !launch.firstLoad })
        // Chats, plots, layers and console survive a reload only. Main
        // deletes these files at launch, so on a fresh start this reads
        // nothing and scratch opens clean — which is what scratch is.
        try { await loadChats() } catch { /* nothing to recover */ }
        try { await loadPlots() } catch { /* no saved plots yet */ }
        try { await loadWorkspace() } catch { /* no saved workspace yet */ }
      }

      // Load the recent-projects list for the project dropdown
      try { await loadRecentProjects() } catch { /* no recents yet */ }

      // Plugins BEFORE the theme and layout restores below. A plugin can
      // contribute a theme and a panel, and both of those are resolved by id
      // against a registry — a saved id whose plugin has not loaded yet reads
      // as missing, and the restore quietly falls back to a default.
      try {
        await loadPlugins(APP_VERSION)
      } catch (e) {
        // Never fatal. ouRGeo without plugins is still ouRGeo; ouRGeo that
        // will not start because of one is not.
        console.error('[Plugins] Failed to load:', e)
      }

      // Register the user's own themes BEFORE resolving the saved ids — a
      // theme built in the Theme Studio is not in the registries until this
      // runs, and `loadTheme`/`loadEditorThemes` validate against them.
      try {
        useCustomThemeStore.getState().init(await loadCustomThemes())
      } catch { /* ship-only themes are a fine fallback */ }

      // Load and apply saved theme
      const savedTheme = await loadTheme()
      const { codeTheme, markdownTheme } = await loadEditorThemes(savedTheme)
      applyTheme(savedTheme)
      applyEditorTheme(savedTheme, codeTheme, markdownTheme)
      const savedScale = await loadUiScale()
      applyUiScale(savedScale)
      useThemeStore.setState({
        current: savedTheme,
        codeTheme,
        markdownTheme,
        uiScale: savedScale,
      })
      // Background choices are device preferences, restored after custom theme
      // definitions. A damaged gallery config must never prevent app startup.
      try { await useThemeBackgroundStore.getState().init() }
      catch (error) { console.warn('[Theme backgrounds] Restore failed:', error) }

      // Load spatial editor settings
      const {
        mode: extentMode, userExtent, snapSettings, showAttributePopup, calcCrs, defaultCrs,
        lastExportMode, traverseUnit, traverseNotation
      } = await loadSpatialSettings()
      useSpatialSettingsStore.setState({
        initialExtentMode: extentMode,
        userExtent,
        snapSettings,
        showAttributePopup,
        calcCrs,
        defaultCrs,
        lastExportMode,
        traverseUnit,
        traverseNotation
      })

      // Load markdown/R Markdown document settings
      const mdSettings = await loadMarkdownSettings()
      useMarkdownSettingsStore.setState(mdSettings)

      // Load saved basemap override
      const savedBasemap = await loadBasemap()
      useBasemapStore.setState({ overrideBasemapId: savedBasemap })

      // Voice input: device, service and dictation preferences.
      void useVoiceStore.getState().init()

      // How the Environment panel lists each of the user's environments —
      // beside .GlobalEnv, or inside it as well.
      const envPrefs = await loadEnvironmentPreferences()
      useEnvironmentStore.getState().setEnvPlacements(envPrefs.envPlacement)

      setRStatus('connecting')

      try {
        await rClient.connect()
        const port = rClient.port

        if (!port) {
          setRStatus('error')
          addEntry('error', 'Could not connect to R server. Is R installed?')
          useProjectStore.setState({ restored: true })
          return
        }

        setRPort(port)

        // Wait for R to be healthy
        let healthy = false
        for (let i = 0; i < 30; i++) {
          healthy = await rClient.health()
          if (healthy) break
          await new Promise((r) => setTimeout(r, 1000))
        }

        if (!healthy) {
          setRStatus('error')
          addEntry('error', 'R server health check failed after 30s')
          useProjectStore.setState({ restored: true })
          return
        }

        setRStatus('ready')

        // Initialize session
        const sessionResult = await rClient.initSession()
        if (sessionResult.systemNames?.length) {
          useEnvironmentStore.getState().addRdataLoadedNames('.GlobalEnv', sessionResult.systemNames)
          useEnvironmentStore.getState().setSystemNames(sessionResult.systemNames)
        }
        addEntry('info', 'R session ready.')
        void refreshWorkingDir()

        // The project open at quit comes back with its draft (§1.3). On a
        // reload R still holds its objects, so only the window is rebuilt.
        // Read before opening: the draft writer starts again once the project
        // is open, and "the newest recovered change" must not become "now".
        const crashedMeta = launch.crashed && launch.project ? (await window.electronAPI.drafts.read(launch.project)).meta : null
        if (launch.project) {
          await loadProjectFromPath(launch.project, { keepR: !launch.firstLoad })
          // "Not opened" can still mean opened: cancelling Resolve conflicts
          // leaves the user's own version open. Only an empty workspace gets
          // scratch's documents — restoring them over an open project once
          // replaced its documents, and the draft writer saved that.
          if (useProjectStore.getState().path === null) scratchRestore = await restoreScratchDocuments({ keepFileBacked: false })
        }
        useProjectStore.setState({ restored: true })
        if (launch.crashed) {
          const named = useProjectStore.getState().path !== null
          const status = useDraftStatus.getState()
          const meta = named ? crashedMeta : null
          void reportCrash({
            scratch: !named,
            documents: named ? useEditorStore.getState().tabs.filter(hasUnsavedEdits).map(t => t.fileName) : scratchRestore.restored,
            lost: named ? lastOpenLostDocuments() : scratchRestore.lost,
            checkpointAt: status.checkpointAt,
            newestChange: meta?.changed ? meta.updatedAt : null,
          })
        }

        // Startup restore is done — from here on, env/state changes mark the
        // project dirty (drives the exit/switch save prompt).
        enableDirtyTracking()

        // Drop any restored data-viewer/function-editor tabs whose object isn't
        // in this R session (keeps them after a reload, cleans up on fresh start).
        void pruneStaleObjectTabs()

        // Re-register restored raster map layers with the R tile engine
        // (server-side registrations are session-scoped; layers whose object
        // is gone are dropped).
        void rehydrateRasterLayers()

        // Connect WebSocket console
        wsClient.connect(port)
      } catch (err) {
        setRStatus('error')
        addEntry('error', `Initialization failed: ${String(err)}`)
        useProjectStore.setState({ restored: true })
      }
    }

    init()

    const cleanupDrafts = startDraftWriter()
    const cleanupCheckpoints = startCheckpointScheduler()
    const cleanupChatsAutosave = setupChatsAutosave()
    const cleanupContext = setupContextLifecycle()
    void useContextStore.getState().init()
    const cleanupPlotsAutosave = setupPlotsAutosave()
    const cleanupPlotPopoutSync = setupPlotPopoutSync()
    const cleanupWorkspaceAutosave = setupWorkspaceAutosave()
    const cleanupProjectTracking = setupProjectTracking()
    initProjectFileAiInvalidation()
    initProjectFiles()
    const cleanupFileAnalysis = startProjectFileAutoAnalysis()

    // Auto-reconnect when R restarts (e.g. after hibernation or crash)
    const cleanupRestarted = window.electronAPI.r.onRestarted(() => {
      void reconnectToR({ unexpected: true })
    })

    // On system resume, the R console WebSocket can be left half-open (no data,
    // no close event) — reconnect it so live output/plots/env updates resume.
    // R itself survives sleep, so this keeps all state intact.
    const refreshSocket = (): void => {
      // Force a fresh socket — a suspended one can report OPEN while being dead,
      // so don't trust isConnected. connect() closes the stale one first.
      const port = useSessionStore.getState().rPort
      if (port) wsClient.connect(port)
    }
    const cleanupResume = window.electronAPI.system?.onResume(refreshSocket)

    // On window close: a named project's work goes to its draft (or is saved,
    // or asked about — Settings → Projects); scratch offers Save as project
    // and asks about unsaved file edits (lib/project-leave.tsx). Cancel at any
    // question keeps the app open.
    let quitting = false
    const cleanupBeforeQuit = window.electronAPI.app.onBeforeQuit(() => {
      if (quitting) return
      quitting = true
      void (async () => {
        try {
          if (!await leaveCurrentWorkspace('quit')) return // keep the app open
        } finally { quitting = false }
        // The draft is flushed; chats deliberately are NOT written to
        // ai-chats.json. That file is session-scoped, and a write started now
        // would race the will-quit handler that deletes it.
        await flushDraft()
        // Awaited: confirmQuit destroys the window, and an in-flight write to
        // layout.json does not survive that.
        await flushLayout()
        await window.electronAPI.app.confirmQuit()
      })()
    })

    // Fallback wake detector: powerMonitor's resume event is unreliable on some
    // Linux/Wayland desktops. A heartbeat that sees a large wall-clock jump means
    // the machine slept — revalidate the R socket even if system:resume didn't fire.
    let lastTick = Date.now()
    const wakeTimer = setInterval(() => {
      const now = Date.now()
      if (now - lastTick > 30_000) refreshSocket()
      lastTick = now
    }, 10_000)

    return () => {
      cleanupWsStatus()
      cleanupWsMessages()
      cleanupDrafts()
      cleanupCheckpoints()
      cleanupChatsAutosave()
      cleanupContext()
      cleanupPlotsAutosave()
      cleanupPlotPopoutSync()
      cleanupWorkspaceAutosave()
      cleanupProjectTracking()
      cleanupFileAnalysis()
      cleanupRestarted()
      cleanupResume?.()
      cleanupBeforeQuit()
      clearInterval(wakeTimer)
      wsClient.disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <ThemeBackgroundLifecycle />
    <ErrorBoundary><EditorLayout /><MergeDialog /><AskDialog /></ErrorBoundary>
    {/* A map/compositor render failure must not unmount an active repair. */}
    <ErrorBoundary><HealthCheckDialog /></ErrorBoundary>
    <AppUpdateController />
  </>
}

function ThemeBackgroundLifecycle(): null {
  useEffect(() => {
    const stop = startThemeBackgroundPlayback()
    // This read need not wait for R/session restoration. The main startup path
    // awaits the same coalesced promise after registering custom themes, so a
    // remembered gallery selection is ready when its app theme is applied.
    void useThemeBackgroundStore.getState().init().catch(error => console.warn('[Theme backgrounds] Restore failed:', error))
    const refresh = (): void => { void useThemeBackgroundStore.getState().refreshFolders().catch(error => console.warn('[Theme image folders] Refresh failed:', error)) }
    refresh()
    const unsubscribe = window.electronAPI.themeBackgrounds.onChanged(refresh)
    return () => { stop(); unsubscribe() }
  }, [])
  return null
}
