// The provider abstraction that every Web-API connector implements. A single
// generic component (ApiConnectorBrowser) drives any provider: pick a server →
// walk the cascade → read field metadata → build a query → preview → generate R.

import type { SearchableOption } from '@/components/ui/SearchableSelect'
import type { Field, FieldKind, FilterOp, Query } from './query-model'

export type ApiCategory = 'Open Data' | 'Geospatial' | 'Raster / Image Layers' | 'Scientific' | 'Statistics'

export interface ApiServer {
  id: string
  label: string
  baseUrl: string
  /** Built-ins ship with the app and can't be removed. */
  builtin?: boolean
  /**
   * This server's own documentation, where it differs usefully from the
   * provider's.
   *
   * The distinction is real for an open-data portal: the protocol docs explain
   * SoQL, and the portal explains what is IN it and whether it is having a bad
   * day. Optional, because for most servers there is nothing to say that the
   * provider page does not.
   */
  docsUrl?: string
}

/** Runtime context handed to every provider call. */
export interface ProviderContext {
  baseUrl: string
  apiKeys: Record<string, string>
}

/** Map of selected ids per cascade level key (plus parents), e.g.
 *  { organization: 'dwr', dataset: 'pgwl', resource: 'bfa9…' }. */
export type Selection = Record<string, string>

export interface ResourceMetadata {
  fields: Field[]
  /**
   * Columns for the preview table. Defaults to the field ids — override when
   * `fields` are query *parameters* rather than data columns (e.g. Macrostrat),
   * so the preview shows what the rows actually carry.
   */
  previewColumns?: string[]
  total?: number
  /** Import as an `sf` object (true) vs a `data.frame` (false). */
  spatial: boolean
  /** Whether the query builder should be shown (false → download/notice only). */
  queryable: boolean
  /** Optional user-facing note (e.g. "not query-able — will be downloaded"). */
  note?: string
  /** Opaque per-provider capabilities surfaced to opsFor (e.g. CKAN sqlAvailable). */
  caps?: unknown
  /** Optional R code for a non-queryable resource (download & read). */
  downloadCode?: (varName: string, opts?: DownloadCodeOptions) => string
  /**
   * Raster (COG/GeoTIFF) assets the resource's items expose. When present the
   * browser offers an "Import as raster assets" mode: the user picks an asset
   * key, and buildCode is called with `opts.rasterAsset` to emit terra-based
   * import code instead of the sf footprint import.
   */
  rasterAssets?: { key: string; title?: string; type?: string }[]
  /**
   * The import produces a SpatRaster (e.g. an ArcGIS ImageServer export) —
   * the browser skips the tabular data-viewer tab after loading.
   */
  rasterResult?: boolean
  /**
   * Raster imagery export controls (ArcGIS ImageServer, OGC WCS/WMS, ERDDAP
   * griddap). When present the browser shows an extent + resolution panel with
   * a download-size estimate and passes the choices to `downloadCode` via
   * DownloadCodeOptions.
   */
  imageExport?: {
    serviceUrl: string
    name: string
    pixelType?: string
    bandCount: number
    /** Service full extent as 4326 [w, s, e, n] when derivable. */
    extent4326?: [number, number, number, number]
    /** Server-side per-request pixel cap after ouRGeo's soft cap. */
    chunkPx: number
    /** Time-enabled service (WMS TIME dimension, ERDDAP time axis): the panel
     *  shows a time input prefilled with `default`; `extent` is helper text. */
    time?: { default?: string; extent?: string }
  }
}

/** Import-flow choices handed to `downloadCode` (raster imagery exports). */
export interface DownloadCodeOptions {
  /** 4326 [w, s, e, n]; null/undefined = the service's full extent. */
  bbox?: [number, number, number, number] | null
  /** Pixels on the long side of the export. */
  size?: number
  /** exportImage request budget when the export needs many chunks. */
  maxTiles?: number
  /** ISO time slice for time-enabled services (imageExport.time present). */
  time?: string
}

export interface CascadeLevel {
  /** Stable key used in the Selection map (e.g. 'organization'). */
  key: string
  /** Human label shown above the dropdown (e.g. 'Organization'). */
  label: string
  placeholder?: string
}

