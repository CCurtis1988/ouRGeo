import { ipcMain, app, shell, type IpcMain } from 'electron'
import { join, resolve, sep, dirname, extname } from 'path'
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'fs/promises'
import AdmZip from 'adm-zip'

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
        hasManifest: await exists(join(full, 'ourgeo-plugin.json')),
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
    zip.addLocalFolder(dir)
    zip.writeZip(outPath)
  })

  ipc.handle('plugins:unpack', async (_e, zipPath: string): Promise<string> => {
    const zip = new AdmZip(zipPath)
    const manifest = zip.getEntry('ourgeo-plugin.json')
    if (!manifest) {
      throw new Error('That file has no ourgeo-plugin.json at its top level, so it is not an ouRGeo plugin.')
    }
    let id: string
    try {
      id = String(JSON.parse(manifest.getData().toString('utf-8')).id ?? '')
    } catch {
      throw new Error('That plugin’s ourgeo-plugin.json is not valid JSON.')
    }
    // Re-run the id rule here rather than trusting the archive: the id becomes
    // a directory name, and this is the one place a hostile one could traverse.
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
      throw new Error(`That plugin's id ("${id}") is not a valid plugin id, so it cannot be installed.`)
    }
    const target = contain(id)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    // `extractAllTo` with the target inside the plugins folder; entries are
    // still checked, because a zip can carry `../` in an entry name.
    for (const entry of zip.getEntries()) {
      if (entry.entryName.includes('..')) {
        throw new Error(`That plugin archive contains an unsafe path ("${entry.entryName}").`)
      }
    }
    zip.extractAllTo(target, true)
    return id
  })

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
