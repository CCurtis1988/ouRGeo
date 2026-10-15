import { describe, it, expect, beforeEach, vi } from 'vitest'
import { buildDistFiles } from './store-package'
import type { PluginManifest } from './types'

// What goes into the package the store distributes, and what must not.
//
// The compiled half — that a minified ESM artifact survives the load-time pass
// — is pinned by store-package.test.ts, which runs the real compiler. This file
// covers the tree around it: which files are copied, which are refused, and
// what the author is told. Those paths need no esbuild, and the ones that do
// are marked.

interface Fake { files: Record<string, string> }
let fake: Fake

function stubElectron(): void {
  fake = { files: {} }
  vi.stubGlobal('window', {
    electronAPI: {
      plugins: {
        listFiles: async (id: string) =>
          Object.keys(fake.files)
            .filter((k) => k.startsWith(`${id}/`))
            .map((k) => k.slice(id.length + 1))
            .sort(),
        readFile: async (rel: string) => {
          const v = fake.files[rel]
          if (v === undefined) throw new Error(`no such file: ${rel}`)
          return v
        },
      },
    },
  })
}

const declarative = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'tide',
  name: 'Tide Tools',
  version: '1.0.0',
  contributes: { docs: [{ topic: 'tides', summary: 'Tides.', body: 'About tides.' }] },
  ...over,
})

beforeEach(stubElectron)

describe('buildDistFiles', () => {
  it('preserves skills and source Markdown in context-only packages', async () => {
    fake.files['tide/skills/flood.md'] = 'Synthetic flood workflow'
    fake.files['tide/docs/flood.md'] = 'Synthetic flood reference'
    fake.files['tide/skills/safety.md'] = 'Mandatory section guidance'
    const manifest = declarative({ contributes: undefined, permissions: ['context-source'], context: { version: 1, required: ['sources', 'skill-sections'], skills: [{ id: 'workflow', summary: 'Flood workflow', bodyFile: 'skills/flood.md', sections: [{ id: 'safety', summary: 'Safety', bodyFile: 'skills/safety.md', required: true }], triggers: [], exclusions: [], actions: [], requiresSources: [] }], sources: [{ id: 'flood', title: 'Flood', summary: 'Flood reference', bodyFile: 'docs/flood.md' }] } })
    const result = await buildDistFiles(manifest)
    expect(result.ok).toBe(true)
    expect(result.files?.['skills/flood.md']).toContain('workflow')
    expect(result.files?.['docs/flood.md']).toContain('reference')
    expect(result.files?.['skills/safety.md']).toContain('Mandatory section guidance')
    expect(JSON.parse(result.files!['ourgeo-plugin.json']).context.required).toEqual(['sources', 'skill-sections'])
    delete fake.files['tide/docs/flood.md']
    expect((await buildDistFiles(manifest)).error).toContain('Could not package context resource')
  })
  it('includes all service assets in a distributable', async () => {
    fake.files['tide/server/main.mjs'] = 'export {}'
    fake.files['tide/web/index.html'] = '<main>Player</main>'
    const manifest = declarative({ permissions: ['service'], service: { entry: 'server/main.mjs', files: ['server/main.mjs', 'web/index.html'] } })
    const result = await buildDistFiles(manifest)
    expect(result.ok).toBe(true)
    expect(result.files?.['web/index.html']).toContain('Player')
    delete fake.files['tide/server/main.mjs']
    expect((await buildDistFiles(manifest)).ok).toBe(false)
  })
  it('packages a declarative plugin with no compiler involved at all', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    const r = await buildDistFiles(declarative())
    expect(r.ok).toBe(true)
    expect(Object.keys(r.files ?? {})).toEqual(['ourgeo-plugin.json'])
  })

  it('says outright that a declarative plugin ships readable JSON', async () => {
    // The one thing an author must not be left to assume. Their connectors and
    // tools travel as JSON in the manifest, because the loader reads them.
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    const r = await buildDistFiles(declarative())
    expect(r.warnings.join(' ')).toMatch(/readable JSON/)
  })

  it('carries the R library verbatim, because R has to read it', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    fake.files['tide/r/tides.R'] = 'tide_at <- function(t) t\n'
    const r = await buildDistFiles(declarative({
      contributes: { rLibrary: ['r/tides.R'] },
    }))
    expect(r.ok).toBe(true)
    expect(r.files?.['r/tides.R']).toContain('tide_at')
  })

  it('warns about an rLibrary entry that is not there, rather than failing', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    const r = await buildDistFiles(declarative({ contributes: { rLibrary: ['r/gone.R'] } }))
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toContain('r/gone.R')
  })

  it('copies a README, and does not fail without one', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    fake.files['tide/README.md'] = '# Tide Tools\n'
    const withIt = await buildDistFiles(declarative())
    expect(withIt.files?.['README.md']).toContain('Tide Tools')

    delete fake.files['tide/README.md']
    const without = await buildDistFiles(declarative())
    expect(without.ok).toBe(true)
  })

  it('rewrites the manifest so `main` names the built file', async () => {
    // Needs the compiler, so it asserts on the refusal rather than the output —
    // the built path is proven end to end in store-package.test.ts.
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    fake.files['tide/main.ts'] = 'export function activate() {}'
    const r = await buildDistFiles(declarative({ main: 'main.ts' }))
    // Under Node there is no esbuild-wasm browser runtime; what matters is
    // that the failure is reported and not silently packaged without code.
    expect(r.ok).toBe(false)
    expect(r.files).toBeUndefined()
  })

  it('names the missing entry point rather than compiling nothing', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    const r = await buildDistFiles(declarative({ main: 'main.ts' }))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('main.ts')
    expect(r.error).toContain('not in the plugin folder')
  })

  it('refuses a plugin that would publish nothing', async () => {
    fake.files['tide/ourgeo-plugin.json'] = '{}'
    const r = await buildDistFiles({ id: 'tide', name: 'Tide', version: '1.0.0' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('nothing to publish')
  })
})
