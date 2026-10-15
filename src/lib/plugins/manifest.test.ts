import { describe, it, expect } from 'vitest'
import { readManifest, checkAppVersion } from './manifest'

// The refusals ARE the design here. A plugin manifest is usually written by a
// model, and a model can only correct a mistake it is told about precisely —
// so every message is pinned, not just the ok/not-ok.

const base = {
  id: 'noaa-tides',
  name: 'NOAA Tides',
  version: '1.0.0',
  contributes: { docs: [{ topic: 'tides', summary: 'x', body: 'y' }] },
}

const read = (over: Record<string, unknown> = {}, app = '1.11.0'): ReturnType<typeof readManifest> =>
  readManifest(JSON.stringify({ ...base, ...over }), app)

describe('a manifest that is fine', () => {
  it('comes back parsed, with the defaults filled in', () => {
    const r = read()
    expect(r.ok).toBe(true)
    expect(r.manifest?.id).toBe('noaa-tides')
    expect(r.manifest?.permissions).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('accepts a declarative-only plugin with no entry point', () => {
    expect(read({ main: undefined }).ok).toBe(true)
  })
})

describe('context capability compatibility', () => {
  it('requires separate permission for context-only provider profile contributions', () => {
    const context = { version: 1, required: ['memory-providers'], providers: [{ id: 'lexical', label: 'Local memory', profileId: 'mnemosyne-lexical-v1' }] }
    expect(read({ contributes: undefined, context, permissions: ['memory-provider'] }).ok).toBe(true)
    expect(read({ context, permissions: ['network'] }).error).toContain('memory-provider')
  })
  it('checks skill-level app requirements before activating the plugin', () => {
    const context = { version: 1, required: ['skill-dependencies'], skills: [{ id: 'flood', summary: 'Flood workflow', bodyFile: 'skills/flood.md', ourgeoVersion: '>=1.16.19' }] }
    expect(read({ context }, '1.16.18').error).toContain('Skill "flood"')
    expect(read({ context }, '1.16.19').ok).toBe(true)
  })
  it('refuses required provider context capabilities instead of silently dropping them', () => {
    const result = read({ context: { version: 1, skills: [], required: ['unreviewed-provider-code'] } })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unsupported context capabilities')
    expect(read({ context: { version: 1, skills: [], required: ['skills'] } }).ok).toBe(true)
  })
  it('requires separate sharing permission for dynamic sources and preserves required capabilities', () => {
    const context = { version: 1, required: ['dynamic-sources'] }
    expect(read({ context, main: 'main.ts', permissions: ['network'] }).error).toContain('context-source')
    expect(read({ context, main: 'main.ts', permissions: ['context-source'] }).manifest?.context?.required).toEqual(['dynamic-sources'])
  })
  it('accepts a skill-only plugin without a dummy contribution', () => {
    expect(read({ contributes: undefined, context: { version: 1, skills: [{ id: 'flood', summary: 'Assess flood exposure', bodyFile: 'skills/flood.md' }] } }).ok).toBe(true)
  })
  it('requires older-app rejection for declarative source manifests', () => {
    const context = { version: 1, sources: [{ id: 'flood', title: 'Flood', summary: 'Flood', bodyFile: 'docs/flood.md' }] }
    expect(read({ context, permissions: ['context-source'] }).error).toContain('context.required')
    expect(read({ contributes: undefined, context: { ...context, required: ['sources'] }, permissions: ['context-source'] }).ok).toBe(true)
  })
  it('refuses a skill body that leaves the plugin directory', () => {
    expect(read({ context: { version: 1, skills: [{ id: 'flood', summary: 'Assess flood exposure', bodyFile: '../private.md' }] } }).ok).toBe(false)
  })
  it('does not let a declarative skill attach requirements to another plugin action', () => {
    const result = read({ context: { version: 1, skills: [{ id: 'flood', summary: 'Assess flood exposure', bodyFile: 'skills/flood.md', actions: ['another-plugin:assess'] }] } })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('without another namespace')
  })
})

describe('refusals name the field', () => {
  it('refuses text that is not JSON, and says which file', () => {
    const r = readManifest('{ nope', '1.11.0')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('ourgeo-plugin.json')
    expect(r.error).toContain('not valid JSON')
  })

  it('refuses a missing id, and shows what one looks like', () => {
    const r = readManifest(JSON.stringify({ name: 'x', version: '1.0.0' }), '1.11.0')
    expect(r.error).toContain('"id" is required')
    expect(r.error).toContain('noaa-tides')
  })

  it('refuses an id that could not be part of an action id', () => {
    // Ids are namespaced as `<plugin-id>:<name>`; a space or a dot there would
    // make an id that reads as R, which is exactly what the colon prevents.
    const r = read({ id: 'NOAA Tides' })
    expect(r.error).toContain('lowercase letters')
    expect(r.error).toContain('action id')
  })

  it('refuses a version that is not a version', () => {
    expect(read({ version: 'v2' }).error).toContain('"1.0.0"')
  })

  it('refuses a plugin that contributes nothing', () => {
    const r = readManifest(JSON.stringify({ id: 'x', name: 'X', version: '1.0.0' }), '1.11.0')
    expect(r.error).toContain('contributes nothing')
  })

  it('refuses a main that escapes the plugin folder', () => {
    expect(read({ main: '../../etc/passwd' }).error).toContain('inside the plugin folder')
    expect(read({ main: '/tmp/evil.js' }).error).toContain('inside the plugin folder')
  })
})

describe('version compatibility', () => {
  it('names both versions when ouRGeo is too old', () => {
    const r = read({ ourgeoVersion: '>=2.0.0' }, '1.11.0')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('2.0.0')
    expect(r.error).toContain('1.11.0')
  })

  it('accepts an equal or newer app', () => {
    expect(read({ ourgeoVersion: '>=1.11.0' }, '1.11.0').ok).toBe(true)
    expect(read({ ourgeoVersion: '1.10.0' }, '1.11.0').ok).toBe(true)
  })

  it('compares numerically, not as text', () => {
    // "1.9.0" > "1.10.0" as strings, and would refuse a perfectly good plugin.
    expect(checkAppVersion('>=1.9.0', '1.10.0')).toBeNull()
  })

  it('refuses a manifest format from the future rather than half-reading it', () => {
    const r = read({ manifestVersion: 99 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Update ouRGeo')
  })
})

describe('one bad contribution does not lose the rest', () => {
  it('drops the broken entry, keeps the good one, and says which', () => {
    const r = read({
      contributes: {
        docs: [
          { topic: 'good', summary: 's', body: 'b' },
          { topic: 'bad' },
        ],
      },
    })
    expect(r.ok).toBe(true)
    expect(r.manifest?.contributes?.docs).toHaveLength(1)
    expect(r.warnings.join(' ')).toContain('contributes.docs[1]')
    expect(r.warnings.join(' ')).toContain('"summary"')
  })

  it('ignores an unknown permission instead of refusing the plugin', () => {
    // Written against a later ouRGeo. Everything else it does still works.
    const r = read({ permissions: ['network', 'telepathy'] })
    expect(r.ok).toBe(true)
    expect(r.manifest?.permissions).toEqual(['network'])
    expect(r.warnings.join(' ')).toContain('telepathy')
  })

  it('drops an R file that points outside the plugin folder', () => {
    const r = read({ contributes: { ...base.contributes, rLibrary: ['helpers.R', '../../secrets.R'] } })
    expect(r.manifest?.contributes?.rLibrary).toEqual(['helpers.R'])
    expect(r.warnings.join(' ')).toContain('inside the plugin folder')
  })

  it('ignores a contribution list that is not a list', () => {
    const r = read({ contributes: { ...base.contributes, actions: 'lots' } })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toContain('"contributes.actions" must be a list')
  })
})
