import { describe, it, expect } from 'vitest'
import {
  basePanelId, instanceLabel, instanceNumber, isPanelInstance,
  makePanelInstanceId, nextPanelInstanceId, panelInstanceIds,
} from './instances'

// The naming scheme is the whole design of this module, and getting it wrong
// is not a cosmetic problem: `editor` has to keep meaning `editor` or every
// layout.json, saved preset and `data-ourgeo-id` written before second editors
// existed stops resolving.

describe('naming an instance', () => {
  it('leaves the first one alone, forever', () => {
    expect(makePanelInstanceId('editor', 1)).toBe('editor')
    expect(basePanelId('editor')).toBe('editor')
    expect(isPanelInstance('editor')).toBe(false)
    expect(instanceNumber('editor')).toBe(1)
  })

  it('numbers the rest from two', () => {
    expect(makePanelInstanceId('spatial', 2)).toBe('spatial#2')
    expect(basePanelId('spatial#3')).toBe('spatial')
    expect(instanceNumber('spatial#3')).toBe(3)
  })

  it('leaves a plugin panel id intact', () => {
    // Plugin ids are `plugin:panel`, which is why the separator is not a colon.
    expect(basePanelId('my-plugin:notes')).toBe('my-plugin:notes')
    expect(isPanelInstance('my-plugin:notes')).toBe(false)
    expect(basePanelId('my-plugin:notes#2')).toBe('my-plugin:notes')
  })

  it('reports a malformed id as zero rather than NaN', () => {
    // These arrive from a hand-edited layout.json. One comparison has to be
    // enough to reject them, or a NaN index rides along into the render.
    expect(instanceNumber('editor#')).toBe(0)
    expect(instanceNumber('editor#x')).toBe(0)
    expect(instanceNumber('editor#0')).toBe(0)
    expect(instanceNumber('editor#1')).toBe(0)
  })

  it('names the first one plainly and numbers the others', () => {
    expect(instanceLabel('Code editor', 1)).toBe('Code editor')
    expect(instanceLabel('Code editor', 2)).toBe('Code editor 2')
  })
})

describe('choosing the next id', () => {
  const placed = ['editor', 'editor#2', 'console', 'spatial']

  it('finds this panel and its instances, and nothing else', () => {
    expect(panelInstanceIds(placed, 'editor')).toEqual(['editor', 'editor#2'])
    expect(panelInstanceIds(placed, 'spatial')).toEqual(['spatial'])
  })

  it('takes the lowest free number, not one past the highest', () => {
    // Remove the second of three and the next one added is #2 again, so the
    // numbers a user sees stay small instead of climbing for ever.
    expect(nextPanelInstanceId(['editor', 'editor#3'], 'editor', 4)).toBe('editor#2')
  })

  it('refuses once the cap is reached', () => {
    expect(nextPanelInstanceId(['editor', 'editor#2'], 'editor', 2)).toBeNull()
  })

  it('offers the bare id when the panel is not placed at all', () => {
    expect(nextPanelInstanceId([], 'spatial', 4)).toBe('spatial')
  })
})
