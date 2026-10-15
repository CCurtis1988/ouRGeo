import { constants } from 'node:fs'
import { lstat, open, readFile, readdir, readlink, realpath } from 'node:fs/promises'
import { createHash, createHmac } from 'node:crypto'
import { basename, dirname, isAbsolute, join, resolve, relative as relativePath } from 'node:path'
import type { MemoryConnection } from '../../../src/lib/context/providers/connections'
import type { ConformanceReport } from '../../../src/lib/context/providers/conformance'
import type { DeploymentReview } from './providers/certification'
import { connectionDigest } from './providers/routing'
import { HINDSIGHT_PROFILE } from './providers/hindsight'
import evidence from '../../../docs/context-hindsight-local-evidence.json'

export const HINDSIGHT_LOCAL_PROFILE = 'hindsight-local-chunks-v1'
const sourceFiles = ['hindsight-local-server.py', 'hindsight-gateway.py', 'hindsight-retention.py']
const sha = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

/** Installed distributions differ from source/API pins. This fingerprint
 * includes dependency code, native libraries and packaged pg0; only generated
 * bytecode and installation-location receipts are excluded. No code is run. */
export async function hindsightDistribution(directory: string): Promise<{ files: number; bytes: number; sha256: string }> {
  const files: string[] = []
  let entries = 0, bytes = 0
  async function visit(relative: string): Promise<void> {
    const path = join(directory, relative), info = await lstat(path)
    if (++entries > 100000 || !info.isSymbolicLink() && (info.mode & 0o022 || !info.isFile() && !info.isDirectory())) throw new Error('Review the bounded private Hindsight distribution.')
    if (info.isSymbolicLink()) {
      const target = await readlink(path), resolved = await realpath(path), inside = relativePath(directory, resolved)
      if (isAbsolute(target) || inside.startsWith('../') || isAbsolute(inside) || !(await lstat(resolved)).isFile()) throw new Error('Review linked files outside the pinned distribution.')
      files.push(relative); return
    }
    if (info.isDirectory()) {
      for (const name of await readdir(path)) if (name !== '__pycache__') await visit(relative ? `${relative}/${name}` : name)
    } else if (!['RECORD', 'direct_url.json'].includes(basename(path))) {
      if (info.nlink !== 1 || info.size > 512 * 1024 * 1024 || info.mode & 0o022) throw new Error('Repair the private Hindsight distribution before review.')
      files.push(relative)
    }
  }
  await visit('')
  const hash = createHash('sha256')
  for (const relative of files.sort()) {
    if ((await lstat(join(directory, relative))).isSymbolicLink()) {
      hash.update(JSON.stringify([relative, 'symlink', await readlink(join(directory, relative))]) + '\n')
      continue
    }
    const file = await open(join(directory, relative), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = await file.stat(), content = createHash('sha256')
      bytes += before.size
      if (bytes > 2 * 1024 * 1024 * 1024) throw new Error('Review the bounded Hindsight distribution size.')
      for await (const chunk of file.createReadStream({ autoClose: false })) content.update(chunk)
      const after = await file.stat()
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Hindsight changed during deployment review.')
      hash.update(JSON.stringify([relative, before.size, content.digest('hex')]) + '\n')
    } finally { await file.close() }
  }
  return { files: files.length, bytes, sha256: hash.digest('hex') }
}

interface Attached { directory: string; pid: number; start: string; endpoint: string; namespace: string }
async function processStart(pid: number): Promise<string> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)
  if (fields[0] === 'Z' || !/^\d+$/.test(fields[19])) throw new Error('Restart and review the dedicated Hindsight server.')
  return fields[19]
}
async function privateFile(file: string, maximum: number): Promise<Buffer> {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid!() || info.mode & 0o077 || info.size > maximum) throw new Error('Use the private deployment files owned by this account.')
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { return await handle.readFile() } finally { await handle.close() }
}

/** Attaches to an operator-started server; it does not install or supervise a
 * managed Hindsight runtime. No renderer, endpoint assertion or plugin can add
 * deployment reviews. A cold desktop restart requires native review again. */
