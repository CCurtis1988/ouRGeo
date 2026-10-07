import { describe, it, expect } from 'vitest'
import { AI_BASE_PROMPT, buildProvenanceRules, buildToolGuidance } from './ai-system-prompt'

describe('buildProvenanceRules', () => {
  const rules = buildProvenanceRules()

  it('forbids fabricated data and demands the transformation code', () => {
    expect(rules).toMatch(/Never fabricate data/i)
    expect(rules).toMatch(/Show every transformation/i)
    expect(rules).toMatch(/data\.frame\(\)/)
  })

  it('requires a named source object and a provenance note', () => {
    expect(rules).toMatch(/Name the source/i)
    expect(rules).toMatch(/source object → operations applied/)
  })

  it('tells the model to admit missing data rather than assume', () => {
    expect(rules).toMatch(/Say when you cannot/i)
  })
})

describe('buildToolGuidance', () => {
  it('describes both tools as available when both switches are on', () => {
    const g = buildToolGuidance({ autoPilot: true, webAccess: true, terminal: false })
    expect(g).toContain('`execute_r_code`')
    expect(g).toContain('`web_search`')
    expect(g).toContain('Web access — ON')
  })

  it('distinguishes web-tool permission from the assistant connection', () => {
    const g = buildToolGuidance({ autoPilot: true, webAccess: false, terminal: false })
    expect(g).toContain('Web access — OFF')
    expect(g).toMatch(/Web tools are off/)
    expect(g).toMatch(/Do not claim to have looked anything up/)
    expect(g).not.toContain('`web_search`')
    expect(g).toContain('does not disable the configured assistant connection')
  })

  it('tells the model to hand code to the user when Autopilot is off', () => {
    const g = buildToolGuidance({ autoPilot: false, webAccess: false, terminal: false })
    expect(g).toContain('Running R code — unavailable')
    expect(g).toMatch(/Autopilot is off/)
  })

  it('keeps the two switches independent', () => {
    const webOnly = buildToolGuidance({ autoPilot: false, webAccess: true, terminal: false })
    expect(webOnly).toContain('Running R code — unavailable')
    expect(webOnly).toContain('Web access — ON')
  })
})

describe('AI_BASE_PROMPT', () => {
  it('still explains the [DatasetName] mention syntax', () => {
    expect(AI_BASE_PROMPT).toContain('[DatasetName]')
  })
})
