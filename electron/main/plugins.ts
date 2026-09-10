import { ipcMain, app, shell, type IpcMain } from 'electron'
import { createHash } from 'node:crypto'
import { join, resolve, sep, dirname, extname } from 'path'
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'fs/promises'
import AdmZip from 'adm-zip'
import {
  planExtraction, readArchiveId, isDotPath, MANIFEST_ENTRY,
} from '../../src/lib/plugins/archive-policy'

// Plugin files, and the one rule about them.
//
// These handlers exist rather than reusing the generic `file:read`/`file:write`
// for a single reason: **every path is confined to the plugins directory.**
// Plugin authoring is something the AI assistant does on the user's behalf, and
// `file:write` takes an absolute path with no checks at all — a wrong or
// coaxed argument there writes anywhere the user can write. `contain()` is the
// whole security boundary for that surface, so it resolves symlinks' worth of
// `..` before comparing and refuses on the path, never on the file name.
//
// The directory itself is NOT session-scoped: it must never be added to the
// `will-quit` cleanup list in index.ts, which deletes plots.json and friends.

const PLUGIN_DIR_NAME = 'plugins'
const MAX_FILE_BYTES = 8 * 1024 * 1024

export function pluginsDir(): string {
  return join(app.getPath('userData'), PLUGIN_DIR_NAME)
}

/** Where a built submission is staged. Dot-prefixed, so nothing lists it. */
export function distStageDir(id: string): string {
  return join(pluginsDir(), '.dist', id)
}

/** The two names inside a staged build, and inside a `.ourgeosubmit` file. */
export const DIST_NAME = 'plugin.ourgeoplugin'
export const SOURCE_NAME = 'source.zip'

/** What `plugins:packBuilt` hands back. */
export interface BuiltPackage {
  distPath: string
  sourcePath: string
  distBytes: number
  sourceBytes: number
  /** sha256 of the distributable, hex. */
  sha256: string
}

/**
 * Resolve `relative` inside the plugins directory, or throw.
 *
 * `resolve` collapses `..` first, so the comparison is on the real target and
 * not on the string that was asked for. The trailing separator matters: without
 * it, `<userData>/plugins-evil` passes a `startsWith` against
 * `<userData>/plugins`.
 */