export class HindsightLocalProfiles {
  private attached = new Map<string, Attached>()
  constructor(private bundledSources: string, private fetcher: typeof fetch = fetch) {}
  owns(connection: MemoryConnection): boolean {
    const current = this.attached.get(connection.id)
    return Boolean(current && connection.adapter === 'hindsight' && connection.localProfile === HINDSIGHT_LOCAL_PROFILE && connection.location === 'loopback'
      && connection.endpoint === current.endpoint && connection.namespaceRef === current.namespace && connection.profileDirectory === current.directory && connection.credentialRef)
  }
  revoke(id: string): void { this.attached.delete(id) }
  async verify(connection: MemoryConnection): Promise<void> {
    const current = this.attached.get(connection.id)
    if (!this.owns(connection) || !current || await processStart(current.pid) !== current.start) { this.revoke(connection.id); throw new Error('Restart and review the dedicated Hindsight server before processing memory.') }
  }
  async attach(directory: string, id: string, namespace: string): Promise<{ endpoint: string; token: string; directory: string }> {
    if (process.platform !== 'linux' || process.arch !== 'x64' || !isAbsolute(directory) || !/^[a-f0-9-]{36}$/i.test(id) || !/^[a-f0-9-]{36}$/i.test(namespace)
      || !evidence.passed || this.attached.size >= 32 && !this.attached.has(id)) throw new Error('Use the reviewed Linux x64 Hindsight deployment profile.')
    const root = await realpath(directory), info = await lstat(directory)
    if (root !== resolve(directory) || !info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.mode & 0o077) throw new Error('Choose the private dedicated Hindsight server directory (mode 0700).')
    const metadata = JSON.parse((await privateFile(join(root, 'server.json'), 8192)).toString()) as Record<string, unknown>
    if (metadata.version !== 1 || metadata.profile !== HINDSIGHT_LOCAL_PROFILE || metadata.llm !== 'none' || metadata.processing !== 'local-lexical-hash-128'
      || !Number.isSafeInteger(metadata.pid) || Number(metadata.pid) <= 1 || typeof metadata.endpoint !== 'string' || typeof metadata.script !== 'string'
      || typeof metadata.python !== 'string' || typeof metadata.sitePackages !== 'string' || typeof metadata.postgresDirectory !== 'string' || !isAbsolute(metadata.postgresDirectory) || !isAbsolute(metadata.script) || basename(metadata.script) !== 'hindsight-local-server.py' || !isAbsolute(metadata.sitePackages)
      || !metadata.sitePackages.endsWith('/lib/python3.14/site-packages')) throw new Error('Use the shipped dedicated Hindsight launcher and pinned private environment.')
    const endpoint = new URL(metadata.endpoint)
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Use the exact private loopback Hindsight listener.')
    const pid = Number(metadata.pid), start = await processStart(pid), proc = `/proc/${pid}`
    const uid = Number((await readFile(join(proc, 'status'), 'utf8')).match(/^Uid:\s+(\d+)/m)?.[1])
    const argv = (await readFile(join(proc, 'cmdline'), 'utf8')).split('\0').filter(Boolean)
    if (uid !== process.getuid!() || await readlink(join(proc, 'cwd')) !== root || argv.length !== 8 && argv.length !== 10
      || argv[1] !== '-I' || argv[2] !== '-B' || argv[3] !== metadata.script || argv[4] !== '--state' || argv[5] !== root
      || argv.length === 10 && (argv[6] !== '--port' || !/^[0-9]{1,5}$/.test(argv[7]))
      || argv[argv.length - 2] !== '--postgres' || await realpath(argv[argv.length - 1]) !== join(metadata.postgresDirectory, 'bin/postgres')
      || await realpath(argv[0]) !== metadata.python || await readlink(join(proc, 'exe')) !== metadata.python
      || sha(await readFile(metadata.python as string)) !== evidence.pythonSha256) throw new Error('Review the exact running private Python process before attaching.')
    const venv = dirname(dirname(dirname(metadata.sitePackages)))
    if (!/^include-system-site-packages\s*=\s*false$/m.test(await readFile(join(venv, 'pyvenv.cfg'), 'utf8')) || await realpath(join(venv, 'bin/python')) !== metadata.python) throw new Error('Use the isolated reviewed Hindsight virtual environment.')
    for (const name of sourceFiles) {
      const expected = evidence.sourceHashes[name as keyof typeof evidence.sourceHashes]
      if (sha(await readFile(join(this.bundledSources, name))) !== expected || sha(await readFile(join(dirname(metadata.script), name))) !== expected) throw new Error('Update the dedicated Hindsight launcher to match this ouRGeo release.')
    }
    const distribution = await hindsightDistribution(metadata.sitePackages)
    if (JSON.stringify(distribution) !== JSON.stringify(evidence.distribution)) throw new Error('Use the exact dependency distribution recorded in the Hindsight deployment evidence.')
    if (JSON.stringify(await hindsightDistribution(metadata.postgresDirectory)) !== JSON.stringify(evidence.postgresDistribution)) throw new Error('Use the exact pinned PostgreSQL distribution recorded in the deployment evidence.')
    const listeners = (await readFile('/proc/net/tcp', 'utf8')).split('\n').filter(line => line.trim().split(/\s+/)[1] === `0100007F:${Number(endpoint.port).toString(16).toUpperCase().padStart(4, '0')}` && line.trim().split(/\s+/)[3] === '0A')
    const descriptors = await Promise.all((await readdir(join(proc, 'fd'))).map(async fd => { try { return await readlink(join(proc, 'fd', fd)) } catch { return '' } }))
    if (listeners.length !== 1 || !descriptors.includes(`socket:[${listeners[0].trim().split(/\s+/)[9]}]`)) throw new Error('The reviewed process does not own this Hindsight listener.')
    const secret = await privateFile(join(root, 'server-secret'), 32)
    if (secret.length !== 32 || start !== await processStart(pid)) throw new Error('The Hindsight server changed during review. Refresh its deployment.')
    const token = `${namespace}.${createHmac('sha256', secret).update(namespace).digest('hex')}`
    secret.fill(0)
    const response = await this.fetcher(`${metadata.endpoint}/health`, { redirect: 'error', signal: AbortSignal.timeout(3000), headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok || Number(response.headers.get('content-length')) > 8192) { await response.body?.cancel(); throw new Error('Wait for the dedicated Hindsight server to become healthy, then review it again.') }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('The dedicated Hindsight health response was empty.')
    const chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break
        bytes += chunk.value.length; if (bytes > 8192) throw new Error('The Hindsight health response exceeded its review limit.')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    if (!['healthy', 'ok'].includes(JSON.parse(Buffer.concat(chunks).toString()).status) || await processStart(pid) !== start) throw new Error('Repair the dedicated Hindsight server before attaching it.')
    this.attached.set(id, { directory: root, pid, start, endpoint: metadata.endpoint, namespace })
    return { endpoint: metadata.endpoint, token, directory: root }
  }
  review(connection: MemoryConnection): DeploymentReview {
    if (!this.owns(connection) || !evidence.passed || !evidence.networkAuditPassed || !evidence.derivativeDeletionPassed || !evidence.restartVerified
      || connection.destinations.length !== 7 || connection.destinations.some(item => item.destination !== (['storage', 'embeddings', 'reranking'].includes(item.purpose) ? connection.endpoint : 'disabled'))) throw new Error('Complete the named Hindsight deployment review before activation.')
    const hash = sha(Buffer.from(JSON.stringify(evidence)))
    return { id: 'hindsight-local-chunks-linux-review-v1', adapter: 'hindsight', providerId: 'hindsight', adapterVersion: HINDSIGHT_PROFILE.commit,
      connectionId: connection.id, connectionDigest: connectionDigest(connection), reviewedAt: evidence.measuredAt, expiresAt: new Date(Date.parse(evidence.measuredAt) + 90 * 86400_000).toISOString(),
      isolation: 'native', timeoutMs: 15000, maxTokens: 2000, conformance: evidence.conformance as ConformanceReport,
      audits: Object.fromEntries(['authenticated-transport', 'scope-access-control', 'derivative-deletion', 'processing-destinations', 'bounded-billing', 'recovery'].map(name => [name, { status: 'passed', evidenceSha256: hash }])) as DeploymentReview['audits'],
      operations: { read: { processing: 'non-billable' }, search: { processing: 'non-billable' }, upsert: { processing: 'non-billable' }, delete: { processing: 'non-billable' } } }
  }
}
