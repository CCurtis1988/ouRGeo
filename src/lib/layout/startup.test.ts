import { describe, expect, it } from 'vitest'
import { startupLayout } from './startup'
import { BUILTIN_PANEL_INFO } from './panel-meta'
import { defaultLayout, movePanel, setActivePanel, setZoneMode, zoneOf } from './model'

describe('opening a workspace with Project Files', () => {
  it('preserves an old split even when that layout predates Terminal', () => {
    const oldPanels = BUILTIN_PANEL_INFO.filter(panel => !['terminal', 'projectFiles'].includes(panel.id))
    const stored = setZoneMode(defaultLayout(oldPanels), 'bottom', 'split')
    const result = startupLayout(stored, [...BUILTIN_PANEL_INFO], 'tab')
    expect(result.zones.bottom.mode).toBe('split')
    expect(result.zones.bottom.active).toBe(stored.zones.bottom.active)
    expect(result.zones.bottom.order).toEqual(['console', 'terminal', 'projectFiles'])
  })
  it('follows a moved Console and preserves its active tab and mode', () => {
    const oldPanels = BUILTIN_PANEL_INFO.filter(panel => panel.id !== 'projectFiles')
    const stored = setActivePanel(setZoneMode(movePanel(defaultLayout(oldPanels), 'console', 'left'), 'left', 'split'), 'console')
    const result = startupLayout(stored, [...BUILTIN_PANEL_INFO], 'tab')
    expect(zoneOf(result, 'projectFiles')).toBe('left')
    expect(result.zones.left.mode).toBe('split')
    expect(result.zones.left.active).toBe('console')
  })
  it('uses the terminal preference only when creating a fresh arrangement', () => {
    expect(startupLayout(null, [...BUILTIN_PANEL_INFO], 'tab').zones.bottom.mode).toBe('tabs')
    expect(startupLayout(null, [...BUILTIN_PANEL_INFO], 'split').zones.bottom.mode).toBe('split')
  })
})
