/** Mirror of the main window's current plot selection, sent to the popout. */
interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

// ── Plugin store ────────────────────────────────────────────────────────────
//
// Declared here as well as in src/lib/plugin-store/types.ts, deliberately. This
// file is ambient and belongs to the node tsconfig project; importing renderer
// modules into it would drag them into the main process's compile. The forum
// types are duplicated for the same reason.

/** One card in the store's browse list. */
interface StoreListing {
  slug: string
  name: string
  summary: string
  category: string
  tags: string[]
  installCount: number
  ratingAvg: number | null
  ratingCount: number
  publishedAt: string
  updatedAt: string
  author: string
  authorAvatar: string | null
  version: string
  ourgeoVersion: string | null
  hasCode: boolean
  permissions: string[]
  iconUrl: string | null
}

interface StoreCategory {
  slug: string
  name: string
  description: string
  icon: string
}

interface StoreVersion {
  id: string
  version: string
  status: string
  bytes: number
  sha256: string
  ourgeoVersion: string | null
  permissions: string[]
  hasCode: boolean
  changelog: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
  storagePath: string | null
  sourcePath: string | null
}

interface StoreDetail {
  slug: string
  name: string
  summary: string
  description: string | null
  category: string
  tags: string[]
  homepage: string | null
  repository: string | null
  license: string | null
  installCount: number
  ratingAvg: number | null
  ratingCount: number
  publishedAt: string | null
  updatedAt: string
  isRemoved: boolean
  isMine: boolean
  author: { username: string; displayName: string; avatarUrl: string | null }
  media: { path: string; url: string; alt: string | null; width: number; height: number }[]
  versions: StoreVersion[]
  installedByMe: boolean
  canReview: boolean
  pageUrl: string
}

interface StoreUpdate {
  slug: string
  latestVersion: string | null
  latestId: string | null
  ourgeoVersion: string | null
  changelog: string | null
  /** The status of the version the user HAS — 'revoked' is why this exists. */
  installedStatus: string | null
}

interface StoreReview {
  rating: number
  body: string | null
  created_at: string
  updated_at: string
  author_id: string
}

interface StoreMine {
  slug: string
  name: string
  published_at: string | null
  is_removed: boolean
  install_count: number
  rating_avg: number | null
  versions: {
    id: string; version: string; status: string
    submittedAt: string; reviewedAt: string | null; reviewNotes: string | null
  }[]
}

/** What `account:status` reports without touching the network. */
interface AccountStatus {
  hasStoredToken: boolean
  signedIn: boolean
  profile: { id: string; username: string; displayName: string; role: string } | null
}

/** Where an installed plugin came from — see src/lib/plugins/store-origin.ts. */
interface StoreOrigin {
  slug: string
  versionId: string
  version: string
  sha256: string
  installedAt: string
  name: string
  author?: string
}

