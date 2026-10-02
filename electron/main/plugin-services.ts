import { app, ipcMain, utilityProcess, type IpcMain, type UtilityProcess, type WebContents } from 'electron'
import { readFile, realpath, mkdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { serviceSpec, serviceConnection, type ServiceConnection } from '../../src/lib/plugins/service-policy'

interface Running {
  owner: WebContents
  child: UtilityProcess
  signature: string
  ready: Promise<ServiceConnection>
  exited: Promise<void>
}
const running = new Map<string, Running>()
const starting = new Map<string, Promise<ServiceConnection>>()
const stopping = new Set<Promise<void>>()
const ownerHooks = new WeakSet<WebContents>()
let revision = 0

async function descriptor(id: string): Promise<{ entry: string; dir: string; dataDir: string; signature: string }> {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid plugin id.')
  const root = await realpath(join(app.getPath('userData'), 'plugins'))
  const dir = await realpath(join(root, id))
  if (!dir.startsWith(root + sep)) throw new Error('Service folder is outside the installed plugins directory.')
  const manifest = JSON.parse(await readFile(join(dir, 'ourgeo-plugin.json'), 'utf8'))
  const prefs = JSON.parse(await readFile(join(app.getPath('userData'), 'plugins.json'), 'utf8'))
  if (manifest.id !== id || prefs.enabled?.[id] !== true || !manifest.permissions?.includes('service')) {
    throw new Error('Enable this plugin with its background service permission before starting it.')
  }
  const spec = serviceSpec(manifest.service)
  const hash = createHash('sha256').update(JSON.stringify(spec))
  // Recheck real paths here, at the execution boundary. Renderer validation is
  // useful feedback, but cannot authorize native code or symlink traversal.
  for (const file of spec.files) {
    const path = await realpath(resolve(dir, file))
    if (!path.startsWith(dir + sep)) throw new Error('A service asset points outside its plugin.')
    hash.update(await readFile(path))
  }
  const dataDir = join(app.getPath('userData'), 'plugin-data', id)
  await mkdir(dataDir, { recursive: true })
  return { entry: resolve(dir, spec.entry), dir, dataDir, signature: hash.digest('hex') }
}

function stop(id: string): Promise<void> {
  const active = running.get(id)
  if (!active) return Promise.resolve()
  running.delete(id)
  const task = (async () => {
    const timer = setTimeout(() => active.child.kill(), 4000)
    try {
      try { active.child.postMessage({ type: 'stop' }) } catch { active.child.kill() }
      await active.exited
    }
    finally { clearTimeout(timer) }
  })()
  stopping.add(task)
  void task.finally(() => stopping.delete(task))
  return task
}

export function pluginServicesRunning(): boolean {
  return running.size > 0 || starting.size > 0 || stopping.size > 0
}

export async function stopPluginServices(): Promise<void> {
  revision++
  await Promise.allSettled([...starting.values()])
  await Promise.allSettled([...running.keys()].map(stop))
  await Promise.allSettled([...stopping])
}

export function startPluginService(id: string, owner: WebContents): Promise<ServiceConnection> {
  const pending = starting.get(id)
  if (pending) return pending
  const epoch = revision
  const task = (async () => {
    const spec = await descriptor(id)
    if (epoch !== revision || owner.isDestroyed()) throw new Error('The plugin stopped while its service was starting.')
    const previous = running.get(id)
    if (previous?.owner === owner && previous.signature === spec.signature) return previous.ready
    if (previous) await stop(id)
    if (epoch !== revision || owner.isDestroyed()) throw new Error('The plugin stopped while its service was starting.')
    const child = utilityProcess.fork(spec.entry, [], {
      cwd: spec.dir,
      serviceName: `OurGeo plugin: ${id}`,
      stdio: 'pipe',
      env: { ...process.env, OURGEO_PLUGIN_DATA: spec.dataDir, OURGEO_PLUGIN_MANAGED: '1', OURGEO_NODE_EXECUTABLE: process.execPath },
    })
    // Drain diagnostic pipes so a noisy service cannot deadlock on a full pipe.
    // Do not forward arbitrary logs or connection secrets to the UI console.
    child.stdout?.resume()
    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => { stderr = (stderr + data.toString()).slice(-1000) })
    const exited = new Promise<void>(done => child.once('exit', () => done()))
    const ready = new Promise<ServiceConnection>((resolveReady, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('The plugin service did not start within 20 seconds.')) }, 20000)
      child.on('message', (message: unknown) => {
        const data = message as { type?: string; connection?: unknown; error?: string }
        if (data?.type === 'ready') {
          try { const connection = serviceConnection(data.connection); clearTimeout(timer); resolveReady(connection) }
          catch (error) { clearTimeout(timer); child.kill(); reject(error) }
        } else if (data?.type === 'error') { clearTimeout(timer); child.kill(); reject(new Error(String(data.error || 'The media service failed to start.').slice(0, 1000))) }
      })
      child.once('exit', (code: number) => {
        clearTimeout(timer)
        reject(new Error(`The plugin service exited (${code}) before it was ready.${stderr ? ' Check the service installation and try again.' : ''}`))
        if (running.get(id)?.child === child) running.delete(id)
      })
    })
    running.set(id, { owner, child, signature: spec.signature, ready, exited })
    if (!ownerHooks.has(owner)) {
      ownerHooks.add(owner)
      owner.once('destroyed', () => {
        revision++
        for (const [pluginId, active] of running) if (active.owner === owner) void stop(pluginId)
      })
      owner.on('render-process-gone', () => {
        revision++
        for (const [pluginId, active] of running) if (active.owner === owner) void stop(pluginId)
      })
    }
    return ready
  })()
  starting.set(id, task)
  void task.then(() => starting.delete(id), () => starting.delete(id))
  return task
}

export function registerPluginServiceHandlers(ipc: IpcMain = ipcMain): void {
  ipc.handle('plugins:service:start', (event, id: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Services can only be started by the OurGeo workspace.')
    return startPluginService(id, event.sender)
  })
  ipc.handle('plugins:service:reconcile', async (event, ids: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame || !Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('Invalid service lifecycle request.')
    revision++
    const keep = new Set(ids)
    await Promise.allSettled([...running].filter(([id, item]) => item.owner === event.sender && !keep.has(id)).map(([id]) => stop(id)))
  })
}
