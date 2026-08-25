import { createJsonFileStore } from '@/lib/persistence'

const store = createJsonFileStore('ai-preferences.json', 'AI Prefs')

export interface AiPreferences {
  provider: string
  modelByProvider: Record<string, string>
  autopilotWarningDismissed: boolean
  webAccessEnabled: boolean
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
}

export async function loadAiPreferences(): Promise<AiPreferences> {
  const data = await store.read<{
    provider?: unknown
    modelByProvider?: unknown
    autopilotWarningDismissed?: unknown
    webAccessEnabled?: unknown
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
  }
}

export async function saveAiPreferences(prefs: Partial<AiPreferences>): Promise<void> {
  await store.merge(prefs as Record<string, unknown>)
}
