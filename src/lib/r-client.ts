import type { PreflightReport, PreflightRequest } from './data-preflight-types'
import axios, { AxiosInstance } from 'axios'
import { useSessionStore } from '@/store/session'
import { withPowerBlock } from '@/lib/power-block'

export interface RResponse<T = unknown> {
  success: boolean
  result?: T
  code?: string
  message?: string
  error?: string
}

/** A checkpoint's progress: `running` while a forked snapshot writes. */
export interface CheckpointState { success: boolean; state: 'idle' | 'busy' | 'running' | 'done' | 'failed'; ms?: number; error?: string; async?: boolean }
/** An object a snapshot could not bring back, and why. */
export interface NotRestored { name: string; reason: string }
export interface MergeEnvDescription { side: 'base' | 'mine' | 'theirs'; class: string; size: string; str: string }
export interface MergeEnvItem {
  name: string
  has: { base: boolean; mine: boolean; theirs: boolean }
  mineEqBase: boolean
  theirsEqBase: boolean
  mineEqTheirs: boolean
  describe: MergeEnvDescription[]
}

// /r/execute returns the captured console text at the TOP level (`output`),
// not nested under `result` — see r/lib/handlers-exec.R handle_execute.
export interface RExecuteResponse extends RResponse {
  output?: string
}

export interface RPackageInfo {
  name: string
  version: string
  loaded: boolean
  isBase: boolean
}

export interface RLibrary {
  path: string
  packages: RPackageInfo[]
}

export interface RObjectInfo {
  name: string
  class: string
  size: number
  length: number | null
  dim: number[] | null
  preview: string
  isEnvironment: boolean
  isList: boolean
  columns?: ColumnInfo[]
  children?: RObjectInfo[]
  rgeoProxy?: {
    handle: string
    name: string
    kind: RgeoObjectKind
    spatialFormat?: RgeoSpatialFormat | null
    geometryType?: string | null
    geometryColumn?: string | null
    pkColumn?: string
    crs?: string | null
  }
}

export interface ColumnInfo {
  name: string
  type: string
}

export interface DataFrameResponse {
  success: boolean
  columns: ColumnInfo[]
  rows: string[][]
  totalRows: number
  offset: number
  limit: number
  error?: string
}

export interface MatrixResponse {
  success: boolean
  nrow: number
  ncol: number
  type: string
  rows: string[][]
  offset: number
  limit: number
  error?: string
}

export interface VectorResponse {
  success: boolean
  type: string
  values: string[]
  totalLength: number
  offset: number
  limit: number
  error?: string
}

export interface FunctionResponse {
  success: boolean
  source: string
  name: string
  error?: string
}

export interface RFormalArg {
  name: string
  hasDefault: boolean
  default: string
}

export interface RChunkResponse {
  success: boolean
  output: string
  error?: string | null
  /** data:image/png;base64,… one per plot the chunk drew, in draw order. */
  plots: string[]
  /** HTML widgets served by the live R process. */
  widgets?: string[]
  /** Matching ids in R's plot history, for re-export at another size. */
  plotIds: string[]
  skipped: boolean
  durationMs: number
}

export interface REnvironmentInfo {
  name: string
  /** On R's search path — every entry except .GlobalEnv. Read across the app
   *  as "not somewhere the user keeps data". */
  isSearchPath: boolean
  objects: RObjectInfo[]
}

class RClient {
  private client: AxiosInstance | null = null
  private _port: number | null = null

  get port(): number | null {
    return this._port
  }

  get isConnected(): boolean {
    return this._port !== null
  }

