import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectFileLibrary } from './library'
import { emptyLibrary } from './catalogue'
import { fixtureEntry, fixtureExtraction } from './test-fixtures'
import { handleProjectFileRequest, startProjectFileAccess, type ProjectFileAccess, type ProjectFileAccessDeps } from './r-access'
import type { ProjectFileCatalogue } from '../../../src/lib/project-files'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step() })

const catalogue = (overrides: Partial<ProjectFileCatalogue> = {}): ProjectFileCatalogue => ({
  projectId: 'p', revision: 3, savedRevision: 3,
  files: [fixtureEntry({ name: 'sites.csv', folder: 'data', mediaType: 'text/csv' }), fixtureEntry({ id: 'linked-1', name: 'roads.gpkg', storage: { kind: 'linked', folderId: 'f1', relativePath: 'vector/roads.gpkg', fingerprint: 'x' } })],
  linkedFolders: [{ id: 'f1', name: 'Field data', status: 'ready', path: '/data/field' }],
  ...overrides,
})
const deps = (projectId: string | null = 'p', overrides: Partial<ProjectFileAccessDeps> = {}): ProjectFileAccessDeps => ({
  lease: () => ({ id: 'lease', projectId }), catalogue: () => catalogue(),
  original: vi.fn(async (id: string) => ({ path: id === 'linked-1' ? '/data/field/vector/roads.gpkg' : '/blobs/abc' })),
  put: vi.fn(async (_path, target) => ({ action: 'added' as const, id: 'n', revision: 'r', name: target.name, folder: '', bytes: 1 })),
  rescan: vi.fn(async () => catalogue()), ...overrides,
})

describe('project files, as R asks for them', () => {
  it('lists files with the name R uses, and where each one lives', async () => {
    const listed = await handleProjectFileRequest('list', {}, deps()) as { files: { target: string; location: string }[] }
    expect(listed.files.map(file => [file.target, file.location])).toEqual([['data/sites.csv', 'project'], ['roads.gpkg', 'Field data']])
  })
  it('answers scratch with an empty list, and refuses anything else by naming Save As', async () => {
    expect(await handleProjectFileRequest('list', {}, deps(null))).toEqual({ project: null, files: [], folders: [] })
    await expect(handleProjectFileRequest('resolve', { name: 'sites.csv' }, deps(null))).rejects.toThrow('Save As')
  })
  it('resolves a folder-qualified name, a bare name and a linked relative path', async () => {
    const d = deps()
    expect(await handleProjectFileRequest('resolve', { name: 'data/sites.csv' }, d)).toMatchObject({ kind: 'embedded', path: '/blobs/abc', target: 'data/sites.csv' })
    expect(await handleProjectFileRequest('resolve', { name: 'vector/roads.gpkg' }, d)).toMatchObject({ kind: 'linked', location: 'Field data' })
    await expect(handleProjectFileRequest('resolve', { name: 'site.csv' }, d)).rejects.toThrow('ourgeo_project_files()')
  })
  it('refuses a put whose writer never wrote anything', async () => {
    await expect(handleProjectFileRequest('put', { path: join(tmpdir(), 'ourgeo-never-written.csv'), name: 'x.csv' }, deps())).rejects.toThrow('Nothing was written')
  })
  it('hands out a linked folder root only when it is linked on this device', async () => {
    expect(await handleProjectFileRequest('linked', { location: 'field data' }, deps())).toMatchObject({ id: 'f1', root: '/data/field' })
    const unlinked = deps('p', { catalogue: () => catalogue({ linkedFolders: [{ id: 'f1', name: 'Field data', status: 'unlinked' }] }) })
    await expect(handleProjectFileRequest('linked', { location: 'Field data' }, unlinked)).rejects.toThrow('Relink folder')
    await expect(handleProjectFileRequest('linked', { location: 'Elsewhere' }, deps())).rejects.toThrow('"Field data"')
  })
})

