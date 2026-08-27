// Getting data in: files, the Data Connector, and .Rgeo databases.
//
// `data.load` emits the same R the Load Data dialog emits, through the same
// `buildLoadCode` — an import the assistant performs and an import the user
// performs leave the identical line in the console.
//
// The Data Connector is a different shape: its value is the browsing, the query
// builder and the provider-specific dialects, none of which reduces to a few
// arguments. So the assistant OPENS it (optionally on a provider) and walks the
// user through it, rather than trying to be it.

import { rClient } from '@/lib/r-client'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { useDatabaseStore, type OpenDb } from '@/store/database'
import { useUiStore } from '@/store/ui'
import { buildLoadCode, detectFormat, isRasterFormat, isSpatialFormat, type DataFormat } from '@/lib/load-data-code'
import { ok, fail, argStr, argNum, argBool, type UiAction } from './types'

const FORMATS: DataFormat[] = [
  'csv', 'tsv', 'txt', 'excel', 'ods', 'json_tabular', 'parquet', 'feather',
  'sas', 'spss', 'stata', 'geojson', 'shapefile', 'kml', 'spatial', 'raster',
]

/** A legal R name from a file's base name, matching what the dialog suggests. */
function suggestVarName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'data'
  return base.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_.]/g, '_').replace(/^[^a-zA-Z.]/, '_$&')
}

function openDbByPath(path: string): OpenDb | undefined {
  const dbs = useDatabaseStore.getState().openDbs
  return dbs[path] ?? Object.values(dbs).find((d) => d.filePath.endsWith(path))
}

function dbListing(): string {
  const dbs = Object.values(useDatabaseStore.getState().openDbs)
  return dbs.length > 0 ? dbs.map((d) => d.filePath).join(', ') : '(no databases connected)'
}

