import { spawn } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { join } from 'node:path'

/** Inspect the actual mounted artifact before any app/profile startup. This
 * avoids treating an unrelated companion archive as a native launch guard. */
export async function appImageArchive(executable) {
  if (process.env.APPIMAGE_EXTRACT_AND_RUN) throw new Error('Unset APPIMAGE_EXTRACT_AND_RUN before native AppImage acceptance.')
  const child = spawn(executable, ['--appimage-mount'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', errors = ''
  const exited = new Promise(resolveExit => child.once('exit', resolveExit))
  try {
    const mounted = await new Promise((resolveMount, reject) => {
      const timer = setTimeout(() => reject(new Error(`AppImage mount timed out: ${errors}`)), 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`AppImage did not remain mounted: ${errors}`)) })
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000) })
      child.stdout.on('data', chunk => {
        output += chunk
        const path = output.split('\n').find(line => line.startsWith('/') && !line.includes('\0'))
        if (path) { clearTimeout(timer); resolveMount(path.trim()) }
      })
    })
    if ((await statfs(mounted)).type !== 0x65735546) throw new Error('Native AppImage guard inspection requires an actual FUSE mount.')
    return await readFile(join(mounted, 'resources/app.asar'))
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT')
    await Promise.race([exited, new Promise(resolveDelay => setTimeout(resolveDelay, 5000))])
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}
