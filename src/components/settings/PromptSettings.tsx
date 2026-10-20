import React, { useEffect } from 'react'
import { Switch } from '../ui/switch'
import { loadProjectFilePreferences, useProjectFileReplaceStore } from '@/store/project-file-replace'
import { loadPromptPreferences, usePromptPreferences, PROMPTS } from '@/store/prompt-preferences'
import { useAiStore } from '@/store/ai'

const describe = (key: string): string => PROMPTS.find(p => p.key === key)?.description ?? ''
const label = (key: string): string => PROMPTS.find(p => p.key === key)?.label ?? key

/**
 * Settings → Prompts: every "Don't ask again" and "Don't show again" in
 * ouRGeo, each turned back on here (docs/project-persistence-spec.md §4.1).
 * A dismissal with no way back makes the checkbox a one-way door. The rows
 * are written out rather than mapped from `PROMPTS` so each switch carries a
 * literal highlight id; PromptSettings.test.tsx holds this page to the
 * registry, so a prompt added there and not here fails a test.
 */
export function PromptSettings(): React.ReactElement {
  const askReplace = useProjectFileReplaceStore(s => s.askBeforeReplacing)
  const setAskReplace = useProjectFileReplaceStore(s => s.setAskBeforeReplacing)
  const askScratch = usePromptPreferences(s => s.askScratchSave)
  const warnNotRestored = usePromptPreferences(s => s.warnNotRestored)
  const set = usePromptPreferences(s => s.set)
  const autopilotDismissed = useAiStore(s => s.autopilotWarningDismissed)
  useEffect(() => { void loadProjectFilePreferences(); void loadPromptPreferences() }, [])
  return (
    <div className="flex flex-col gap-4" data-prompt-keys={PROMPTS.map(p => p.key).join(' ')}>
      <Switch checked={askReplace} onChange={setAskReplace} data-ourgeo-id="settings.projectFilesAskReplace" data-prompt-key="askBeforeReplacing"
        label={label('askBeforeReplacing')} description={describe('askBeforeReplacing')} />
      <Switch checked={askScratch} onChange={value => set('askScratchSave', value)} data-ourgeo-id="settings.promptsScratchSave" data-prompt-key="askScratchSave"
        label={label('askScratchSave')} description={describe('askScratchSave')} />
      <Switch checked={!autopilotDismissed} onChange={value => useAiStore.getState().setAutopilotWarningDismissed(!value)} data-ourgeo-id="settings.promptsAutopilotWarning" data-prompt-key="autopilotWarningDismissed"
        label={label('autopilotWarningDismissed')} description={describe('autopilotWarningDismissed')} />
      <Switch checked={warnNotRestored} onChange={value => set('warnNotRestored', value)} data-ourgeo-id="settings.promptsNotRestored" data-prompt-key="warnNotRestored"
        label={label('warnNotRestored')} description={describe('warnNotRestored')} />
      <p className="text-[11px] text-geo-muted leading-relaxed">
        The warning after ouRGeo did not close properly is not listed: it cannot be turned off, because it is the only
        place that says which work may be missing.
      </p>
    </div>
  )
}
