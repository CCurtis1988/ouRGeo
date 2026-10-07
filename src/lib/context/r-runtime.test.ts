import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('loads the schema handler in the actual R server and distinguishes same-name environments without sampling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ourgeo-context-r-'))
  const child = spawn('Rscript', ['--vanilla', resolve('r/server.R')], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-10000) })
  try {
    const port = await new Promise<number>((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error(`R startup timed out: ${output}`)), 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`R exited (${code}): ${output}`)) })
      child.stdout.on('data', chunk => {
        output = (output + chunk).slice(-10000)
        const match = output.match(/OURGEO_PORT:(\d+)/)
        if (match && output.includes('OURGEO_READY')) { clearTimeout(timer); resolvePort(Number(match[1])) }
      })
    })
    const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) })
      return response.json()
    }
    expect(await post('/r/execute', { code: 'roads <- data.frame(income = c(12, 23)); study <- new.env(); study$roads <- data.frame(length_m = 10)' })).toMatchObject({ success: true })
    const global = await post('/context/schema', { name: 'roads', envName: '.GlobalEnv' })
    const study = await post('/context/schema', { name: 'roads', envName: 'study' })
    expect(global).toMatchObject({ success: true, columns: [{ name: 'income' }] })
    expect(study).toMatchObject({ success: true, columns: [{ name: 'length_m' }] })
    expect(JSON.stringify(global)).not.toContain('23')
    expect(await post('/r/execute', { code: 'makeActiveBinding("danger", function() stop("binding evaluated"), .GlobalEnv)' })).toMatchObject({ success: true })
    expect(await post('/context/schema', { name: 'danger', envName: '.GlobalEnv' })).toMatchObject({ success: false, error: expect.stringContaining('active or lazy binding') })
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM')
    await new Promise<void>(resolveExit => { if (child.exitCode !== null) resolveExit(); else { const timer = setTimeout(resolveExit, 1000); child.once('exit', () => { clearTimeout(timer); resolveExit() }) } })
    await rm(directory, { recursive: true, force: true })
  }
}, 25000)
