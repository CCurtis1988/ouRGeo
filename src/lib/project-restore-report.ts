// What a restored R environment could not bring back (docs/project-persistence-spec.md
// §1.11): one warning naming each object and why, with a "Don't show again"
// that Settings → Prompts undoes. The console always gets the same list, so a
// silenced warning never makes a missing object invisible.

import { ask } from '@/store/ask'
import { loadPromptPreferences, usePromptPreferences } from '@/store/prompt-preferences'
import { useSessionStore } from '@/store/session'
import type { NotRestored } from '@/lib/r-client'

export function describeNotRestored(items: NotRestored[]): string {
  return `Not restored: ${items.map(item => `${item.name} (${item.reason})`).join(', ')}`
}

export async function reportNotRestored(items: NotRestored[]): Promise<void> {
  if (!items.length) return
  const line = describeNotRestored(items)
  useSessionStore.getState().addConsoleEntry('info', `${line}. The other objects were restored; re-run the code that created these.`)
  await loadPromptPreferences()
  if (!usePromptPreferences.getState().warnNotRestored) return
  // Not awaited by the caller's restore: the warning is information, and the
  // project finishes opening behind it.
  void ask({
    title: 'Some R objects could not be restored',
    body: `${line}. Everything else in the environment was restored. Re-run the code that created these objects; the console history shows what you ran.`,
    choices: [{ id: 'ok', label: 'OK', variant: 'primary' }],
    cancelId: 'ok',
    checkbox: { label: "Don't show again", hint: 'The list still goes to the console. Turn this warning back on in Settings → Prompts.' },
  }).then(answer => { if (answer.checked) usePromptPreferences.getState().set('warnNotRestored', false) })
}
