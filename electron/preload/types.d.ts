/** Mirror of the main window's current plot selection, sent to the popout. */
interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

/** A signed-in forum account, as the main process reports it. */
interface ForumProfile {
  id: string
  username: string
  displayName: string
  role: string
  trustLevel: number
  bytesUsed: number
  quota: number
  bannedUntil: string | null
}

interface ForumCategory {
  slug: string
  name: string
  description: string
  icon: string
  minRoleToPost: string
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
        /** `kind` is a DocLanguage ('r' | 'markdown' | 'rmarkdown'); omit for R. */
        saveFile(kind?: string): Promise<string | null>
        openRData(): Promise<string | null>
        saveRData(): Promise<string | null>
        openPackageFile(): Promise<string | null>
        openDirectory(title?: string): Promise<string | null>
        openDataFile(): Promise<string | null>
        openRgeo(): Promise<string | null>
        openWorkspaceFolder(): Promise<string | null>
        saveExportFile(format: string): Promise<string | null>
        savePlot(format: string): Promise<string | null>
        openTheme(): Promise<string | null>
        saveTheme(defaultName?: string): Promise<string | null>
        openThemeImage(title?: string): Promise<string | null>
        openLayout(): Promise<string | null>
        saveLayout(defaultName?: string): Promise<string | null>
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
        readBinary(filePath: string): Promise<string>
      }
      fs: {
        scanRgeo(folder: string): Promise<string[]>
        listDirectory(folder: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>
        fileStat(filePath: string): Promise<{ exists: boolean; size: number; mtimeMs: number }>
      }
      shell: {
        showItemInFolder(filePath: string): Promise<void>
        /** Resolves to '' on success, or the OS error message. */
        openPath(filePath: string): Promise<string>
        openExternal(url: string): Promise<void>
      }
      forum: {
        restore(): Promise<ForumProfile | null>
        signIn(req: { provider: 'google' | 'github' | 'email'; email?: string }): Promise<ForumProfile>
        signOut(): Promise<void>
        redirectUri(): Promise<string>
        postableCategories(): Promise<ForumCategory[]>
        uploadImage(req: {
          bytes: Uint8Array; mime: string; width: number; height: number; alt?: string
        }): Promise<{ id: string; url: string }>
        createThread(req: {
          category: string; title: string; body: string; attachmentIds: string[]
        }): Promise<{ id: number; url: string; imageError: string | null }>
      }
      knit: {
        render(req: {
          id: string; filePath: string; format: string; rscriptPath?: string; outputDir?: string
        }): Promise<{
          success: boolean
          outputPath?: string
          error?: string
          hint?: string | null
          errorLine?: number | null
          log?: string
        }>
        cancel(id: string): Promise<boolean>
        onProgress(id: string, cb: (text: string) => void): () => void
      }
      plugins: {
        dir(): Promise<string>
        list(): Promise<{ id: string; dir: string; hasManifest: boolean }[]>
        readFile(relative: string): Promise<string>
        writeFile(relative: string, content: string): Promise<void>
        readBinary(relative: string): Promise<string>
        listFiles(relative: string): Promise<string[]>
        delete(relative: string): Promise<void>
        reveal(relative: string): Promise<void>
        pack(id: string, outPath: string): Promise<void>
        unpack(zipPath: string): Promise<string>
        cacheRead(id: string, key: string): Promise<string | null>
        cacheWrite(id: string, key: string, code: string): Promise<void>
        esbuildWasm(): Promise<string>
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
