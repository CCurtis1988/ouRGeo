import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, AlertCircle, Plus, Trash2, Database, RefreshCw } from 'lucide-react'
import { Button } from '../ui/button'
import { SearchableSelect, type SearchableOption } from '../ui/SearchableSelect'
import { QueryBuilder } from './QueryBuilder'
import { toRVarName } from './dataConnectorCode'
import { getServerStore } from '@/lib/api-connectors/apiServers'
import { DEFAULT_QUERY, type Query } from '@/lib/api-connectors/query-model'
import type { ApiProvider, CapacityProbe, ProviderContext, ResourceMetadata, Selection } from '@/lib/api-connectors/types'
import { useApiKeysStore } from '@/store/apiKeys'
import { useSessionStore } from '@/store/session'
import { useSpatialStore } from '@/store/spatial'
import { useEditorStore } from '@/store/editor'
import { rClient } from '@/lib/r-client'
import { createRasterLayerInfo, rasterLayerDraft } from '@/lib/raster-layers'
import { cn } from '@/lib/utils'

// ── Raster imagery export sizing ─────────────────────────────────────────────

const IMAGE_SIZE_CHOICES = [1024, 2048, 4096, 8192, 16384]

/** Bytes per pixel for an ArcGIS pixelType code (upper-bound estimate). */
function pixelBytes(pixelType?: string): number {
  switch (pixelType) {
    case 'U1': case 'U2': case 'U4': case 'U8': case 'S8': return 1
    case 'U16': case 'S16': return 2
    case 'F64': case 'D64': return 8
    default: return 4 // F32/U32/S32/unknown
  }
}

interface ImageEstimate {
  pxW: number
  pxH: number
  chunks: number
  megabytes: number
  metersPerPx: number | null
}

