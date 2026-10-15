import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextBroker } from '../broker'
import { PluginContextSession, pluginContextFile, pluginContextSources, replacePluginContextSessions, revokePluginWorkspaceSources } from './plugin'

const definition = (over = {}) => ({ id: 'flood', title: 'Flood result', summary: 'Parcel flood exposure', revision: '1', read: () => 'Own synthetic result', ...over })
afterEach(() => { replacePluginContextSessions([]); vi.useRealTimers() })

describe('plugin context ownership', () => {
  it('namespaces evidence, preserves untrusted provenance and gives callbacks only cancellation', async () => {
    const read = vi.fn<(request: { signal: AbortSignal }) => string>(() => 'Own synthetic result'), owner = new PluginContextSession('flood-tools', '1.0.0', () => undefined, () => 1)
    owner.publish(definition({ read })); replacePluginContextSessions([owner])
    const source = [...pluginContextSources()][0]
    expect(source).toMatchObject({ id: 'document:plugin:flood-tools:flood', scope: 'workspace', trust: 'untrusted', group: 'plugin.flood-tools' })
    expect(read).not.toHaveBeenCalled()
    expect(await source.read()).toContain('flood-tools/flood (1.0.0, 1)')
    expect(Object.keys(read.mock.calls[0][0])).toEqual(['signal'])
  })
  it('rejects scope, trust, namespace and injection claims before registration', () => {
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    for (const extra of [{ scope: 'global' }, { trust: 'host' }, { namespace: 'another' }, { alwaysInject: true }, { id: 'other:source' }]) expect(() => owner.publish(definition(extra))).toThrow()
    expect([...owner.sources()]).toEqual([])
  })
  it('bounds descriptors, source counts and callback text', async () => {
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    expect(() => owner.publish(definition({ summary: 'x'.repeat(501) }))).toThrow('500')
    for (let index = 0; index < 64; index++) owner.publish(definition({ id: `source-${index}`, read: () => 'x'.repeat(100_001) }))
    expect(() => owner.publish(definition())).toThrow('64')
    replacePluginContextSessions([owner])
    await expect([...owner.sources()][0].read()).rejects.toThrow('100,000')
  })
  it('withdraws in-flight evidence on disable even if a callback ignores cancellation', async () => {
    let resolve!: (text: string) => void
    const read = vi.fn<(request: { signal: AbortSignal }) => Promise<string>>(() => new Promise<string>(done => { resolve = done }))
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    owner.publish(definition({ read })); replacePluginContextSessions([owner])
    const reading = [...owner.sources()][0].read()
    const rejected = expect(reading).rejects.toThrow('revoked')
    await Promise.resolve(); replacePluginContextSessions([])
    await rejected
    expect(read.mock.calls[0][0].signal.aborted).toBe(true)
    resolve('Late private result')
    expect([...pluginContextSources()]).toEqual([])
    expect(() => owner.publish(definition())).toThrow('revoked')
  })
  it('bounds a callback which never resolves without relying on its cooperation', async () => {
    vi.useFakeTimers()
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    owner.publish(definition({ read: () => new Promise(() => undefined) })); replacePluginContextSessions([owner])
    const rejected = expect([...owner.sources()][0].read()).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(2000); await rejected
  })
  it('refuses a late result when synchronous plugin code delayed the timeout timer', async () => {
    vi.useFakeTimers()
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    owner.publish(definition({ read: () => { vi.setSystemTime(Date.now() + 3000); return 'Late result' } }))
    replacePluginContextSessions([owner])
    await expect([...owner.sources()][0].read()).rejects.toThrow('timed out')
  })
  it('cancels a resource read when the broker turn is aborted', async () => {
    const read = vi.fn<(request: { signal: AbortSignal }) => Promise<string>>(() => new Promise<string>(() => undefined)), signal = new AbortController()
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    owner.publish(definition({ read })); replacePluginContextSessions([owner])
    const rejected = expect([...owner.sources()][0].read(signal.signal)).rejects.toThrow('revoked')
    await Promise.resolve(); signal.abort(); await rejected
    expect(read.mock.calls[0][0].signal.aborted).toBe(true)
  })
  it('withdraws workspace resources on project changes while keeping installed Markdown', async () => {
    let epoch = 1
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => epoch)
    owner.publish(definition()); owner.publish(definition({ id: 'manual' }), 'activation')
    replacePluginContextSessions([owner])
    const old = [...owner.sources()].find(source => source.scope === 'workspace')!
    epoch++
    expect([...owner.sources()].map(source => source.scope)).toEqual(['application'])
    await expect(old.read()).rejects.toThrow('workspace changed')
    revokePluginWorkspaceSources()
    owner.publish(definition({ read: () => 'New project result' }))
    expect(await [...owner.sources()].find(source => source.scope === 'workspace')!.read()).toContain('New project')
  })
  it('invalidates cached broker evidence even when the plugin reuses its revision', async () => {
    const changed = vi.fn(), owner = new PluginContextSession('flood-tools', '1', changed, () => 1)
    owner.publish(definition()); replacePluginContextSessions([owner])
    const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'thorough', signal: new AbortController().signal, current: () => true, sources: () => pluginContextSources(), excluded: () => [] })
    const discovered = JSON.parse(broker.search({ query: 'flood', kinds: ['document'] }))
    const ref = discovered.results[0].ref
    expect(JSON.parse(await broker.read({ ref })).content).toContain('Own synthetic result')
    owner.publish(definition({ read: () => 'Corrected result' }))
    expect(JSON.parse(await broker.read({ ref })).status).toBe('STALE_REFERENCE')
    expect(changed).toHaveBeenCalledOnce()
    const fresh = JSON.parse(broker.search({ query: 'flood' })).results[0].ref
    expect(JSON.parse(await broker.read({ ref: fresh })).content).toContain('Corrected result')
  })
  it('keeps replacement sources when an older disposer runs', async () => {
    const owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    const dispose = owner.publish(definition())
    owner.publish(definition({ read: () => 'Replacement' })); replacePluginContextSessions([owner]); dispose()
    expect(await [...owner.sources()][0].read()).toContain('Replacement')
  })
  it('applies normal broker exclusions and never calls an excluded plugin', async () => {
    const read = vi.fn(() => 'Private'), owner = new PluginContextSession('flood-tools', '1', () => undefined, () => 1)
    owner.publish(definition({ read })); replacePluginContextSessions([owner])
    const broker = new ContextBroker({ identity: { chatId: 'chat', projectId: null, workspaceEpoch: 1, policyRevision: 1 }, target: 'test', effort: 'balanced', signal: new AbortController().signal, current: () => true, sources: () => pluginContextSources(), excluded: () => ['document:plugin:flood-tools:flood'] })
    expect(JSON.parse(broker.search({ query: 'flood' })).results).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })
})
it('refuses source files outside the installed plugin and non-Markdown assets', () => {
  for (const bodyFile of ['../private.md', '/private.md', 'docs//a.md', 'docs/a.ts']) expect(() => pluginContextFile({ id: 'flood', title: 'Flood', summary: 'Flood', bodyFile })).toThrow('inside the plugin')
})