/** The two archives a store submission is built from. */
interface BuiltPackage {
  distPath: string
  sourcePath: string
  distBytes: number
  sourceBytes: number
  /** sha256 of the distributable, hex. */
  sha256: string
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

/** A shell the Terminal panel can open, as main found it on this machine. */
export interface TerminalShellProfile {
  id: string
  label: string
  path: string
  args: string[]
}

/** A live shell session, for reconciling the panel after a reload. */
export interface TerminalInfo {
  id: string
  profileId: string
  pid: number
  alive: boolean
  exitCode: number | null
}

export interface VoiceModelStatus {
  id: string
  label: string
  note: string
  multilingual: boolean
  totalBytes: number
  installed: boolean
  bytesOnDisk: number
}

declare global {
  interface Window {
    electronAPI: {
      preflight: { interrupt: (operationId: string) => Promise<void>; review: (operationId: string) => Promise<boolean> }
    health: import('../../src/lib/health-types').HealthAPI
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
        /** Screenshots and other pictures. Multi-select; [] if cancelled. */
        openImages(title?: string): Promise<string[]>
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
      store: {
        accountStatus(): Promise<AccountStatus>
        categories(): Promise<StoreCategory[]>
        catalogue(req: {
          query?: string; category?: string; tag?: string
          sort?: string; limit?: number; offset?: number
        }): Promise<StoreListing[]>
        detail(slug: string): Promise<StoreDetail | null>
        updates(installed: { slug: string; version: string }[]): Promise<StoreUpdate[]>
        install(req: { slug: string; versionId: string }): Promise<StoreOrigin>
        reviews(slug: string): Promise<StoreReview[]>
        writeReview(req: { slug: string; rating: number; body?: string }): Promise<void>
        deleteReview(slug: string): Promise<void>
        mine(): Promise<StoreMine[]>
        submit(req: {
          pluginId: string
          built: BuiltPackage
          manifest: Record<string, unknown>
          meta: {
            name: string; summary: string; description?: string; category: string
            tags?: string[]; homepage?: string; repository?: string; license?: string
            changelog?: string
          }
        }): Promise<{ versionId: string }>
        uploadMedia(req: {
          slug: string; bytes: Uint8Array; mime: string
          width: number; height: number; alt?: string; sortOrder?: number
        }): Promise<{ id: string; path: string; url: string }>
        media(slug: string): Promise<{
          claimed: boolean
          mine: boolean
          items: {
            id: string; url: string; path: string; alt: string | null
            bytes: number; width: number; height: number; sortOrder: number
          }[]
        }>
        deleteMedia(req: { id: string; path: string }): Promise<void>
        updateMedia(req: { id: string; alt?: string; sortOrder?: number }): Promise<void>
        isModerator(): Promise<boolean>
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
        services: {
          start(id: string): Promise<{ url: string; token: string }>
          reconcile(active: string[]): Promise<void>
        }
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
        installFromStore(zipPath: string, origin: StoreOrigin): Promise<string>
        storeOrigins(): Promise<Record<string, StoreOrigin>>
        packBuilt(id: string, files: Record<string, string>): Promise<BuiltPackage>
        saveSubmission(id: string, submission: unknown, outPath: string): Promise<void>
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
          req: { url: string; method?: string; headers?: Record<string, string>; body?: string; billing?: 'chatgpt'; billingAccountId?: string },
          handlers: {
            onMeta: (meta: { ok: boolean; status: number; requestId?: string | null }) => void
            onChunk: (chunk: Uint8Array) => void
            onDone: () => void
            onError: (message: string) => void
          }
        ): () => void
      }
      chatgpt: {
        status(): Promise<{
          activeId: string | null; signingIn: boolean; error: string | null; persistent: boolean
          signedIn: boolean; planEnabled: boolean
          accounts: { id: string; email: string | null; signedIn: boolean; planEnabled: boolean }[]
        }>
        signIn(id?: string): Promise<void>
        cancel(): Promise<void>
        models(): Promise<{ id: string; label: string }[]>
        select(id: string): Promise<void>
        signOut(): ReturnType<Window['electronAPI']['chatgpt']['status']>
        usage(): Promise<void>
      }
      claudeCli: {
        detect(): Promise<{ path: string; version: string } | null>
        getPath(): Promise<string | null>
        setPath(p: string | null): Promise<void>
        authStatus(binary?: string): Promise<{
          loggedIn: boolean
          authMethod: string | null
          subscriptionType: string | null
          email: string | null
          error?: string
        }>
        browse(): Promise<string | null>
        start(
          req: {
            prompt: string
            systemPrompt: string
            model: string
            sessionId: string
            resume: boolean
            tools: { name: string; description: string; inputSchema: unknown }[]
            cwd: string
          },
          handlers: {
            onLine: (line: string) => void
            onToolCall: (call: { name: string; input: Record<string, unknown> }) => Promise<string>
            onDone: (code: number | null, stderr: string) => void
            onError: (message: string) => void
          }
        ): () => void
      }
      voice: {
        transcribe(req: {
          url: string
          headers: Record<string, string>
          audio: Uint8Array
          filename: string
          mime: string
          fields: Record<string, string>
          raw?: boolean
          timeoutMs?: number
        }): Promise<{ ok: boolean; status: number; body: string }>
        request(req: {
          url: string; method?: string; headers?: Record<string, string>; body?: string
        }): Promise<{ ok: boolean; status: number; body: string }>
        /** macOS microphone authorisation; 'granted' everywhere else. */
        micAccess(): Promise<string>
        models(): Promise<VoiceModelStatus[]>
        modelDownload(
          id: string, onProgress: (p: { received: number; total: number; file: string }) => void,
        ): Promise<{ ok: boolean; error?: string }>
        modelCancel(id: string): Promise<boolean>
        modelRemove(id: string): Promise<boolean>
      }
      clipboard: {
        readText(): Promise<string>
      }
      terminal: {
        available(): Promise<{ ok: boolean; error?: string }>
        shells(): Promise<TerminalShellProfile[]>
        create(req: {
          profileId?: string | null; cwd?: string | null; cols?: number; rows?: number
        }): Promise<{
          ok: boolean; id?: string; profile?: TerminalShellProfile; error?: string
        }>
        attach(id: string): Promise<{
          ok: boolean; replay?: string; alive?: boolean; exitCode?: number | null; error?: string
        }>
        write(id: string, data: string): void
        resize(id: string, cols: number, rows: number): void
        ack(id: string, chars: number): void
        kill(id: string): Promise<boolean>
        cwd(id: string): Promise<string | null>
        list(): Promise<TerminalInfo[]>
        onData(callback: (id: string, data: string) => void): () => void
        onExit(
          callback: (id: string, exitCode: number, signal: number | null) => void,
        ): () => void
      }
    }
  }
}

export {}
