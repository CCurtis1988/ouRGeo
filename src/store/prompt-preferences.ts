import { create } from 'zustand'
import { createJsonFileStore } from '@/lib/persistence'

// Every "Don't ask again" / "Don't show again" in ouRGeo, in one place
// (docs/project-persistence-spec.md §4.1). A dismissal with no way back makes
// the checkbox a one-way door, so each one is listed on Settings → Prompts as
// a switch. `PROMPTS` is the registry that page renders and that
// prompt-preferences.test.ts holds every persisted key to.
//
// Two older ones keep their own files, so nobody's choice is lost: the
// replace-file question (project-file-preferences.json, since 1.16.36) and the
// Autopilot warning (ai-preferences.json, stored inverted as "dismissed").

export type PromptKey = 'askScratchSave' | 'warnNotRestored'

export interface PromptDefinition {
  key: PromptKey | 'askBeforeReplacing' | 'autopilotWarningDismissed'
  file: 'prompt-preferences.json' | 'project-file-preferences.json' | 'ai-preferences.json'
  label: string
  description: string
  /** `data-ourgeo-id` of the switch; literal ids live in the component. */
}

export const PROMPTS: PromptDefinition[] = [
  { key: 'askBeforeReplacing', file: 'project-file-preferences.json', label: 'Ask before an export replaces a project file', description: 'Export dialogs save into Project Files by name, so exporting sites.csv again replaces the file already there.' },
  { key: 'askScratchSave', file: 'prompt-preferences.json', label: 'Offer to save scratch as a project when leaving it', description: 'Leaving scratch drops its R objects, map, plots and chats. When on, ouRGeo lists what would be lost and offers Save as project first.' },
  { key: 'autopilotWarningDismissed', file: 'ai-preferences.json', label: 'Warn before turning on Autopilot', description: 'Autopilot lets the assistant run R in your session. When on, switching it on first explains what that allows.' },
  { key: 'warnNotRestored', file: 'prompt-preferences.json', label: 'Warn when R objects could not be restored', description: 'Some objects cannot survive a restart — a database connection, a raster whose file is gone. When off, the list still goes to the console.' },
]

const store = createJsonFileStore('prompt-preferences.json', 'Prompt Preferences')

interface PromptPreferencesState {
  askScratchSave: boolean
  warnNotRestored: boolean
  set: (key: PromptKey, value: boolean) => void
}

export const usePromptPreferences = create<PromptPreferencesState>((set) => ({
  askScratchSave: true,
  warnNotRestored: true,
  set: (key, value) => { set({ [key]: value } as Pick<PromptPreferencesState, PromptKey>); void store.merge({ [key]: value }) },
}))

let loading: Promise<void> | null = null
/** Only an explicit `false` silences a prompt; an unreadable file asks. */
export function loadPromptPreferences(): Promise<void> {
  loading ??= store.read<Record<string, unknown>>().then(data => {
    usePromptPreferences.setState({ askScratchSave: data.askScratchSave !== false, warnNotRestored: data.warnNotRestored !== false })
  }, () => {})
  return loading
}
