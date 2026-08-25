import { describe, it, expect } from 'vitest'
import { availabilityFor, allAvailability, remedyCode, type KnitDeps } from './knit-deps'

const full: KnitDeps = {
  knitr: true, rmarkdown: true, pandoc: true, pandocVersion: '3.1.0',
  tinytex: true, systemLatex: true,
}

describe('availabilityFor', () => {
  it('allows every format when everything is present', () => {
    expect(allAvailability(full).every((a) => a.available)).toBe(true)
  })

  it('blocks everything when rmarkdown is missing, and offers to install it', () => {
    const deps = { ...full, rmarkdown: false }
    for (const a of allAvailability(deps)) {
      expect(a.available).toBe(false)
      expect(a.remedy?.kind).toBe('install-rmarkdown')
    }
  })

  it('blocks everything when pandoc is missing and says it is not an R package', () => {
    // The point of the whole pre-flight: users reasonably assume every R
    // dependency is an R package, and RStudio bundles this one.
    const deps = { ...full, pandoc: false }
    const html = availabilityFor('html', deps)
    expect(html.available).toBe(false)
    expect(html.reason).toMatch(/not an R package/)
    expect(html.remedy?.kind).toBe('install-pandoc')
  })

  it('blocks only PDF when LaTeX is missing, and points at Word', () => {
    const deps = { ...full, tinytex: false, systemLatex: false }
    expect(availabilityFor('pdf', deps).available).toBe(false)
    expect(availabilityFor('pdf', deps).reason).toMatch(/Word/)
    // HTML and Word need only pandoc, so they must stay usable.
    expect(availabilityFor('html', deps).available).toBe(true)
    expect(availabilityFor('word', deps).available).toBe(true)
  })

  it('accepts a system LaTeX without tinytex', () => {
    expect(availabilityFor('pdf', { ...full, tinytex: false }).available).toBe(true)
  })

  it('accepts tinytex without a system LaTeX', () => {
    expect(availabilityFor('pdf', { ...full, systemLatex: false }).available).toBe(true)
  })

  it('reports a pending check rather than claiming unavailability', () => {
    const a = availabilityFor('html', null)
    expect(a.available).toBe(false)
    expect(a.reason).toMatch(/Checking/)
    expect(a.remedy).toBeUndefined()
  })
})

describe('remedyCode', () => {
  it('emits runnable R for each remedy', () => {
    expect(remedyCode('install-rmarkdown')).toContain('install.packages')
    expect(remedyCode('install-pandoc')).toContain('pandoc_install')
    expect(remedyCode('install-tinytex')).toContain('install_tinytex')
  })
})
