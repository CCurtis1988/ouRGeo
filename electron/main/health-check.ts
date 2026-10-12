import { app, type IpcMain, type WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, writeFile, mkdir, statfs, access, readdir, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir, totalmem, freemem } from 'node:os'
import { join, dirname } from 'node:path'
import type { HealthHardware, HealthHistory, HealthReport, InstallPlan, RHealth, HealthPackageCopy } from '../../src/lib/health-types'
import { rBridge } from './r-bridge'
import { detectRInstallations } from './ipc'
import { HEALTH_MODELS, modelFits, parseNvidiaMemory, comparePackageVersions } from '../../src/lib/health-policy'

const GB = 1024 ** 3
const emptyR = (): RHealth => ({ path: null, version: null, supported: false, configuredPathBroken: false, packages: [], duplicates: [], updatesChecked: false, library: null, libraryWritable: false, tools: { pandoc: false, latex: false } })
const healthFile = () => join(app.getPath('userData'), 'health-check.json')
let snapshot: RHealth | null = null
let mutating = false
let needsRestart = false
let lastProgress = ''
let lastRepairError: string | null = null
let ownedOllama: ChildProcess | null = null

async function history(): Promise<HealthHistory> {
  try { return JSON.parse(await readFile(healthFile(), 'utf8')) as HealthHistory }
  catch { return { prompted: false, report: null } }
}
async function save(data: HealthHistory): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(healthFile(), JSON.stringify(data), 'utf8')
}
function progress(wc: WebContents, message: string): void {
  lastProgress = message.slice(-4000)
  if (!wc.isDestroyed()) wc.send('health:progress', message.slice(-4000))
}

function run(command: string, args: string[], wc?: WebContents, timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: homedir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errors = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill(); reject(new Error('The operation timed out. Check connectivity and try again.')) }, timeout)
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2_000_000); if (wc) progress(wc, chunk.toString()) })
    child.stderr.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-8000); if (wc) progress(wc, chunk.toString()) })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) return
      if (code === 0) resolve(output)
      else reject(new Error(errors.trim() || `${command} exited with code ${code}.`))
    })
  })
}
async function binary(name: string, extra: string[] = []): Promise<string | null> {
  for (const candidate of extra) {
    try { await access(candidate, constants.X_OK); return candidate } catch { /* next */ }
  }
  try { return (await run(process.platform === 'win32' ? 'where.exe' : 'which', [name])).trim().split(/\r?\n/)[0] || null }
  catch { return null }
}
const rScript = () => join(is.dev ? join(process.cwd(), 'r') : join(process.resourcesPath, 'r'), 'health-check.R')

export function parseRHealth(output: string, path: string): RHealth {
  const result = { ...emptyR(), path }
  for (const line of output.split(/\r?\n/)) {
    const [marker, kind, ...v] = line.split('\t')
    if (marker !== 'OURGEO_HEALTH') continue
    if (kind === 'runtime') {
      result.version = v[0]; result.library = v[1]
      const [major, minor] = v[0].split('.').map(Number)
      result.supported = major > 4 || (major === 4 && minor >= 1)
    }
    if (kind === 'updates') result.updatesChecked = v[0] === 'TRUE'
    if (kind === 's2') result.s2 = { ok: v[0] === 'TRUE', detail: v[1], repair: v[2], library: v[3] }
    if (kind === 'package') result.packages.push({ name: v[0], group: v[1], version: v[2], available: v[3], built: v[4], loaded: v[5] === 'TRUE', reason: v[6] })
    if (kind === 'duplicate') result.duplicates.push({ name: v[0], version: v[1], library: v[2], built: v[3], active: v[4] === 'TRUE', removable: v[5] === 'TRUE' })
    if (kind === 'library') { result.library = v[0]; result.libraryWritable = v[1] === 'TRUE' }
    if (kind === 'tools') result.tools = { pandoc: v[0] === 'TRUE', latex: v[1] === 'TRUE' }
  }
  if (!result.version) throw new Error('Rscript did not return a valid diagnostic result. Check your R startup profile in Settings → R Backend.')
  return result
}