/** Per-provider knobs for the final `buildCode`, set by the import flow. */
export interface BuildCodeOptions {
  /** Rows to request per server page (e.g. after a capacity probe reduced it). */
  pageSize?: number
  /**
   * Asset key from ResourceMetadata.rasterAssets — when set, the provider
   * emits raster (terra) import code for that asset instead of the tabular/sf
   * import. `rasterMaxItems` caps how many items' assets are read.
   */
  rasterAsset?: string
  rasterMaxItems?: number
}

/**
 * Result of probing how many rows a server can actually return per request.
 * Some layers advertise a page size they can't satisfy for detailed geometry
 * and error on large pages; the probe halves until requests succeed.
 */
export interface CapacityProbe {
  /** The page size we would normally request. */
  requestedPageSize: number
  /** The largest page size the server actually answered without error. */
  workingPageSize: number
  /** True when the server couldn't deliver the requested page size (drives the
   *  dialog wording: a hard server limit vs. simply a large result set). */
  reduced: boolean
  /** Whether the import-size dialog should be shown. Set per provider — Esri
   *  prompts only when the server is `reduced`; STAC also prompts for large
   *  collections that far exceed one page. */
  prompt: boolean
  /** Rows matching the current query (for "import all" and messaging). */
  total?: number
  /** Noun for the quantity chosen, shown in the dialog (default "rows"). */
  unit?: string
  /** Custom explanatory line for the dialog; overrides the default wording. */
  description?: string
  /** Provider-specific import options. When set, the dialog renders these
   *  (plus a custom field + cancel) instead of the default row-based buttons —
   *  e.g. SDMX offers observations-per-series rather than a row count. */
  choices?: CapacityChoice[]
}

/** One import-size option in the capacity dialog. */
export interface CapacityChoice {
  label: string
  /** Value handed to `buildCode` via `query.limit` (the provider interprets it). */
  limit: number
  /** Optional secondary hint (e.g. "≈22,843 rows"). */
  note?: string
}

export interface ApiProvider {
  id: string
  label: string
  category: ApiCategory
  /** One-line description shown under the provider title. */
  description: string
  /**
   * The protocol or service documentation, opened by the Help button.
   *
   * Required, for the reason `DataSource.docsUrl` is: a connector is a shell
   * over somebody else's API, and the questions it cannot answer — what an
   * operator means, why a filter was refused, what a collection contains — are
   * answered there.
   */
  docsUrl: string
  builtinServers: ApiServer[]
  /** Variable-depth cascade; the LAST level selects the queryable resource. */
  cascade: CascadeLevel[]

  /** Options for one cascade level given the selections above it. */
  listLevel(levelKey: string, sel: Selection, ctx: ProviderContext): Promise<SearchableOption[]>
  /** Field metadata + capabilities once the leaf is selected. */
  getMetadata(sel: Selection, ctx: ProviderContext): Promise<ResourceMetadata>
  /**
   * Check the current query against route rules the server won't explain
   * (e.g. Macrostrat map units need a point or an id). A returned message is
   * shown as a warning and disables Load; null/undefined means the query is
   * fine. Synchronous — no network.
   */
  validateQuery?(sel: Selection, query: Query): string | null
  /** Preview rows for the current query (the browser derives columns from
   *  getMetadata fields, falling back to row keys). `query.limit` is the preview cap. */
  preview(sel: Selection, query: Query, ctx: ProviderContext): Promise<Record<string, unknown>[]>
  /** Reproducible R import code for the current query. */
  buildCode(sel: Selection, query: Query, varName: string, ctx: ProviderContext, opts?: BuildCodeOptions): string
  /** Operators offered for a field kind (narrow per provider/caps). */
  opsFor(kind: FieldKind, caps?: unknown): FilterOp[]
  /** Distinct values for a field, to populate value dropdowns (optional). */
  distinctValues?(sel: Selection, field: string, ctx: ProviderContext): Promise<string[]>
  /**
   * Probe how many rows the server can return per request for the current
   * query (optional). The import flow calls this for multi-page imports and, if
   * the server can't deliver the requested page size, asks the user how much to
   * import before running `buildCode` with the reduced `pageSize`.
   */
  probeCapacity?(sel: Selection, query: Query, ctx: ProviderContext): Promise<CapacityProbe>
  /** A good default variable name from the current selection (optional). */
  defaultVarName?(sel: Selection): string
}
