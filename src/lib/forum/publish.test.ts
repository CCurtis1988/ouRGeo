import { describe, it, expect } from 'vitest'
import { forumErrorMessage } from './publish'

describe('forumErrorMessage', () => {
  it('unwraps Electron\'s IPC prefix so the forum\'s own wording survives', () => {
    // The messages underneath are written as sentences by the schema's triggers;
    // the wrapper would bury the only part worth reading.
    const raw = new Error(
      "Error invoking remote method 'forum:createThread': Error: At most 10 images per post."
    )
    expect(forumErrorMessage(raw)).toBe('At most 10 images per post.')
  })

  it('leaves a plain message alone', () => {
    expect(forumErrorMessage(new Error('Sign in first.'))).toBe('Sign in first.')
  })

  it('copes with a non-Error', () => {
    expect(forumErrorMessage('boom')).toBe('boom')
  })
})
