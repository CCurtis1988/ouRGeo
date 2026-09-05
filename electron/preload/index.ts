import { contextBridge, ipcRenderer } from 'electron'

/** Mirror of the main window's current plot selection, sent to the popout. */
interface PlotPopoutState {
  dataUrl: string | null
  plotId: string | null
  index: number
  total: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  r: {
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
    saveExportFile: (format: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveExportFile', format),
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
    pack: (bundlePath: string, projectJson: string, envRDataPath: string | null): Promise<void> =>
      ipcRenderer.invoke('project:pack', bundlePath, projectJson, envRDataPath),
    unpack: (bundlePath: string): Promise<{ projectJson: string; envRDataPath: string | null }> =>
      ipcRenderer.invoke('project:unpack', bundlePath)
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
    cacheRead: (id: string, key: string): Promise<string | null> =>
      ipcRenderer.invoke('plugins:cacheRead', id, key),
    cacheWrite: (id: string, key: string, code: string): Promise<void> =>
      ipcRenderer.invoke('plugins:cacheWrite', id, key, code),
    esbuildWasm: (): Promise<string> => ipcRenderer.invoke('plugins:esbuildWasm')
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
      req: { url: string; method?: string; headers?: Record<string, string>; body?: string },
      handlers: {
        onMeta: (meta: { ok: boolean; status: number }) => void
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
      const metaL = (_e: Electron.IpcRendererEvent, m: { ok: boolean; status: number }): void =>
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
