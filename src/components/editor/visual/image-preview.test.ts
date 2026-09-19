import { describe, expect, it } from 'vitest'
import { imageMime, localImagePath } from './image-preview'

describe('visual Markdown image paths', () => {
  it('resolves relative images beside the saved document', () => {
    expect(localImagePath('figures/plot.png', '/work/report.Rmd')).toBe('/work/figures/plot.png')
    expect(localImagePath('../shared/map.svg', '/work/reports/report.Rmd')).toBe('/work/shared/map.svg')
    expect(localImagePath('figures\\plot.png', 'C:\\work\\report.Rmd')).toBe('C:/work/figures/plot.png')
  })

  it('leaves web and embedded images to the browser', () => {
    expect(localImagePath('https://example.org/a.png', '/work/report.Rmd')).toBeNull()
    expect(localImagePath('data:image/png;base64,AAA', '/work/report.Rmd')).toBeNull()
    expect(localImagePath('figure.png', null)).toBeNull()
  })

  it('only embeds supported image types', () => {
    expect(imageMime('figure.PNG')).toBe('image/png')
    expect(imageMime('map.svg')).toBe('image/svg+xml')
    expect(imageMime('notes.txt')).toBeNull()
  })
})
