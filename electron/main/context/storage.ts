import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { MemoryRecord } from '../../../src/lib/context/types'
import type { ProjectContext, AuthorisedFileLink } from '../../../src/lib/context/types'
import type { ProviderBinding, OutboxOperation, OutboxJob, OutboxReceipt } from '../../../src/lib/context/providers/outbox'
import { randomUUID } from 'node:crypto'
import { applyMemoryRevision } from '../../../src/lib/context/preferences'
import type { MemoryConnection } from '../../../src/lib/context/providers/connections'
import { backupMemoryDatabase } from './storage-backup'
import type { CanonicalScopeSnapshot } from '../../../src/lib/context/providers/types'

export const MEMORY_SCHEMA_VERSION = 11

/** SQLite never sees canonical plaintext on disk. FTS exists in a separate
 * in-memory database, so its pages, WAL and temp files cannot leak statements.
 * The OS-protected key is supplied by main, never by the renderer. */
export class MemoryStorage {
  private db: DatabaseSync
  private index = new DatabaseSync(':memory:')
  constructor(path: string, private key: Buffer) {
    this.db = new DatabaseSync(path)
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
      if (version > MEMORY_SCHEMA_VERSION) throw new Error('This memory store needs a newer ouRGeo version. Preserve it and upgrade before writing.')
      if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Memory storage is damaged. Preserve it and restore a supported backup before writing.')
      if (version > 0 && version < MEMORY_SCHEMA_VERSION && path !== ':memory:') {
        // A wrong/unavailable key must not create repeated recovery copies or
        // advance the schema. Validate every existing encrypted record first.
        for (const table of ['memories', 'journals', 'provider_bindings', 'outbox', 'file_links', 'exclusions', 'project_locations', 'memory_connections', 'memory_credentials', 'provider_snapshots']) {
          if (this.db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table', table)) {
            for (const row of this.db.prepare(`SELECT * FROM ${table}`).all()) this.unseal(row)
          }
        }
        backupMemoryDatabase(this.db, path, version)
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA temp_store=MEMORY; PRAGMA secure_delete=ON; BEGIN IMMEDIATE;')
      try {
        this.db.exec('CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS suppressed_sources(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS record_scopes(id TEXT PRIMARY KEY, scope TEXT NOT NULL); CREATE TABLE IF NOT EXISTS provider_bindings(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS file_links(id TEXT PRIMARY KEY, payload BLOB NOT NULL);')
        this.db.exec('CREATE TABLE IF NOT EXISTS exclusions(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS project_locations(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS memory_connections(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS memory_credentials(id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS remote_namespaces(id TEXT PRIMARY KEY, scope TEXT NOT NULL);')
        this.db.exec('CREATE TABLE IF NOT EXISTS provider_snapshots(id TEXT PRIMARY KEY, payload BLOB NOT NULL);')
        for (const connection of this.connections()) {
          const identity = this.namespaceIdentity(connection)
          const claimed = this.db.prepare('SELECT scope FROM remote_namespaces WHERE id=?').get(identity)
          if (claimed && claimed.scope !== connection.scope) throw new Error('Conflicting memory namespaces need review. Preserve the original store and give each scope a separate bank.')
          this.db.prepare('INSERT OR IGNORE INTO remote_namespaces VALUES (?, ?)').run(identity, connection.scope)
        }
        this.db.exec(`PRAGMA user_version=${MEMORY_SCHEMA_VERSION}; COMMIT;`)
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
      this.index.exec('PRAGMA temp_store=MEMORY; CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, scope UNINDEXED, statement);')
      for (const record of this.list()) {
        this.claim(record.id, record.scope === 'global' ? 'global' : `project:${record.projectId}`)
        if (record.status === 'active') this.index.prepare('INSERT INTO search VALUES (?, ?, ?)').run(record.id, record.scope === 'global' ? 'global' : `project:${record.projectId}`, record.statement)
      }
    } catch (error) { this.index.close(); this.db.close(); throw error }
  }
  private seal(id: string, value: unknown): Buffer {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from(id))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted])
  }
  private unseal(row: Record<string, unknown>): unknown {
    const payload = Buffer.from(row.payload as Uint8Array)
    const decipher = createDecipheriv('aes-256-gcm', this.key, payload.subarray(0, 12))
    decipher.setAAD(Buffer.from(String(row.id)))
    decipher.setAuthTag(payload.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'))
  }
  private decode(row: Record<string, unknown>): MemoryRecord { return this.unseal(row) as MemoryRecord }
  connections(): MemoryConnection[] { return this.db.prepare('SELECT * FROM memory_connections').all().map(row => this.unseal(row) as MemoryConnection) }
  connection(id: string): MemoryConnection | undefined { return this.connections().find(connection => connection.id === id) }
  credential(reference: string): string | undefined {
    const row = this.db.prepare('SELECT * FROM memory_credentials WHERE id=?').get(reference)
    return row ? this.unseal(row) as string : undefined
  }
  private namespaceIdentity(connection: MemoryConnection): string {
    const endpoint = new URL(connection.endpoint)
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') || '/'
    return createHash('sha256').update(JSON.stringify([connection.adapter, endpoint.href, connection.namespaceRef])).digest('hex')
  }
  saveConnection(connection: MemoryConnection, token?: string): void {
    if (connection.certification !== 'pending') throw new Error('Only the host certification registry can grant provider capabilities.')
    const previous = this.connection(connection.id)
    if (previous && (connection.revision !== previous.revision + 1 || connection.scope !== previous.scope || connection.namespaceRef !== previous.namespaceRef || connection.credentialRef !== previous.credentialRef)) throw new Error('The connection changed. Refresh its settings before updating it.')
    if (!previous && this.connections().length >= 32) throw new Error('Remove disconnected connection settings before adding another.')
    const namespaceIdentity = this.namespaceIdentity(connection)
    const claimed = this.db.prepare('SELECT scope FROM remote_namespaces WHERE id=?').get(namespaceIdentity)
    if (claimed && claimed.scope !== connection.scope) throw new Error('Use a dedicated bank for this scope. This namespace is already associated with another scope.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT OR IGNORE INTO remote_namespaces VALUES (?, ?)').run(namespaceIdentity, connection.scope)
      if (token !== undefined) {
        if (!connection.credentialRef || previous) throw new Error('Create a new connection to replace its credentials.')
        this.db.prepare('INSERT INTO memory_credentials VALUES (?, ?)').run(connection.credentialRef, this.seal(connection.credentialRef, token))
      }
      if (connection.state === 'disconnected' && connection.credentialRef) this.db.prepare('DELETE FROM memory_credentials WHERE id=?').run(connection.credentialRef)
      this.db.prepare('INSERT INTO memory_connections VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(connection.id, this.seal(connection.id, connection))
      for (const binding of this.bindings()) if (binding.connectionRef === connection.id) {
        if (connection.state === 'disconnected') {
          const revoked = { ...binding, enabled: false, policyRevision: binding.policyRevision + 1 }
          this.db.prepare('UPDATE provider_bindings SET payload=? WHERE id=?').run(this.seal(binding.id, revoked), binding.id)
          for (const job of this.outbox()) if (job.bindingId === binding.id && !['confirmed', 'cancelled'].includes(job.status)) this.putJob({ ...job, status: 'cancelled', reason: 'revoked' })
        }
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  removeConnection(id: string): void {
    const connection = this.connection(id)
    if (!connection || connection.state !== 'disconnected') throw new Error('Disconnect before removing these settings.')
    // Keep namespace claims, revoked bindings and deletion receipts: removing setup metadata is
    // not evidence that the service has erased its managed copies.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (connection.credentialRef) this.db.prepare('DELETE FROM memory_credentials WHERE id=?').run(connection.credentialRef)
      this.db.prepare('DELETE FROM memory_connections WHERE id=?').run(id)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private claim(id: string, scope: string): void {
    const previous = this.db.prepare('SELECT scope FROM record_scopes WHERE id=?').get(id)
    if (previous && previous.scope !== scope) throw new Error('POLICY_REFUSED: memory identity belongs to another scope. Import an independent copy.')
    this.db.prepare('INSERT OR IGNORE INTO record_scopes VALUES (?, ?)').run(id, scope)
  }
  registerProjectReferences(projectId: string, ids: string[]): string[] {
    const scope = `project:${projectId}`
    const allowed: string[] = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of this.filterDeleted(ids)) {
        const existing = this.db.prepare('SELECT scope FROM record_scopes WHERE id=?').get(id)
        if (existing && existing.scope !== scope) continue
        this.claim(id, scope)
        allowed.push(id)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return allowed
  }
  list(scope?: string): MemoryRecord[] {
    const rows = scope === undefined ? this.db.prepare('SELECT * FROM memories WHERE id NOT IN (SELECT id FROM tombstones)').all()
      : this.db.prepare('SELECT memories.* FROM memories JOIN record_scopes ON memories.id=record_scopes.id WHERE scope=? AND memories.id NOT IN (SELECT id FROM tombstones)').all(scope)
    return rows.flatMap(row => {
      const record = this.decode(row)
      if (record.status === 'candidate' && Date.now() - Date.parse(record.createdAt) > 30 * 86400_000) { this.forget(record.id, [], record.scope === 'global' ? 'global' : `project:${record.projectId}`); return [] }
      return [record]
    })
  }
  /** Provider generations are allocated from committed canonical state in the
   * worker, not guessed from timestamps or selected by an assistant. Equal
   * snapshots retry idempotently; every change, including deletion, advances it. */
  scopeSnapshot(scope: string): CanonicalScopeSnapshot {
    if (!/^(global|project:[a-f0-9-]{36})$/i.test(scope)) throw new Error('POLICY_REFUSED')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const records = this.db.prepare('SELECT memories.* FROM memories JOIN record_scopes ON memories.id=record_scopes.id WHERE scope=? AND memories.id NOT IN (SELECT id FROM tombstones)').all(scope)
        .map(row => this.decode(row)).filter(record => record.status === 'active').sort((a, b) => a.id.localeCompare(b.id))
      if (records.length > 10000 || records.some(record => (record.scope === 'global' ? 'global' : `project:${record.projectId}`) !== scope)) throw new Error('BUDGET_LIMIT')
      const text = JSON.stringify(records)
      if (Buffer.byteLength(text) > 40_000_000) throw new Error('BUDGET_LIMIT')
      const digest = createHash('sha256').update(text).digest('hex')
      const row = this.db.prepare('SELECT * FROM provider_snapshots WHERE id=?').get(scope)
      const previous = row ? this.unseal(row) as { generation: number; digest: string } : undefined
      if (previous && (!Number.isSafeInteger(previous.generation) || previous.generation < 1 || !/^[a-f0-9]{64}$/.test(previous.digest))) throw new Error('Memory generation metadata is damaged. Preserve it and restore a supported backup.')
      const generation = previous ? previous.generation + Number(previous.digest !== digest) : 1
      if (!Number.isSafeInteger(generation)) throw new Error('Memory generations need a reviewed index migration before further writes.')
      if (!previous || previous.digest !== digest) this.db.prepare('INSERT INTO provider_snapshots VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(scope, this.seal(scope, { generation, digest }))
      this.db.exec('COMMIT')
      return { generation, records }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  scopeSnapshotCurrent(scope: string, generation: number): boolean { return this.scopeSnapshot(scope).generation === generation }
  save(record: MemoryRecord): MemoryRecord {
    if (this.db.prepare('SELECT id FROM tombstones WHERE id=?').get(record.id)) throw new Error('This memory was forgotten. Create a new explicit memory instead.')
    const changedIds: string[] = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.claim(record.id, record.scope === 'global' ? 'global' : `project:${record.projectId}`)
      const previous = this.db.prepare('SELECT * FROM memories WHERE id=?').get(record.id)
      if (previous) {
        const current = this.decode(previous)
        if (current.revision === record.revision && JSON.stringify(current) === JSON.stringify({ ...record, supersedes: current.supersedes })) { this.db.exec('COMMIT'); return current }
        if (record.revision !== current.revision + 1) throw new Error('This memory changed. Refresh the library before editing it.')
      }
      if (previous && (this.decode(previous).scope !== record.scope || this.decode(previous).projectId !== record.projectId)) throw new Error('Memory identity belongs to another scope. Import this record as a copy.')
      const scope = record.scope === 'global' ? 'global' : `project:${record.projectId}`
      const records = this.db.prepare('SELECT memories.* FROM memories JOIN record_scopes ON memories.id=record_scopes.id WHERE scope=? AND memories.id NOT IN (SELECT id FROM tombstones)').all(scope).map(row => this.decode(row))
      const update = applyMemoryRevision(records, record)
      record = update.record
      for (const changed of update.changed) {
        changedIds.push(changed.id)
        this.db.prepare('UPDATE memories SET payload=? WHERE id=?').run(this.seal(changed.id, changed), changed.id)
        this.queueRecord(changed)
      }
      this.db.prepare('INSERT INTO memories VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(record.id, this.seal(record.id, record))
      this.queueRecord(record)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    for (const id of [record.id, ...changedIds]) this.index.prepare('DELETE FROM search WHERE id=?').run(id)
    if (record.status === 'active') this.index.prepare('INSERT INTO search VALUES (?, ?, ?)').run(record.id, record.scope === 'global' ? 'global' : `project:${record.projectId}`, record.statement)
    return record
  }
  learn(record: MemoryRecord): MemoryRecord | null {
    const records = this.list()
    if (record.evidence.some(id => this.db.prepare('SELECT id FROM suppressed_sources WHERE id=?').get(id))) return null
    const duplicate = records.find(m => ['candidate', 'active'].includes(m.status) && m.scope === record.scope && m.projectId === record.projectId && m.statement.toLocaleLowerCase() === record.statement.toLocaleLowerCase())
    return duplicate ?? this.save(record)
  }
  forget(id: string, sources: string[] = [], scope = 'global'): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.claim(id, scope)
      const row = this.db.prepare('SELECT * FROM memories WHERE id=?').get(id)
      const evidence = row ? this.decode(row).evidence : sources
      for (const source of evidence) this.db.prepare('INSERT OR IGNORE INTO suppressed_sources VALUES (?)').run(source)
      this.db.prepare('INSERT OR IGNORE INTO tombstones VALUES (?)').run(id)
      this.db.prepare('DELETE FROM memories WHERE id=?').run(id)
      for (const journal of this.db.prepare('SELECT * FROM journals').all()) {
        const draft = this.unseal(journal) as { baseRevision: number; context: ProjectContext }
        if (draft.context.memories.some(memory => memory.id === id)) {
          const context = { ...draft.context, revision: draft.context.revision + 1, memories: draft.context.memories.filter(memory => memory.id !== id) }
          this.db.prepare('UPDATE journals SET payload=? WHERE id=?').run(this.seal(String(journal.id), { ...draft, context }), String(journal.id))
        }
      }
      // Cancel unsent ingestion, but delete even if a running/finished write
      // may have reached the provider. A late ingestion receipt cannot undo it.
      for (const job of this.outbox()) {
        if (job.canonicalId !== id) continue
        if (job.operation === 'upsert' && !['confirmed', 'cancelled'].includes(job.status)) this.putJob({ ...job, status: 'cancelled', reason: 'superseded' })
        const binding = this.binding(job.bindingId)
        if (binding && job.operation === 'upsert') this.queueDeletion(id, Math.max(job.revision + 1, row ? this.decode(row).revision + 1 : 1), binding)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    this.index.prepare('DELETE FROM search WHERE id=?').run(id)
  }
  filterDeleted(ids: string[]): string[] { return ids.filter(id => !this.db.prepare('SELECT id FROM tombstones WHERE id=?').get(id)) }
  filterLearningSources(ids: string[]): string[] { return ids.filter(id => !this.db.prepare('SELECT id FROM suppressed_sources WHERE id=?').get(id)) }
  saveFileLinks(projectId: string, links: AuthorisedFileLink[]): void {
    this.db.prepare('INSERT INTO file_links VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(projectId, this.seal(projectId, links))
  }
  fileLinks(projectId: string): AuthorisedFileLink[] {
    const row = this.db.prepare('SELECT * FROM file_links WHERE id=?').get(projectId)
    return row ? this.unseal(row) as AuthorisedFileLink[] : []
  }
  exclusions(scope: string): string[] {
    const row = this.db.prepare('SELECT * FROM exclusions WHERE id=?').get(scope)
    return row ? this.unseal(row) as string[] : []
  }
  projectLocation(projectId: string): string | null {
    const row = this.db.prepare('SELECT * FROM project_locations WHERE id=?').get(projectId)
    return row ? this.unseal(row) as string : null
  }
  saveProjectLocation(projectId: string, path: string): void {
    if (!path || path.length > 8192) throw new Error('Project location is too long. Save it at a shorter path.')
    if (!this.projectLocation(projectId) && Number(this.db.prepare('SELECT COUNT(*) AS total FROM project_locations').get()?.total) >= 10000) throw new Error('The local project registry is full. Export or review old project metadata before adding another.')
    this.db.prepare('INSERT INTO project_locations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(projectId, this.seal(projectId, path))
  }
  exclude(scope: string, id: string, excluded: boolean): void {
    const ids = this.exclusions(scope).filter(existing => existing !== id)
    if (excluded) ids.push(id)
    if (ids.length > 10000 || JSON.stringify(ids).length > 8_000_000) throw new Error('Too many excluded sources. Review a smaller selection.')
    this.db.prepare('INSERT INTO exclusions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(scope, this.seal(scope, ids))
  }
  private binding(id: string): ProviderBinding | null {
    const row = this.db.prepare('SELECT * FROM provider_bindings WHERE id=?').get(id)
    return row ? this.unseal(row) as ProviderBinding : null
  }
  private bindings(): ProviderBinding[] {
    return this.db.prepare('SELECT * FROM provider_bindings').all().map(row => this.unseal(row) as ProviderBinding)
  }
  outbox(): OutboxOperation[] { return this.db.prepare('SELECT * FROM outbox').all().map(row => this.unseal(row) as OutboxOperation) }
  private putJob(job: OutboxOperation): void {
    if (!this.db.prepare('SELECT id FROM outbox WHERE id=?').get(job.id) && Number(this.db.prepare('SELECT COUNT(*) AS count FROM outbox').get()?.count) >= 10000) throw new Error('Provider queue is full. Resolve or export pending operations before adding memory; canonical records are preserved.')
    this.db.prepare('INSERT INTO outbox VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(job.id, this.seal(job.id, job))
  }
  private queueDeletion(id: string, revision: number, binding: ProviderBinding): void {
    if (this.outbox().some(job => job.bindingId === binding.id && job.canonicalId === id && job.operation === 'delete' && ['queued', 'running', 'pending'].includes(job.status))) return
    const now = new Date().toISOString()
    this.putJob({ id: randomUUID(), bindingId: binding.id, scope: binding.scope, canonicalId: id, revision, policyRevision: binding.policyRevision,
      operation: 'delete', status: binding.enabled ? 'queued' : 'cancelled', ...(binding.enabled ? {} : { reason: 'revoked' as const }), attempts: 0, createdAt: now, nextAttemptAt: now })
  }
  private queueRecord(record: MemoryRecord): void {
    const scope = record.scope === 'global' ? 'global' : `project:${record.projectId}`
    for (const binding of this.bindings().filter(binding => binding.scope === scope && binding.enabled && binding.writesCertified)) {
      const jobs = this.outbox().filter(job => job.bindingId === binding.id && job.canonicalId === record.id)
      if (jobs.some(job => job.revision === record.revision && job.operation === 'upsert' && job.status !== 'cancelled')) continue
      for (const job of jobs) if (job.operation === 'upsert' && !['confirmed', 'cancelled'].includes(job.status)) this.putJob({ ...job, status: 'cancelled', reason: 'superseded' })
      if (record.status !== 'active') {
        if (jobs.some(job => job.operation === 'upsert')) this.queueDeletion(record.id, record.revision, binding)
        continue
      }
      const now = new Date().toISOString()
      this.putJob({ id: randomUUID(), bindingId: binding.id, scope, canonicalId: record.id, revision: record.revision, policyRevision: binding.policyRevision,
        operation: 'upsert', status: 'queued', attempts: 0, createdAt: now, nextAttemptAt: now })
    }
  }
  /** Only a reviewed host connection flow may configure bindings. It never
   * bulk-migrates existing records or accepts a provider namespace from a model. */
  configureBinding(binding: ProviderBinding): void {
    if (![binding.id, binding.namespaceRef, binding.connectionRef, binding.adapterVersion].every(value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value))
      || !['mnemosyne', 'hindsight'].includes(binding.adapter) || typeof binding.enabled !== 'boolean' || typeof binding.writesCertified !== 'boolean'
      || !/^(global|project:[a-f0-9-]{36})$/i.test(binding.scope) || !Number.isSafeInteger(binding.policyRevision) || binding.policyRevision < 0) throw new Error('Invalid host memory binding.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.binding(binding.id)
      if (binding.enabled && this.bindings().some(other => other.id !== binding.id && other.scope === binding.scope && other.enabled)) throw new Error('Choose one primary provider per scope before migrating.')
      if (previous && (previous.scope !== binding.scope || previous.namespaceRef !== binding.namespaceRef || previous.connectionRef !== binding.connectionRef || previous.adapter !== binding.adapter || binding.policyRevision <= previous.policyRevision)) throw new Error('Create a new binding for migration; increment policy revision to change access.')
      this.db.prepare('INSERT INTO provider_bindings VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(binding.id, this.seal(binding.id, binding))
      for (const job of this.outbox()) if (job.bindingId === binding.id && !['confirmed', 'cancelled'].includes(job.status)) this.putJob({ ...job, status: 'cancelled', reason: 'revoked' })
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  /** Claim with an expiry so a worker crash retries the same operation ID.
   * Uncertain paid ingestion must be reconciled by the adapter, not blindly
   * replayed: pending jobs require an explicit completion receipt. */
  claimJob(now = Date.now(), scopes?: string[]): OutboxJob | null {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const job of this.outbox()) {
        if (scopes && !scopes.includes(job.scope)) continue
        if (!['queued', 'running'].includes(job.status) || Date.parse(job.nextAttemptAt) > now || (job.status === 'running' && Date.parse(job.leaseUntil ?? '') > now)) continue
        const binding = this.binding(job.bindingId)
        if (!binding?.enabled || !binding.writesCertified || binding.scope !== job.scope || binding.policyRevision !== job.policyRevision) { this.putJob({ ...job, status: 'cancelled', reason: 'revoked' }); continue }
        const row = this.db.prepare('SELECT * FROM memories WHERE id=? AND id NOT IN (SELECT id FROM tombstones)').get(job.canonicalId)
        const record = row ? this.decode(row) : undefined
        if (job.operation === 'upsert' && (!record || record.revision !== job.revision || record.status !== 'active')) { this.putJob({ ...job, status: 'cancelled', reason: 'superseded' }); continue }
        // A crashed upsert can have billed processing already. Do not retry
        // it without verifying completion through a provider read/receipt.
        if (job.status === 'running' && job.operation === 'upsert') { this.putJob({ ...job, status: 'pending', reason: 'awaiting-completion' }); continue }
        if (job.attempts >= 6 || now - Date.parse(job.createdAt) > 7 * 86400_000) { this.putJob({ ...job, status: 'failed', reason: 'retry-limit' }); continue }
        const claimed = { ...job, status: 'running' as const, attempts: job.attempts + 1, leaseUntil: new Date(now + 30_000).toISOString() }
        this.putJob(claimed)
        this.db.exec('COMMIT')
        return { operation: claimed, binding, ...(record && job.operation === 'upsert' ? { record } : {}) }
      }
      this.db.exec('COMMIT')
      return null
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  /** Recovery reads are leased independently of ingestion attempts. They can
   * confirm a matching source revision, but never enqueue another paid retain
   * merely because a timeout left its outcome unknown. */
  claimPendingJob(now = Date.now(), scopes?: string[]): OutboxJob | null {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const job of this.outbox()) {
        if (job.status !== 'pending' || job.operation !== 'upsert' || (scopes && !scopes.includes(job.scope)) || Date.parse(job.nextAttemptAt) > now || Date.parse(job.leaseUntil ?? '') > now) continue
        const binding = this.binding(job.bindingId)
        if (!binding?.enabled || !binding.writesCertified || binding.scope !== job.scope || binding.policyRevision !== job.policyRevision) { this.putJob({ ...job, status: 'cancelled', reason: 'revoked' }); continue }
        const row = this.db.prepare('SELECT * FROM memories WHERE id=? AND id NOT IN (SELECT id FROM tombstones)').get(job.canonicalId)
        const record = row ? this.decode(row) : undefined
        if (!record || record.status !== 'active' || record.revision !== job.revision) { this.putJob({ ...job, status: 'cancelled', reason: 'superseded' }); continue }
        if ((job.reconciliationAttempts ?? 0) >= 6 || now - Date.parse(job.createdAt) > 7 * 86400_000) {
          this.putJob({ ...job, reason: 'reconciliation-limit', nextAttemptAt: new Date(now + 7 * 86400_000).toISOString() }); continue
        }
        const claimed = { ...job, reconciliationAttempts: (job.reconciliationAttempts ?? 0) + 1, leaseUntil: new Date(now + 30_000).toISOString() }
        this.putJob(claimed)
        this.db.exec('COMMIT')
        return { operation: claimed, binding, record }
      }
      this.db.exec('COMMIT'); return null
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  currentJob(id: string, scopes: string[]): OutboxJob | null {
    const job = this.outbox().find(job => job.id === id && scopes.includes(job.scope) && ['running', 'pending'].includes(job.status))
    if (!job) return null
    const binding = this.binding(job.bindingId)
    if (!binding?.enabled || !binding.writesCertified || binding.policyRevision !== job.policyRevision) return null
    const row = this.db.prepare('SELECT * FROM memories WHERE id=? AND id NOT IN (SELECT id FROM tombstones)').get(job.canonicalId)
    const record = row ? this.decode(row) : undefined
    if (job.operation === 'upsert' && (!record || record.status !== 'active' || record.revision !== job.revision)) return null
    return { operation: job, binding, ...(job.operation === 'upsert' && record ? { record } : {}) }
  }
  completeJob(id: string, receipt: OutboxReceipt, now = Date.now()): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const job = this.outbox().find(job => job.id === id)
      if (!job) { this.db.exec('COMMIT'); return }
      const binding = this.binding(job.bindingId)
      if (job.status === 'cancelled') {
        if (job.operation === 'upsert' && binding && receipt.status !== 'retry') {
          const deleted = this.db.prepare('SELECT id FROM tombstones WHERE id=?').get(job.canonicalId)
          if (deleted) this.queueDeletion(job.canonicalId, job.revision + 1, binding)
          else {
            const row = this.db.prepare('SELECT * FROM memories WHERE id=?').get(job.canonicalId)
            // Mark a completed replacement for re-delivery if an older write
            // finished afterwards. Retain the canonical revision and scope.
            if (row) {
              const current = this.decode(row)
              for (const newer of this.outbox()) if (newer.bindingId === job.bindingId && newer.canonicalId === job.canonicalId && newer.operation === 'upsert' && newer.revision === current.revision && newer.status === 'confirmed') this.putJob({ ...newer, status: 'cancelled', reason: 'superseded' })
              this.queueRecord(current)
            }
          }
        }
        this.db.exec('COMMIT'); return
      }
      if (!['running', 'pending'].includes(job.status)) { this.db.exec('COMMIT'); return }
      if (!binding?.enabled || binding.policyRevision !== job.policyRevision) this.putJob({ ...job, status: 'cancelled', reason: 'revoked' })
      else if (receipt.status === 'confirmed') this.putJob({ ...job, status: 'confirmed', leaseUntil: undefined })
      else if (receipt.status === 'pending') this.putJob({ ...job, status: 'pending', reason: (job.reconciliationAttempts ?? 0) >= 6 ? 'reconciliation-limit' : 'awaiting-completion', leaseUntil: undefined,
        nextAttemptAt: new Date(now + Math.min(3_600_000, 1000 * 2 ** (job.reconciliationAttempts ?? 0))).toISOString() })
      else this.putJob({ ...job, status: 'queued', reason: 'provider-offline', nextAttemptAt: new Date(now + Math.min(3_600_000, 1000 * 2 ** job.attempts)).toISOString() })
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  stageProject(projectId: string, baseRevision: number, context: ProjectContext): void {
    const id = `draft:${projectId}`
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const allowed = new Set(this.filterDeleted(context.memories.map(memory => memory.id)))
      const retained = { ...context, memories: context.memories.filter(memory => allowed.has(memory.id)) }
      for (const memory of retained.memories) this.claim(memory.id, `project:${projectId}`)
      this.db.prepare('INSERT INTO journals VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id, this.seal(id, { baseRevision, context: retained }))
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  /** The bundle is authoritative, but only its successful atomic save may
   * publish records. Drafts never reach a provider. Refuse an older conflicting
   * copy rather than overwriting newer committed evidence or billing a replay. */
  commitProject(projectId: string, context: ProjectContext): void {
    const scope = `project:${projectId}`
    const allowed = new Set(this.filterDeleted(context.memories.map(record => record.id)))
    const records = context.memories.filter(record => allowed.has(record.id))
    if (records.some(record => record.scope !== 'project' || record.projectId !== projectId)) throw new Error('POLICY_REFUSED: save only this project’s records.')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db.prepare('SELECT memories.* FROM memories JOIN record_scopes ON memories.id=record_scopes.id WHERE scope=?').all(scope).map(row => this.decode(row))
      const byId = new Map(previous.map(record => [record.id, record]))
      for (const record of records) {
        this.claim(record.id, scope)
        const old = byId.get(record.id)
        if (old && (record.revision < old.revision || (record.revision === old.revision && JSON.stringify(record) !== JSON.stringify(old)))) {
          throw new Error('This saved bundle conflicts with a newer local memory revision. Open it as a copy or restore the latest bundle before synchronising memory.')
        }
        this.db.prepare('INSERT INTO memories VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(record.id, this.seal(record.id, record))
        this.queueRecord(record)
      }
      const selected = new Set(records.map(record => record.id))
      for (const old of previous.filter(record => !selected.has(record.id))) {
        this.queueRecord({ ...old, status: 'deleted', revision: old.revision + 1 })
        this.db.prepare('DELETE FROM memories WHERE id=?').run(old.id)
      }
      const draftId = `draft:${projectId}`
      const row = this.db.prepare('SELECT * FROM journals WHERE id=?').get(draftId)
      if (row) {
        const draft = this.unseal(row) as { baseRevision: number; context: ProjectContext }
        if (draft.context.revision > context.revision) {
          this.db.prepare('UPDATE journals SET payload=? WHERE id=?').run(this.seal(draftId, { ...draft, baseRevision: context.revision }), draftId)
        } else this.db.prepare('DELETE FROM journals WHERE id=?').run(draftId)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    this.index.prepare('DELETE FROM search WHERE scope=?').run(scope)
    for (const record of records.filter(record => record.status === 'active')) this.index.prepare('INSERT INTO search VALUES (?, ?, ?)').run(record.id, scope, record.statement)
  }
  recoverProject(projectId: string, baseRevision: number): ProjectContext | null {
    const row = this.db.prepare('SELECT * FROM journals WHERE id=?').get(`draft:${projectId}`)
    if (!row) return null
    const draft = this.unseal(row) as { baseRevision: number; context: ProjectContext }
    if (draft.baseRevision !== baseRevision) return null
    const allowed = new Set(this.filterDeleted(draft.context.memories.map(m => m.id)))
    return { ...draft.context, memories: draft.context.memories.filter(m => allowed.has(m.id)) }
  }
  discardProject(projectId: string, savedRevision?: number): void {
    const id = `draft:${projectId}`
    if (savedRevision !== undefined) {
      const row = this.db.prepare('SELECT * FROM journals WHERE id=?').get(id)
      if (row) {
        const draft = this.unseal(row) as { baseRevision: number; context: ProjectContext }
        if (draft.context.revision > savedRevision) {
          this.stageProject(projectId, savedRevision, draft.context)
          return
        }
      }
    }
    this.db.prepare('DELETE FROM journals WHERE id=?').run(id)
  }
  search(query: string, scope = 'global'): MemoryRecord[] {
    const words = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32) ?? []
    if (!words.length) return []
    const ids = this.index.prepare('SELECT id FROM search WHERE search MATCH ? AND scope=? ORDER BY bm25(search) LIMIT 10').all(words.map(word => `"${word}"`).join(' OR '), scope).map(row => String(row.id))
    return ids.flatMap(id => {
      const row = this.db.prepare('SELECT * FROM memories WHERE id=? AND id NOT IN (SELECT id FROM tombstones)').get(id)
      if (!row) return []
      const record = this.decode(row)
      return record.status === 'active' ? [record] : []
    })
  }
  close(): void { this.index.close(); this.db.close(); this.key.fill(0) }
}
