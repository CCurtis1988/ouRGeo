import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveTier, checkAllowed, setTierOverride, setTierOverrides, clearTierOverrides, getTierOverrides,
} from './permissions'
import { actionById } from './registry'
import type { UiAction } from './types'

const get = (id: string): UiAction => {
  const a = actionById(id)
  if (!a) throw new Error(`no action ${id}`)
  return a
}

beforeEach(() => clearTierOverrides())

describe('tiers', () => {
  it('uses the action\'s default when the user has not chosen', () => {
    expect(resolveTier(get('ui.panel'))).toBe('always')
    expect(resolveTier(get('map.addLayer'))).toBe('autopilot')
    expect(resolveTier(get('env.remove'))).toBe('confirm')
  })

  it('lets the user override one action without touching the rest', () => {
    setTierOverride('map.addLayer', 'confirm')
    expect(resolveTier(get('map.addLayer'))).toBe('confirm')
    expect(resolveTier(get('map.removeLayer'))).toBe('autopilot')
  })

  it('stores overrides sparse, so defaults stay live', () => {
    setTierOverride('ui.panel', 'confirm')
    expect(getTierOverrides()).toEqual({ 'ui.panel': 'confirm' })
    setTierOverride('ui.panel', null)
    expect(getTierOverrides()).toEqual({})
    expect(resolveTier(get('ui.panel'))).toBe('always')
  })

  it('restores a whole override map, as the preferences file supplies it', () => {
    setTierOverrides({ 'env.remove': 'always', 'ui.panel': 'autopilot' })
    expect(resolveTier(get('env.remove'))).toBe('always')
    expect(resolveTier(get('ui.panel'))).toBe('autopilot')
  })
})

describe('checkAllowed', () => {
  it('lets `always` actions run with Autopilot off', () => {
    expect(checkAllowed(get('ui.panel'), { autoPilot: false })).toEqual({ allowed: true })
  })

  it('refuses `autopilot` actions with Autopilot off, and says what to do instead', () => {
    const d = checkAllowed(get('map.addLayer'), { autoPilot: false })
    expect(d.allowed).toBe(false)
    if (d.allowed || d.reason !== 'autopilot') throw new Error('expected an autopilot refusal')
    expect(d.message).toMatch(/needs Autopilot/)
    expect(d.message).toMatch(/ui\.highlight/)
  })

  it('allows `autopilot` actions once Autopilot is on', () => {
    expect(checkAllowed(get('map.addLayer'), { autoPilot: true })).toEqual({ allowed: true })
  })

  it('asks for confirmation on `confirm` actions, even with Autopilot on', () => {
    expect(checkAllowed(get('env.remove'), { autoPilot: true }))
      .toEqual({ allowed: false, reason: 'confirm' })
  })

  it('refuses `confirm` actions for Autopilot first when it is off', () => {
    // Autopilot is the outer gate: no point asking the user to confirm
    // something that the switch forbids anyway.
    const d = checkAllowed(get('env.remove'), { autoPilot: false })
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toBe('autopilot')
  })

  it('honours an override in both directions', () => {
    setTierOverride('ui.panel', 'confirm')
    expect(checkAllowed(get('ui.panel'), { autoPilot: true }))
      .toEqual({ allowed: false, reason: 'confirm' })

    setTierOverride('env.remove', 'always')
    expect(checkAllowed(get('env.remove'), { autoPilot: false })).toEqual({ allowed: true })
  })
})

describe('the default tiers as shipped', () => {
  // These are the promises the permissions dialog describes. If a default
  // moves, it should move deliberately.
  it('keeps everything that only changes the screen on `always`', () => {
    for (const id of [
      'ui.panel', 'ui.openDialog', 'ui.highlight', 'ui.describe',
      'map.status', 'map.zoomTo', 'map.setBasemap', 'map.setLayerVisible',
      'env.list', 'packages.list', 'help.search', 'plots.show', 'session.clearConsole',
    ]) {
      expect(resolveTier(get(id)), id).toBe('always')
    }
  })

  it('keeps everything destructive on `confirm`', () => {
    for (const id of [
      'env.remove', 'session.reset', 'project.new', 'project.open', 'editor.saveAs',
      'packages.install', 'db.deleteObject', 'draw.saveEdits', 'draw.discardEdits',
      'draw.deleteFeatures',
    ]) {
      expect(resolveTier(get(id)), id).toBe('confirm')
    }
  })

  it('keeps everything that touches R state or disk behind Autopilot', () => {
    for (const id of [
      'data.load', 'map.addLayer', 'map.setSymbology', 'map.exportCode',
      'editor.openFile', 'editor.save', 'editor.runTab', 'env.rename', 'packages.load',
    ]) {
      expect(resolveTier(get(id)), id).toBe('autopilot')
    }
  })
})