export const dataActions: UiAction[] = [
  {
    id: 'data.preview',
    group: 'data',
    tier: 'autopilot',
    summary: 'Read the first rows of a data file without importing it — the dialog\'s Preview.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to the file.' },
      { name: 'format', type: 'enum', values: FORMATS, description: 'Override the format; detected from the extension otherwise.' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      const format = (argStr(args, 'format') || detectFormat(path)) as DataFormat
      const res = await rClient.previewData({ file_path: path, format })
      if (!res.success || !res.result) return fail(res.error ?? 'Preview failed.')
      const cols = res.result.columns.map((c) => `${c.name} (${c.type})`).join(', ')
      const sheets = res.result.sheet_names?.length
        ? `\nSheets: ${res.result.sheet_names.join(', ')}`
        : ''
      return ok(`${path} — detected ${format}.\nColumns: ${cols}${sheets}`)
    },
  },

  {
    id: 'data.load',
    group: 'data',
    tier: 'autopilot',
    summary:
      'Import a data file into R, generating the same code the Load Data dialog generates ' +
      '(vector, raster, tabular and spreadsheet formats). Opens the result in the Data Viewer.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Absolute path to the file.' },
      { name: 'name', type: 'string', description: 'R variable to create; derived from the file name otherwise.' },
      { name: 'format', type: 'enum', values: FORMATS, description: 'Override the detected format.' },
      { name: 'sheet', type: 'string', description: 'Excel/ODS sheet name.' },
      { name: 'delimiter', type: 'string', description: 'Field separator for delimited text.' },
      { name: 'header', type: 'boolean', default: true, description: 'First row holds column names.' },
      { name: 'skip', type: 'number', default: 0, description: 'Rows to skip before the header.' },
      { name: 'crs', type: 'string', description: 'EPSG code to assign when the file carries no CRS.' },
      { name: 'layer', type: 'string', description: 'Layer name inside a multi-layer spatial file (GeoPackage).' },
    ],
    run: async (args) => {
      const path = argStr(args, 'path')
      if (!path) return fail('path is required.')
      const format = (argStr(args, 'format') || detectFormat(path)) as DataFormat
      const varName = argStr(args, 'name') || suggestVarName(path)
      const code = buildLoadCode(varName, path, format, {
        delimiter: argStr(args, 'delimiter') || (format === 'tsv' ? '\t' : ','),
        hasHeader: argBool(args, 'header', true),
        skipRows: argNum(args, 'skip', 0),
        encoding: 'UTF-8',
        naStrings: '',
        sheet: argStr(args, 'sheet'),
        crsOverride: argStr(args, 'crs'),
        layerName: argStr(args, 'layer'),
      }, [], [])

      const session = useSessionStore.getState()
      session.addConsoleEntry('input', code)
      session.addInputHistory(code)
      const res = await rClient.execute(code)
      if (!res.success) return fail(res.error ?? `Import of "${path}" failed.`)
      if (res.output) session.addConsoleEntry('output', res.output)

      // Rasters have no tabular viewer — the console echo and the Environment
      // panel carry them, and map.addLayer puts them on the map.
      if (!isRasterFormat(format)) {
        useEditorStore.getState().addObjectTab(
          varName, '.GlobalEnv', isSpatialFormat(format) ? 'sf' : 'data.frame', varName, 'data-viewer',
        )
      }
      return ok(
        `Imported ${path} as "${varName}" (${format}).` +
        (isRasterFormat(format) ? ' Use map.addLayer to put it on the map.' : ' Opened in the Data Viewer.')
      )
    },
  },

  {
    id: 'data.connector',
    group: 'data',
    tier: 'always',
    summary:
      'Open the Data Connector — public APIs and open-data portals. The assistant cannot drive ' +
      'its query builder; open it and walk the user through the cascade.',
    params: [],
    run: () => {
      useUiStore.getState().showDialog('data-connector')
      return ok(
        'Opened the Data Connector. It has three tabs: Browse Sources (curated catalogues), ' +
        'Web APIs (14 provider families — CKAN, Socrata, Esri, OGC, STAC, ERDDAP, SDMX, OData, ' +
        'Macrostrat), and Manual (a URL you type). Whatever the user picks, the import is ' +
        'generated R echoed to the console.'
      )
    },
  },

  {
    id: 'db.list',
    group: 'data',
    tier: 'always',
    summary: 'List connected .Rgeo databases and the tables in them.',
    params: [],
    run: () => {
      const dbs = Object.values(useDatabaseStore.getState().openDbs)
      if (dbs.length === 0) return ok('No .Rgeo databases are connected.')
      const lines = dbs.map((d) =>
        `${d.filePath}: ${d.objects.map((o) => `${o.name} (${o.kind ?? 'table'})`).join(', ') || '(empty)'}`)
      return ok(lines.join('\n'))
    },
  },

  {
    id: 'db.create',
    group: 'data',
    tier: 'autopilot',
    summary: 'Create a new .Rgeo database file.',
    params: [{ name: 'path', type: 'string', required: true, description: 'Absolute path, ending .Rgeo.' }],
    run: async (args) => {
      const path = argStr(args, 'path')
      const res = await rClient.dbCreate(path)
      return res.success ? ok(`Created ${res.path ?? path}.`) : fail(res.error ?? 'Create failed.')
    },
  },

  {
    id: 'db.open',
    group: 'data',
    tier: 'autopilot',
    summary: 'Connect to an .Rgeo database and list what is inside it.',
    params: [{ name: 'path', type: 'string', required: true, description: 'Absolute path to the .Rgeo file.' }],
    run: async (args) => {
      const path = argStr(args, 'path')
      const res = await rClient.dbOpen(path)
      if (!res.success || !res.handle) return fail(res.error ?? `Could not open "${path}".`)
      const db: OpenDb = { filePath: path, handle: res.handle, objects: res.objects ?? [], expanded: true }
      useDatabaseStore.getState().setOpenDb(db)
      // Show the panel, so the user sees what just connected.
      if (!useDatabaseStore.getState().isOpen) useDatabaseStore.getState().toggleOpen()
      useSessionStore.getState().addConsoleEntry('output', `# Opened .Rgeo: ${path}\n`)
      const names = db.objects.map((o) => o.name)
      return ok(`Connected to ${path}. Contains: ${names.join(', ') || '(nothing yet)'}.`)
    },
  },

  {
    id: 'db.close',
    group: 'data',
    tier: 'autopilot',
    summary: 'Disconnect from an .Rgeo database.',
    params: [{ name: 'path', type: 'string', required: true, description: 'Path of the connected database.' }],
    run: async (args) => {
      const db = openDbByPath(argStr(args, 'path'))
      if (!db) return fail(`That database is not connected. Connected: ${dbListing()}.`)
      await rClient.dbClose(db.handle)
      useDatabaseStore.getState().removeOpenDb(db.filePath)
      return ok(`Disconnected from ${db.filePath}.`)
    },
  },

  {
    id: 'db.connectObject',
    group: 'data',
    tier: 'autopilot',
    summary:
      'Bring a table out of an .Rgeo database. "connect" makes a lazy dplyr proxy that filters ' +
      'in the database; "load" pulls the whole thing into memory.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Path of the connected database.' },
      { name: 'name', type: 'string', required: true, description: 'Table name inside the database.' },
      { name: 'varName', type: 'string', description: 'R variable to create; defaults to the table name.' },
      {
        name: 'mode', type: 'enum', values: ['connect', 'load'], default: 'connect',
        description: 'Lazy proxy, or a full in-memory copy.',
      },
    ],
    run: async (args) => {
      const db = openDbByPath(argStr(args, 'path'))
      if (!db) return fail(`That database is not connected. Connected: ${dbListing()}.`)
      const name = argStr(args, 'name')
      const varName = argStr(args, 'varName') || name
      const mode = (argStr(args, 'mode', 'connect') || 'connect') as 'connect' | 'load'
      const res = await rClient.dbConnectObject(db.handle, name, varName, mode)
      if (!res.success) return fail(res.error ?? `Could not ${mode} "${name}".`)
      return ok(`"${name}" is now available as \`${varName}\` (${mode === 'connect' ? 'lazy proxy' : 'in memory'}).`)
    },
  },

  {
    id: 'db.import',
    group: 'data',
    tier: 'autopilot',
    summary: 'Write an R object into an .Rgeo database.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Path of the connected database.' },
      { name: 'source', type: 'string', required: true, description: 'R variable to store.' },
      { name: 'name', type: 'string', description: 'Name to store it under; defaults to the variable name.' },
      { name: 'notes', type: 'string', description: 'Free-text note saved alongside it.' },
    ],
    run: async (args) => {
      const db = openDbByPath(argStr(args, 'path'))
      if (!db) return fail(`That database is not connected. Connected: ${dbListing()}.`)
      const source = argStr(args, 'source')
      const target = argStr(args, 'name') || source
      const res = await rClient.dbImportObject(db.handle, source, target, argStr(args, 'notes') || undefined)
      if (!res.success) return fail(res.error ?? `Could not store "${source}".`)
      const listed = await rClient.dbListObjects(db.handle)
      if (listed.success && listed.objects) {
        useDatabaseStore.getState().setObjects(db.filePath, listed.objects)
      }
      return ok(`Stored \`${source}\` in ${db.filePath} as "${target}".`)
    },
  },

  {
    id: 'db.deleteObject',
    group: 'data',
    // Removes data from a file on disk.
    tier: 'confirm',
    summary: 'Delete a table from an .Rgeo database.',
    params: [
      { name: 'path', type: 'string', required: true, description: 'Path of the connected database.' },
      { name: 'name', type: 'string', required: true, description: 'Table to delete.' },
    ],
    run: async (args) => {
      const db = openDbByPath(argStr(args, 'path'))
      if (!db) return fail(`That database is not connected. Connected: ${dbListing()}.`)
      const name = argStr(args, 'name')
      const res = await rClient.dbDeleteObject(db.handle, name)
      if (!res.success) return fail(res.error ?? `Could not delete "${name}".`)
      const listed = await rClient.dbListObjects(db.handle)
      if (listed.success && listed.objects) {
        useDatabaseStore.getState().setObjects(db.filePath, listed.objects)
      }
      return ok(`Deleted "${name}" from ${db.filePath}.`)
    },
  },
]