/** Export dimensions + request count + size for a bbox at a long-side size. */
function estimateImageExport(
  bbox: [number, number, number, number] | null,
  size: number,
  bandCount: number,
  pixelType: string | undefined,
  chunkPx: number
): ImageEstimate | null {
  if (!bbox || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return null
  const aspect = (bbox[2] - bbox[0]) / (bbox[3] - bbox[1])
  const pxW = aspect >= 1 ? size : Math.max(1, Math.round(size * aspect))
  const pxH = aspect >= 1 ? Math.max(1, Math.round(size / aspect)) : size
  const chunks = Math.ceil(pxW / chunkPx) * Math.ceil(pxH / chunkPx)
  const megabytes = (pxW * pxH * bandCount * pixelBytes(pixelType)) / 1e6
  const midLat = (bbox[1] + bbox[3]) / 2
  const widthMeters = (bbox[2] - bbox[0]) * 111320 * Math.cos((midLat * Math.PI) / 180)
  const metersPerPx = widthMeters > 0 ? widthMeters / pxW : null
  return { pxW, pxH, chunks, megabytes, metersPerPx }
}

function fmtMb(mb: number): string {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

function fmtRes(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km/px` : `${m < 10 ? m.toFixed(1) : Math.round(m)} m/px`
}

const PREVIEW_LIMIT = 20
// Rows/request the import uses by default; above this an import spans multiple
// server pages, so it's worth probing whether the server can keep up.
const IMPORT_PAGE_SIZE = 1000

interface Props {
  provider: ApiProvider
  onClose: () => void
}

export function ApiConnectorBrowser({ provider, onClose }: Props): React.ReactElement {
  const keys = useApiKeysStore((s) => s.keys)
  const addConsoleEntry = useSessionStore((s) => s.addConsoleEntry)

  const useServers = useMemo(() => getServerStore(provider.id, provider.builtinServers), [provider])
  const servers = useServers((s) => s.servers)
  const initServers = useServers((s) => s.init)
  const addServer = useServers((s) => s.addServer)
  const removeServer = useServers((s) => s.removeServer)

  const [serverId, setServerId] = useState(provider.builtinServers[0]?.id ?? '')
  const server = useMemo(() => servers.find((s) => s.id === serverId) ?? servers[0] ?? null, [servers, serverId])
  const baseUrl = server?.baseUrl ?? ''
  const ctx: ProviderContext = useMemo(() => ({ baseUrl, apiKeys: keys }), [baseUrl, keys])

  // Cascade
  const levels = provider.cascade
  const lastKey = levels[levels.length - 1]?.key
  const [sel, setSel] = useState<Selection>({})
  const [levelOptions, setLevelOptions] = useState<Record<string, SearchableOption[]>>({})
  const [levelLoading, setLevelLoading] = useState<Record<string, boolean>>({})
  const [levelError, setLevelError] = useState<Record<string, string | null>>({})

  // Leaf metadata
  const [meta, setMeta] = useState<ResourceMetadata | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [metaError, setMetaError] = useState<string | null>(null)

  // Query + preview
  const [query, setQuery] = useState<Query>(DEFAULT_QUERY)
  const [preview, setPreview] = useState<{ cols: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [varName, setVarName] = useState('mydata')
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<CapacityProbe | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Raster-asset import mode (STAC collections exposing COG/GeoTIFF assets)
  const [importMode, setImportMode] = useState<'features' | 'raster'>('features')
  const [assetKey, setAssetKey] = useState('')
  const [assetMaxItems, setAssetMaxItems] = useState(1)

  // Raster imagery export controls (ImageServer / WCS / WMS / griddap) — live
  // map view bbox so the extent + estimate track the Spatial Editor as the
  // user pans.
  const viewBbox = useSpatialStore((s) => s.viewBbox)
  const [imgExtent, setImgExtent] = useState<'view' | 'full'>('view')
  const [imgSize, setImgSize] = useState(2048)
  const [imgTime, setImgTime] = useState('')

  // Raster imports can land straight on the map (same path as the Spatial
  // Editor's Add-layer dialog).
  const [addToMap, setAddToMap] = useState(true)

  // Add-server form
  const [addingServer, setAddingServer] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  useEffect(() => { initServers() }, [initServers])

  const errMsg = (e: unknown) => String(e instanceof Error ? e.message : e)

  // Fetch options for cascade level `i` given a selection.
  const fetchLevel = useCallback(async (i: number, selForFetch: Selection) => {
    const level = levels[i]
    if (!level || !baseUrl) return
    setLevelLoading((p) => ({ ...p, [level.key]: true }))
    setLevelError((p) => ({ ...p, [level.key]: null }))
    try {
      const opts = await provider.listLevel(level.key, selForFetch, { baseUrl, apiKeys: keys })
      setLevelOptions((p) => ({ ...p, [level.key]: opts }))
    } catch (e) {
      setLevelError((p) => ({ ...p, [level.key]: errMsg(e) }))
    } finally {
      setLevelLoading((p) => ({ ...p, [level.key]: false }))
    }
  }, [provider, levels, baseUrl, keys])

  const runPreview = useCallback(async (q: Query, selForFetch: Selection, m: ResourceMetadata) => {
    if (!baseUrl) return
    setPreviewLoading(true); setPreviewError(null)
    try {
      const rows = await provider.preview(selForFetch, { ...q, limit: PREVIEW_LIMIT }, { baseUrl, apiKeys: keys })
      const cols = (m.previewColumns ?? (m.fields.length > 0 ? m.fields.map((f) => f.id) : Object.keys(rows[0] ?? {}))).filter((c) => c !== '_id')
      setPreview({ cols, rows })
    } catch (e) {
      setPreviewError(errMsg(e)); setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }, [provider, baseUrl, keys])

  const loadMetadata = useCallback(async (selForFetch: Selection, leafLabel: string) => {
    setMeta(null); setPreview(null); setMetaError(null); setMetaLoading(true)
    setQuery(DEFAULT_QUERY)
    setVarName(toRVarName(leafLabel || 'mydata'))
    setImportMode('features'); setAssetKey(''); setAssetMaxItems(1)
    try {
      const m = await provider.getMetadata(selForFetch, { baseUrl, apiKeys: keys })
      setMeta(m)
      setAssetKey(m.rasterAssets?.[0]?.key ?? '')
      setImgTime(m.imageExport?.time?.default ?? '')
      if (m.queryable) void runPreview(DEFAULT_QUERY, selForFetch, m)
    } catch (e) {
      setMetaError(errMsg(e))
    } finally {
      setMetaLoading(false)
    }
  }, [provider, baseUrl, keys, runPreview])

  // Selecting a cascade level: clear children, then fetch next level or metadata.
  const selectLevel = useCallback((i: number, value: string) => {
    const newSel: Selection = { ...sel }
    newSel[levels[i].key] = value
    for (let j = i + 1; j < levels.length; j++) delete newSel[levels[j].key]
    setSel(newSel)
    // clear downstream options + leaf state
    setLevelOptions((p) => {
      const next = { ...p }
      for (let j = i + 1; j < levels.length; j++) delete next[levels[j].key]
      return next
    })
    setMeta(null); setPreview(null); setMetaError(null); setQuery(DEFAULT_QUERY)

    if (i + 1 < levels.length) {
      void fetchLevel(i + 1, newSel)
    } else {
      const leaf = (levelOptions[levels[i].key] ?? []).find((o) => o.value === value)
      void loadMetadata(newSel, leaf?.label ?? value)
    }
  }, [sel, levels, levelOptions, fetchLevel, loadMetadata])

  // Reset + load first level when the server changes
  useEffect(() => {
    setSel({}); setLevelOptions({}); setLevelError({}); setMeta(null); setPreview(null); setQuery(DEFAULT_QUERY)
    if (baseUrl) void fetchLevel(0, {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, provider])

  const leafSelected = !!lastKey && !!sel[lastKey]

  // Provider-declared query rules (e.g. "this route needs a point or an id").
  // A message disables Load and renders as a warning, instead of letting the
  // server fail with a bare HTTP 500.
  const queryIssue = useMemo(
    () => (leafSelected && meta?.queryable && provider.validateQuery ? provider.validateQuery(sel, query) : null),
    [leafSelected, meta, provider, sel, query],
  )

  const opsFor = useCallback((kind: Parameters<typeof provider.opsFor>[0]) => provider.opsFor(kind, meta?.caps), [provider, meta])
  const fetchDistinct = useMemo(
    () => (provider.distinctValues ? (field: string) => provider.distinctValues!(sel, field, ctx) : undefined),
    [provider, sel, ctx],
  )

  const rasterMode = importMode === 'raster' && !!meta?.rasterAssets?.length && !!assetKey

  // Raster imagery export: resolved bbox + size/requests estimate.
  const imgBbox = useMemo<[number, number, number, number] | null>(() => {
    if (!meta?.imageExport) return null
    if (imgExtent === 'view' && viewBbox) return viewBbox
    return meta.imageExport.extent4326 ?? null
  }, [meta, imgExtent, viewBbox])

  const imgEstimate = useMemo(() => {
    if (!meta?.imageExport) return null
    return estimateImageExport(
      imgBbox, imgSize, meta.imageExport.bandCount,
      meta.imageExport.pixelType, meta.imageExport.chunkPx,
    )
  }, [meta, imgBbox, imgSize])

  // Generated R code
  const code = useMemo(() => {
    if (!leafSelected || !meta) return ''
    if (!meta.queryable) {
      if (!meta.downloadCode) return '# This resource is not importable.'
      const opts = meta.imageExport
        ? {
            bbox: imgBbox,
            size: imgSize,
            maxTiles: imgEstimate ? Math.max(64, imgEstimate.chunks + 8) : undefined,
            time: meta.imageExport.time ? imgTime.trim() || undefined : undefined,
          }
        : undefined
      return meta.downloadCode(varName || 'mydata', opts)
    }
    return provider.buildCode(
      sel, query, varName || 'mydata', ctx,
      rasterMode ? { rasterAsset: assetKey, rasterMaxItems: assetMaxItems } : undefined,
    )
  }, [leafSelected, meta, provider, sel, query, varName, ctx, rasterMode, assetKey, assetMaxItems, imgBbox, imgSize, imgEstimate, imgTime])

  // Execute a final import code string and register the resulting object tab.
  const runImport = useCallback(async (finalCode: string) => {
    if (!finalCode || !meta) return
    setLoading(true); setError(null)
    try {
      addConsoleEntry('input', finalCode)
      const res = await rClient.execute(finalCode)
      if (!res.success) { setError(res.error ?? 'Execution failed'); return }
      const isRaster = rasterMode || !!meta.rasterResult
      // Raster imports have no tabular viewer — they surface in the
      // Environment panel and the Spatial Editor's Add-layer list.
      if (!isRaster) {
        useEditorStore.getState().addObjectTab(
          varName || 'mydata', '.GlobalEnv', meta.spatial ? 'sf' : 'data.frame', varName || 'mydata', 'data-viewer',
        )
      }
      if (isRaster && addToMap) {
        // Same path as AddFeaturesDialog's raster branch: register with the
        // tile engine, add to the layer stack, zoom to it. Never fails the
        // import — e.g. a multi-item STAC import yields a list, not a raster.
        const name = varName || 'mydata'
        try {
          const info = await createRasterLayerInfo(name, '.GlobalEnv')
          useSpatialStore.getState().addLayer(rasterLayerDraft(name, '.GlobalEnv', info))
          useSpatialStore.getState().requestFitBounds()
        } catch (e) {
          addConsoleEntry('info',
            `${name} imported, but could not be added to the map: ${errMsg(e)} ` +
            `Add it from the Spatial Editor once ready.`)
        }
      }
      onClose()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }, [meta, varName, rasterMode, addToMap, addConsoleEntry, onClose])

  const handleLoad = useCallback(async () => {
    if (!code || !meta) return
    // For multi-page imports, first check the server can actually deliver the
    // requested page size; if not, ask the user how much to import. Raster
    // asset imports cap items explicitly, so the probe is unnecessary.
    const effRows = Math.min(query.limit, meta.total ?? Number.MAX_SAFE_INTEGER)
    if (!rasterMode && provider.probeCapacity && meta.queryable && effRows > IMPORT_PAGE_SIZE) {
      setProbing(true); setError(null)
      try {
        const p = await provider.probeCapacity(sel, query, ctx)
        if (p.prompt) { setProbe(p); return } // hand off to the choice dialog
      } catch {
        /* probe failed — fall through to a normal import; R backs off if needed */
      } finally {
        setProbing(false)
      }
    }
    await runImport(code)
  }, [code, meta, provider, sel, query, ctx, rasterMode, runImport])

  // The user picked how many rows to import from the capacity dialog.
  const chooseImport = useCallback((limit: number) => {
    if (!meta || !probe) return
    const rows = Math.max(1, Math.floor(limit))
    const pageSize = Math.min(rows, probe.workingPageSize)
    const finalCode = provider.buildCode(sel, { ...query, limit: rows }, varName || 'mydata', ctx, { pageSize })
    setProbe(null)
    void runImport(finalCode)
  }, [meta, probe, provider, sel, query, varName, ctx, runImport])

  const handleAddServer = async () => {
    setAddBusy(true); setAddError(null)
    try {
      const validate = (url: string) => provider.listLevel(levels[0].key, {}, { baseUrl: url, apiKeys: keys })
      const s = await addServer(newLabel, newUrl, validate)
      setServerId(s.id); setAddingServer(false); setNewLabel(''); setNewUrl('')
    } catch (e) {
      setAddError(errMsg(e))
    } finally {
      setAddBusy(false)
    }
  }

  const canLoad = leafSelected && !!code && !queryIssue && !!(varName || '').trim() && (meta?.queryable ? !metaLoading : true)

  return (
    <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 gap-3">

        <p className="text-[11px] text-geo-muted -mb-1">{provider.description}</p>

        {/* Server picker */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-geo-muted">Server</label>
            <button type="button" onClick={() => setAddingServer((v) => !v)} className="text-[11px] text-geo-accent hover:text-geo-accent/80 flex items-center gap-0.5">
              <Plus className="w-3 h-3" /> Add server
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <SearchableSelect
              value={server?.id ?? null}
              options={servers.map((s) => ({ value: s.id, label: s.label }))}
              onChange={setServerId}
              placeholder="Select a server"
              className="flex-1"
            />
            {server && !server.builtin && (
              <button type="button" onClick={() => { removeServer(server.id); setServerId(servers[0]?.id ?? '') }} className="text-geo-muted hover:text-geo-error" title="Remove this server">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {server && <p className="text-[10px] text-geo-muted font-mono break-all">{server.baseUrl}</p>}

          {addingServer && (
            <div className="flex flex-col gap-1.5 mt-1 p-2 bg-geo-bg border border-geo-border rounded">
              <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Server name" className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
              <input type="text" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="Base URL (e.g. https://example.org/api)" className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground font-mono focus:outline-none focus:border-geo-accent" />
              {addError && <span className="text-[11px] text-geo-error">{addError}</span>}
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAddingServer(false)}>Cancel</Button>
                <Button size="sm" onClick={handleAddServer} disabled={addBusy || !newUrl.trim()}>
                  {addBusy ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Checking…</> : 'Add & verify'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Cascade */}
        {levels.map((level, i) => {
          const parentsReady = levels.slice(0, i).every((l) => !!sel[l.key])
          return (
            <div key={level.key} className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">{level.label}</label>
              <SearchableSelect
                value={sel[level.key] ?? null}
                options={levelOptions[level.key] ?? []}
                onChange={(v) => selectLevel(i, v)}
                placeholder={parentsReady ? (level.placeholder ?? `Select ${level.label.toLowerCase()}`) : `Pick ${levels[i - 1]?.label.toLowerCase()} first`}
                disabled={!parentsReady}
                loading={levelLoading[level.key]}
                error={levelError[level.key]}
                onRefresh={i === 0 ? () => fetchLevel(0, sel) : undefined}
              />
            </div>
          )
        })}

        {/* Leaf metadata + query builder / notice */}
        {leafSelected && (
          <>
            <div className="h-px bg-geo-border" />
            {metaLoading ? (
              <div className="flex items-center gap-2 text-xs text-geo-muted"><Loader2 className="w-3 h-3 animate-spin" /> Reading metadata…</div>
            ) : metaError ? (
              <div className="flex items-start gap-2 p-2 bg-geo-error/10 border border-geo-error/30 rounded">
                <AlertCircle className="w-3.5 h-3.5 text-geo-error flex-shrink-0 mt-0.5" />
                <span className="text-[11px] text-geo-error">{metaError}</span>
              </div>
            ) : meta && !meta.queryable ? (
              <>
                <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <span className="text-[11px] text-yellow-400">{meta.note ?? 'This resource will be downloaded and read directly.'}</span>
                </div>

                {/* Raster imagery export panel (ImageServer) */}
                {meta.imageExport && (
                  <div className="flex flex-col gap-2 p-2.5 bg-geo-bg border border-geo-border rounded">
                    <div className="flex items-end gap-3 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-geo-muted">Extent</label>
                        <div className="flex gap-1">
                          {([['view', 'Current map view'], ['full', 'Full service extent']] as const).map(([v, label]) => (
                            <button
                              key={v}
                              type="button"
                              disabled={v === 'view' && !viewBbox}
                              className={cn(
                                'px-2 py-1 rounded text-xs border',
                                imgExtent === v
                                  ? 'bg-geo-accent/15 border-geo-accent text-foreground'
                                  : 'border-geo-border text-geo-muted hover:text-foreground',
                                v === 'view' && !viewBbox && 'opacity-40 cursor-not-allowed',
                              )}
                              onClick={() => setImgExtent(v)}
                              title={v === 'view' && !viewBbox ? 'Open the Spatial Editor to use the map view' : undefined}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[11px] text-geo-muted">Resolution (long side)</label>
                        <select
                          value={IMAGE_SIZE_CHOICES.includes(imgSize) ? String(imgSize) : 'custom'}
                          onChange={(e) => { if (e.target.value !== 'custom') setImgSize(Number(e.target.value)) }}
                          className="bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                        >
                          {IMAGE_SIZE_CHOICES.map((s) => (
                            <option key={s} value={s}>{s.toLocaleString()} px</option>
                          ))}
                          {!IMAGE_SIZE_CHOICES.includes(imgSize) && <option value="custom">{imgSize.toLocaleString()} px</option>}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1 w-24">
                        <label className="text-[11px] text-geo-muted">Custom px</label>
                        <input
                          type="number"
                          min={64}
                          step={512}
                          value={imgSize}
                          onChange={(e) => setImgSize(Math.max(64, Math.floor(Number(e.target.value) || 2048)))}
                          className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground tabular-nums focus:outline-none focus:border-geo-accent"
                        />
                      </div>
                      {meta.imageExport.time && (
                        <div className="flex flex-col gap-1 min-w-[180px]">
                          <label className="text-[11px] text-geo-muted">Time (ISO)</label>
                          <input
                            type="text"
                            value={imgTime}
                            onChange={(e) => setImgTime(e.target.value)}
                            placeholder={meta.imageExport.time.default ?? 'latest'}
                            className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground font-mono focus:outline-none focus:border-geo-accent"
                          />
                          {meta.imageExport.time.extent && (
                            <span className="text-[10px] text-geo-muted">Available: {meta.imageExport.time.extent}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {imgEstimate ? (
                      <div className="flex flex-col gap-0.5 text-[11px] text-geo-muted tabular-nums">
                        <span>
                          ≈ {imgEstimate.pxW.toLocaleString()} × {imgEstimate.pxH.toLocaleString()} px
                          {' · '}{meta.imageExport.bandCount} band{meta.imageExport.bandCount === 1 ? '' : 's'}
                          {meta.imageExport.pixelType ? ` (${meta.imageExport.pixelType})` : ''}
                          {imgEstimate.metersPerPx != null && <>{' · '}{fmtRes(imgEstimate.metersPerPx)}</>}
                        </span>
                        <span>
                          Estimated size <b className="text-foreground">≈ {fmtMb(imgEstimate.megabytes)}</b> uncompressed
                          {' · '}{imgEstimate.chunks} server request{imgEstimate.chunks === 1 ? '' : 's'}
                          {imgEstimate.chunks > 9 && (
                            <span className="text-yellow-400"> — large export; expect several minutes</span>
                          )}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-geo-muted">
                        No extent available for an estimate — the code will use the full service extent.
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : meta ? (
              <>
                <div className="flex items-center gap-2 text-[11px] text-geo-muted">
                  <Database className="w-3 h-3" />
                  <span>{meta.fields.length} columns{meta.total != null ? ` · ${meta.total.toLocaleString()} rows available` : ''}{meta.spatial ? ' · spatial (sf)' : ''}</span>
                </div>

                {/* Provider guidance for query-able resources (e.g. required params) */}
                {meta.note && (
                  <div className="flex items-start gap-2 p-2 bg-geo-accent/5 border border-geo-accent/20 rounded">
                    <AlertCircle className="w-3.5 h-3.5 text-geo-accent flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-geo-muted">{meta.note}</span>
                  </div>
                )}

                {/* Import-as toggle for collections exposing COG/GeoTIFF assets */}
                {meta.rasterAssets && meta.rasterAssets.length > 0 && (
                  <div className="flex flex-col gap-1.5 p-2 bg-geo-bg border border-geo-border rounded">
                    <div className="flex gap-1">
                      {([['features', 'Footprints (sf)'], ['raster', 'Raster assets']] as const).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          className={cn(
                            'flex-1 px-2 py-1 rounded text-xs border',
                            importMode === m
                              ? 'bg-geo-accent/15 border-geo-accent text-foreground'
                              : 'border-geo-border text-geo-muted hover:text-foreground',
                          )}
                          onClick={() => setImportMode(m)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {importMode === 'features' && (
                      <p className="text-[10px] text-geo-muted">
                        Footprints import the matched items&apos; outlines + metadata as an sf table — useful for
                        checking coverage and dates before pulling the imagery itself.
                      </p>
                    )}
                    {importMode === 'raster' && (
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                          <label className="text-[11px] text-geo-muted">Asset (band/product)</label>
                          <select
                            value={assetKey}
                            onChange={(e) => setAssetKey(e.target.value)}
                            className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                          >
                            {meta.rasterAssets.map((a) => (
                              <option key={a.key} value={a.key}>
                                {a.title ? `${a.key} — ${a.title}` : a.key}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1 w-24">
                          <label className="text-[11px] text-geo-muted">Max items</label>
                          <input
                            type="number"
                            min={1}
                            value={assetMaxItems}
                            onChange={(e) => setAssetMaxItems(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                            className="w-full bg-geo-panel border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
                          />
                        </div>
                        <p className="w-full text-[10px] text-geo-muted">
                          Reads lazily via /vsicurl/ (no full download). One item → SpatRaster; several → named list. Use the filters above to pick which items match.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <QueryBuilder fields={meta.fields} query={query} onChange={setQuery} opsFor={opsFor} fetchDistinct={fetchDistinct} />

                {queryIssue && (
                  <div className="flex items-start gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                    <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <span className="text-[11px] text-yellow-400">{queryIssue}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-geo-muted">Preview (first {PREVIEW_LIMIT} rows)</span>
                  <button type="button" onClick={() => meta && runPreview(query, sel, meta)} disabled={previewLoading} className="text-[11px] text-geo-accent hover:text-geo-accent/80 flex items-center gap-0.5 disabled:opacity-50">
                    <RefreshCw className={cn('w-3 h-3', previewLoading && 'animate-spin')} /> Run preview
                  </button>
                </div>
                <RecordsPreview cols={preview?.cols ?? []} rows={preview?.rows ?? []} loading={previewLoading} error={previewError} />
              </>
            ) : null}

            {/* Variable name */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-geo-muted">Variable name</label>
              <input type="text" value={varName} onChange={(e) => setVarName(e.target.value)} className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent" />
            </div>

            {/* Raster imports can go straight onto the map */}
            {(meta?.rasterResult || rasterMode) && (
              <label className="flex items-center gap-2 cursor-pointer text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={addToMap}
                  onChange={(e) => setAddToMap(e.target.checked)}
                  className="accent-geo-accent"
                />
                Add to map when done
                <span className="text-[10px] text-geo-muted">— appears in the Spatial Editor, zoomed to the layer</span>
              </label>
            )}

            {/* R code */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-geo-muted">Generated R code</span>
              <pre className="bg-geo-bg border border-geo-border rounded p-2 text-[11px] text-foreground font-mono whitespace-pre-wrap overflow-x-auto max-h-48 shrink-0">{code || '# Select a resource'}</pre>
            </div>
          </>
        )}

        {!leafSelected && (
          <p className="text-xs text-geo-muted">Pick a server and work down the list to load data.</p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-geo-border flex-shrink-0">
        {error && <span className="text-xs text-geo-error flex-1 truncate">{error}</span>}
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleLoad} disabled={loading || probing || !canLoad}>
          {probing ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Checking layer…</>
            : loading ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Loading…</>
            : 'Load'}
        </Button>
      </div>

      {probe && (
        <CapacityDialog
          probe={probe}
          onChoose={chooseImport}
          onCancel={() => setProbe(null)}
        />
      )}
    </div>
  )
}

// ── Capacity choice dialog ──────────────────────────────────────────────────
// Shown when a server can't return the requested page size for a layer. Lets
// the user decide how much of a large, slow layer to pull.
function CapacityDialog({ probe, onChoose, onCancel }: {
  probe: CapacityProbe
  onChoose: (limit: number) => void
  onCancel: () => void
}): React.ReactElement {
  const unit = probe.unit ?? 'rows'
  const total = probe.total
  const allRows = total ?? probe.workingPageSize
  const [custom, setCustom] = useState(String(probe.choices ? (probe.choices[0]?.limit ?? 1) : probe.workingPageSize))
  const customN = Math.max(1, Math.floor(Number(custom) || 0))

  // Default (row-based) options for paginated providers; providers may supply
  // their own `choices` (e.g. SDMX offers observations-per-series).
  const options = probe.choices ?? [
    { label: 'First 10 rows', limit: 10, note: 'quick look' },
    { label: 'First chunk', limit: probe.workingPageSize, note: `${probe.workingPageSize.toLocaleString()} rows (one page)` },
    { label: 'All rows', limit: allRows, note: total != null ? `${total.toLocaleString()} rows, may be slow` : undefined },
  ]

  const title = probe.choices ? 'Large dataset' : probe.reduced ? 'Server can’t return large pages' : 'Large result set'

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-geo-panel border border-geo-border rounded-lg p-4 w-[440px] max-w-full flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
        </div>
        <p className="text-[11px] text-geo-muted leading-relaxed">
          {probe.description ? (
            probe.description
          ) : probe.reduced ? (
            <>
              This resource’s server errors when asked for {probe.requestedPageSize.toLocaleString()} detailed
              features at once. ouRGeo found it can reliably return{' '}
              <b className="text-foreground">{probe.workingPageSize.toLocaleString()}</b> rows per request
              {total != null && <>, and this query matches <b className="text-foreground">{total.toLocaleString()}</b> rows</>}.
            </>
          ) : (
            <>
              This query matches{' '}
              <b className="text-foreground">{total != null ? total.toLocaleString() : 'many'}</b> rows — far more
              than one request returns. The server delivers up to{' '}
              <b className="text-foreground">{probe.workingPageSize.toLocaleString()}</b> rows per request.
            </>
          )}
          {' '}How much would you like to import?
        </p>
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <Button key={i} variant="outline" size="sm" className="justify-start" onClick={() => onChoose(opt.limit)}>
              {opt.label}{opt.note && <span className="text-geo-muted ml-1">— {opt.note}</span>}
            </Button>
          ))}
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={1} value={custom}
              onChange={(e) => setCustom(e.target.value)}
              className="w-24 bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
            />
            <Button variant="outline" size="sm" className="flex-1 justify-start" onClick={() => onChoose(customN)}>
              Import {customN.toLocaleString()} {unit}
            </Button>
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel import</Button>
        </div>
      </div>
    </div>
  )
}

// ── Lightweight records preview table ───────────────────────────────────────
function RecordsPreview({ cols, rows, loading, error }: {
  cols: string[]; rows: Record<string, unknown>[]; loading: boolean; error: string | null
}): React.ReactElement {
  if (loading) return <div className="flex items-center gap-2 text-xs text-geo-muted py-2"><Loader2 className="w-3 h-3 animate-spin" /> Running query…</div>
  if (error) return <div className="text-[11px] text-geo-error py-1">{error}</div>
  if (cols.length === 0 || rows.length === 0) return <div className="text-[11px] text-geo-muted py-1">No rows returned for this query.</div>
  return (
    <div className="border border-geo-border rounded overflow-auto max-h-48 shrink-0">
      <table className="text-[11px] border-collapse">
        <thead className="sticky top-0 bg-geo-bg">
          <tr>{cols.map((c) => <th key={c} className="px-2 py-1 text-left font-medium text-foreground border-b border-r border-geo-border whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-white/5">
              {cols.map((c) => (
                <td key={c} className="px-2 py-1 text-geo-muted border-b border-r border-geo-border/50 whitespace-nowrap max-w-[12rem] truncate">
                  {r[c] == null ? <span className="opacity-40">NA</span> : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
