// ── Raster tool definitions (terra) ─────────────────────────────────────────
// The "Spatial — Raster" toolbox category. All tools emit plain terra:: / sf::
// R code echoed to the console, like every other toolbox tool. Raster dataset
// fields use ids that are NOT 'ds' so the dplyr pipeline system never engages.

import type { ToolDef, FieldDef, Values, DatasetMeta } from './tools'
import { dsRef } from './tools'

/** Bare reference to a raster input (rasters are never db-lazy). */
function rr(v: Values, key = 'r', fallback = 'raster'): string {
  return v[key] || fallback
}

/** Materialize-aware reference for sf inputs feeding terra::vect(). */
function sfRef(v: Values, meta: DatasetMeta | undefined, key: string): string {
  return dsRef(v, meta, key, 'materialized', 'sf_data')
}

function out(v: Values): string {
  return v.out || 'result'
}

/** Quote an R string. */
function rStr(val: string): string {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Number with fallback. */
function num(v: string | undefined, fallback: number): string {
  const t = (v ?? '').trim()
  return t !== '' && Number.isFinite(Number(t)) ? t : String(fallback)
}

/** 1-based band index (band fields store the index as a string). */
function band(v: string | undefined, fallback = 1): string {
  return num(v, fallback)
}

const R_FIELD: FieldDef = { id: 'r', label: 'Raster', type: 'dataset', filter: 'raster' }

const METHOD_FIELD: FieldDef = {
  id: 'method', label: 'Resampling Method', type: 'select',
  options: [
    { value: 'bilinear', label: 'Bilinear (continuous)' },
    { value: 'near', label: 'Nearest neighbor (categorical)' },
    { value: 'cubic', label: 'Cubic' },
    { value: 'cubicspline', label: 'Cubic spline' },
  ],
}

const STAT_OPTIONS = [
  { value: 'mean', label: 'Mean' },
  { value: 'sum', label: 'Sum' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
  { value: 'median', label: 'Median' },
  { value: 'modal', label: 'Majority (modal)' },
  { value: 'sd', label: 'Std. deviation' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Processing
// ─────────────────────────────────────────────────────────────────────────────

const processingOps: ToolDef[] = [
  {
    id: 'raster-project',
    label: 'Reproject Raster',
    description: 'Warp a raster to a different coordinate reference system.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'crs', label: 'Target CRS (EPSG code or CRS string)', type: 'text', placeholder: 'e.g. 32610 or EPSG:3857' },
      METHOD_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_proj` : '' },
    ],
    buildCode: v => {
      const crs = (v.crs || '4326').trim()
      const crsStr = /^\d+$/.test(crs) ? `EPSG:${crs}` : crs
      return `${out(v)} <- terra::project(${rr(v)}, ${rStr(crsStr)}, method = ${rStr(v.method || 'bilinear')})`
    },
  },
  {
    id: 'raster-crop',
    label: 'Clip (Crop) Raster',
    description: 'Cut a raster down to a polygon layer or a manual extent; masking also blanks cells outside the polygons.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'by', label: 'Clip By', type: 'select', options: [
        { value: 'vector', label: 'Vector layer' },
        { value: 'extent', label: 'Manual extent' },
      ]},
      { id: 'v', label: 'Clip Layer (sf)', type: 'dataset', filter: 'sf', visibleWhen: v => v.by !== 'extent' },
      { id: 'mask', label: 'Mask cells outside the polygons (not just the bounding box)', type: 'checkbox', default: true, visibleWhen: v => v.by !== 'extent' },
      { id: 'xmin', label: 'xmin', type: 'number', visibleWhen: v => v.by === 'extent' },
      { id: 'xmax', label: 'xmax', type: 'number', visibleWhen: v => v.by === 'extent' },
      { id: 'ymin', label: 'ymin', type: 'number', visibleWhen: v => v.by === 'extent' },
      { id: 'ymax', label: 'ymax', type: 'number', visibleWhen: v => v.by === 'extent' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_clip` : '' },
    ],
    buildCode: (v, meta) => {
      if (v.by === 'extent') {
        return `${out(v)} <- terra::crop(${rr(v)}, terra::ext(${num(v.xmin, 0)}, ${num(v.xmax, 1)}, ${num(v.ymin, 0)}, ${num(v.ymax, 1)}))`
      }
      const maskArg = v.mask !== 'false' ? ', mask = TRUE' : ''
      return `${out(v)} <- terra::crop(${rr(v)}, terra::vect(${sfRef(v, meta, 'v')})${maskArg})`
    },
  },
  {
    id: 'raster-mask',
    label: 'Mask Raster',
    description: 'Set cells to NA where a mask layer (vector or raster) is absent — or present, with Inverse.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'by', label: 'Mask With', type: 'select', options: [
        { value: 'vector', label: 'Vector layer' },
        { value: 'raster', label: 'Another raster' },
      ]},
      { id: 'v', label: 'Mask Layer (sf)', type: 'dataset', filter: 'sf', visibleWhen: v => v.by !== 'raster' },
      { id: 'mr', label: 'Mask Raster', type: 'dataset', filter: 'raster', visibleWhen: v => v.by === 'raster' },
      { id: 'inverse', label: 'Inverse (mask where the layer IS present)', type: 'checkbox', default: false },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_mask` : '' },
    ],
    buildCode: (v, meta) => {
      const inv = v.inverse === 'true' ? ', inverse = TRUE' : ''
      const maskExpr = v.by === 'raster' ? rr(v, 'mr', 'mask_raster') : `terra::vect(${sfRef(v, meta, 'v')})`
      return `${out(v)} <- terra::mask(${rr(v)}, ${maskExpr}${inv})`
    },
  },
  {
    id: 'raster-resample',
    label: 'Resample Raster',
    description: 'Transfer values onto the grid of a template raster, or onto a new cell size.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'by', label: 'Resample To', type: 'select', options: [
        { value: 'template', label: 'Template raster grid' },
        { value: 'res', label: 'New cell size' },
      ]},
      { id: 'template', label: 'Template Raster', type: 'dataset', filter: 'raster', visibleWhen: v => v.by !== 'res' },
      { id: 'res', label: 'Cell Size (CRS units)', type: 'number', min: 0, visibleWhen: v => v.by === 'res' },
      METHOD_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_resampled` : '' },
    ],
    buildCode: v => {
      const method = rStr(v.method || 'bilinear')
      if (v.by === 'res') {
        return `${out(v)} <- terra::resample(${rr(v)}, terra::rast(terra::ext(${rr(v)}), resolution = ${num(v.res, 100)}, crs = terra::crs(${rr(v)})), method = ${method})`
      }
      return `${out(v)} <- terra::resample(${rr(v)}, ${rr(v, 'template', 'template')}, method = ${method})`
    },
  },
  {
    id: 'raster-aggregate',
    label: 'Aggregate (Coarsen)',
    description: 'Reduce resolution by combining blocks of cells with a statistic.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'fact', label: 'Factor (cells per block side)', type: 'number', min: 2, step: 1, default: '2' },
      { id: 'fun', label: 'Statistic', type: 'select', options: STAT_OPTIONS },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_agg` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::aggregate(${rr(v)}, fact = ${num(v.fact, 2)}, fun = ${rStr(v.fun || 'mean')}, na.rm = TRUE)`,
  },
  {
    id: 'raster-disagg',
    label: 'Disaggregate (Refine)',
    description: 'Increase resolution by splitting each cell into smaller cells.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'fact', label: 'Factor (subdivisions per cell side)', type: 'number', min: 2, step: 1, default: '2' },
      { id: 'method', label: 'Method', type: 'select', options: [
        { value: 'near', label: 'Nearest (duplicate values)' },
        { value: 'bilinear', label: 'Bilinear (smooth)' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_disagg` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::disagg(${rr(v)}, fact = ${num(v.fact, 2)}, method = ${rStr(v.method || 'near')})`,
  },
  {
    id: 'raster-mosaic',
    label: 'Merge / Mosaic',
    description: 'Combine two overlapping rasters into one. Merge keeps the first raster’s values in overlaps; Mosaic combines them with a statistic.',
    output: 'raster',
    fields: [
      { id: 'r', label: 'Raster 1', type: 'dataset', filter: 'raster' },
      { id: 'r2', label: 'Raster 2', type: 'dataset', filter: 'raster' },
      { id: 'op', label: 'Operation', type: 'select', options: [
        { value: 'merge', label: 'Merge (first wins)' },
        { value: 'mosaic', label: 'Mosaic (combine overlaps)' },
      ]},
      { id: 'fun', label: 'Overlap Statistic', type: 'select', options: STAT_OPTIONS, visibleWhen: v => v.op === 'mosaic' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_mosaic` : '' },
    ],
    buildCode: v =>
      v.op === 'mosaic'
        ? `${out(v)} <- terra::mosaic(${rr(v)}, ${rr(v, 'r2', 'raster2')}, fun = ${rStr(v.fun || 'mean')})`
        : `${out(v)} <- terra::merge(${rr(v)}, ${rr(v, 'r2', 'raster2')})`,
  },
  {
    id: 'raster-reclassify',
    label: 'Reclassify',
    description: 'Map value ranges to new values. Enter one rule per range as "from,to,new", separated by semicolons — e.g. 0,50,1; 50,100,2.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'rules', label: 'Rules (from,to,new; …)', type: 'text', placeholder: '0,50,1; 50,100,2; 100,255,3' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_reclass` : '' },
    ],
    buildCode: v => {
      const nums = (v.rules || '')
        .split(';')
        .map(rule => rule.split(',').map(s => s.trim()).filter(Boolean))
        .filter(parts => parts.length === 3)
        .flat()
      const body = nums.length >= 3 ? nums.join(', ') : '0, 1, 1'
      return `${out(v)} <- terra::classify(${rr(v)}, rcl = matrix(c(${body}), ncol = 3, byrow = TRUE), include.lowest = TRUE)`
    },
  },
  {
    id: 'raster-calculator',
    label: 'Raster Calculator',
    description: 'Evaluate a map-algebra expression. Reference the rasters as A and B, e.g. (A - B) / (A + B) or A * 2 + 10.',
    output: 'raster',
    fields: [
      { id: 'r', label: 'Raster A', type: 'dataset', filter: 'raster' },
      { id: 'r2', label: 'Raster B (optional)', type: 'dataset', filter: 'raster', optional: true },
      { id: 'expr', label: 'Expression', type: 'text', placeholder: '(A - B) / (A + B)', default: 'A' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_calc` : '' },
    ],
    buildCode: v => {
      const expr = (v.expr || 'A').trim()
      const bLine = v.r2 ? `\n  B <- ${rr(v, 'r2', 'raster_b')}` : ''
      return `${out(v)} <- local({\n  A <- ${rr(v)}${bLine}\n  ${expr}\n})`
    },
  },
  {
    id: 'raster-focal',
    label: 'Focal Statistics',
    description: 'Moving-window statistic over each cell’s neighborhood (smoothing, texture, neighborhood sums).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'w', label: 'Window Size (odd number of cells)', type: 'number', min: 3, step: 2, default: '3' },
      { id: 'fun', label: 'Statistic', type: 'select', options: STAT_OPTIONS },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_focal` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::focal(${rr(v)}, w = ${num(v.w, 3)}, fun = ${rStr(v.fun || 'mean')}, na.rm = TRUE)`,
  },
  {
    id: 'raster-terrain',
    label: 'Terrain Analysis',
    description: 'Derive slope, aspect, TPI, TRI, roughness, or flow direction from an elevation raster.',
    output: 'raster',
    fields: [
      { id: 'r', label: 'Elevation Raster (DEM)', type: 'dataset', filter: 'raster' },
      { id: 'v', label: 'Measure', type: 'select', options: [
        { value: 'slope', label: 'Slope' },
        { value: 'aspect', label: 'Aspect' },
        { value: 'TPI', label: 'Topographic Position Index' },
        { value: 'TRI', label: 'Terrain Ruggedness Index' },
        { value: 'roughness', label: 'Roughness' },
        { value: 'flowdir', label: 'Flow direction' },
      ]},
      { id: 'unit', label: 'Units', type: 'select', options: [
        { value: 'degrees', label: 'Degrees' },
        { value: 'radians', label: 'Radians' },
      ], visibleWhen: v => v.v === 'slope' || v.v === 'aspect' || !v.v },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_${(v.v || 'slope').toLowerCase()}` : '' },
    ],
    buildCode: v => {
      const measure = v.v || 'slope'
      const unit = (measure === 'slope' || measure === 'aspect')
        ? `, unit = ${rStr(v.unit || 'degrees')}` : ''
      return `${out(v)} <- terra::terrain(${rr(v, 'r', 'dem')}, v = ${rStr(measure)}${unit})`
    },
  },
  {
    id: 'raster-hillshade',
    label: 'Hillshade',
    description: 'Shaded relief from an elevation raster and a sun position.',
    output: 'raster',
    fields: [
      { id: 'r', label: 'Elevation Raster (DEM)', type: 'dataset', filter: 'raster' },
      { id: 'angle', label: 'Sun Altitude (°)', type: 'number', min: 0, step: 5, default: '45' },
      { id: 'direction', label: 'Sun Azimuth (°)', type: 'number', min: 0, step: 15, default: '315' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_hillshade` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- local({\n  slope  <- terra::terrain(${rr(v, 'r', 'dem')}, v = "slope",  unit = "radians")\n  aspect <- terra::terrain(${rr(v, 'r', 'dem')}, v = "aspect", unit = "radians")\n  terra::shade(slope, aspect, angle = ${num(v.angle, 45)}, direction = ${num(v.direction, 315)})\n})`,
  },
  {
    id: 'raster-distance',
    label: 'Distance Raster',
    description: 'Distance from every NA cell to the nearest non-NA cell.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_dist` : '' },
    ],
    buildCode: v => `${out(v)} <- terra::distance(${rr(v)})`,
  },
  {
    id: 'raster-trim',
    label: 'Trim NA Edges',
    description: 'Remove outer rows and columns that are entirely NA.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_trim` : '' },
    ],
    buildCode: v => `${out(v)} <- terra::trim(${rr(v)})`,
  },
  {
    id: 'raster-extend',
    label: 'Extend Extent',
    description: 'Grow the raster by a number of NA rows/columns on every side.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'cells', label: 'Cells to Add (each side)', type: 'number', min: 1, step: 1, default: '10' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_ext` : '' },
    ],
    buildCode: v => `${out(v)} <- terra::extend(${rr(v)}, ${num(v.cells, 10)})`,
  },
  {
    id: 'raster-set-nodata',
    label: 'Set NoData Value',
    description: 'Convert a specific cell value to NA (e.g. a -9999 fill value).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'value', label: 'Value to Treat as NoData', type: 'number', default: '-9999' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_na` : '' },
    ],
    buildCode: v => `${out(v)} <- terra::classify(${rr(v)}, cbind(${num(v.value, -9999)}, NA))`,
  },
  {
    id: 'raster-rescale',
    label: 'Rescale / Stretch Values',
    description: 'Linearly stretch cell values into a new range (per band).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'minv', label: 'New Minimum', type: 'number', default: '0' },
      { id: 'maxv', label: 'New Maximum', type: 'number', default: '255' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_scaled` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::stretch(${rr(v)}, minv = ${num(v.minv, 0)}, maxv = ${num(v.maxv, 255)})`,
  },
  {
    id: 'raster-fill-na',
    label: 'Fill NoData Gaps',
    description: 'Fill NA cells from the mean of their neighborhood (leaves data cells untouched).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'w', label: 'Window Size (odd number of cells)', type: 'number', min: 3, step: 2, default: '5' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_filled` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::focal(${rr(v)}, w = ${num(v.w, 5)}, fun = "mean", na.policy = "only", na.rm = TRUE)`,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Multi-band
// ─────────────────────────────────────────────────────────────────────────────

const bandOps: ToolDef[] = [
  {
    id: 'raster-subset-bands',
    label: 'Select / Reorder Bands',
    description: 'Keep only the chosen bands, in the chosen order.',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'bands', label: 'Bands', type: 'band', datasetField: 'r', multi: true },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_bands` : '' },
    ],
    buildCode: v => {
      const idx = (v.bands || '1').split(',').map(s => s.trim()).filter(Boolean)
      return `${out(v)} <- terra::subset(${rr(v)}, c(${idx.join(', ')}))`
    },
  },
  {
    id: 'raster-stack',
    label: 'Stack Bands',
    description: 'Combine two rasters on the same grid into one multi-band raster.',
    output: 'raster',
    fields: [
      { id: 'r', label: 'Raster 1', type: 'dataset', filter: 'raster' },
      { id: 'r2', label: 'Raster 2', type: 'dataset', filter: 'raster' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_stack` : '' },
    ],
    buildCode: v => `${out(v)} <- c(${rr(v)}, ${rr(v, 'r2', 'raster2')})`,
  },
  {
    id: 'raster-rename-bands',
    label: 'Rename Bands',
    description: 'Assign new band names (comma-separated, one per band).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'names', label: 'New Names (comma-separated)', type: 'text', placeholder: 'red, green, blue' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_renamed` : '' },
    ],
    buildCode: v => {
      const names = (v.names || '')
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(n => rStr(n)).join(', ')
      return `${out(v)} <- ${rr(v)}\nnames(${out(v)}) <- c(${names || '"band_1"'})`
    },
  },
  {
    id: 'raster-band-index',
    label: 'Band Index (NDVI, NDWI, …)',
    description: 'Normalized difference of two bands: (B1 − B2) / (B1 + B2). NDVI = (NIR − Red), NDWI = (Green − NIR), NDBI = (SWIR − NIR).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'b1', label: 'Band 1 (e.g. NIR for NDVI)', type: 'band', datasetField: 'r' },
      { id: 'b2', label: 'Band 2 (e.g. Red for NDVI)', type: 'band', datasetField: 'r' },
      { id: 'name', label: 'Index Name', type: 'text', default: 'ndvi' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_${(v.name || 'index').trim() || 'index'}` : '' },
    ],
    buildCode: v => {
      const nm = (v.name || 'index').trim() || 'index'
      return `${out(v)} <- local({\n  b1 <- ${rr(v)}[[${band(v.b1, 1)}]]\n  b2 <- ${rr(v)}[[${band(v.b2, 2)}]]\n  idx <- (b1 - b2) / (b1 + b2)\n  names(idx) <- ${rStr(nm)}\n  idx\n})`
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Raster ↔ Vector
// ─────────────────────────────────────────────────────────────────────────────

const rasterVectorOps: ToolDef[] = [
  {
    id: 'raster-rasterize',
    label: 'Rasterize Vector',
    description: 'Burn vector features into raster cells, onto a template grid or a new cell size.',
    output: 'raster',
    fields: [
      { id: 'v', label: 'Vector Layer (sf)', type: 'dataset', filter: 'sf' },
      { id: 'field', label: 'Value Column (blank = presence 1)', type: 'column', datasetField: 'v' },
      { id: 'by', label: 'Grid From', type: 'select', options: [
        { value: 'res', label: 'New cell size' },
        { value: 'template', label: 'Template raster' },
      ]},
      { id: 'res', label: 'Cell Size (CRS units)', type: 'number', min: 0, visibleWhen: v => v.by !== 'template' },
      { id: 'template', label: 'Template Raster', type: 'dataset', filter: 'raster', visibleWhen: v => v.by === 'template' },
      { id: 'fun', label: 'Overlap Statistic', type: 'select', options: STAT_OPTIONS },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.v ? `${v.v}_raster` : '' },
    ],
    buildCode: (v, meta) => {
      const vect = `terra::vect(${sfRef(v, meta, 'v')})`
      const grid = v.by === 'template'
        ? rr(v, 'template', 'template')
        : `terra::rast(${vect}, resolution = ${num(v.res, 100)})`
      const fieldArg = v.field ? `field = ${rStr(v.field)}, ` : ''
      return `${out(v)} <- terra::rasterize(${vect}, ${grid}, ${fieldArg}fun = ${rStr(v.fun || 'mean')})`
    },
  },
  {
    id: 'raster-to-points',
    label: 'Raster to Points',
    description: 'One point per non-NA cell, with the cell values as attributes.',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_pts` : '' },
    ],
    buildCode: v => `${out(v)} <- sf::st_as_sf(terra::as.points(${rr(v)}, na.rm = TRUE))`,
  },
  {
    id: 'raster-to-polygons',
    label: 'Raster to Polygons',
    description: 'Polygonize cells; Dissolve merges adjacent cells with equal values into single polygons.',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'dissolve', label: 'Dissolve equal-valued neighbors', type: 'checkbox', default: true },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_polys` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- sf::st_as_sf(terra::as.polygons(${rr(v)}, dissolve = ${v.dissolve !== 'false' ? 'TRUE' : 'FALSE'}, na.rm = TRUE))`,
  },
  {
    id: 'raster-contours',
    label: 'Contours from Raster',
    description: 'Generate contour lines from a continuous raster (e.g. elevation).',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'nlevels', label: 'Number of Contour Levels', type: 'number', min: 2, step: 1, default: '10' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_contours` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- sf::st_as_sf(terra::as.contour(${rr(v)}, nlevels = ${num(v.nlevels, 10)}))`,
  },
  {
    id: 'raster-extract-points',
    label: 'Extract Values to Points',
    description: 'Sample the raster at each point — the points gain one attribute column per band.',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'pts', label: 'Point Layer (sf)', type: 'dataset', filter: 'sf' },
      { id: 'method', label: 'Sampling', type: 'select', options: [
        { value: 'simple', label: 'Cell value (simple)' },
        { value: 'bilinear', label: 'Interpolated (bilinear)' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.pts ? `${v.pts}_values` : '' },
    ],
    buildCode: (v, meta) =>
      `${out(v)} <- sf::st_as_sf(terra::extract(${rr(v)}, terra::vect(${sfRef(v, meta, 'pts')}), method = ${rStr(v.method || 'simple')}, bind = TRUE))`,
  },
  {
    id: 'raster-zonal-stats',
    label: 'Zonal Statistics',
    description: 'Summarize raster values inside each polygon (e.g. mean elevation per district) — the summary joins onto the polygons as new columns.',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'zones', label: 'Zone Polygons (sf)', type: 'dataset', filter: 'sf' },
      { id: 'fun', label: 'Statistic', type: 'select', options: [
        { value: 'mean', label: 'Mean' },
        { value: 'sum', label: 'Sum' },
        { value: 'min', label: 'Minimum' },
        { value: 'max', label: 'Maximum' },
        { value: 'median', label: 'Median' },
        { value: 'sd', label: 'Std. deviation' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.zones ? `${v.zones}_zonal` : '' },
    ],
    buildCode: (v, meta) => {
      const zones = sfRef(v, meta, 'zones')
      return `${out(v)} <- local({\n  zonal <- terra::extract(${rr(v)}, terra::vect(${zones}), fun = ${v.fun || 'mean'}, na.rm = TRUE, ID = FALSE)\n  dplyr::bind_cols(${zones}, zonal)\n})`
    },
  },
  {
    id: 'raster-sample',
    label: 'Sample Raster to Points',
    description: 'Draw random or regular sample points across the raster, carrying the cell values.',
    output: 'spatial',
    fields: [
      R_FIELD,
      { id: 'size', label: 'Number of Points', type: 'number', min: 1, step: 100, default: '1000' },
      { id: 'method', label: 'Method', type: 'select', options: [
        { value: 'random', label: 'Random' },
        { value: 'regular', label: 'Regular grid' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_sample` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- sf::st_as_sf(terra::spatSample(${rr(v)}, size = ${num(v.size, 1000)}, method = ${rStr(v.method || 'random')}, as.points = TRUE, na.rm = TRUE))`,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Conversion & statistics
// ─────────────────────────────────────────────────────────────────────────────

const conversionOps: ToolDef[] = [
  {
    id: 'raster-to-df',
    label: 'Raster to Data Frame',
    description: 'One row per non-NA cell with x/y coordinates and band values.',
    output: 'table',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_df` : '' },
    ],
    buildCode: v => `${out(v)} <- as.data.frame(${rr(v)}, xy = TRUE, na.rm = TRUE)`,
  },
  {
    id: 'raster-from-xyz',
    label: 'XYZ Data Frame to Raster',
    description: 'Build a raster from a data frame whose first columns are x, y, value(s) on a regular grid.',
    output: 'raster',
    fields: [
      { id: 'df', label: 'Data Frame', type: 'dataset', filter: 'any' },
      { id: 'crs', label: 'CRS (EPSG code or CRS string)', type: 'text', placeholder: 'e.g. 4326', default: '4326' },
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.df ? `${v.df}_raster` : '' },
    ],
    buildCode: (v, meta) => {
      const crs = (v.crs || '4326').trim()
      const crsStr = /^\d+$/.test(crs) ? `EPSG:${crs}` : crs
      return `${out(v)} <- terra::rast(${dsRef(v, meta, 'df', 'materialized', 'df')}, type = "xyz", crs = ${rStr(crsStr)})`
    },
  },
  {
    id: 'raster-global-stats',
    label: 'Global Statistics',
    description: 'Whole-raster statistics per band (mean, min, max, sum, sd).',
    output: 'table',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_stats` : '' },
    ],
    buildCode: v =>
      `${out(v)} <- terra::global(${rr(v)}, fun = c("mean", "min", "max", "sum", "sd"), na.rm = TRUE)`,
  },
  {
    id: 'raster-freq',
    label: 'Cell Value Frequency',
    description: 'Count how many cells hold each value (categorical/integer rasters).',
    output: 'table',
    fields: [
      R_FIELD,
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_freq` : '' },
    ],
    buildCode: v => `${out(v)} <- as.data.frame(terra::freq(${rr(v)}))`,
  },
  {
    id: 'raster-write',
    label: 'Export Raster to File',
    description: 'Write the raster to disk as a GeoTIFF or Cloud-Optimized GeoTIFF (COG).',
    output: 'raster',
    fields: [
      R_FIELD,
      { id: 'path', label: 'Output File Path', type: 'text', placeholder: '/path/to/output.tif' },
      { id: 'format', label: 'Format', type: 'select', options: [
        { value: 'gtiff', label: 'GeoTIFF (DEFLATE)' },
        { value: 'cog', label: 'Cloud-Optimized GeoTIFF' },
      ]},
      { id: 'out', label: 'Output Name', type: 'output-name', derive: v => v.r ? `${v.r}_written` : '' },
    ],
    buildCode: v => {
      const path = rStr(v.path || 'output.tif')
      if (v.format === 'cog') {
        return `${out(v)} <- terra::writeRaster(${rr(v)}, ${path}, overwrite = TRUE, filetype = "COG", gdal = c("COMPRESS=DEFLATE"))`
      }
      return `${out(v)} <- terra::writeRaster(${rr(v)}, ${path}, overwrite = TRUE, gdal = c("COMPRESS=DEFLATE", "TILED=YES"))`
    },
  },
]

export const rasterOps: ToolDef[] = [
  ...processingOps,
  ...bandOps,
  ...rasterVectorOps,
  ...conversionOps,
]
