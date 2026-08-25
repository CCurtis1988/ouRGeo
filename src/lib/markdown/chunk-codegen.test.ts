import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveMapEngine, buildMapChunkParts, mapChunkMarkdown, generateChunkBody, chunkVariantFor,
} from './chunk-codegen'
import { MD_ACTION_BY_ID } from './actions'
import { useSpatialStore } from '@/store/spatial'
import { useSpatialSettingsStore } from '@/store/spatialSettings'
import { useMarkdownSettingsStore } from '@/store/markdownSettings'
import { makeLayer } from '@/lib/codegen-fixtures'

/** Put one visible layer on the map so the generators have something to emit. */
function seedMap(): void {
  useSpatialStore.setState({
    layers: [makeLayer()],
    viewState: { longitude: 6, latitude: 49.8, zoom: 9 },
    viewBbox: [5.7, 49.4, 6.5, 50.2],
  })
}

beforeEach(() => {
  useSpatialStore.setState({ layers: [], viewBbox: null })
  useMarkdownSettingsStore.setState({ mapChunkEngine: 'tmap' })
  useSpatialSettingsStore.setState({ lastExportMode: 'tmap' })
})

describe('resolveMapEngine', () => {
  it('defaults to tmap', () => {
    expect(resolveMapEngine()).toBe('tmap')
  })

  it('honours an explicit choice', () => {
    useMarkdownSettingsStore.setState({ mapChunkEngine: 'ggplot' })
    expect(resolveMapEngine()).toBe('ggplot')
  })

  it('follows the export panel when set to auto', () => {
    useMarkdownSettingsStore.setState({ mapChunkEngine: 'auto' })
    useSpatialSettingsStore.setState({ lastExportMode: 'ggplot' })
    expect(resolveMapEngine()).toBe('ggplot')
    useSpatialSettingsStore.setState({ lastExportMode: 'tmap' })
    expect(resolveMapEngine()).toBe('tmap')
  })
})

describe('buildMapChunkParts', () => {
  it('returns null with nothing on the map, so the caller keeps the scaffolding', () => {
    expect(buildMapChunkParts({ label: 'chunk-1' })).toBeNull()
  })

  it('returns null when every layer is hidden', () => {
    useSpatialStore.setState({ layers: [makeLayer({ visible: false })] })
    expect(buildMapChunkParts({ label: 'chunk-1' })).toBeNull()
  })

  it('generates real tmap code, not a placeholder', () => {
    seedMap()
    const parts = buildMapChunkParts({ label: 'chunk-1' })!
    expect(parts.header).toBe('r chunk-1, echo=FALSE, fig.width=7, fig.height=5')
    expect(parts.code).toContain('library(tmap)')
    expect(parts.code).toContain('tm_shape(')
    expect(parts.after).toBeUndefined()
  })

  it('generates ggplot code when asked', () => {
    seedMap()
    const parts = buildMapChunkParts({ label: 'chunk-1', engine: 'ggplot' })!
    expect(parts.code).toContain('library(ggplot2)')
    expect(parts.code).toContain('geom_sf(')
  })

  it('always renders a static map — a knitted document cannot host a live view', () => {
    seedMap()
    expect(buildMapChunkParts({ label: 'c' })!.code).toContain('tmap_mode("plot")')
  })

  it('saveFigure writes the figure and references it', () => {
    seedMap()
    const parts = buildMapChunkParts({ label: 'chunk-2', saveFigure: true })!
    expect(parts.code).toContain('dir.create("figures"')
    expect(parts.code).toContain('figures/chunk-2.png')
    expect(parts.after).toBe('![](figures/chunk-2.png)')
  })

  it('hides the figure-writing chunk entirely, so the figure is not knitted twice', () => {
    seedMap()
    const parts = buildMapChunkParts({ label: 'chunk-2', saveFigure: true })!
    expect(parts.header).toBe('r chunk-2, include=FALSE')
  })
})

describe('mapChunkMarkdown', () => {
  it('wraps the code in a fence carrying the header', () => {
    const md = mapChunkMarkdown({ header: 'r a, echo=FALSE', code: 'plot(1)' })
    expect(md).toBe('```{r a, echo=FALSE}\nplot(1)\n```')
  })

  it('appends the figure reference after a blank line', () => {
    const md = mapChunkMarkdown({ header: 'r a', code: 'x', after: '![](f.png)' })
    expect(md).toBe('```{r a}\nx\n```\n\n![](f.png)')
  })
})

describe('generateChunkBody', () => {
  it('is null for a plain R chunk, which has nothing to generate from', () => {
    seedMap()
    expect(generateChunkBody(MD_ACTION_BY_ID.rchunk, 'chunk-1')).toBeNull()
  })

  it('is null when the map is empty, so the action falls back to scaffolding', () => {
    expect(generateChunkBody(MD_ACTION_BY_ID['chunk-map'], 'chunk-1')).toBeNull()
  })

  it('emits a labelled fence for the map action', () => {
    seedMap()
    const body = generateChunkBody(MD_ACTION_BY_ID['chunk-map'], 'chunk-1')!
    expect(body.startsWith('```{r chunk-1,')).toBe(true)
    expect(body.trimEnd().endsWith('```')).toBe(true)
  })
})

describe('chunkVariantFor', () => {
  it('distinguishes the two ouRGeo chunk actions and ignores the rest', () => {
    expect(chunkVariantFor(MD_ACTION_BY_ID['chunk-map'])).toBe(false)
    expect(chunkVariantFor(MD_ACTION_BY_ID['chunk-plot'])).toBe(true)
    expect(chunkVariantFor(MD_ACTION_BY_ID.rchunk)).toBeNull()
    expect(chunkVariantFor(MD_ACTION_BY_ID.bold)).toBeNull()
  })
})
