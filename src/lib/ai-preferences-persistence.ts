import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('ai-preferences.json', 'AI Prefs')

export interface AiPreferences {
  provider: string
  modelByProvider: Record<string, string>
  autopilotWarningDismissed: boolean
  webAccessEnabled: boolean
  /**
   * The Terminal switch: whether the assistant may run shell commands.
   *
   * OFF by default, and only an explicit `true` turns it on — an absent or
   * unreadable value is off, which is the state a new install is in rather
   * than one a user would have to notice was wrong. Same reasoning as
   * `dragEnabled` in layout.json, and for a much larger power.
   */
  terminalEnabled: boolean
  /**
   * Per-action permission overrides, actionId → tier.
   *
   * SPARSE on purpose: only the actions the user actually moved. That keeps the
   * registry's defaults live, so a later release can retighten one without
   * overwriting a choice the user made, and with no migration.
   */
  actionTiers: Record<string, string>
}

const DEFAULTS: AiPreferences = {
  provider: 'anthropic',
  modelByProvider: {
    openai: 'gpt-4o',
    anthropic: 'claude-opus-4-6',
    google: 'gemini-2.0-flash',
    ollama: 'llama3.1',
    lmstudio: '',
    llamacpp: '',
    jan: '',
    localai: '',
    vllm: '',
    sglang: '',
    mistralrs: '',
    xinference: '',
    openllm: '',
  },
  autopilotWarningDismissed: false,
  webAccessEnabled: true,
  terminalEnabled: false,
  actionTiers: {},
}

export async function loadAiPreferences(): Promise<AiPreferences> {
  const data = await store.read<{
    provider?: unknown
    modelByProvider?: unknown
    autopilotWarningDismissed?: unknown
    webAccessEnabled?: unknown
    terminalEnabled?: unknown
    actionTiers?: unknown
  }>()
  return {
    provider: typeof data.provider === 'string' ? data.provider : DEFAULTS.provider,
    modelByProvider: typeof data.modelByProvider === 'object' && data.modelByProvider
      ? { ...DEFAULTS.modelByProvider, ...(data.modelByProvider as Record<string, string>) }
      : DEFAULTS.modelByProvider,
    autopilotWarningDismissed: typeof data.autopilotWarningDismissed === 'boolean'
      ? data.autopilotWarningDismissed
      : false,
    // Web access is on by default; the panel's kill switch persists the opt-out.
    webAccessEnabled: typeof data.webAccessEnabled === 'boolean'
      ? data.webAccessEnabled
      : DEFAULTS.webAccessEnabled,
    // Only an explicit true. Anything else — absent, a string, a half-written
    // file — is off, because the safe answer must be the one you get by
    // default and by accident.
    terminalEnabled: data.terminalEnabled === true,
    actionTiers: typeof data.actionTiers === 'object' && data.actionTiers
      ? (data.actionTiers as Record<string, string>)
      : {},
  }
}

export async function saveAiPreferences(prefs: Partial<AiPreferences>): Promise<void> {
  await store.merge(prefs as Record<string, unknown>)
}