  async connect(): Promise<void> {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const port = await window.electronAPI.r.getPort()
      if (!port) throw new Error('R server port not available')
      this.init(port)
    } else {
      this.init(10000)
    }
  }

  init(port: number): void {
    this._port = port
    this.client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json' }
    })

    // Track /r/execute calls for the console processing indicator
    this.client.interceptors.request.use((config) => {
      if (config.url === '/r/execute') {
        useSessionStore.getState().setExecuting(true)
      }
      return config
    })
    this.client.interceptors.response.use(
      (response) => {
        if (response.config.url === '/r/execute') {
          useSessionStore.getState().setExecuting(false)
        }
        return response
      },
      (error) => {
        if (error.config?.url === '/r/execute') {
          useSessionStore.getState().setExecuting(false)
        }
        return Promise.reject(error)
      }
    )
  }

  private get http(): AxiosInstance {
    if (!this.client) throw new Error('R client not initialized. Call connect() first.')
    return this.client
  }

  /**
   * A POST whose refusal is an answer, not a failure.
   *
   * R's handlers report a refused operation with `error_response()`, which is
   * HTTP 500 carrying `{success: false, error}` — and axios REJECTS a 500. So
   * every caller that dutifully checked `res.success` never saw one: the
   * promise rejected instead, unhandled, and the menu item did nothing and said
   * nothing. Creating an environment over the top of a data frame, moving an
   * object into a locked package environment, copying onto a name already
   * taken — all silent.
   *
   * A rejection with no response at all is left to throw: that is a severed
   * connection, not R's considered answer, and `transport-retry.ts` is what
   * knows the difference.
   */
  private async ask<T extends RResponse>(url: string, body: unknown): Promise<T> {
    try {
      const res = await this.http.post<T>(url, body)
      return res.data
    } catch (e) {
      const data = (e as { response?: { data?: unknown } })?.response?.data
      if (data && typeof data === 'object' && 'success' in (data as object)) return data as T
      throw e
    }
  }

  async initSession(): Promise<RResponse & { systemNames?: string[] }> {
    const res = await this.http.post<RResponse & { systemNames?: string[] }>('/session/init')
    return res.data
  }

  /** R's current working directory, plus the home path for display shortening. */
  async getWorkingDir(): Promise<{ success: boolean; path?: string; home?: string }> {
    const res = await this.http.get<{ success: boolean; path?: string; home?: string }>('/session/wd')
    return res.data
  }

  /**
   * Move R's working directory.
   *
   * A dedicated endpoint rather than `execute('setwd(…)')` so a bad path comes
   * back as a result the dialog can show, instead of as console stderr the user
   * has to go and read. The console still gets the equivalent `setwd()` line —
   * every GUI operation in ouRGeo is echoed as the R that would do it.
   */
  async setWorkingDir(path: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const res = await this.http.post<{ success: boolean; path?: string; error?: string }>(
      '/session/setwd', { path },
    )
    return res.data
  }

  async health(): Promise<boolean> {
    try {
      await this.http.get('/health')
      return true
    } catch {
      return false
    }
  }

  /**
   * Where `execute` evaluates. `.GlobalEnv` unless the user has asked to work
   * inside one of their own environments (`src/lib/working-env.ts`).
   *
   * A field on the client rather than an argument threaded through forty call
   * sites: the toolbox, the AI assistant and the console all run R the same
   * way, and if a tool wrote its result into .GlobalEnv while the user was
   * working in `env2` the panel would show the object arriving somewhere they
   * were not looking.
   */
  private workingEnv = '.GlobalEnv'

  setWorkingEnv(name: string): void { this.workingEnv = name }

  async preflightStart(request: PreflightRequest): Promise<PreflightReport> {
    return (await this.http.post('/preflight/start', request)).data
  }

  async preflightStatus(operationId: string): Promise<PreflightReport> {
    // R serves queued HTTP between native write/readback stages. A large native
    // call must not time out in the UI while its verified save proceeds.
    return (await this.http.post('/preflight/status', { operationId }, { timeout: 3_600_000 })).data
  }

  async preflightCancel(operationId: string): Promise<PreflightReport> {
    return (await this.http.post('/preflight/cancel', { operationId }, { timeout: 3_600_000 })).data
  }

  async preflightExecute(operationId: string, fingerprint: string): Promise<RResponse & { outputClass?: string; validation?: PreflightReport; pending?: boolean; path?: string; featureCount?: number; verified?: boolean }> {
    return withPowerBlock(async () => (await this.http.post('/preflight/execute', { operationId, fingerprint }, { timeout: 3_600_000 })).data)
  }

  async preflightRows(operationId: string, reference: string): Promise<{ success: boolean; error?: string; rowIdentities: string[]; geometries: { row: number; identity: string; status: string; reason: string }[][] }> {
    return (await this.http.post('/preflight/rows', { operationId, reference })).data
  }

  async preflightSelection(name: string, envName: string, rows: number[], version: number): Promise<void> {
    await this.http.post('/preflight/selection', { name, envName, rows, version })
  }

  async execute(code: string): Promise<RExecuteResponse> {
    // Arbitrary user/generated code — imports, geoprocessing, model fits — can
    // run for a long time (a large chunked ImageServer export easily exceeds
    // 10 minutes against slow government servers). The 60s client default
    // would abort while R is still working, so allow a very generous ceiling;
    // R executes requests serially, so a stuck call blocks nothing else.
    // Inhibit OS idle-suspend for the duration: sleeping mid-request makes
    // Chromium abort it (ERR_NETWORK_CHANGED) even though R finishes the work.
    return withPowerBlock(async () => {
      const res = await this.http.post<RExecuteResponse>(
        '/r/execute', { code, envir: this.workingEnv }, { timeout: 3_600_000 })
      return res.data
    })
  }

  /**
   * Run one R Markdown chunk.
   *
   * A separate endpoint from `execute` because /r/execute captures at most ONE
   * plot per call (server.R points the default device at a single fixed-name
   * PNG) and broadcasts plots globally with no caller attribution. The chunk
   * endpoint uses a per-page device and returns everything in the response, so a
   * chunk that draws three plots shows three plots under that chunk.
   */
  async executeChunk(
    code: string, options: Record<string, string> = {},
  ): Promise<RChunkResponse> {
    return withPowerBlock(async () => {
      const res = await this.http.post<RChunkResponse>(
        '/r/chunk/execute', { code, options }, { timeout: 3_600_000 },
      )
      return res.data
    })
  }

  /** Which knit dependencies are present. Cheap and in-process — used to
   *  pre-disable menu items rather than surfacing an opaque render failure. */
  async rmarkdownDeps(): Promise<import('@/lib/markdown/knit-deps').KnitDeps> {
    const res = await this.http.get('/rmarkdown/deps')
    return res.data as import('@/lib/markdown/knit-deps').KnitDeps
  }

  async kaggleFiles(ref: string, username: string, apiKey: string): Promise<{
    success: boolean
    files?: { name: string; totalBytes: number }[]
    zipPath?: string
    error?: string
  }> {
    const res = await this.http.post(
      '/kaggle/files',
      { ref, username, apiKey },
      { timeout: 300_000 }  // large datasets can take a while
    )
    return res.data
  }

  async listPackages(): Promise<{ success: boolean; libraries: RLibrary[]; error?: string }> {
    const res = await this.http.get<{ success: boolean; libraries: RLibrary[]; error?: string }>(
      '/packages/list',
      { timeout: 120_000 }
    )
    return res.data
  }

  async loadPackage(name: string, libPath?: string, version?: string): Promise<RResponse> {
    return this.ask('/packages/load', { name, libPath, version })
  }

  async unloadPackage(name: string, libPath?: string, version?: string): Promise<RResponse> {
    return this.ask('/packages/unload', { name, libPath, version })
  }

  async installPackage(code: string): Promise<RResponse<{ output: string }>> {
    const res = await this.http.post<RResponse<{ output: string }>>(
      '/packages/install',
      { code },
      { timeout: 300_000 }
    )
    return res.data
  }

  async getCranList(): Promise<{ success: boolean; packages: { name: string; title: string }[]; error?: string }> {
    const res = await this.http.get<{ success: boolean; packages: { name: string; title: string }[]; error?: string }>(
      '/packages/cran-list',
      { timeout: 30_000 }
    )
    return res.data
  }

  async checkPackageVersion(name: string, libPath: string): Promise<{
    success: boolean
    installed: string | null
    cran: string | null
    upToDate: boolean
  }> {
    const res = await this.http.post('/packages/check-version', { name, libPath }, { timeout: 30_000 })
    return res.data
  }

  async addLibraryPath(path: string): Promise<RResponse<{ path: string; libPaths: string[] }>> {
    const res = await this.http.post<RResponse<{ path: string; libPaths: string[] }>>(
      '/packages/addlibpath',
      { path }
    )
    return res.data
  }

  async listEnvironments(): Promise<{ success: boolean; environments: REnvironmentInfo[] }> {
    const res = await this.http.get<{ success: boolean; environments: REnvironmentInfo[] }>(
      '/env/list',
      { timeout: 30_000 }
    )
    return res.data
  }

  async envRemove(name: string, envName: string): Promise<RResponse> {
    return this.ask<RResponse>('/env/remove', { name, envName })
  }

  async envRename(oldName: string, newName: string, envName: string): Promise<RResponse> {
    return this.ask<RResponse>('/env/rename', { oldName, newName, envName })
  }

  async envCopy(name: string, fromEnv: string, toEnv: string, newName: string): Promise<RResponse> {
    return this.ask<RResponse>('/env/copy', { name, fromEnv, toEnv, newName })
  }

  async envMove(name: string, fromEnv: string, toEnv: string): Promise<RResponse> {
    return this.ask<RResponse>('/env/move', { name, fromEnv, toEnv })
  }

  async envCreate(name: string, parentEnv?: string): Promise<RResponse> {
    return this.ask<RResponse>('/env/create', { name, parentEnv })
  }

  /** Copy an environment's contents into a NEW environment in .GlobalEnv.
   *  `/env/copy` would copy the reference — see handlers-env.R. */
  async envDuplicate(
    name: string, newName: string, envName = '.GlobalEnv', toEnv?: string,
  ): Promise<RResponse & { count?: number }> {
    return this.ask<RResponse & { count?: number }>(
      '/env/duplicate', { name, newName, envName, toEnv: toEnv ?? envName },
    )
  }

  async envSave(
    envNames: string[],
    filePath: string,
    rdataLoadedNames?: string[],
    excludeSystem = false
  ): Promise<RResponse> {
    return this.ask<RResponse>('/env/save', {
      envNames, filePath, rdataLoadedNames: rdataLoadedNames ?? [], excludeSystem
    })
  }

  async envLoad(filePath: string, envName: string): Promise<RResponse & { rdataLoadedNames?: string[] }> {
    return this.ask<RResponse & { rdataLoadedNames?: string[] }>('/env/load', { filePath, envName })
  }

  // ── Project snapshots (docs/project-persistence-spec.md §1.2, §1.9, §1.11) ──
  /** Snapshot the user's objects to `filePath`. On Unix R forks and returns
   *  `running` at once; poll `checkpointStatus`. `sync` writes in-process.
   *  `compress: 'fast'` is for bundles that travel; checkpoints stay local
   *  and uncompressed, which is what keeps them fast (handlers-checkpoint.R). */
  async checkpointStart(filePath: string, sync = false, compress: 'none' | 'fast' = 'none'): Promise<CheckpointState> {
    return this.ask<CheckpointState>('/session/checkpoint', { filePath, sync, compress })
  }
  async checkpointStatus(): Promise<CheckpointState> {
    const res = await this.http.get<CheckpointState>('/session/checkpoint/status')
    return res.data
  }
  /** Restore a project snapshot into .GlobalEnv, unpacking terra objects and
   *  naming what could not be rebuilt. */
  async snapshotLoad(filePath: string): Promise<RResponse & { restored?: string[]; notRestored?: NotRestored[]; rdataLoadedNames?: string[] }> {
    return this.ask('/session/snapshot-load', { filePath })
  }
  async mergeEnvCompare(sides: { base?: string | null; mine?: string | null; theirs?: string | null }): Promise<RResponse & { items?: MergeEnvItem[] }> {
    return this.ask('/project/merge-env/compare', { sides })
  }
  async mergeEnvBuild(filePath: string, choices: Record<string, 'mine' | 'theirs' | 'both' | 'none'>): Promise<RResponse & { names?: string[] }> {
    return this.ask('/project/merge-env/build', { filePath, choices })
  }
  async mergeEnvRelease(): Promise<void> {
    await this.ask('/project/merge-env/release', {})
  }

  // Clear .GlobalEnv, disconnect all DuckDB connections, drop proxies — a clean
  // slate for the project workflow's New action and before loading a project.
  async sessionReset(): Promise<RResponse> {
    useSessionStore.setState(s => ({ rGeneration: s.rGeneration + 1 }))
    const res = await this.http.post<RResponse>('/session/reset', {})
    return res.data
  }

  async listSpatialObjects(): Promise<{
    success: boolean
    objects: SpatialObjectInfo[]
  }> {
    const res = await this.http.get<{ success: boolean; objects: SpatialObjectInfo[] }>(
      '/spatial/list',
      { timeout: 30_000 }
    )
    return res.data
  }

  /** Absolute base URL of the R server — used for raster tile templates. */
  get baseUrl(): string {
    if (this._port === null) throw new Error('R client not initialized')
    return `http://127.0.0.1:${this._port}`
  }

  async rasterInfo(name: string, envName: string): Promise<RasterInfoResponse> {
    const res = await this.http.post<RasterInfoResponse>(
      '/raster/info',
      { name, envName },
      { timeout: 120_000 }
    )
    return res.data
  }

  // Registration warps + builds overviews for large rasters — allow time.
  async rasterRegister(
    name: string,
    envName: string,
    symbology: RasterSymbologyPayload,
    layerId?: string
  ): Promise<RasterRegisterResponse> {
    const res = await this.http.post<RasterRegisterResponse>(
      '/raster/register',
      { name, envName, layerId, symbology },
      { timeout: 600_000 }
    )
    return res.data
  }

  async rasterUnregister(layerId: string): Promise<RResponse> {
    const res = await this.http.post<RResponse>('/raster/unregister', { layerId })
    return res.data
  }

  async rasterHistogram(
    name: string,
    envName: string,
    band: number,
    bins = 48
  ): Promise<{ success: boolean; error?: string; breaks: number[]; counts: number[] }> {
    const res = await this.http.post<{
      success: boolean
      error?: string
      breaks: number[]
      counts: number[]
    }>('/raster/histogram', { name, envName, band, bins }, { timeout: 120_000 })
    return res.data
  }

  // Pixel band values at a 4326 lng/lat (info-click identify on a raster).
  async rasterValue(
    name: string,
    envName: string,
    lng: number,
    lat: number
  ): Promise<{ success: boolean; error?: string; bands?: { name: string; value: string | null }[] }> {
    const res = await this.http.post<{
      success: boolean
      error?: string
      bands?: { name: string; value: string | null }[]
    }>('/raster/value', { name, envName, lng, lat }, { timeout: 30_000 })
    return res.data
  }

  async getObjectFunction(
    name: string,
    envName: string,
    accessPath?: string
  ): Promise<FunctionResponse> {
    const res = await this.http.post<FunctionResponse>('/object/function', {
      name,
      envName,
      accessPath: accessPath || name
    })
    return res.data
  }

  async getObjectFormals(
    name: string,
    pkg?: string
  ): Promise<{ success: boolean; args?: RFormalArg[]; error?: string }> {
    const res = await this.http.post<{ success: boolean; args?: RFormalArg[]; error?: string }>(
      '/object/formals',
      { name, package: pkg }
    )
    return res.data
  }

  async contextSchema(name: string, envName: string): Promise<RResponse & { columns?: ColumnInfo[] }> {
    const { data } = await this.http.post('/context/schema', { name, envName }, { timeout: 8000 })
    return data
  }

  async getObjectDataFrame(
    name: string,
    envName: string,
    accessPath?: string,
    offset = 0,
    limit = 500
  ): Promise<DataFrameResponse> {
    const res = await this.http.post<DataFrameResponse>('/object/dataframe', {
      name,
      envName,
      accessPath: accessPath || name,
      offset,
      limit
    })
    return res.data
  }

  async getObjectMatrix(
    name: string,
    envName: string,
    accessPath?: string,
    offset = 0,
    limit = 500
  ): Promise<MatrixResponse> {
    const res = await this.http.post<MatrixResponse>('/object/matrix', {
      name,
      envName,
      accessPath: accessPath || name,
      offset,
      limit
    })
    return res.data
  }

  async getObjectVector(
    name: string,
    envName: string,
    accessPath?: string,
    offset = 0,
    limit = 500
  ): Promise<VectorResponse> {
    const res = await this.http.post<VectorResponse>('/object/vector', {
      name,
      envName,
      accessPath: accessPath || name,
      offset,
      limit
    })
    return res.data
  }

  async previewData(opts: {
    file_path: string
    format: string
    sheet?: string
    skip?: number
    header?: boolean
    sep?: string
  }): Promise<RResponse<{ columns: { name: string; type: string }[]; is_spatial: boolean; sheet_names: string[] }>> {
    const res = await this.http.post<RResponse<{ columns: { name: string; type: string }[]; is_spatial: boolean; sheet_names: string[] }>>(
      '/data/preview',
      opts,
      { timeout: 30_000 }
    )
    return res.data
  }

  /**
   * Re-render a recorded plot at an arbitrary size. `plotId` pins a specific
   * plot from R's history; omit it to render the most recent one. Returns the
   * server's message instead of throwing, so callers can distinguish "that
   * plot is gone" from a real render failure.
   */
  async exportPlot(opts: {
    format: 'png' | 'jpg' | 'pdf'
    widthPx: number
    heightPx: number
    dpi: number
    plotId?: string | null
  }): Promise<{ success: boolean; data?: string; format?: string; error?: string }> {
    try {
      const res = await this.http.post<{
        success: boolean
        data?: string
        format?: string
        error?: string
      }>('/r/plot/export', opts, { timeout: 30_000 })
      return res.data
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(err)
      return { success: false, error: msg }
    }
  }

  async getSpatialGeoJSON(
    name: string,
    envName: string
  ): Promise<{ success: boolean; geojson?: string; error?: string }> {
    const res = await this.http.post<{ success: boolean; geojson?: string; error?: string }>(
      '/spatial/geojson',
      { name, envName },
      { timeout: 120_000 }
    )
    return res.data
  }

  /** True (curve-preserving) WKT for one row's geometry, in WGS84. */
  async spatialWkt(
    name: string,
    envName: string,
    row: number,
    column?: string
  ): Promise<{ success: boolean; wkt?: string; hasCurve?: boolean; error?: string }> {
    const res = await this.http.post<{
      success: boolean
      wkt?: string
      hasCurve?: boolean
      error?: string
    }>('/spatial/wkt', { name, envName, row, column }, { timeout: 15_000 })
    return res.data
  }

  /**
   * What a layer's coordinate system is, in the terms the Distance & Bearing
   * strip needs: is it projected, and what linear unit is it defined in.
   * `crs$input` alone cannot answer either — it is whatever string the CRS was
   * built from — so R is asked rather than the string parsed.
   */
  async spatialCrs(
    target: { name: string; envName?: string } | { crs: string | number }
  ): Promise<{
    success: boolean
    input?: string | null
    epsg?: number | null
    name?: string | null
    isGeographic?: boolean
    unitName?: string | null
    unitToMetre?: number | null
    error?: string
  }> {
    const res = await this.http.post('/spatial/crs', target, { timeout: 15_000 })
    return res.data as Awaited<ReturnType<RClient['spatialCrs']>>
  }

  /**
   * Walk a traverse in the layer's own projected grid.
   *
   * Only the GRID basis comes here: a geodesic leg is computed in the renderer
   * (`lib/draw/cogo.ts`) and needs no round trip, which matters because the R
   * server is serial and somebody may be running a long command. What comes
   * back is the vertices in WGS84 plus the projected frame at the last of them,
   * so the NEXT leg can be previewed while it is typed without asking again.
   */
  async spatialTraverse(body: {
    origin: [number, number]
    /**
     * The courses to lay out. A straight one is a distance and an azimuth; a
     * curve is a radius, a central angle and a turn, with `azimuth` carrying
     * its incoming tangent — or omitted on a TANGENT curve, which inherits the
     * previous course's arrival azimuth. `type` defaults to `'line'`, so the
     * straight-only shape this started as still means what it meant.
     */
    courses: {
      type?: 'line' | 'curve' | 'spiral' | 'bezier'
      distance?: number
      azimuth?: number
      radius?: number
      delta?: number
      turn?: 'L' | 'R'
      /** Transition courses: which end the spiral is, and how long. */
      form?: 'in' | 'out' | 'scs'
      length?: number
      lengthOut?: number
      /**
       * Free curves. `azimuth` is the bearing to the END point here, so the
       * direction the curve LEAVES on needs its own field — omit it to inherit
       * the previous course's arrival.
       */
      arrive?: number
      tension?: number
      leave?: number
      /**
       * Vertices to cut the curve into. A power of two, because the renderer
       * fits circular arcs through these points and needs every piece boundary
       * and midpoint to land exactly on one rather than between two. Left off,
       * R emits roughly one per degree of sweep.
       */
      samples?: number
    }[]
    basis: 'geodesic' | 'grid'
    name?: string
    envName?: string
    crs?: string | number
  }): Promise<{
    success: boolean
    vertices?: [number, number][]
    frame?: { x: number; y: number; convergence: number; scale: number } | null
    error?: string
  }> {
    const res = await this.http.post('/spatial/traverse', body, { timeout: 20_000 })
    return res.data as Awaited<ReturnType<RClient['spatialTraverse']>>
  }

  async searchHelp(query: string, limit = 20): Promise<RResponse<{ results: HelpSearchResult[] }>> {
    const res = await this.http.post<RResponse<{ results: HelpSearchResult[] }>>(
      '/help/search', { query, limit }, { timeout: 15_000 }
    )
    return res.data
  }

  async getHelpDoc(topic: string, pkg?: string): Promise<RResponse<{ html: string; topic: string; package: string; examples: string }>> {
    const res = await this.http.post<RResponse<{ html: string; topic: string; package: string; examples: string }>>(
      '/help/doc', { topic, package: pkg ?? null }, { timeout: 15_000 }
    )
    return res.data
  }

  async getPackageInfo(pkg: string): Promise<RResponse<{ title: string; version: string; description: string; functions: string[] }>> {
    const res = await this.http.post<RResponse<{ title: string; version: string; description: string; functions: string[] }>>(
      '/help/package', { package: pkg }, { timeout: 10_000 }
    )
    return res.data
  }

  async getVignettes(pkg: string): Promise<RResponse<{ vignettes: { name: string; title: string }[] }>> {
    const res = await this.http.post<RResponse<{ vignettes: { name: string; title: string }[] }>>(
      '/help/vignettes', { package: pkg }, { timeout: 10_000 }
    )
    return res.data
  }

  async getVignetteContent(pkg: string, name: string): Promise<RResponse<{ html: string; name: string }>> {
    const res = await this.http.post<RResponse<{ html: string; name: string }>>(
      '/help/vignette', { package: pkg, name }, { timeout: 10_000 }
    )
    return res.data
  }

  interrupt(): void {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.r.interrupt()
    }
    useSessionStore.getState().setExecuting(false)
  }

  async selectionQuery(params: {
    code: string
    sourceName: string
    sourceEnv: string
  }): Promise<{ success: boolean; rowIndices: number[]; error?: string }> {
    const res = await this.http.post('/selection/query', params, { timeout: 60_000 })
    return res.data
  }

  async renderPlotPreview(code: string): Promise<{ success: boolean; data?: string; error?: string }> {
    try {
      const res = await this.http.post<{ success: boolean; data?: string; error?: string }>(
        '/r/plot-preview',
        { code },
        { timeout: 30_000 }
      )
      return res.data
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(err)
      return { success: false, error: msg }
    }
  }

  // Routes /db/* responses through here so a non-2xx (e.g. missing R package → HTTP 500)
  // surfaces the R server's structured `{success:false, error:"..."}` body instead of axios's
  // generic "Request failed with status code 500".
  private async dbCall<T extends { success: boolean; error?: string }>(
    fn: () => Promise<{ data: T }>
  ): Promise<T> {
    try {
      const res = await fn()
      return res.data
    } catch (err: unknown) {
      const body = (err as { response?: { data?: unknown } })?.response?.data
      if (body && typeof body === 'object') return body as T
      return { success: false, error: err instanceof Error ? err.message : String(err) } as T
    }
  }

  async dbCreate(filePath: string): Promise<RResponse & { path?: string }> {
    return this.dbCall(() => this.http.post<RResponse & { path?: string }>('/db/create', { filePath }))
  }

  async dbOpen(filePath: string): Promise<{ success: boolean; handle?: string; objects?: RgeoObjectInfo[]; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; handle?: string; objects?: RgeoObjectInfo[]; error?: string }>(
        '/db/open', { filePath }
      )
    )
  }

  async dbClose(handle: string): Promise<RResponse> {
    return this.dbCall(() => this.http.post<RResponse>('/db/close', { handle }))
  }

  // Snapshot connected dataset proxies for a project save.
  async dbProxies(): Promise<{ success: boolean; proxies?: DbProxyInfo[]; error?: string }> {
    return this.dbCall(() =>
      this.http.get<{ success: boolean; proxies?: DbProxyInfo[]; error?: string }>('/db/proxies')
    )
  }

  // Reopen each .Rgeo file and rebind its proxies after a project load.
  async dbReconnect(databases: DbReconnectEntry[]):
    Promise<{ success: boolean; handles?: Record<string, string>; errors?: string[]; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; handles?: Record<string, string>; errors?: string[]; error?: string }>(
        '/db/reconnect', { databases }, { timeout: 120_000 }
      )
    )
  }

  async dbListObjects(handle: string): Promise<{ success: boolean; objects?: RgeoObjectInfo[]; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; objects?: RgeoObjectInfo[]; error?: string }>(
        '/db/list-objects', { handle }
      )
    )
  }

  async dbDeleteObject(handle: string, name: string): Promise<RResponse> {
    return this.dbCall(() => this.http.post<RResponse>('/db/delete-object', { handle, name }))
  }

  async dbConnectObject(handle: string, name: string, varName: string, mode: 'connect' | 'load'):
    Promise<{ success: boolean; varName?: string; kind?: string; mode?: 'lazy' | 'loaded'; code?: string; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; varName?: string; kind?: string; mode?: 'lazy' | 'loaded'; code?: string; error?: string }>(
        '/db/connect-object', { handle, name, varName, mode }
      )
    )
  }

  async dbPreviewObject(handle: string, name: string, n = 100):
    Promise<{ success: boolean; kind?: string; columns?: ColumnInfo[]; rows?: (string | null)[][]; message?: string; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; kind?: string; columns?: ColumnInfo[]; rows?: (string | null)[][]; message?: string; error?: string }>(
        '/db/preview-object', { handle, name, n }
      )
    )
  }

  async dbImportObject(handle: string, sourceVarName: string, targetName: string, notes?: string):
    Promise<{ success: boolean; name?: string; kind?: string; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; name?: string; kind?: string; error?: string }>(
        '/db/import-object', { handle, sourceVarName, targetName, notes }
      )
    )
  }

  async dbPreviewTbl(varName: string, n = 100):
    Promise<{ success: boolean; columns?: ColumnInfo[]; rows?: (string | null)[][]; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; columns?: ColumnInfo[]; rows?: (string | null)[][]; error?: string }>(
        '/db/preview-tbl', { varName, n }
      )
    )
  }

  async dbRecents(): Promise<{ success: boolean; files?: string[]; error?: string }> {
    return this.dbCall(() =>
      this.http.get<{ success: boolean; files?: string[]; error?: string }>('/db/recents')
    )
  }

  async dbRecentsAdd(filePath: string): Promise<{ success: boolean; files?: string[]; error?: string }> {
    return this.dbCall(() =>
      this.http.post<{ success: boolean; files?: string[]; error?: string }>(
        '/db/recents-add', { filePath }
      )
    )
  }

  // -------------------------------------------------------------------------
  // /dataset/* — uniform per-kind operations on database-backed datasets.
  // The `proxy` argument identifies the (open db handle, object name) pair.
  // -------------------------------------------------------------------------

  async datasetPreview(proxy: RgeoProxyRef, opts: { offset?: number; limit?: number; where?: string; orderBy?: string } = {}) {
    type R = { success: boolean; columns?: ColumnInfo[]; rows?: (string | null)[][]; totalRows?: number; pkColumn?: string; geometryColumn?: string; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/preview', { ...proxy, ...opts }))
  }

  async datasetUpdateCell(proxy: RgeoProxyRef, rowId: number, column: string, value: string | number | null) {
    type R = { success: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/update-cell', { ...proxy, rowId, column, value }))
  }

  async datasetAddColumn(proxy: RgeoProxyRef, newColumn: string, formula: string) {
    type R = { success: boolean; used_pushdown?: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/add-column', { ...proxy, newColumn, formula }))
  }

  async datasetDeleteRows(proxy: RgeoProxyRef, rowIds: number[]) {
    type R = { success: boolean; deleted?: number; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/delete-rows', { ...proxy, rowIds }))
  }

  async datasetRenameColumn(proxy: RgeoProxyRef, oldName: string, newName: string) {
    type R = { success: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/rename-column', { ...proxy, oldName, newName }))
  }

  async datasetDeleteColumn(proxy: RgeoProxyRef, column: string) {
    type R = { success: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/delete-column', { ...proxy, column }))
  }

  async datasetSpatialTile(proxy: RgeoProxyRef, opts: { bbox: [number, number, number, number]; zoom?: number; limit?: number }) {
    type R = { success: boolean; geojson?: GeoJSON.FeatureCollection; truncated?: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/spatial-tile', { ...proxy, ...opts }))
  }

  async datasetUpdateGeometry(
    proxy: RgeoProxyRef,
    edits: { rowId: number; wkt: string; wktTrue?: string }[]
  ) {
    type R = { success: boolean; applied?: number; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/update-geometry', { ...proxy, edits }))
  }

  /** True (curve-preserving) WKT for one DB row, in WGS84. */
  async datasetRowWkt(proxy: RgeoProxyRef, rowId: number) {
    type R = { success: boolean; wkt?: string; hasCurve?: boolean; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/row-wkt', { ...proxy, rowId }))
  }

  async datasetCollect(proxy: RgeoProxyRef, opts: { varName?: string; where?: string; columns?: string[]; bbox?: [number, number, number, number] } = {}) {
    type R = { success: boolean; varName?: string; kind?: RgeoObjectKind; nRows?: number; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/collect', { ...proxy, ...opts }))
  }

  async datasetBbox(proxy: RgeoProxyRef) {
    type R = { success: boolean; bbox?: [number, number, number, number] | null; crs?: string | null; error?: string }
    return this.dbCall<R>(() => this.http.post<R>('/dataset/bbox', proxy))
  }
}

export interface HelpSearchResult {
  name: string
  package?: string
  title?: string
  type?: string
  source: 'loaded' | 'index'
}

export interface SpatialObjectInfo {
  name: string
  envName: string
  class: string
  geometryType: string
  nFeatures: number
  crs: string | null
  sfColumn?: string
  /** SpatRaster listings only. */
  nBands?: number
  dims?: [number, number]
}

// ---------------------------------------------------------------------------
// Raster engine (r/lib/handlers-raster.R)

export interface RasterBandStats {
  index: number
  name: string
  min: number
  max: number
  mean: number
  sd: number
  q02: number
  q98: number
  categorical: boolean
  levels?: { value: number; label: string; color: string }[]
}

export interface RasterInfoResponse {
  success: boolean
  error?: string
  bands: RasterBandStats[]
  nbands: number
  nrow: number
  ncol: number
  resolution: number[]
  dtype: string
  crs: string | null
  extent4326: [number, number, number, number] | null
  nodata: number | null
  approx: boolean
}

/** Wire shape POSTed to /raster/register (resolved from RasterSymbology). */
export interface RasterSymbologyPayload {
  mode: 'singleband' | 'rgb' | 'categorical'
  bands: number[]
  stretch: {
    type: 'minmax' | 'percent' | 'stddev' | 'custom'
    pLow?: number
    pHigh?: number
    nStd?: number
    min?: number[]
    max?: number[]
  }
  colormap?: { position: number; color: string }[]
  categories?: { value: number; label: string; color: string }[]
  nodataTransparent: boolean
  resampling: 'nearest' | 'bilinear'
}

export interface RasterRegisterResponse {
  success: boolean
  error?: string
  layerId: string
  version: number
  tileUrl: string
  bounds4326: [number, number, number, number] | null
  minzoom: number
  maxzoom: number
  bands: RasterBandStats[]
  nbands: number
  stretch: { lo: number[]; hi: number[] }
}

export type RgeoObjectKind =
  | 'sf' | 'geos' | 'data.frame' | 'tibble' | 'data.table' | 'raster' | 'image' | 'rds'

export type RgeoSpatialFormat = 'duckdb_geometry' | 'wkb_blob' | 'serialized' | 'none'

export interface RgeoObjectInfo {
  name: string
  kind: RgeoObjectKind
  geometry_type?: string | null
  crs?: string | null
  n_rows?: number | null
  size_bytes?: number | null
  notes?: string | null
  r_class?: string | null
  pk_column?: string | null
  geometry_column?: string | null
  bbox?: [number, number, number, number] | null
  spatial_format?: RgeoSpatialFormat | null
  has_spatial_index?: boolean | null
  editable?: boolean | null
}

// Minimal reference passed to /dataset/* endpoints to identify the
// (open database, object name) pair. Surfaced on environment items via
// `rgeoProxy` when the env variable is a connected database dataset.
export interface RgeoProxyRef {
  handle: string
  name: string
}

// A connected dataset proxy snapshot for a project save: the env variable, the
// source object name, and the .Rgeo file it lives in (resolved server-side).
export interface DbProxyInfo {
  varName: string
  name: string
  filePath: string | null
}

// One database to re-establish on project load, with the proxies to rebind.
export interface DbReconnectEntry {
  filePath: string
  proxies: { varName: string; name: string }[]
}

// Full description of a dataset that the renderer can drive via the
// uniform translator surface — works equally for in-memory and db-backed
// datasets so callers don't have to fork their logic.
export interface DatasetHandle {
  source: 'environment' | 'database'
  kind: RgeoObjectKind
  envName?: string
  accessPath?: string
  proxy?: RgeoProxyRef
  pkColumn?: string
  geometryColumn?: string | null
  geometryType?: string
  crs?: string | null
  bbox?: [number, number, number, number] | null
  nRows?: number
  columns?: ColumnInfo[]
  spatialFormat?: RgeoSpatialFormat | null
  editable?: boolean
}

export const rClient = new RClient()
