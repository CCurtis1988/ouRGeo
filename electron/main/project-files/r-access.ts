import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { ProjectFileCatalogue, ProjectFilePutResult, ProjectFilePutTarget } from '../../../src/lib/project-files'
import { formatProjectFileTarget, projectFileLocationName, resolveProjectFile } from '../../../src/lib/project-file-targets'

/**
 * Project Files, as seen from R.
 *
 * The library's originals live in main, inside a bundle R cannot open, and R
 * talks to nobody but the renderer — over a channel that only runs while R is
 * NOT busy. That rules out the obvious route for exactly the calls this exists
 * for: `read.csv(ourgeo_project_file("sites.csv"))` needs a path while R is in
 * the middle of evaluating, so R cannot wait for the renderer to ask main and
 * post the answer back. So R asks main itself, over a loopback HTTP server,
 * the house pattern for a child that needs a door into ouRGeo (`claude-mcp.ts`).
 *
 * Bound to 127.0.0.1 on a random port, guarded by a per-launch bearer token
 * handed to R in its environment (and to the knit child, so a document using
 * these helpers knits the way it runs). Holding the token grants exactly what
 * the user's R session already has: R can read and write the user's files
 * anyway. What it does NOT grant is a path into ouRGeo's own storage to write:
 * every write goes through `ProjectFileLibrary.put`, which copies, hashes and
 * journals it like an import, so a script cannot corrupt the bundle's blobs.
 */

export interface ProjectFileAccessDeps {
  lease: () => { id: string; projectId: string | null }
  catalogue: (lease: string) => ProjectFileCatalogue
  original: (id: string, revision: string, lease: string) => Promise<{ path: string }>
  put: (path: string, target: ProjectFilePutTarget, lease: string) => Promise<ProjectFilePutResult>
  rescan: (ids: string[], lease: string) => Promise<ProjectFileCatalogue>
}

const SCRATCH = 'This is the scratch workspace, which has no Project Files. Save the project (Project menu > Save As...) and run this again.'
const text = (value: unknown, field: string, max = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`"${field}" must be a non-empty string.`)
  return value
}
const optional = (value: unknown, field: string, max = 4000): string | undefined => value === undefined || value === null ? undefined : (typeof value === 'string' && value.length <= max && !value.includes('\0') ? value : (() => { throw new Error(`"${field}" must be a string.`) })())

