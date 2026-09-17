import { describe, it, expect } from 'vitest'
import {
  MAX_SCREENSHOTS, baseName, describeRejected, formatBytes, mimeForName,
  planScreenshotAdd, summarizeScreenshots,
} from './screenshots'

describe('mimeForName', () => {
  it('reads the extension, case-insensitively', () => {
    expect(mimeForName('shot.PNG')).toBe('image/png')
    expect(mimeForName('a.jpg')).toBe('image/jpeg')
    expect(mimeForName('a.jpeg')).toBe('image/jpeg')
  })

  it('refuses what a canvas cannot decode', () => {
    expect(mimeForName('paper.pdf')).toBeNull()
    expect(mimeForName('notes')).toBeNull()
    // A .svg is an image and is deliberately not offered: transcodeForUpload
    // rasterises through createImageBitmap, which needs intrinsic dimensions.
    expect(mimeForName('logo.svg')).toBeNull()
  })
})

describe('baseName', () => {
  it('handles both separators', () => {
    expect(baseName('/home/a/earth.png')).toBe('earth.png')
    expect(baseName('C:\\shots\\earth.png')).toBe('earth.png')
  })
})

describe('planScreenshotAdd', () => {
  it('accepts a whole multi-selection when there is room', () => {
    const plan = planScreenshotAdd(['/a/one.png', '/a/two.jpg'], 0)
    expect(plan.accepted.map((a) => a.name)).toEqual(['one.png', 'two.jpg'])
    expect(plan.rejected).toEqual([])
  })

  it('names what it drops rather than dropping it quietly', () => {
    const plan = planScreenshotAdd(['/a/one.png', '/a/notes.pdf'], 0)
    expect(plan.accepted).toHaveLength(1)
    expect(plan.rejected).toEqual([{ name: 'notes.pdf', reason: 'not an image ouRGeo can read' }])
  })

  it('fills the remaining room and rejects the rest, in order', () => {
    const paths = Array.from({ length: 5 }, (_, i) => `/a/s${i}.png`)
    const plan = planScreenshotAdd(paths, MAX_SCREENSHOTS - 2)
    expect(plan.accepted.map((a) => a.name)).toEqual(['s0.png', 's1.png'])
    expect(plan.rejected.map((r) => r.name)).toEqual(['s2.png', 's3.png', 's4.png'])
    expect(plan.rejected[0].reason).toContain('8')
  })

  it('accepts nothing when already full', () => {
    const plan = planScreenshotAdd(['/a/one.png'], MAX_SCREENSHOTS)
    expect(plan.accepted).toEqual([])
    expect(plan.rejected).toHaveLength(1)
  })
})

describe('describeRejected', () => {
  it('is null when nothing was left out', () => {
    expect(describeRejected([])).toBeNull()
  })

  it('caps the list and counts the remainder', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, reason: 'x' }))
    const s = describeRejected(many)!
    expect(s).toContain('f0 (x)')
    expect(s).toContain('and 2 more')
    expect(s).not.toContain('f3')
  })
})

describe('summarizeScreenshots', () => {
  it('says so when there are none', () => {
    expect(summarizeScreenshots([])).toBe('No screenshots yet.')
  })

  it('counts each state separately', () => {
    expect(summarizeScreenshots(['attached', 'attached', 'uploading', 'failed']))
      .toBe('2 on your store page · 1 uploading · 1 failed')
  })

  // The distinction this function exists for: a queued screenshot is not on the
  // server, and must never be counted with the ones that are.
  it('never counts a waiting screenshot as attached', () => {
    const s = summarizeScreenshots(['attached', 'waiting'])
    expect(s).toBe('1 on your store page · 1 will upload when you submit')
  })

  it('folds preparing in with uploading, since both are work in progress', () => {
    expect(summarizeScreenshots(['preparing', 'uploading'])).toBe('2 uploading')
  })
})

describe('formatBytes', () => {
  it('scales', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(180_000)).toBe('176 KB')
    expect(formatBytes(2_400_000)).toBe('2.3 MB')
  })
})
