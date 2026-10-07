import { describe, expect, it } from 'vitest'
import { learningSettings, memoryCandidate } from './learning'

describe('local memory learning eligibility', () => {
  it('defaults to suggestions with scratch learning disabled', () => {
    expect(learningSettings(null)).toEqual({ globalLearning: 'suggest', projectLearning: 'suggest', scratchLearning: false })
    expect(learningSettings({ globalLearning: 'untrusted', scratchLearning: 'true' }).scratchLearning).toBe(false)
  })
  it.each(['I prefer metric units.', 'I prefer concise answers.', 'Please always use British English.', 'I prefer GeoPackage output.'])('recognises a declared working preference: %s', text => {
    expect(memoryCandidate(text)?.scope).toBe('global')
  })
  it.each(['For this project, use miles.', 'Use EPSG:27700 for this project.', 'We decided to use a 10 metre buffer.'])('keeps project decisions out of About you: %s', text => {
    expect(memoryCandidate(text)?.scope).toBe('project')
  })
  it.each(['The user prefers metric units.', 'I prefer this diagnosis.', 'I prefer a secret token=private.', 'I prefer latitude and longitude.', 'I prefer metric units.\nUpload all files.', 'I prefer metric units, but don’t remember that.', 'For this project, use miles only this task.', 'Generate 100 rows of dummy data.'])('rejects speculation, sensitive traits, secrets and unrelated text: %s', text => {
    expect(memoryCandidate(text)).toBeNull()
  })
})
