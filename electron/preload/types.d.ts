/** Mirror of the main window's current plot selection, sent to the popout. */
interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

declare global {
  interface Window {
    electronAPI: {
      r: {
        getPort(): Promise<number | null>
        isReady(): Promise<boolean>
        detectInstallations(): Promise<{ path: string; version: string }[]>
        getConfiguredPath(): Promise<string | null>
        setAndRestartR(path: string | null): Promise<void>
        browseRscript(): Promise<string | null>
        interrupt(): Promise<void>
        onRestarted(callback: () => void): () => void
      }
      system: {
        onResume(callback: () => void): () => void
      }
      power: {
        block(): Promise<void>
        unblock(): Promise<void>
      }
      dialog: {
        openFile(): Promise<string | null>
        saveFile(): Promise<string | null>
        openRData(): Promise<string | null>
        saveRData(): Promise<string | null>
        openPackageFile(): Promise<string | null>
        openDirectory(title?: string): Promise<string | null>
        openDataFile(): Promise<string | null>
        openRgeo(): Promise<string | null>
        openWorkspaceFolder(): Promise<string | null>
        saveExportFile(format: string): Promise<string | null>
        savePlot(format: string): Promise<string | null>
        openProject(): Promise<string | null>
        saveProject(defaultName?: string): Promise<string | null>
      }
      project: {
        tempEnvPath(): Promise<string>
        pack(bundlePath: string, projectJson: string, envRDataPath: string | null): Promise<void>
        unpack(bundlePath: string): Promise<{ projectJson: string; envRDataPath: string | null }>
      }
      file: {
        read(filePath: string): Promise<string>
        write(filePath: string, content: string): Promise<void>
        writeBinary(filePath: string, base64: string): Promise<void>
      }
      fs: {
        scanRgeo(folder: string): Promise<string[]>
        listDirectory(folder: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>
        fileStat(filePath: string): Promise<{ exists: boolean; size: number; mtimeMs: number }>
      }
      shell: {
        showItemInFolder(filePath: string): Promise<void>
      }
      app: {
        getDataPath(): Promise<string>
        onUiZoom(callback: (direction: 'in' | 'out') => void): void
        onBeforeQuit(callback: () => void): () => void
        confirmQuit(): Promise<void>
      }
      plot: {
        openPopout(state: PlotPopoutState): Promise<void>
        syncState(state: PlotPopoutState): Promise<void>
        onState(callback: (state: PlotPopoutState) => void): () => void
        navigate(index: number): Promise<void>
        onNavigate(callback: (index: number) => void): () => void
        toggleFullscreen(): Promise<void>
      }
      widget: {
        openPopout(id: string): Promise<void>
      }
      ai: {
        stream(
          req: { url: string; method?: string; headers?: Record<string, string>; body?: string },
          handlers: {
            onMeta: (meta: { ok: boolean; status: number }) => void
            onChunk: (chunk: Uint8Array) => void
            onDone: () => void
            onError: (message: string) => void
          }
        ): () => void
      }
    }
  }
}

export {}
