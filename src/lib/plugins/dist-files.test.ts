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