async function checkR(): Promise<RHealth> {
  const paths = [rBridge.currentPath, ...detectRInstallations(null).map((r) => r.path)]
  let firstError = ''
  for (const path of [...new Set(paths)]) {
    try {
      const result = parseRHealth(await run(path, [rScript(), 'runtime']), path)
      result.configuredPathBroken = path !== rBridge.currentPath
      snapshot = result
      return result
    } catch (e) { firstError ||= String(e) }
  }
  snapshot = { ...emptyR(), error: firstError }
  return snapshot
}
async function checkPackages(): Promise<RHealth> {
  if (!snapshot?.path) await checkR()
  if (!snapshot?.path) return snapshot ?? emptyR()
  const previous = snapshot
  snapshot = { ...parseRHealth(await run(previous.path!, [rScript(), 'packages'], undefined, 180_000), previous.path!), configuredPathBroken: previous.configuredPathBroken }
  // Retain known update targets if the post-install CRAN request fails. A
  // failed download must not appear repaired merely because CRAN is offline.
  if (!snapshot.updatesChecked) for (const pkg of snapshot.packages) {
    const known = previous.packages.find((p) => p.name === pkg.name)?.available
    if (known) {
      pkg.available = known
      if (pkg.version && comparePackageVersions(known, pkg.version) > 0) pkg.reason = [pkg.reason, `update to ${known}`].filter(Boolean).join('; ')
    }
  }
  snapshot.githubUpdatesChecked = false
  try {
    const response = await fetch('https://api.github.com/repos/CCurtis1988/sfarc/contents/DESCRIPTION', { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) })
    if (response.ok) {
      const data = await response.json() as { content?: string; encoding?: string }
      const text = data.encoding === 'base64' && data.content ? Buffer.from(data.content, 'base64').toString('utf8') : ''
      const latest = text.match(/^Version:\s*([0-9]+(?:[.-][0-9]+)*)\s*$/m)?.[1]
      const pkg = snapshot.packages.find((p) => p.name === 'sfarc')
      if (latest && pkg) {
        snapshot.githubUpdatesChecked = true
        pkg.available = latest
        if (pkg.version && comparePackageVersions(latest, pkg.version) > 0 && !pkg.reason.includes(`update to ${latest}`)) pkg.reason = [pkg.reason, `update to ${latest}`].filter(Boolean).join('; ')
      }
    }
  } catch { /* Report GitHub as unchecked; repairs can still reinstall sfarc. */ }
  if (!snapshot.githubUpdatesChecked) {
    const pkg = snapshot.packages.find((p) => p.name === 'sfarc')
    const known = previous.packages.find((p) => p.name === 'sfarc')?.available
    if (pkg && known) {
      pkg.available = known
      if (pkg.version && comparePackageVersions(known, pkg.version) > 0 && !pkg.reason.includes(`update to ${known}`)) pkg.reason = [pkg.reason, `update to ${known}`].filter(Boolean).join('; ')
    }
  }
  return snapshot
}

async function installPlan(target: 'r' | 'ollama'): Promise<InstallPlan> {
  const r = target === 'r'
  const manualUrl = r ? 'https://cran.r-project.org/' : 'https://ollama.com/download'
  const detail = 'Downloads software and may ask for your system administrator password.'
  if (process.platform === 'win32') {
    const command = await binary('winget.exe')
    if (command) return { command, args: ['install', '--id', r ? 'RProject.R' : 'Ollama.Ollama', '--exact', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], label: `Install ${r ? 'R' : 'Ollama'} with Windows Package Manager`, detail, manualUrl }
  }
  if (process.platform === 'darwin') {
    const command = await binary('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'])
    if (command) return { command, args: r ? ['install', 'r'] : ['install', '--cask', 'ollama'], label: `Install ${r ? 'R' : 'Ollama'} with Homebrew`, detail, manualUrl }
  }
  if (process.platform === 'linux' && r) {
    const elevate = await binary('pkexec')
    if (elevate) {
      for (const [name, args] of [
        ['apt-get', ['install', '-y', 'r-base', 'r-base-dev', 'libcurl4-openssl-dev', 'libssl-dev', 'libxml2-dev', 'libgdal-dev', 'libgeos-dev', 'libproj-dev', 'libudunits2-dev']],
        ['dnf', ['install', '-y', 'R', 'gdal-devel', 'geos-devel', 'proj-devel', 'udunits2-devel', 'libcurl-devel', 'openssl-devel', 'libxml2-devel']],
        ['pacman', ['-S', '--needed', '--noconfirm', 'r', 'gdal', 'geos', 'proj', 'udunits']],
        ['zypper', ['--non-interactive', 'install', 'R-base', 'R-base-devel', 'gdal-devel', 'geos-devel', 'proj-devel', 'udunits2-devel']],
      ] as [string, string[]][]) {
        const command = await binary(name)
        if (command) return { command: elevate, args: [command, ...args], label: 'Install R and spatial build libraries', detail, manualUrl }
      }
    }
  }
  if (r && (process.platform === 'darwin' || process.platform === 'win32')) return { command: null, args: [], label: 'Download and launch the official R installer', detail: `${detail} Complete the installer window, then return here to recheck R.`, manualUrl }
  return { command: null, args: [], label: `Open ${r ? 'R' : 'Ollama'} installation guide`, detail: 'Install from the official website, then return here and recheck. Automatic installation is unavailable on this system.', manualUrl }
}

