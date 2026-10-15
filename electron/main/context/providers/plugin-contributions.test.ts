import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginProviderContributions } from './plugin-contributions'
import { validateSkills } from '../../../../src/lib/context/skills'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture() {
  const data = mkdtempSync(join(tmpdir(), 'ourgeo-plugin-providers-'))
  cleanups.push(() => rmSync(data, { recursive: true, force: true }))
  mkdirSync(join(data, 'plugins', 'fixture'), { recursive: true })
  const manifest = { id: 'fixture', name: 'Synthetic provider plugin', version: '1.0.0', permissions: ['memory-provider'], context: { version: 1, required: ['memory-providers'], providers: [{ id: 'lexical', label: 'Synthetic local lexical', profileId: 'mnemosyne-lexical-v1' }] } }
  const path = join(data, 'plugins', 'fixture', 'ourgeo-plugin.json')
  writeFileSync(path, JSON.stringify(manifest))
  const grants = { enabled: { fixture: true }, permissionGrants: { fixture: ['memory-provider'] } }
  const prefs = join(data, 'plugins.json'); writeFileSync(prefs, JSON.stringify(grants))
  const providers = new PluginProviderContributions(data, '1.16.19'); cleanups.push(() => providers.close())
  const ref = () => { const { pluginId, id, manifestSha256 } = providers.list()[0]; return { pluginId, id, manifestSha256 } }
  return { data, path, prefs, manifest, grants, providers, ref }
}
it('accepts context-only profiles but demands a separate explicit grant and capability', () => {
  const { providers, manifest, prefs, grants } = fixture()
  expect(validateSkills(manifest.context).providers).toHaveLength(1)
  expect(providers.list()[0]).toMatchObject({ pluginId: 'fixture', id: 'lexical', profileId: 'mnemosyne-lexical-v1' })
  writeFileSync(prefs, JSON.stringify({ enabled: grants.enabled }))
  expect(providers.list()).toEqual([])
  expect(() => validateSkills({ ...manifest.context, required: [] })).toThrow('memory-providers')
})
it('binds activation to exact bytes and refuses plugin-supplied trust or unknown implementations', () => {
  const { path, providers, manifest, ref } = fixture(); const previous = ref()
  expect(providers.require(previous).profileId).toBe('mnemosyne-lexical-v1')
  writeFileSync(path, JSON.stringify({ ...manifest, version: '1.0.1' }))
  expect(() => providers.require(previous)).toThrow('PROVIDER_UNCERTIFIED')
  writeFileSync(path, JSON.stringify({ ...manifest, context: { ...manifest.context, providers: [{ ...manifest.context.providers[0], profileId: 'unreviewed-profile' }] } }))
  expect(providers.list()[0].available).toBe(false)
  expect(() => providers.require(ref())).toThrow('PROVIDER_UNCERTIFIED')
  expect(() => validateSkills({ ...manifest.context, providers: [{ ...manifest.context.providers[0], scope: 'global' }] })).toThrow('cannot grant scope')
})
it('rejects incompatible, oversized and symlinked descriptors without reading another plugin', () => {
  const { data, path, providers, manifest } = fixture()
  writeFileSync(path, JSON.stringify({ ...manifest, ourgeoVersion: '>=9.0.0' })); expect(providers.list()).toEqual([])
  writeFileSync(path, ' '.repeat(131073)); expect(providers.list()).toEqual([])
  rmSync(path); writeFileSync(join(data, 'foreign.json'), JSON.stringify(manifest)); symlinkSync(join(data, 'foreign.json'), path)
  expect(providers.list()).toEqual([])
})
it('observes grant revocation and refuses the old activation reference immediately', async () => {
  const { providers, prefs, grants, ref } = fixture(), previous = ref(), changed = vi.fn()
  providers.observe(changed)
  writeFileSync(prefs, JSON.stringify({ ...grants, enabled: { fixture: false } }))
  expect(() => providers.require(previous)).toThrow('Enable this compatible plugin')
  await vi.waitFor(() => expect(changed).toHaveBeenCalled())
  writeFileSync(prefs, JSON.stringify(grants)); await vi.waitFor(() => expect(providers.list()).toHaveLength(1))
})