describe('the loopback door', () => {
  const start = async (d = deps()): Promise<ProjectFileAccess> => { const access = await startProjectFileAccess(d); cleanup.push(() => access.close()); return access }
  const post = (access: ProjectFileAccess, route: string, headers: Record<string, string> = {}) =>
    fetch(`${access.url}/v1/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json', ...headers }, body: '{}' })
  it('answers its token and nothing else', async () => {
    const access = await start()
    expect(access.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect((await post(access, 'status')).status).toBe(200)
    expect((await post(access, 'status', { Authorization: 'Bearer wrong' })).status).toBe(403)
    // A web page could not know the token; refusing an Origin says only R talks here.
    expect((await post(access, 'status', { Origin: 'https://example.com' })).status).toBe(403)
    expect((await post(access, 'nonsense')).status).toBe(400)
  })
  it('returns the library sentence without its machine prefix', async () => {
    const access = await start(deps('p', { original: async () => { throw new Error('STALE_REFERENCE: linked bytes changed. Rescan the folder.') } }))
    const res = await fetch(`${access.url}/v1/resolve`, { method: 'POST', headers: { Authorization: `Bearer ${access.token}` }, body: JSON.stringify({ name: 'sites.csv' }) })
    expect(await res.json()).toEqual({ error: 'linked bytes changed. Rescan the folder.' })
  })
})

// The helpers end to end: real Rscript, real library, real HTTP. The server
// shares this process's event loop, so R must be spawned asynchronously.
const run = promisify(execFile)
const hasR = await run('Rscript', ['-e', 'cat(requireNamespace("curl", quietly = TRUE) && requireNamespace("jsonlite", quietly = TRUE))']).then(r => r.stdout.trim() === 'TRUE', () => false)
const hasSf = hasR && await run('Rscript', ['-e', 'cat(requireNamespace("sf", quietly = TRUE) && requireNamespace("openssl", quietly = TRUE))']).then(r => r.stdout.trim() === 'TRUE', () => false)
describe.skipIf(!hasR)('R helpers against a real library', () => {
  it('writes through ourgeo_project_path, reads back through ourgeo_project_file, and lists both', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ourgeo-r-access-')); cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const scope = { id: 'lease', projectId: 'project-r' as string | null }
    const library = new ProjectFileLibrary(join(directory, 'library'), () => scope, () => {}, async () => fixtureExtraction(), async () => Buffer.alloc(32, 7))
    cleanup.push(() => { scope.projectId = null; library.scopeChanged() })
    const incoming = join(directory, 'incoming'); await mkdir(incoming)
    await library.activate('project-r', join(directory, 'p.ourgeoproj'), emptyLibrary(), incoming, 'sig', false)
    const access = await startProjectFileAccess({ lease: () => scope, catalogue: lease => library.catalogue(lease), original: (...a) => library.original(...a), put: (...a) => library.put(...a), rescan: (...a) => library.rescanFolders(...a) })
    cleanup.push(() => access.close())
    const existing = join(directory, 'notes.txt'); await writeFile(existing, 'field notes\n')
    const script = join(directory, 'script.R')
    await writeFile(script, `
      sys.source(${JSON.stringify(resolve('r/lib/project-files.R'))}, envir = globalenv())
      df <- data.frame(site = c("A", "B"), depth = c(1.5, 2))
      write.csv(df, ourgeo_project_path("tables/sites.csv"), row.names = FALSE)
      # Write-then-read inside one command: the read commits the staged write first.
      back <- read.csv(ourgeo_project_file("tables/sites.csv"))
      stopifnot(identical(back$site, df$site), file.access(ourgeo_project_file("sites.csv"), 2) != 0)
      ourgeo_project_save(${JSON.stringify(existing)}, "reference/notes.txt", description = "From R")
      never <- ourgeo_project_path("never.csv")
      refused <- tryCatch({ ourgeo_project_path("sites.csv", overwrite = FALSE); "no" }, error = function(e) conditionMessage(e))
      stopifnot(grepl("overwrite = TRUE", refused))
      .ourgeo_pf_finish_command(function(text) cat("REPORT:", text, "\\n"))
      cat(paste(ourgeo_project_files()$file, collapse = ";"), "\\n")
    `)
    const { stdout } = await run('Rscript', [script], { env: { ...process.env, OURGEO_PROJECT_FILES_URL: access.url, OURGEO_PROJECT_FILES_TOKEN: access.token }, timeout: 60_000 })
    expect(stdout).toContain('REPORT: Project Files: nothing was written to never.csv')
    expect(stdout.trim().split('\n').pop()).toBe('tables/sites.csv;reference/notes.txt')
    const files = library.catalogue(scope.id).files
    expect(files.find(file => file.name === 'notes.txt')).toMatchObject({ folder: 'reference', userDescription: 'From R', saved: false })
    const sites = files.find(file => file.name === 'sites.csv')!
    expect(await readFile((await library.original(sites.id, sites.revision, scope.id)).path, 'utf8')).toBe('"site","depth"\n"A",1.5\n"B",2\n')
  }, 90_000)
  it.skipIf(!hasSf)('checked vector export writes a verified GeoPackage into Project Files, then adds a layer to it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ourgeo-r-vector-')); cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const scope = { id: 'lease', projectId: 'project-v' as string | null }
    const library = new ProjectFileLibrary(join(directory, 'library'), () => scope, () => {}, async () => fixtureExtraction(), async () => Buffer.alloc(32, 7))
    cleanup.push(() => { scope.projectId = null; library.scopeChanged() })
    const incoming = join(directory, 'incoming'); await mkdir(incoming)
    await library.activate('project-v', join(directory, 'p.ourgeoproj'), emptyLibrary(), incoming, 'sig', false)
    const access = await startProjectFileAccess({ lease: () => scope, catalogue: lease => library.catalogue(lease), original: (...a) => library.original(...a), put: (...a) => library.put(...a), rescan: (...a) => library.rescanFolders(...a) })
    cleanup.push(() => access.close())
    const script = join(directory, 'vector.R')
    await writeFile(script, `
      suppressPackageStartupMessages(library(sf))
      for (f in c("util-core.R", "util-env.R", "data-preflight.R", "vector-export.R", "project-files.R")) sys.source(file.path(${JSON.stringify(resolve('r/lib'))}, f), envir = globalenv())
      x <- st_sf(id = 1:2, geometry = st_sfc(st_point(c(500000, 4100000)), st_point(c(500003, 4100004)), crs = 32610))
      req <- function(layer, mode) list(operationType = "export-gpkg", inputs = list(list(name = "x")), parameters = list(path = "", projectFile = "data/points.gpkg", layer = layer, mode = mode, precision = "15"))
      run <- function(request) { report <- dq_validate(request); if (report$status == "blocked") { print(report$issues); stop("blocked") }
        dq_export_run(request, report$validationFingerprint, vapply(Filter(function(i) i$requiresAcknowledgment, report$issues), \`[[\`, "", "stableCode")) }
      first <- run(req("points", "new"))
      cat("FIRST:", first$path, "\n")
      second <- run(req("again", "add"))
      layers <- sort(st_layers(ourgeo_project_file("data/points.gpkg"))$name)
      cat("LAYERS:", paste(layers, collapse = ","), "\n")
      stopifnot(nrow(st_read(ourgeo_project_file("points.gpkg"), layer = "again", quiet = TRUE)) == 2L)
    `)
    const { stdout } = await run('Rscript', [script], { env: { ...process.env, OURGEO_PROJECT_FILES_URL: access.url, OURGEO_PROJECT_FILES_TOKEN: access.token, OURGEO_PREFLIGHT_SECRET: 'vector-project-test' }, timeout: 120_000 })
    expect(stdout).toContain('FIRST: Project Files: data/points.gpkg (save the project to keep it)')
    expect(stdout).toContain('LAYERS: again,points')
    const files = library.catalogue(scope.id).files
    expect(files.filter(file => file.name === 'points.gpkg')).toHaveLength(1)
    expect(files[0]).toMatchObject({ folder: 'data', saved: false })
  }, 150_000)
  it('tells a script outside ouRGeo what to do instead', async () => {
    const result = await run('Rscript', ['-e', `sys.source(${JSON.stringify(resolve('r/lib/project-files.R'))}, envir = globalenv()); tryCatch(ourgeo_project_file("x.csv"), error = function(e) cat(conditionMessage(e)))`], { env: { ...process.env, OURGEO_PROJECT_FILES_URL: '', OURGEO_PROJECT_FILES_TOKEN: '' } })
    expect(result.stdout).toContain('reachable only from R running inside ouRGeo')
  }, 30_000)
})