async function officialRInstaller(wc: WebContents): Promise<void> {
  const windows = process.platform === 'win32'
  const base = windows ? 'https://cran.r-project.org/bin/windows/base/' : 'https://cran.r-project.org/bin/macosx/'
  const page = await fetch(base, { signal: AbortSignal.timeout(30_000) })
  if (!page.ok) throw new Error(`R download page returned HTTP ${page.status}.`)
  const html = await page.text()
  const pattern = windows ? /href=["'](R-[\d.]+-win\.exe)["']/g : process.arch === 'arm64' ? /href=["'](R-[\d.]+-arm64\.pkg)["']/g : /href=["'](R-[\d.]+-x86_64\.pkg)["']/g
  const name = [...html.matchAll(pattern)][0]?.[1]
  if (!name) throw new Error('Could not find the official R installer for this system. Use the R installation guide.')
  const response = await fetch(new URL(name, base), { signal: AbortSignal.timeout(600_000) })
  if (!response.ok) throw new Error(`R download returned HTTP ${response.status}.`)
  const path = join(app.getPath('temp'), name)
  // The installer stays interactive: its publisher/signature and privilege
  // prompt are presented by the OS before it installs anything.
  progress(wc, 'Downloading the official R installer…')
  await writeFile(path, Buffer.from(await response.arrayBuffer()))
  progress(wc, 'Complete the R installer window, then return to ouRGeo.')
  try { await run(windows ? path : '/usr/bin/open', windows ? [] : ['-W', path], wc, 3_600_000) }
  finally { await unlink(path).catch(() => {}) }
}

async function exclusive<T>(approved: boolean, work: () => Promise<T>): Promise<T> {
  if (approved !== true) throw new Error('Approval is required for this repair.')
  if (mutating) throw new Error('Another health-check installation is still running.')
  mutating = true
  lastProgress = ''; lastRepairError = null
  try { return await work() }
  catch (e) { lastRepairError = String(e); throw e }
  finally { mutating = false }
}

