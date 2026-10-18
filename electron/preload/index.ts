import { contextBridge, ipcRenderer, webUtils } from 'electron'

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

/** The two archives a store submission is built from — see main/plugins.ts. */
interface BuiltPackage {
  distPath: string
  sourcePath: string
  distBytes: number
  sourceBytes: number
  sha256: string
}

/** Mirror of the main window's current plot selection, sent to the popout. */
interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  projectFiles: {
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    catalogue: (lease: string) => ipcRenderer.invoke('projectFiles:catalogue', lease),
    add: (lease: string, paths?: string[]) => ipcRenderer.invoke('projectFiles:add', lease, paths),
    linkFolder: (lease: string, path?: string, name?: string) => ipcRenderer.invoke('projectFiles:linkFolder', lease, path, name),
    createFolder: (lease: string, name: string, parentPath?: string, label?: string) => ipcRenderer.invoke('projectFiles:createFolder', lease, name, parentPath, label),
    relinkFolder: (id: string, lease: string, path?: string) => ipcRenderer.invoke('projectFiles:relinkFolder', id, lease, path),
    rescanFolders: (ids: string[] | undefined, lease: string) => ipcRenderer.invoke('projectFiles:rescanFolders', ids, lease),
    forgetFolder: (id: string, lease: string) => ipcRenderer.invoke('projectFiles:forgetFolder', id, lease),
    renameLinkedFolder: (id: string, name: string, lease: string) => ipcRenderer.invoke('projectFiles:renameLinkedFolder', id, name, lease),
    update: (id: string, revision: string, changes: Partial<Pick<import('../../src/lib/project-files').ProjectFileEntry, 'name' | 'folder' | 'role' | 'userDescription'>>, lease: string) => ipcRenderer.invoke('projectFiles:update', id, revision, changes, lease),
    replace: (id: string, revision: string, lease: string) => ipcRenderer.invoke('projectFiles:replace', id, revision, lease),
    remove: (ids: string[], lease: string) => ipcRenderer.invoke('projectFiles:remove', ids, lease),
    undo: (lease: string) => ipcRenderer.invoke('projectFiles:undo', lease),
    reindex: (ids: string[] | undefined, lease: string) => ipcRenderer.invoke('projectFiles:reindex', ids, lease),
    read: (id: string, revision: string, lease: string, location?: import('../../src/lib/project-files').ProjectFileLocation, offset?: number) => ipcRenderer.invoke('projectFiles:read', id, revision, lease, location, offset),
    preview: (id: string, revision: string, lease: string, location?: import('../../src/lib/project-files').ProjectFileLocation, options?: { includeHidden?: boolean }) => ipcRenderer.invoke('projectFiles:preview', id, revision, lease, location, options),
    search: (query: string, lease: string) => ipcRenderer.invoke('projectFiles:search', query, lease),
    exportFile: (id: string, revision: string, lease: string) => ipcRenderer.invoke('projectFiles:exportFile', id, revision, lease),
    cancel: (operationId: string, lease: string) => ipcRenderer.invoke('projectFiles:cancel', operationId, lease),
    discard: (lease: string) => ipcRenderer.invoke('projectFiles:discard', lease),
    recoverIntoCopy: (id: string, lease: string) => ipcRenderer.invoke('projectFiles:recoverIntoCopy', id, lease),
    setIncludeHidden: (id: string, revision: string, enabled: boolean, lease: string) => ipcRenderer.invoke('projectFiles:setIncludeHidden', id, revision, enabled, lease),
    onChanged: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('projectFiles:changed', handler)
      return () => ipcRenderer.removeListener('projectFiles:changed', handler)
    },
  },
  context: {
    onRetentionChanged: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('context:retentionChanged', handler)
      return () => ipcRenderer.removeListener('context:retentionChanged', handler)
    },
    chatBudgetStatus: () => ipcRenderer.invoke('context:chatBudgetStatus'),
    configureChatBudget: (policy: import('../../src/lib/context/chat-budget').ChatBudgetPolicy, lease: string) => ipcRenderer.invoke('context:configureChatBudget', policy, lease),
    prepareInferenceUsage: (input: import('../../src/lib/context/inference-usage').InferenceUsageInput, outputTokens: number, authority: string) => ipcRenderer.invoke('context:prepareInferenceUsage', input, outputTokens, authority),
    endInferenceUsage: (authority: string) => ipcRenderer.invoke('context:endInferenceUsage', authority),
    beginInferenceUsage: (chatId: string, turnId: string, provider: import('../../src/lib/context/inference-usage').InferenceUsageProvider, lease: string, model?: string) => ipcRenderer.invoke('context:beginInferenceUsage', chatId, turnId, provider, lease, model),
    recordInferenceUsage: (inputs: import('../../src/lib/context/inference-usage').InferenceUsageInput[], authority: string) => ipcRenderer.invoke('context:recordInferenceUsage', inputs, authority),
    inferenceUsageSummary: (chatId: string | undefined, lease: string) => ipcRenderer.invoke('context:inferenceUsageSummary', chatId, lease),
    columnPolicies: (lease: string) => ipcRenderer.invoke('context:columnPolicies', lease),
    saveColumnPolicies: (revision: number, selections: Record<string, string[]>, lease: string) => ipcRenderer.invoke('context:saveColumnPolicies', revision, selections, lease),
    folderCatalogue: (lease: string) => ipcRenderer.invoke('context:folderCatalogue', lease),
    chooseContextFolder: (lease: string) => ipcRenderer.invoke('context:chooseFolder', lease),
    refreshContextFolder: (id: string, lease: string) => ipcRenderer.invoke('context:refreshFolder', id, lease),
    removeContextFolder: (id: string, lease: string) => ipcRenderer.invoke('context:removeFolder', id, lease),
    readContextFile: (id: string, revision: string, lease: string, range?: import('../../src/lib/context/types').DocumentRange) => ipcRenderer.invoke('context:readFolderFile', id, revision, lease, range),
    onFoldersChanged: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('context:foldersChanged', handler)
      return () => ipcRenderer.removeListener('context:foldersChanged', handler)
    },
    memoryRecoveryStatus: () => ipcRenderer.invoke('context:memoryRecoveryStatus'),
    createMemoryBackup: (lease: string) => ipcRenderer.invoke('context:createMemoryBackup', lease),
    inspectMemoryBackup: (id: string, lease: string) => ipcRenderer.invoke('context:inspectMemoryBackup', id, lease),
    restoreMemoryBackup: (id: string, lease: string) => ipcRenderer.invoke('context:restoreMemoryBackup', id, lease),
    retryMemoryStorage: (lease: string) => ipcRenderer.invoke('context:retryMemoryStorage', lease),
    lease: () => ipcRenderer.invoke('context:lease'),
    learningSettings: () => ipcRenderer.invoke('context:learningSettings'),
    configureLearning: (settings: import('../../src/lib/context/learning').MemoryLearningSettings) => ipcRenderer.invoke('context:configureLearning', settings),
    closeProject: (lease: string) => ipcRenderer.invoke('context:closeProject', lease),
    exclusions: (lease: string) => ipcRenderer.invoke('context:exclusions', lease),
    exclude: (input: { id: string; scope: import('../../src/lib/context/exclusions').ExclusionScope; projectId: string | null; lease: string | null; excluded: boolean }) => ipcRenderer.invoke('context:exclude', input),
    listGlobal: () => ipcRenderer.invoke('context:listGlobal'),
    storageStatus: () => ipcRenderer.invoke('context:storageStatus'),
    connections: () => ipcRenderer.invoke('context:connections'),
    recallMemory: (input: import('../../src/lib/context/providers/recall').MemoryRecallRequest, id: string, lease: string) => ipcRenderer.invoke('context:recallMemory', input, id, lease),
    cancelRecall: (id: string) => ipcRenderer.invoke('context:cancelRecall', id),
    activationStatus: () => ipcRenderer.invoke('context:activationStatus'),
    previewManagedActivation: (scope: 'global' | 'project', lease: string) => ipcRenderer.invoke('context:previewManagedActivation', scope, lease),
    previewLocalServerActivation: (scope: 'global' | 'project', lease: string, acknowledged: boolean) => ipcRenderer.invoke('context:previewLocalServerActivation', scope, lease, acknowledged),
    previewHindsightActivation: (scope: 'global' | 'project', lease: string) => ipcRenderer.invoke('context:previewHindsightActivation', scope, lease),
    providerContributions: () => ipcRenderer.invoke('context:providerContributions'),
    previewContributedProvider: (ref: import('../../src/lib/context/providers/contributions').ProviderContributionRef, scope: 'global' | 'project', lease: string) => ipcRenderer.invoke('context:previewContributedProvider', ref, scope, lease),
    previewActivation: (id: string, ids: string[], lease: string) => ipcRenderer.invoke('context:previewActivation', id, ids, lease),
    previewMemoryImport: (id: string, ids: string[], lease: string) => ipcRenderer.invoke('context:previewMemoryImport', id, ids, lease),
    previewMemoryMigration: (id: string, ids: string[], lease: string) => ipcRenderer.invoke('context:previewMemoryMigration', id, ids, lease),
    memoryMigrations: () => ipcRenderer.invoke('context:memoryMigrations'),
    finishMemoryMigration: (id: string, choice: 'retain' | 'delete', lease: string) => ipcRenderer.invoke('context:finishMemoryMigration', id, choice, lease),
    cancelMemoryMigration: (id: string, lease: string) => ipcRenderer.invoke('context:cancelMemoryMigration', id, lease),
    useBuiltinMemory: (id: string, lease: string) => ipcRenderer.invoke('context:useBuiltinMemory', id, lease),
    activateProvider: (ref: string) => ipcRenderer.invoke('context:activateProvider', ref),
    pauseProvider: (id: string) => ipcRenderer.invoke('context:pauseProvider', id),
    maintenanceStatus: () => ipcRenderer.invoke('context:maintenanceStatus'),
    configureMaintenance: (policy: import('../../src/lib/context/providers/maintenance').MaintenancePolicy, lease: string) => ipcRenderer.invoke('context:configureMaintenance', policy, lease),
    runtimeStatus: () => ipcRenderer.invoke('context:runtimeStatus'),
    stageRuntime: (lease: string, acknowledged: boolean) => ipcRenderer.invoke('context:stageRuntime', lease, acknowledged),
    cancelRuntime: () => ipcRenderer.invoke('context:cancelRuntime'),
    rollbackRuntime: (lease: string) => ipcRenderer.invoke('context:rollbackRuntime', lease),
    removeConnection: (id: string) => ipcRenderer.invoke('context:removeConnection', id),
    saveConnection: (input: import('../../src/lib/context/providers/connections').MemoryConnectionInput, lease: string) => ipcRenderer.invoke('context:saveConnection', input, lease),
    probeConnection: (id: string) => ipcRenderer.invoke('context:probeConnection', id),
    disconnectConnection: (id: string) => ipcRenderer.invoke('context:disconnectConnection', id),
    saveGlobal: (record: import('../../src/lib/context/types').MemoryRecord, preserveCandidate?: boolean) => ipcRenderer.invoke('context:saveGlobal', record, preserveCandidate),
    forget: (id: string, deletion: import('../../src/lib/context/types').MemoryDeletion) => ipcRenderer.invoke('context:forget', id, deletion),
    cleanupStatus: () => ipcRenderer.invoke('context:cleanupStatus'),
    retryCleanup: (lease: string) => ipcRenderer.invoke('context:retryCleanup', lease),
    learnGlobal: (messageId: string, text: string) => ipcRenderer.invoke('context:learnGlobal', { messageId, text }),
    filterLearningSources: (ids: string[]) => ipcRenderer.invoke('context:filterLearningSources', ids),
    filterDeleted: (ids: string[]) => ipcRenderer.invoke('context:filterDeleted', ids),
    stageProject: (id: string, revision: number, context: import('../../src/lib/context/types').ProjectContext, lease: string) => ipcRenderer.invoke('context:stageProject', id, revision, context, lease),
    recoverProject: (id: string, revision: number, lease: string) => ipcRenderer.invoke('context:recoverProject', id, revision, lease),
    discardProject: (id: string, lease: string) => ipcRenderer.invoke('context:discardProject', id, lease),
  },
  preflight: { interrupt: (operationId: string): Promise<void> => ipcRenderer.invoke('preflight:interrupt', operationId), review: (operationId: string): Promise<boolean> => ipcRenderer.invoke('preflight:review', operationId) },
  health: {
    history: () => ipcRenderer.invoke('health:history'),
    activity: () => ipcRenderer.invoke('health:activity'),
    acknowledge: () => ipcRenderer.invoke('health:acknowledge'),
    saveReport: (report: import('../../src/lib/health-types').HealthReport) => ipcRenderer.invoke('health:saveReport', report),
    checkR: () => ipcRenderer.invoke('health:checkR'),
    checkPackages: () => ipcRenderer.invoke('health:checkPackages'),
    hardware: () => ipcRenderer.invoke('health:hardware'),
    installPlan: (target: 'r' | 'ollama') => ipcRenderer.invoke('health:installPlan', target),
    install: (target: 'r' | 'ollama', approved: boolean) => ipcRenderer.invoke('health:install', target, approved),
    repairPackages: (names: string[], approved: boolean) => ipcRenderer.invoke('health:repairPackages', names, approved),
    removePackageCopies: (copies: import('../../src/lib/health-types').HealthPackageCopy[], approved: boolean) => ipcRenderer.invoke('health:removePackageCopies', copies, approved),
    connectR: (approved: boolean) => ipcRenderer.invoke('health:connectR', approved),
    ollamaModels: () => ipcRenderer.invoke('health:ollamaModels'),
    startOllama: (approved: boolean) => ipcRenderer.invoke('health:startOllama', approved),
    pullModel: (model: string, approved: boolean) => ipcRenderer.invoke('health:pullModel', model, approved),
    onProgress: (callback: (message: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
      ipcRenderer.on('health:progress', listener)
      return () => ipcRenderer.removeListener('health:progress', listener)
    },
  },
  r: {
    consoleConnect: (port: number): void => ipcRenderer.send('r:consoleConnect', port),
    consoleSend: (text: string): void => ipcRenderer.send('r:consoleSend', text),
    consoleClose: (): void => ipcRenderer.send('r:consoleClose'),
    onConsoleEvent: (callback: (event: { type: 'open' | 'close' | 'message'; text?: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, value: { type: 'open' | 'close' | 'message'; text?: string }): void => callback(value)
      ipcRenderer.on('r:consoleEvent', listener)
      return () => ipcRenderer.removeListener('r:consoleEvent', listener)
    },
    getPort: (): Promise<number | null> => ipcRenderer.invoke('r:getPort'),
    isReady: (): Promise<boolean> => ipcRenderer.invoke('r:isReady'),
    detectInstallations: (): Promise<{ path: string; version: string }[]> =>
      ipcRenderer.invoke('r:detectInstallations'),
    getConfiguredPath: (): Promise<string | null> => ipcRenderer.invoke('r:getConfiguredPath'),
    setAndRestartR: (path: string | null): Promise<void> =>
      ipcRenderer.invoke('r:setAndRestartR', path),
    browseRscript: (): Promise<string | null> => ipcRenderer.invoke('r:browseRscript'),
    interrupt: (): Promise<void> => ipcRenderer.invoke('r:interrupt'),
    onRestarted: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('r:restarted', listener)
      return () => ipcRenderer.removeListener('r:restarted', listener)
    }
  },
  system: {
    // Fires when the OS resumes from sleep/hibernate, so the renderer can
    // revalidate its R console socket (which may be half-dead after suspend).
    onResume: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('system:resume', listener)
      return () => ipcRenderer.removeListener('system:resume', listener)
    }
  },
  power: {
    // Inhibit OS idle-suspend while a long R request is in flight (suspend
    // aborts in-flight renderer requests with ERR_NETWORK_CHANGED on resume).
    block: (): Promise<void> => ipcRenderer.invoke('power:block'),
    unblock: (): Promise<void> => ipcRenderer.invoke('power:unblock')
  },
  dialog: {
    openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
    openImages: (title?: string): Promise<string[]> =>
      ipcRenderer.invoke('dialog:openImages', title),
    saveFile: (kind?: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveFile', kind),
    openRData: (): Promise<string | null> => ipcRenderer.invoke('dialog:openRData'),
    saveRData: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveRData'),
    openPackageFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openPackageFile'),
    openDirectory: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openDirectory', title),
    openDataFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDataFile'),
    openRgeo: (): Promise<string | null> => ipcRenderer.invoke('dialog:openRgeo'),
    openWorkspaceFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openWorkspaceFolder'),
    saveExportFile: (format: string, existing?: boolean): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveExportFile', format, existing),
    savePlot: (format: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:savePlot', format),
    openTheme: (): Promise<string | null> => ipcRenderer.invoke('dialog:openTheme'),
    saveTheme: (defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveTheme', defaultName),
    openThemeImage: (title?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:openThemeImage', title),
    openLayout: (): Promise<string | null> => ipcRenderer.invoke('dialog:openLayout'),
    saveLayout: (defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveLayout', defaultName),
    openProject: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProject'),
    saveProject: (defaultName?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveProject', defaultName)
  },
  project: {
    tempEnvPath: (): Promise<string> => ipcRenderer.invoke('project:tempEnvPath'),
    pack: (bundlePath: string, projectJson: string, envRDataPath: string | null): Promise<{ contextWarnings?: string[] }> =>
      ipcRenderer.invoke('project:pack', bundlePath, projectJson, envRDataPath),
    unpack: (bundlePath: string): Promise<{ projectJson: string; envRDataPath: string | null; openToken?: string; identityForked?: boolean; contextWarnings: string[]; authorisedFileLinks: import('../../src/lib/context/types').AuthorisedFileLink[]; authorisedDatabasePaths: string[] }> =>
      ipcRenderer.invoke('project:unpack', bundlePath),
    releaseOpen: (token: string): Promise<void> => ipcRenderer.invoke('project:releaseOpen', token)
  },
  file: {
    read: (filePath: string): Promise<string> => ipcRenderer.invoke('file:read', filePath),
    write: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('file:write', filePath, content),
    writeBinary: (filePath: string, base64: string): Promise<void> =>
      ipcRenderer.invoke('file:writeBinary', filePath, base64),
    /** Base64 contents, for figures Publish has to transcode. */
    readBinary: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('file:readBinary', filePath)
  },
  fs: {
    scanRgeo: (folder: string): Promise<string[]> =>
      ipcRenderer.invoke('fs:scanRgeo', folder),
    listDirectory: (folder: string): Promise<{ name: string; path: string; isDirectory: boolean }[]> =>
      ipcRenderer.invoke('fs:listDirectory', folder),
    fileStat: (filePath: string): Promise<{ exists: boolean; size: number; mtimeMs: number }> =>
      ipcRenderer.invoke('fs:fileStat', filePath)
  },
  forum: {
    restore: (): Promise<unknown> => ipcRenderer.invoke('forum:restore'),
    signIn: (req: { provider: 'google' | 'github' | 'email'; email?: string }): Promise<unknown> =>
      ipcRenderer.invoke('forum:signIn', req),
    signOut: (): Promise<void> => ipcRenderer.invoke('forum:signOut'),
    redirectUri: (): Promise<string> => ipcRenderer.invoke('forum:redirectUri'),
    postableCategories: (): Promise<unknown[]> => ipcRenderer.invoke('forum:postableCategories'),
    uploadImage: (req: {
      bytes: Uint8Array; mime: string; width: number; height: number; alt?: string
    }): Promise<{ id: string; url: string }> => ipcRenderer.invoke('forum:uploadImage', req),
    createThread: (req: {
      category: string; title: string; body: string; attachmentIds: string[]
    }): Promise<{ id: number; url: string; imageError: string | null }> =>
      ipcRenderer.invoke('forum:createThread', req),
  },
  knit: {
    render: (req: {
      id: string; filePath: string; format: string; rscriptPath?: string; outputDir?: string
    }): Promise<unknown> =>
      ipcRenderer.invoke('knit:render', req),
    cancel: (id: string): Promise<boolean> => ipcRenderer.invoke('knit:cancel', id),
    onProgress: (id: string, cb: (text: string) => void): (() => void) => {
      const ch = `knit:progress:${id}`
      const handler = (_e: unknown, text: string): void => cb(text)
      ipcRenderer.on(ch, handler)
      return () => { ipcRenderer.removeListener(ch, handler) }
    },
  },
  shell: {
    showItemInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('shell:showItemInFolder', filePath),
    /** Resolves to '' on success, or the OS error message. */
    openPath: (filePath: string): Promise<string> =>
      ipcRenderer.invoke('shell:openPath', filePath),
    /** Open an http(s) URL in the user's browser. */
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke('shell:openExternal', url)
  },
  // Plugin files. Every path is relative to the plugins folder and the main
  // process refuses to leave it — see electron/main/plugins.ts. That is the
  // reason these exist instead of the generic `file.*` calls: the assistant
  // authors plugins, and `file.write` takes an unchecked absolute path.
  plugins: {
    services: {
      start: (id: string): Promise<{ url: string; token: string }> => ipcRenderer.invoke('plugins:service:start', id),
      reconcile: (active: string[]): Promise<void> => ipcRenderer.invoke('plugins:service:reconcile', active),
    },
    dir: (): Promise<string> => ipcRenderer.invoke('plugins:dir'),
    list: (): Promise<{ id: string; dir: string; hasManifest: boolean }[]> =>
      ipcRenderer.invoke('plugins:list'),
    readFile: (relative: string): Promise<string> => ipcRenderer.invoke('plugins:readFile', relative),
    writeFile: (relative: string, content: string): Promise<void> =>
      ipcRenderer.invoke('plugins:writeFile', relative, content),
    readBinary: (relative: string): Promise<string> => ipcRenderer.invoke('plugins:readBinary', relative),
    listFiles: (relative: string): Promise<string[]> => ipcRenderer.invoke('plugins:listFiles', relative),
    delete: (relative: string): Promise<void> => ipcRenderer.invoke('plugins:delete', relative),
    reveal: (relative: string): Promise<void> => ipcRenderer.invoke('plugins:reveal', relative),
    pack: (id: string, outPath: string): Promise<void> => ipcRenderer.invoke('plugins:pack', id, outPath),
    unpack: (zipPath: string): Promise<string> => ipcRenderer.invoke('plugins:unpack', zipPath),
    installFromStore: (zipPath: string, origin: unknown): Promise<string> =>
      ipcRenderer.invoke('plugins:installFromStore', zipPath, origin),
    storeOrigins: (): Promise<Record<string, StoreOrigin>> =>
      ipcRenderer.invoke('plugins:storeOrigins'),
    packBuilt: (id: string, files: Record<string, string>): Promise<BuiltPackage> =>
      ipcRenderer.invoke('plugins:packBuilt', id, files),
    saveSubmission: (id: string, submission: unknown, outPath: string): Promise<void> =>
      ipcRenderer.invoke('plugins:saveSubmission', id, submission, outPath),
    cacheRead: (id: string, key: string): Promise<string | null> =>
      ipcRenderer.invoke('plugins:cacheRead', id, key),
    cacheWrite: (id: string, key: string, code: string): Promise<void> =>
      ipcRenderer.invoke('plugins:cacheWrite', id, key, code),
    esbuildWasm: (): Promise<string> => ipcRenderer.invoke('plugins:esbuildWasm')
  },

  // The plugin store. Everything goes through main, so the access token never
  // reaches this process — the same rule `forum` follows, and the reason both
  // are named operations rather than a generic query.
  store: {
    accountStatus: (): Promise<AccountStatus> => ipcRenderer.invoke('account:status'),
    categories: (): Promise<unknown[]> => ipcRenderer.invoke('store:categories'),
    catalogue: (req: unknown): Promise<unknown[]> => ipcRenderer.invoke('store:catalogue', req),
    detail: (slug: string): Promise<unknown> => ipcRenderer.invoke('store:detail', slug),
    updates: (installed: unknown[]): Promise<unknown[]> => ipcRenderer.invoke('store:updates', installed),
    install: (req: { slug: string; versionId: string }): Promise<StoreOrigin> =>
      ipcRenderer.invoke('store:install', req),
    reviews: (slug: string): Promise<unknown[]> => ipcRenderer.invoke('store:reviews', slug),
    writeReview: (req: unknown): Promise<void> => ipcRenderer.invoke('store:writeReview', req),
    deleteReview: (slug: string): Promise<void> => ipcRenderer.invoke('store:deleteReview', slug),
    mine: (): Promise<unknown[]> => ipcRenderer.invoke('store:mine'),
    submit: (req: unknown): Promise<{ versionId: string }> => ipcRenderer.invoke('store:submit', req),
    uploadMedia: (req: unknown): Promise<{ id: string; path: string; url: string }> =>
      ipcRenderer.invoke('store:uploadMedia', req),
    media: (slug: string): Promise<unknown> => ipcRenderer.invoke('store:media', slug),
    deleteMedia: (req: { id: string; path: string }): Promise<void> =>
      ipcRenderer.invoke('store:deleteMedia', req),
    updateMedia: (req: { id: string; alt?: string; sortOrder?: number }): Promise<void> =>
      ipcRenderer.invoke('store:updateMedia', req),
    isModerator: (): Promise<boolean> => ipcRenderer.invoke('store:isModerator'),
  },

  app: {
    getDataPath: (): Promise<string> => ipcRenderer.invoke('app:getDataPath'),
    onUiZoom: (callback: (direction: 'in' | 'out') => void) => {
      ipcRenderer.on('ui:zoom', (_event, direction) => callback(direction))
    },
    // Fires when the user tries to close the window; the renderer prompts to save
    // and must call confirmQuit() to let the close proceed (or do nothing to cancel).
    onBeforeQuit: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('app:before-quit', listener)
      return () => ipcRenderer.removeListener('app:before-quit', listener)
    },
    confirmQuit: (): Promise<void> => ipcRenderer.invoke('app:confirm-quit')
  },
  plot: {
    openPopout: (state: PlotPopoutState): Promise<void> =>
      ipcRenderer.invoke('plot:open-popout', state),
    syncState: (state: PlotPopoutState): Promise<void> =>
      ipcRenderer.invoke('plot:sync-state', state),
    onState: (callback: (state: PlotPopoutState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PlotPopoutState): void =>
        callback(state)
      ipcRenderer.on('plot:state', listener)
      return () => ipcRenderer.removeListener('plot:state', listener)
    },
    navigate: (index: number): Promise<void> => ipcRenderer.invoke('plot:navigate', index),
    onNavigate: (callback: (index: number) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, index: number): void => callback(index)
      ipcRenderer.on('plot:navigate', listener)
      return () => ipcRenderer.removeListener('plot:navigate', listener)
    },
    toggleFullscreen: (): Promise<void> => ipcRenderer.invoke('plot:toggle-fullscreen')
  },
  widget: {
    openPopout: (id: string): Promise<void> =>
      ipcRenderer.invoke('widget:open-popout', id),
  },
  ai: {
    // Streams an AI-provider HTTP request through the main process. Returns an
    // abort() function. Body chunks arrive via onChunk as Uint8Array.
    stream: (
      req: { url: string; method?: string; headers?: Record<string, string>; body?: string; billing?: 'chatgpt'; billingAccountId?: string },
      handlers: {
        onMeta: (meta: { ok: boolean; status: number; requestId?: string | null }) => void
        onChunk: (chunk: Uint8Array) => void
        onDone: () => void
        onError: (message: string) => void
      }
    ): (() => void) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const metaCh = `ai:meta:${id}`
      const chunkCh = `ai:chunk:${id}`
      const doneCh = `ai:done:${id}`
      const errCh = `ai:error:${id}`
      const metaL = (_e: Electron.IpcRendererEvent, m: { ok: boolean; status: number; requestId?: string | null }): void =>
        handlers.onMeta(m)
      const chunkL = (_e: Electron.IpcRendererEvent, c: Uint8Array): void => handlers.onChunk(c)
      const cleanup = (): void => {
        ipcRenderer.removeListener(metaCh, metaL)
        ipcRenderer.removeListener(chunkCh, chunkL)
        ipcRenderer.removeListener(doneCh, doneL)
        ipcRenderer.removeListener(errCh, errL)
      }
      const doneL = (): void => { cleanup(); handlers.onDone() }
      const errL = (_e: Electron.IpcRendererEvent, msg: string): void => { cleanup(); handlers.onError(msg) }
      ipcRenderer.on(metaCh, metaL)
      ipcRenderer.on(chunkCh, chunkL)
      ipcRenderer.once(doneCh, doneL)
      ipcRenderer.once(errCh, errL)
      ipcRenderer.send('ai:fetch', id, req)
      return () => { ipcRenderer.send('ai:abort', id); cleanup() }
    }
  },
  chatgpt: {
    status: () => ipcRenderer.invoke('chatgpt:status'),
    signIn: (id?: string): Promise<void> => ipcRenderer.invoke('chatgpt:signIn', id),
    cancel: (): Promise<void> => ipcRenderer.invoke('chatgpt:cancel'),
    models: (): Promise<{ id: string; label: string }[]> => ipcRenderer.invoke('chatgpt:models'),
    select: (id: string): Promise<void> => ipcRenderer.invoke('chatgpt:select', id),
    signOut: () => ipcRenderer.invoke('chatgpt:signOut'),
    usage: (): Promise<void> => ipcRenderer.invoke('chatgpt:usage'),
  },
  claudeCli: {
    detect: (): Promise<{ path: string; version: string } | null> =>
      ipcRenderer.invoke('claude:detect'),
    getPath: (): Promise<string | null> => ipcRenderer.invoke('claude:getPath'),
    setPath: (p: string | null): Promise<void> => ipcRenderer.invoke('claude:setPath', p),
    authStatus: (binary?: string): Promise<{
      loggedIn: boolean; authMethod: string | null
      subscriptionType: string | null; email: string | null; error?: string
    }> => ipcRenderer.invoke('claude:authStatus', binary),
    browse: (): Promise<string | null> => ipcRenderer.invoke('claude:browse'),
    // One headless Claude Code turn. Lines of the CLI's NDJSON arrive on
    // onLine; a tool the model calls arrives on onToolCall, whose resolved
    // string is handed straight back to the waiting MCP request. Returns
    // abort().
    start: (
      req: {
        prompt: string; systemPrompt: string; model: string; sessionId: string
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
    ): (() => void) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const chunkCh = `claude:chunk:${id}`
      const toolCh = `claude:tool:${id}`
      const doneCh = `claude:done:${id}`
      const errCh = `claude:error:${id}`
      const chunkL = (_e: Electron.IpcRendererEvent, line: string): void => handlers.onLine(line)
      const toolL = (
        _e: Electron.IpcRendererEvent,
        call: { callId: string; name: string; input: Record<string, unknown> }
      ): void => {
        void handlers
          .onToolCall({ name: call.name, input: call.input })
          .then(
            (out) => ipcRenderer.send('claude:toolResult', id, call.callId, out),
            (err) => ipcRenderer.send('claude:toolResult', id, call.callId, `Error: ${String(err)}`),
          )
      }
      const cleanup = (): void => {
        ipcRenderer.removeListener(chunkCh, chunkL)
        ipcRenderer.removeListener(toolCh, toolL)
        ipcRenderer.removeListener(doneCh, doneL)
        ipcRenderer.removeListener(errCh, errL)
      }
      const doneL = (_e: Electron.IpcRendererEvent, code: number | null, stderr: string): void => {
        cleanup(); handlers.onDone(code, stderr)
      }
      const errL = (_e: Electron.IpcRendererEvent, msg: string): void => {
        cleanup(); handlers.onError(msg)
      }
      ipcRenderer.on(chunkCh, chunkL)
      ipcRenderer.on(toolCh, toolL)
      ipcRenderer.once(doneCh, doneL)
      ipcRenderer.once(errCh, errL)
      ipcRenderer.send('claude:start', id, req)
      return () => { ipcRenderer.send('claude:abort', id); cleanup() }
    },
  },
  voice: {
    // Upload a recording to a transcription service. The audio crosses as a
    // Uint8Array (structured clone), not base64 — see electron/main/voice.ts.
    transcribe: (req: {
      url: string
      headers: Record<string, string>
      audio: Uint8Array
      filename: string
      mime: string
      fields: Record<string, string>
      raw?: boolean
      timeoutMs?: number
    }): Promise<{ ok: boolean; status: number; body: string }> =>
      ipcRenderer.invoke('voice:transcribe', req),
    request: (req: {
      url: string; method?: string; headers?: Record<string, string>; body?: string
    }): Promise<{ ok: boolean; status: number; body: string }> =>
      ipcRenderer.invoke('voice:request', req),
    /** macOS microphone authorisation; 'granted' everywhere else. */
    micAccess: (): Promise<string> => ipcRenderer.invoke('voice:micAccess'),
    models: (): Promise<unknown[]> => ipcRenderer.invoke('voice:models'),
    modelDownload: (
      id: string, onProgress: (p: { received: number; total: number; file: string }) => void,
    ): Promise<{ ok: boolean; error?: string }> => {
      const channel = `voice:modelProgress:${id}`
      const listener = (
        _e: Electron.IpcRendererEvent, p: { received: number; total: number; file: string },
      ): void => onProgress(p)
      ipcRenderer.on(channel, listener)
      return ipcRenderer.invoke('voice:modelDownload', id)
        .finally(() => ipcRenderer.removeListener(channel, listener))
    },
    modelCancel: (id: string): Promise<boolean> => ipcRenderer.invoke('voice:modelCancel', id),
    modelRemove: (id: string): Promise<boolean> => ipcRenderer.invoke('voice:modelRemove', id),
  },

  clipboard: {
    /** The system clipboard's text, read in the main process so the renderer
     *  needs no standing `clipboard-read` permission. Writing stays
     *  `navigator.clipboard.writeText`, which is allowlisted. */
    readText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
  },
  terminal: {
    /** Whether a pty can be spawned at all — asked before the panel draws, so
     *  an unsupported platform gets a sentence instead of a broken terminal. */
    available: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:available'),
    shells: (): Promise<{ id: string; label: string; path: string; args: string[] }[]> =>
      ipcRenderer.invoke('terminal:shells'),
    create: (req: {
      profileId?: string | null; cwd?: string | null; cols?: number; rows?: number
    }): Promise<{
      ok: boolean
      id?: string
      profile?: { id: string; label: string; path: string; args: string[] }
      error?: string
    }> => ipcRenderer.invoke('terminal:create', req),
    attach: (id: string): Promise<{
      ok: boolean; replay?: string; alive?: boolean; exitCode?: number | null; error?: string
    }> => ipcRenderer.invoke('terminal:attach', id),
    // `send`, not `invoke`: keystrokes and acks are one-way and frequent, and a
    // promise per keypress is a round trip nobody awaits.
    write: (id: string, data: string): void => { ipcRenderer.send('terminal:write', id, data) },
    resize: (id: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', id, cols, rows)
    },
    /** Report drawn output so main can un-pause a firehose. */
    ack: (id: string, chars: number): void => { ipcRenderer.send('terminal:ack', id, chars) },
    kill: (id: string): Promise<boolean> => ipcRenderer.invoke('terminal:kill', id),
    /** The shell's working directory, read from the OS. Null where the OS will
     *  not say — see the handler for which platforms those are. */
    cwd: (id: string): Promise<string | null> => ipcRenderer.invoke('terminal:cwd', id),
    list: (): Promise<{
      id: string; profileId: string; pid: number; alive: boolean; exitCode: number | null
    }[]> => ipcRenderer.invoke('terminal:list'),
    onData: (callback: (id: string, data: string) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, p: { id: string; data: string }): void =>
        callback(p.id, p.data)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    onExit: (
      callback: (id: string, exitCode: number, signal: number | null) => void,
    ): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: { id: string; exitCode: number; signal: number | null },
      ): void => callback(p.id, p.exitCode, p.signal)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    }
  }
})
