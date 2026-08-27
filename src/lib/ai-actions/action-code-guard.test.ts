import { describe, it, expect } from 'vitest'
import { actionCallInCode, actionCodeRefusal, actionCodeHint } from './action-code-guard'

// The exact code a local model produced, and told the user to run:
//
//   map.addLayer(object = "pts_buf")
//   map.zoomTo(layer = "pts_buf")
//
// R answered `could not find function "map.addLayer"`. These tests pin the
// detector that now catches it on both sides.

describe('actionCallInCode', () => {
  it('catches the dotted form — the one that reads as R', () => {
    expect(actionCallInCode('map.addLayer(object = "pts_buf")')).toBe('map:addLayer')
    expect(actionCallInCode('map.zoomTo(layer = "pts_buf")')).toBe('map:zoomTo')
  })

  it('catches the canonical form too', () => {
    expect(actionCallInCode('map:addLayer(object = "pts")')).toBe('map:addLayer')
  })

  it('finds one inside a longer script, comments and all', () => {
    const script = [
      '# Add buffer polygons (bottom layer)',
      'map.addLayer(object = "pts_buf")',
      '',
      '# Add points (top layer)',
      'map.addLayer(object = "pts")',
    ].join('\n')
    expect(actionCallInCode(script)).toBe('map:addLayer')
  })

  it('leaves ordinary R alone, including dotted names', () => {
    for (const code of [
      'sf::st_buffer(pts, 100)',
      'as.data.frame(x)',
      'data.frame(a = 1)',
      'plot(pts$geometry)',
      'my.list$map.addLayer',
      'df |> dplyr::filter(pop > 10)',
      'terra::rast("dem.tif")',
    ]) {
      expect(actionCallInCode(code), code).toBeNull()
    }
  })

  it('is not fooled by a name that merely starts like an action', () => {
    expect(actionCallInCode('map.addLayers(x)')).toBeNull()
    expect(actionCallInCode('mapp.addLayer(x)')).toBeNull()
  })

  it('needs a call, not a mention', () => {
    expect(actionCallInCode('# use map:addLayer for this')).toBeNull()
  })
})

describe('what each side is told', () => {
  it('redirects the model to the tool it should have used', () => {
    const out = actionCodeRefusal('map:addLayer')
    expect(out).toMatch(/not an R function/)
    expect(out).toContain('run_ui_action')
    expect(out).toMatch(/never write an action id as R code/i)
  })

  it('tells the user nothing is wrong with their R', () => {
    const out = actionCodeHint('map:addLayer')
    expect(out).toMatch(/not an R function/)
    expect(out).toMatch(/nothing is missing from your R installation/)
    expect(out).toMatch(/it made a mistake/)
  })
})