async function writable(path: string): Promise<boolean> {
  try { await access(path, constants.W_OK); return true } catch { return false }
}
async function storage(label: string, path: string): Promise<HealthHardware['storage'][number]> {
  let parent = path
  while (true) {
    try { const fs = await statfs(parent); return { label, path, freeGB: Number(fs.bavail) * Number(fs.bsize) / GB, writable: await writable(parent) } }
    catch { if (dirname(parent) === parent) return { label, path, freeGB: null, writable: false }; parent = dirname(parent) }
  }
}
async function hardware(): Promise<HealthHardware> {
  let gpus: HealthHardware['gpus'] = []
  let freeRamGB = freemem() / GB
  if (process.platform === 'linux') {
    try {
      const info = await readFile('/proc/meminfo', 'utf8')
      const available = info.match(/^MemAvailable:\s+(\d+)\s+kB/m)
      if (available) freeRamGB = Number(available[1]) * 1024 / GB
    } catch { /* fall back to os.freemem */ }
  }
  const unifiedMemory = process.platform === 'darwin' && process.arch === 'arm64'
  try { gpus = parseNvidiaMemory(await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits'])) } catch { /* other vendor */ }
  if (!gpus.length && process.platform === 'linux') {
    try {
      for (const entry of await readdir('/sys/class/drm')) {
        if (!/^card\d+$/.test(entry)) continue
        const base = `/sys/class/drm/${entry}/device`
        try {
          const total = Number(await readFile(join(base, 'mem_info_vram_total'), 'utf8')) / GB
          const used = Number(await readFile(join(base, 'mem_info_vram_used'), 'utf8')) / GB
          if (total > 0) gpus.push({ name: `AMD GPU (${entry})`, vramGB: total, freeVramGB: Math.max(0, total - used) })
        } catch { /* driver does not expose memory */ }
      }
    } catch { /* unsupported */ }
  }
  if (!gpus.length) {
    const info = await app.getGPUInfo('complete').catch(() => null) as { gpuDevice?: { deviceString?: string }[] } | null
    gpus = (info?.gpuDevice ?? []).map((g) => ({ name: g.deviceString || 'Graphics adapter', vramGB: null, freeVramGB: null }))
  }
  return {
    platform: process.platform, arch: process.arch, totalRamGB: totalmem() / GB, freeRamGB, gpus, unifiedMemory,
    gpuNote: unifiedMemory ? 'Apple silicon shares system memory with the GPU; RAM and VRAM are not added together.' : 'Unknown GPU memory is not assumed available. Recommendations use RAM when VRAM cannot be measured.',
    storage: await Promise.all([storage('App data', app.getPath('userData')), storage('Temporary files', app.getPath('temp')), storage('Model storage', process.env.OLLAMA_MODELS || join(homedir(), '.ollama', 'models'))]),
  }
}
async function ollamaModels(): Promise<{ models: string[]; error?: string }> {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`)
    const data = await response.json() as { models?: { name: string }[] }
    return { models: data.models?.map((m) => m.name) ?? [] }
  } catch { return { models: [], error: 'Start Ollama, then recheck the connection. On Linux run ollama serve; on Windows or macOS open the Ollama app.' } }
}

export function registerHealthHandlers(ipc: IpcMain): void {
  app.on('will-quit', () => ownedOllama?.kill())
  ipc.handle('health:history', history)
  ipc.handle('health:activity', () => ({ busy: mutating, progress: lastProgress, error: lastRepairError, needsRRestart: needsRestart }))
  ipc.handle('health:acknowledge', async () => save({ ...await history(), prompted: true }))
  ipc.handle('health:saveReport', async (_e, report: HealthReport) => {
    if (!report || !Array.isArray(report.results) || report.results.length > 100) throw new Error('Invalid health report.')
    await save({ prompted: true, report })
  })
  ipc.handle('health:checkR', checkR)
  ipc.handle('health:checkPackages', checkPackages)
  ipc.handle('health:hardware', hardware)
  ipc.handle('health:installPlan', (_e, target: 'r' | 'ollama') => installPlan(target))
  ipc.handle('health:install', (e, target: 'r' | 'ollama', approved: boolean) => exclusive(approved, async () => {
    if (target !== 'r' && target !== 'ollama') throw new Error('Unknown installation target.')
    const plan = await installPlan(target)
    if (plan.command) await run(plan.command, plan.args, e.sender, 3_600_000)
    else if (target === 'r' && (process.platform === 'win32' || process.platform === 'darwin')) await officialRInstaller(e.sender)
    else throw new Error(plan.detail)
  }))
  ipc.handle('health:repairPackages', (e, names: string[], approved: boolean) => exclusive(approved, async () => {
    if (!snapshot?.path || !Array.isArray(names) || !names.length || names.some((n) => !snapshot!.packages.some((p) => p.name === n && p.reason))) throw new Error('Recheck packages before selecting repairs.')
    // Windows locks loaded package DLLs. Stop the live session after the
    // renderer's repair approval so compiled packages can actually be replaced.
    // The approval screen explains the loss of unsaved R objects.
    needsRestart = true
    rBridge.stop()
    await run(snapshot.path, [rScript(), 'repair', ...new Set(names)], e.sender, 3_600_000)
    return checkPackages()
  }))
  ipc.handle('health:removePackageCopies', (e, copies: HealthPackageCopy[], approved: boolean) => exclusive(approved, async () => {
    const duplicates = snapshot?.duplicates ?? []
    if (!snapshot?.path || !Array.isArray(copies) || !copies.length || copies.length > 1000 || copies.some((copy) =>
      !copy || !duplicates.some((known) => known.name === copy.name && known.library === copy.library && known.version === copy.version && known.removable))) {
      throw new Error('Recheck packages before selecting duplicate copies to remove.')
    }
    const selected = duplicates.filter((known) => copies.some((copy) => copy.name === known.name && copy.library === known.library))
    if (selected.length !== copies.length) throw new Error('Invalid duplicate selection.')
    for (const name of new Set(selected.map((copy) => copy.name))) {
      if (duplicates.filter((copy) => copy.name === name).length === selected.filter((copy) => copy.name === name).length) throw new Error(`Keep at least one installation of ${name}.`)
    }
    needsRestart = true
    rBridge.stop()
    // The independent R process also checks versions, permissions and survivors
    // immediately before removal, so stale renderer selections cannot remove a
    // changed package or the last remaining installation.
    await run(snapshot.path, [rScript(), 'remove-copies', ...selected.flatMap((copy) => [copy.name, copy.library, copy.version])], e.sender, 180_000)
    return checkPackages()
  }))
  ipc.handle('health:connectR', (_e, approved: boolean) => exclusive(approved, async () => {
    if (rBridge.isReady && snapshot?.path === rBridge.currentPath && !needsRestart) return { ready: true, detail: 'R server is connected.' }
    if (!snapshot?.path) throw new Error('Install or select R first.')
    rBridge.setPath(snapshot.path)
    await writeFile(join(app.getPath('userData'), 'r-config.json'), JSON.stringify({ rscriptPath: snapshot.path }))
    await rBridge.restart()
    needsRestart = false
    return { ready: rBridge.isReady, detail: 'R server started successfully.' }
  }))
  ipc.handle('health:ollamaModels', ollamaModels)
  ipc.handle('health:startOllama', (e, approved: boolean) => exclusive(approved, async () => {
    if (!(await ollamaModels()).error) return
    const executable = await binary(process.platform === 'win32' ? 'ollama.exe' : 'ollama', [
      '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama',
      join(process.env.LOCALAPPDATA || homedir(), 'Programs', 'Ollama', 'ollama.exe'),
    ])
    if (!executable) throw new Error('Install Ollama first, then start the local server.')
    if (!ownedOllama || ownedOllama.exitCode !== null) {
      const child = spawn(executable, ['serve'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' } })
      ownedOllama = child
      child.on('error', (err) => { progress(e.sender, err.message); if (ownedOllama === child) ownedOllama = null })
      child.on('exit', () => { if (ownedOllama === child) ownedOllama = null })
    }
    for (let i = 0; i < 20; i++) {
      if (!(await ollamaModels()).error) return
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error('Ollama did not become ready. Open the Ollama app or run ollama serve, then recheck.')
  }))
  ipc.handle('health:pullModel', (e, model: string, approved: boolean) => exclusive(approved, async () => {
    const definition = HEALTH_MODELS.find((m) => m.id === model)
    if (!definition || !modelFits(definition, await hardware()).fits) throw new Error('This model does not fit the currently available memory and storage. Recheck resources or choose a smaller model.')
    // A fixed loopback endpoint prevents this repair from downloading on a
    // remote/paid server. Never uses Ollama cloud model tags.
    const response = await fetch('http://127.0.0.1:11434/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: AbortSignal.timeout(3_600_000) })
    if (!response.ok || !response.body) throw new Error(`Ollama download failed (HTTP ${response.status}).`)
    let buffer = '', success = false
    const decoder = new TextDecoder()
    const line = (raw: string) => {
      if (!raw.trim()) return
      const data = JSON.parse(raw) as { status?: string; total?: number; completed?: number; error?: string }
      if (data.error) throw new Error(data.error)
      if (data.status === 'success') success = true
      progress(e.sender, `${data.status ?? 'Downloading'}${data.total ? ` · ${Math.round((data.completed ?? 0) / data.total * 100)}%` : ''}`)
    }
    const reader = response.body.getReader()
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(line)
      }
      line(buffer + decoder.decode())
      if (!success) throw new Error('Ollama download did not finish. Recheck the connection and try again.')
    } finally { await reader.cancel().catch(() => {}) }
  }))
}