function contain(relative: string): string {
  const root = pluginsDir()
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refused: "${relative}" is outside the plugins folder.`)
  }
  return target
}

async function ensureDir(): Promise<string> {
  const dir = pluginsDir()
  await mkdir(dir, { recursive: true })
  return dir
}

/** One plugin folder, as the loader sees it before reading any manifest. */
interface PluginEntry {
  id: string
  dir: string
  hasManifest: boolean
}

export function registerPluginHandlers(ipc: IpcMain = ipcMain): void {
  ipc.handle('plugins:dir', async () => ensureDir())

  ipc.handle('plugins:list', async (): Promise<PluginEntry[]> => {
    const dir = await ensureDir()
    const entries = await readdir(dir, { withFileTypes: true, encoding: 'utf-8' })
    const out: PluginEntry[] = []
    for (const e of entries) {
      // A dot-directory is the loader's own scratch space (`.build`), never a
      // plugin. Files at the top level are ignored rather than reported: a
      // stray zip someone dropped in is not an error worth surfacing.
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      out.push({
        id: e.name,
        dir: full,
        hasManifest: await exists(join(full, MANIFEST_ENTRY)),
      })
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  })

  ipc.handle('plugins:readFile', async (_e, relative: string): Promise<string> => {
    const target = contain(relative)
    const s = await stat(target)
    if (s.size > MAX_FILE_BYTES) {
      throw new Error(`"${relative}" is ${Math.round(s.size / 1e6)} MB; the limit is 8 MB.`)
    }
    return readFile(target, 'utf-8')
  })

  ipc.handle('plugins:writeFile', async (_e, relative: string, content: string): Promise<void> => {
    const target = contain(relative)
    if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
      throw new Error('Refused: that file is larger than the 8 MB plugin file limit.')
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
  })

  ipc.handle('plugins:readBinary', async (_e, relative: string): Promise<string> => {
    const buf = await readFile(contain(relative))
    return buf.toString('base64')
  })

  ipc.handle('plugins:listFiles', async (_e, relative: string): Promise<string[]> => {
    const root = contain(relative)
    const out: string[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true, encoding: 'utf-8' })) {
        if (e.name.startsWith('.')) continue      // .build and friends
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        if (e.isDirectory()) await walk(join(dir, e.name), rel)
        else out.push(rel)
      }
    }
    await walk(root, '')
    return out.sort()
  })

  ipc.handle('plugins:delete', async (_e, relative: string): Promise<void> => {
    const target = contain(relative)
    if (target === pluginsDir()) throw new Error('Refused: that would delete every plugin.')
    await rm(target, { recursive: true, force: true })
  })

  ipc.handle('plugins:reveal', async (_e, relative: string): Promise<void> => {
    await shell.openPath(contain(relative))
  })

  // ── Import / export ──────────────────────────────────────────────────────
  //
  // A `.ourgeoplugin` is a zip of the plugin folder, packed with the same
  // adm-zip the `.ourgeoproj` bundle uses.

  ipc.handle('plugins:pack', async (_e, id: string, outPath: string): Promise<void> => {
    const dir = contain(id)
    const zip = new AdmZip()
    // The filter is not tidiness. adm-zip's `addLocalFolder` walks dotfiles, so
    // without it the compile cache `.build/<key>.js` ships inside the archive —
    // see the header of `archive-policy.ts` for what that let an archive do.
    zip.addLocalFolder(dir, '', (name: string) => !isDotPath(name))
    zip.writeZip(outPath)
  })

  ipc.handle('plugins:unpack', async (_e, zipPath: string): Promise<string> => {
    const id = await unpackArchive(zipPath)
    return id
  })

  // ── Packaging for the store ──────────────────────────────────────────────
  //
  // Two archives, staged on disk rather than passed back as base64. An 8 MB
  // zip through IPC and then back again for the upload is a lot of copying to
  // move bytes between two parts of the same process; `plugin-store.ts` reads
  // these paths directly.
  //
  // They live in `.dist/<id>/` INSIDE the plugins folder: dot-prefixed, so
  // `plugins:list` and `plugins:listFiles` skip it and a staged build can
  // never be mistaken for an installed plugin, and inside the folder so
  // `contain()` still covers every path.

  ipc.handle(
    'plugins:packBuilt',
    async (_e, id: string, files: Record<string, string>): Promise<BuiltPackage> => {
      const stage = distStageDir(id)
      await rm(stage, { recursive: true, force: true })
      await mkdir(stage, { recursive: true })

      const dist = new AdmZip()
      for (const [rel, content] of Object.entries(files)) {
        if (isDotPath(rel)) continue
        dist.addFile(rel, Buffer.from(content, 'utf-8'))
      }
      const distPath = join(stage, DIST_NAME)
      dist.writeZip(distPath)

      // The author's folder as it stands, for a moderator to read. Same
      // dot-filter as `plugins:pack`, so the compile cache does not travel.
      const src = new AdmZip()
      src.addLocalFolder(contain(id), '', (name: string) => !isDotPath(name))
      const sourcePath = join(stage, SOURCE_NAME)
      src.writeZip(sourcePath)

      const distBytes = await readFile(distPath)
      const sourceBytes = await readFile(sourcePath)
      return {
        distPath,
        sourcePath,
        distBytes: distBytes.byteLength,
        sourceBytes: sourceBytes.byteLength,
        // The hash the store stores and the installer checks. Computed here,
        // over the bytes that are actually uploaded, so nothing between this
        // line and the download can change the file without being noticed.
        sha256: createHash('sha256').update(distBytes).digest('hex'),
      }
    },
  )

  /**
   * Write the submission as one file the website's upload page can take.
   *
   * The store can be submitted to from ouRGeo or from ourgeo.dev, and this is
   * what makes those the same submission rather than two formats: the website
   * cannot BUILD one (its CSP carries no `wasm-unsafe-eval`, so esbuild cannot
   * run there), but it can read one.
   */
  ipc.handle(
    'plugins:saveSubmission',
    async (_e, id: string, submission: unknown, outPath: string): Promise<void> => {
      const stage = distStageDir(id)
      const zip = new AdmZip()
      zip.addLocalFile(join(stage, DIST_NAME))
      zip.addLocalFile(join(stage, SOURCE_NAME))
      zip.addFile('submission.json', Buffer.from(`${JSON.stringify(submission, null, 2)}\n`, 'utf-8'))
      zip.writeZip(outPath)
    },
  )

  // Where a compiled bundle is cached, keyed by content hash — see
  // lib/plugins/compile.ts. Kept out of `plugins:writeFile`'s path so a plugin
  // author cannot mistake it for source.
  ipc.handle('plugins:cacheRead', async (_e, id: string, key: string): Promise<string | null> => {
    try {
      return await readFile(contain(join(id, '.build', `${safeKey(key)}.js`)), 'utf-8')
    } catch {
      return null
    }
  })

  ipc.handle('plugins:cacheWrite', async (_e, id: string, key: string, code: string): Promise<void> => {
    const target = contain(join(id, '.build', `${safeKey(key)}.js`))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, code, 'utf-8')
  })
}

/**
 * Extract a `.ourgeoplugin` into `<plugins>/<id>`, replacing what is there.
 *
 * Exported because the plugin store installs through this same function: one
 * place decides what an archive may contain, so a hostile archive cannot be
 * made acceptable by arriving through the other door.
 *
 * What is allowed lives in `src/lib/plugins/archive-policy.ts`, which is pure
 * and tested. This function is the I/O around it.
 */
export async function unpackArchive(zipPath: string): Promise<string> {
  const zip = new AdmZip(zipPath)

  const plan = planExtraction(zip.getEntries().map((e) => ({
    name: e.entryName,
    size: e.header.size,
    isDirectory: e.isDirectory,
  })))
  if (!plan.ok) throw new Error(plan.error)

  const manifestEntry = zip.getEntry(MANIFEST_ENTRY)
  if (!manifestEntry) {
    throw new Error(`That file has no ${MANIFEST_ENTRY} at its top level, so it is not an ouRGeo plugin.`)
  }
  const read = readArchiveId(manifestEntry.getData().toString('utf-8'))
  if ('error' in read) throw new Error(read.error)

  const target = contain(read.id)

  // Every entry is decompressed BEFORE anything is deleted: a failure halfway
  // through would otherwise leave the user with neither the old plugin nor the
  // new one.
  const files: { path: string; data: Buffer }[] = []
  for (const planned of plan.entries) {
    const entry = zip.getEntry(planned.name)
    if (!entry) continue
    const dest = resolve(target, planned.path)
    // `planExtraction` already refused anything that could land here, so this
    // cannot fire. It stays because this is the line that writes to a disk, and
    // a containment check belongs where the write happens.
    if (dest !== target && !dest.startsWith(target + sep)) {
      throw new Error(`That plugin archive contains an unsafe path ("${planned.name}").`)
    }
    files.push({ path: dest, data: entry.getData() })
  }

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const f of files) {
    await mkdir(dirname(f.path), { recursive: true })
    await writeFile(f.path, f.data)
  }
  return read.id
}

function safeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').slice(0, 64) || 'build'
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true } catch { return false }
}

/** Where esbuild's wasm lives in the packaged app, for the renderer to read
 *  through `plugins:readBinary`'s sibling — it is outside the plugins folder,
 *  so it gets its own handler rather than bending `contain`. */
export function registerEsbuildWasmHandler(ipc: IpcMain = ipcMain): void {
  ipc.handle('plugins:esbuildWasm', async (): Promise<string> => {
    // Resolved from the app's own node_modules, inside the asar in a packaged
    // build. `readFile` reads through asar transparently; `fs.realpath` does not.
    const wasm = require.resolve('esbuild-wasm/esbuild.wasm')
    if (extname(wasm) !== '.wasm') throw new Error('esbuild-wasm resolved to something that is not a .wasm file.')
    return (await readFile(wasm)).toString('base64')
  })
}
