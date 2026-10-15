import { readdir, readFile, readlink, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'

interface ProcessIdentity { start: string; zombie: boolean }
async function identity(path: string): Promise<ProcessIdentity | null> {
  try {
    const body = await readFile(join(path, 'stat'), 'utf8'), fields = body.slice(body.lastIndexOf(')') + 2).trim().split(/\s+/)
    return fields.length > 19 ? { start: fields[19], zombie: fields[0] === 'Z' } : null
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(String((error as NodeJS.ErrnoException).code))) return null; throw error }
}

/** Only an exact app-owned private Python/bridge/data layout is eligible.
 * Never match by process name alone, a PID file alone, or a user endpoint. */
export function ownedRuntimeProcess(root: string, executable: string, cwd: string, argv: string[], uid: number, owner: number): boolean {
  if (uid !== owner || argv.length < 7 || argv.length > 10) return false
  const folder = relative(root, cwd)
  if (isAbsolute(folder) || !/^installed_[a-f0-9-]{36}$/.test(folder)) return false
  const binary = relative(cwd, executable)
  if (!/^\.runtime-[a-zA-Z0-9_-]+\/python\/bin\/python3(?:\.12)?$/.test(binary) || argv[0] !== executable) return false
  const flags = argv.slice(1, argv.indexOf(join(cwd, 'ourgeo-bridge.py')))
  if (!['-I,-S', '-I,-B,-S'].includes(flags.join(','))) return false
  const index = 1 + flags.length
  return argv[index] === join(cwd, 'ourgeo-bridge.py')
    && /^\.runtime-[a-zA-Z0-9_-]+\/mnemosyne-[a-f0-9]{40}$/.test(relative(cwd, argv[index + 1] ?? ''))
    && /^\.runtime-[a-zA-Z0-9_-]+\/pyyaml-[0-9.]+\/lib$/.test(relative(cwd, argv[index + 2] ?? ''))
    && argv[index + 3] === join(cwd, 'derived')
    && (argv.length === index + 4 || argv.length === index + 6 && argv[index + 4] === '--parent-pid' && /^[1-9][0-9]*$/.test(argv[index + 5]))
}

/** Recover pre-supervision experimental children as well as current ones.
 * Main stops its known child first. Check PID start time again before every
 * signal; a reused PID or any foreign layout is never a cleanup target. */
export async function stopOwnedRuntimeOrphans(directory: string): Promise<void> {
  if (process.platform !== 'linux') return
  let root: string
  try { root = await realpath(directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const targets: { pid: number; start: string }[] = []
  for (const name of await readdir('/proc')) {
    if (!/^[1-9][0-9]*$/.test(name)) continue
    const path = join('/proc', name)
    try {
      const executable = await readlink(join(path, 'exe'))
      if (!executable.startsWith(`${root}/installed_`)) continue
      const cwd = await readlink(join(path, 'cwd')), raw = await readFile(join(path, 'cmdline'))
      if (raw.length > 32768) continue
      const argv = raw.toString('utf8').split('\0').filter(Boolean), status = await readFile(join(path, 'status')), first = await identity(path)
      const uid = Number(status.toString('utf8').match(/^Uid:\s+(\d+)/m)?.[1])
      if (first && !first.zombie && ownedRuntimeProcess(root, executable, cwd, argv, uid, process.getuid!())) targets.push({ pid: Number(name), start: first.start })
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error }
  }
  if (targets.length > 32) throw new Error('Review the bounded private runtime processes before recovering memory.')
  for (const target of targets) {
    const path = join('/proc', String(target.pid))
    const current = await identity(path)
    if (!current || current.zombie || current.start !== target.start) continue
    try { process.kill(target.pid, 'SIGTERM') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') continue; throw error }
    const deadline = Date.now() + 1000
    while (Date.now() < deadline) {
      const state = await identity(path)
      if (!state || state.zombie || state.start !== target.start) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const state = await identity(path)
    if (state && !state.zombie && state.start === target.start) {
      process.kill(target.pid, 'SIGKILL')
      const limit = Date.now() + 1000
      while (true) {
        const after = await identity(path)
        if (!after || after.zombie || after.start !== target.start) break
        if (Date.now() > limit) throw new Error('Private runtime shutdown is pending. Preserve its files and retry cleanup.')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
  }
}