/** One request, no HTTP. Exported so the routing is testable without a socket. */
export async function handleProjectFileRequest(route: string, body: Record<string, unknown>, deps: ProjectFileAccessDeps): Promise<unknown> {
  const lease = deps.lease()
  if (route === 'status') return { project: lease.projectId }
  if (!lease.projectId) {
    if (route === 'list') return { project: null, files: [], folders: [] }
    throw new Error(SCRATCH)
  }
  const catalogue = deps.catalogue(lease.id)
  switch (route) {
    case 'list':
      return {
        project: lease.projectId,
        files: catalogue.files.map(file => ({
          name: file.name, folder: file.folder, target: formatProjectFileTarget(file),
          location: projectFileLocationName(file, catalogue), mediaType: file.mediaType, bytes: file.bytes,
          saved: file.saved, status: file.status, updated: file.updatedAt, description: file.userDescription,
          ...(file.storage ? { relativePath: file.storage.relativePath } : {}),
        })),
        folders: (catalogue.linkedFolders ?? []).map(folder => ({ name: folder.name, status: folder.status })),
      }
    case 'resolve': {
      const location = optional(body.location, 'location', 240)
      const file = resolveProjectFile(catalogue, text(body.name, 'name'), location)
      if (file.storage && !file.sha256) throw new Error(`"${file.name}" is listed from its linked folder but is larger than the 100 MiB the library reads. Open it from the folder directly.`)
      const { path } = await deps.original(file.id, file.revision, lease.id)
      return { path, kind: file.storage ? 'linked' : 'embedded', name: file.name, folder: file.folder, target: formatProjectFileTarget(file), sha256: file.sha256, bytes: file.bytes, mediaType: file.mediaType, location: projectFileLocationName(file, catalogue) }
    }
    case 'put': {
      const path = text(body.path, 'path', 8192)
      if (!isAbsolute(path)) throw new Error('Pass an absolute path to the file to save.')
      const info = await stat(path).catch(() => null)
      if (!info?.isFile()) throw new Error(`Nothing was written to ${path}, so there is nothing to save. Check that the writing function succeeded.`)
      const role = optional(body.role, 'role', 20)
      if (role !== undefined && !['reference', 'standard', 'example'].includes(role)) throw new Error('Choose role = "reference", "standard" or "example".')
      return deps.put(path, {
        name: text(body.name, 'name'), folder: optional(body.folder, 'folder', 500), description: optional(body.description, 'description'),
        ...(role ? { role: role as ProjectFilePutTarget['role'] } : {}), overwrite: body.overwrite !== false,
      }, lease.id)
    }
    case 'linked': {
      const name = text(body.location, 'location', 240)
      const folder = catalogue.linkedFolders?.find(folder => folder.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
      if (!folder) throw new Error(`No linked folder is called "${name}". Linked folders: ${(catalogue.linkedFolders ?? []).map(f => `"${f.name}"`).join(', ') || 'none'}. Use location = "project" to save inside the project bundle.`)
      if (!folder.path) throw new Error(`"${folder.name}" is not linked on this device. Use Relink folder... in Project Files, then run this again.`)
      return { id: folder.id, name: folder.name, root: folder.path, status: folder.status }
    }
    case 'rescan': {
      const id = text(body.id, 'id', 200)
      if (!catalogue.linkedFolders?.some(folder => folder.id === id)) throw new Error('That linked folder is no longer part of this project.')
      const after = await deps.rescan([id], lease.id)
      const folder = after.linkedFolders?.find(folder => folder.id === id)
      return { status: folder?.status, issue: folder?.issue }
    }
    default: throw new Error(`Unknown project-files request "${route}".`)
  }
}

export interface ProjectFileAccess { url: string; token: string; close: () => void }

const MAX_BODY = 64 * 1024
const tokenMatches = (header: string | undefined, token: string): boolean => {
  const expected = Buffer.from(`Bearer ${token}`), actual = Buffer.from(header ?? '')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function startProjectFileAccess(deps: ProjectFileAccessDeps): Promise<ProjectFileAccess> {
  const token = randomBytes(24).toString('hex')
  const server = http.createServer((req, res) => {
    const reply = (status: number, payload: unknown): void => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)) }
    // A browser page cannot forge the bearer token, but refusing anything that
    // carries an Origin makes the intent plain: only R talks to this.
    if (req.method !== 'POST' || req.headers.origin || !tokenMatches(req.headers.authorization, token)) { reply(403, { error: 'Forbidden' }); return }
    const route = /^\/v1\/([a-z]+)$/.exec(req.url ?? '')?.[1]
    if (!route) { reply(404, { error: 'Not found' }); return }
    let size = 0; const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) { reply(413, { error: 'Request too large.' }); req.destroy() } else chunks.push(chunk) })
    req.on('end', () => {
      if (size > MAX_BODY) return
      void (async () => {
        try {
          const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a JSON object.')
          reply(200, await handleProjectFileRequest(route, body as Record<string, unknown>, deps))
        } catch (error) {
          // Library errors carry machine prefixes for the renderer; R users get the sentence.
          reply(400, { error: (error instanceof Error ? error.message : String(error)).replace(/^(?:SCOPE_CHANGED|STALE_REFERENCE|SOURCE_UNAVAILABLE|BUDGET_LIMIT):\s*/, '') })
        }
      })()
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, token, close: () => server.close() }
}

let running: Promise<ProjectFileAccess> | undefined
let current: ProjectFileAccess | undefined
/** Started once, before R; every Rscript ouRGeo spawns reads these two variables. */
export function ensureProjectFileAccess(deps: () => ProjectFileAccessDeps): Promise<ProjectFileAccess> {
  running ??= startProjectFileAccess({
    lease: () => deps().lease(), catalogue: lease => deps().catalogue(lease), original: (...args) => deps().original(...args),
    put: (...args) => deps().put(...args), rescan: (...args) => deps().rescan(...args),
  }).then(access => (current = access))
  return running
}
export function projectFileAccessEnv(): Record<string, string> {
  return current ? { OURGEO_PROJECT_FILES_URL: current.url, OURGEO_PROJECT_FILES_TOKEN: current.token } : {}
}
