// @vitest-environment jsdom
// Acceptance check M3 (docs/project-persistence-spec.md §4.1, §5): every
// "Don't ask again" / "Don't show again" in ouRGeo has a switch on
// Settings → Prompts. A new silenceable prompt that is not registered here
// fails this test, which is the point: a checkbox with no way back is a
// one-way door.
import React from 'react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROMPTS } from '@/store/prompt-preferences'

vi.mock('@/lib/persistence', () => ({ createJsonFileStore: () => ({ read: async () => ({}), write: async () => {}, merge: async () => {} }) }))
import { PromptSettings } from './PromptSettings'

afterEach(cleanup)

/** Where each silenceable prompt is raised, and the preference it sets. */
const RAISED_IN: Record<string, string> = {
  'components/project/ReplaceProjectFileDialog.tsx': 'askBeforeReplacing',
  'components/ai/AutopilotWarningDialog.tsx': 'autopilotWarningDismissed',
  'lib/project-leave.tsx': 'askScratchSave',
  'lib/project-restore-report.ts': 'warnNotRestored',
}

/** Offers that are not persisted, so there is nothing to turn back on. */
const NOT_PERSISTED: Record<string, string> = {
  'components/spatial/AttributePopover.tsx': 'snoozes the attribute popup until the next Save Edits; never written to disk',
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : []
  })
}

describe('Settings → Prompts', () => {
  it('renders one switch per registered prompt', () => {
    const { container } = render(<PromptSettings />)
    const keys = [...container.querySelectorAll('[role="switch"]')].map(el => el.getAttribute('data-prompt-key'))
    expect(keys.sort()).toEqual(PROMPTS.map(p => p.key).sort())
  })

  it('lists every place in the source that offers to stop asking', () => {
    const root = join(__dirname, '..', '..')
    const offering = sources(root).filter(file => /Don(?:'|&apos;|’)t (?:ask|show)[^"\n]{0,30}again/.test(readFileSync(file, 'utf8')))
      .map(file => relative(root, file).replace(/\\/g, '/'))
      .filter(file => !file.startsWith('components/settings/') && file !== 'store/prompt-preferences.ts')
    for (const file of offering.filter(file => !NOT_PERSISTED[file])) expect(RAISED_IN[file], `${file} offers "don't ask again" — register its preference in PROMPTS and in this test`).toBeDefined()
    for (const key of Object.values(RAISED_IN)) expect(PROMPTS.map(p => p.key)).toContain(key)
  })
})
