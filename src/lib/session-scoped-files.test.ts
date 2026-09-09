import { describe, it, expect } from 'vitest'
import { SESSION_SCOPED_FILES } from './session-scoped-files'

describe('what a clean exit deletes', () => {
  it('includes scratch’s AI chats', () => {
    // Scratch is the workspace ouRGeo always launches into, and it must not
    // accumulate every conversation the user has ever had in it. A chat worth
    // keeping is a reason to Save As, after which it lives in the bundle.
    expect(SESSION_SCOPED_FILES).toContain('ai-chats.json')
  })

  it('still includes everything it did before', () => {
    for (const f of [
      'plots.json', 'spatial-layers.json', 'spatial-ui.json',
      'console.json', 'object-tabs.json',
    ]) {
      expect(SESSION_SCOPED_FILES).toContain(f)
    }
  })

  it('never deletes a preference', () => {
    // Each of these is state a user chose and expects to find again. The list
    // is enumerated rather than sampled: a preference deleted on exit is a
    // setting that silently reverts, and the user has no way to tell why.
    for (const f of [
      'theme.json', 'custom-themes.json', 'layout.json', 'api-keys.json',
      'ai-preferences.json', 'basemap.json', 'database-prefs.json',
      'markdown-settings.json', 'plugins.json', 'spatial-settings.json',
      'terminal-preferences.json', 'voice-preferences.json',
      'recent-projects.json', 'environment-preferences.json', 'working-dirs.json',
    ]) {
      expect(SESSION_SCOPED_FILES).not.toContain(f)
    }
  })

  it('never deletes session.json', () => {
    // The deliberate exception: scratch's open code tabs are the one thing
    // ouRGeo keeps across restarts.
    expect(SESSION_SCOPED_FILES).not.toContain('session.json')
  })
})
