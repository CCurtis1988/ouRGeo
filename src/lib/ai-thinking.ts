import type { AiProvider } from '@/store/ai'

export interface ThinkingChoice { value: string; label: string; wireValue: string | number | boolean }
export interface ThinkingCapability {
  protocol: 'openai' | 'anthropic' | 'claude-cli' | 'google-level' | 'google-budget' | 'ollama'
  choices: ThinkingChoice[]
  defaultLabel?: string
  adaptive?: boolean
}
export interface ThinkingSelection { capability: ThinkingCapability; value: string }
const labels: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum', on: 'On', off: 'Off' }
const levels = (values: string[]): ThinkingChoice[] => values.map(value => ({ value, label: labels[value] ?? value, wireValue: value }))
const normal = ['low', 'medium', 'high']
export const thinkingKey = (provider: AiProvider, model: string): string => JSON.stringify([provider, model])

/** Conservative allowlist: compatible HTTP endpoints do not imply compatible
 * reasoning controls. Unknown models keep their provider's behaviour unchanged. */
export function thinkingCapability(provider: AiProvider, model: string): ThinkingCapability | null {
  const id = model.toLowerCase().replace(/-\d{4}-\d{2}-\d{2}$/, '')
  if (provider === 'openai' || provider === 'openai-subscription') {
    let values: string[] | undefined
    if (['o1', 'o3', 'o3-mini', 'o4-mini'].includes(id)) values = normal
    if (['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].includes(id)) values = ['minimal', ...normal]
    if (id === 'gpt-5.1') values = ['none', ...normal]
    if (['gpt-5.2', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5.6', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].includes(id)) values = ['none', ...normal, 'xhigh']
    if (['gpt-5-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini'].includes(id)) values = normal
    if (['gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex'].includes(id)) values = [...normal, 'xhigh']
    if (['gpt-6-astra', 'gpt-6.1-sol'].includes(id)) values = [...normal, 'xhigh', 'max']
    if (['gpt-6-sol', 'gpt-6-luna'].includes(id)) values = ['none', ...normal, 'xhigh', 'max']
    return values ? { protocol: 'openai', choices: levels(values) } : null
  }
  if (provider === 'anthropic' || provider === 'claude-cli') {
    const alias = provider === 'claude-cli' && ['opus', 'sonnet'].includes(id)
    const older = id === 'claude-opus-4-5' || /^claude-opus-4-5-\d{8}$/.test(id)
    const adaptive = ['claude-opus-4-6', 'claude-sonnet-4-6'].includes(id)
    const newer = ['claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-mythos-5', 'claude-mythos-5-1'].includes(id)
    if (!alias && !older && !adaptive && !newer) return null
    return { protocol: provider === 'claude-cli' ? 'claude-cli' : 'anthropic', choices: levels(older ? normal : adaptive ? [...normal, 'max'] : [...normal, 'xhigh', 'max']), adaptive: !older }
  }
  if (provider === 'google') {
    const name = id.replace(/^models\//, '')
    if (['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(name)) {
      const pro = name.endsWith('-pro')
      return { protocol: 'google-budget', defaultLabel: pro || name === 'gemini-2.5-flash' ? 'Dynamic' : 'Off', choices: [
        ...(!pro ? [{ value: 'off', label: 'Off', wireValue: 0 }] : []),
        ...[1024, 4096, 8192].map(tokens => ({ value: String(tokens), label: `${tokens.toLocaleString('en-GB')} tokens`, wireValue: tokens })),
      ] }
    }
    const values: Record<string, string[]> = {
      'gemini-3-pro-preview': ['low', 'high'], 'gemini-3.1-pro-preview': normal,
      'gemini-3-flash-preview': ['minimal', ...normal], 'gemini-3.5-flash-lite': ['minimal', ...normal],
      'gemini-3.6-flash': ['minimal', ...normal], 'gemini-3.8-flash': normal, 'gemini-4-argon': normal,
    }
    return values[name] ? { protocol: 'google-level', choices: levels(values[name]) } : null
  }
  return null
}

/** New Ollama versions advertise exact values; older versions may only advertise
 * the thinking capability. Never infer a reasoning dial for a custom model name. */
export function ollamaThinkingCapability(data: unknown, model: string): ThinkingCapability | null {
  const source = data as { thinking?: { values?: unknown[]; default?: unknown }; capabilities?: unknown[] } | null
  const advertised = source?.thinking?.values
  if (Array.isArray(advertised)) {
    const values = advertised.filter((value): value is string | boolean => typeof value === 'boolean' || (typeof value === 'string' && /^[a-z][a-z0-9_-]{0,40}$/.test(value)))
    if (values.length < 2 && (values.length === 0 || values[0] === false)) return null
    const choices = values.map(wireValue => { const value = typeof wireValue === 'boolean' ? wireValue ? 'on' : 'off' : wireValue; return { value, label: labels[value] ?? value, wireValue } })
    return { protocol: 'ollama', choices, defaultLabel: choices.find(choice => choice.wireValue === source?.thinking?.default)?.label }
  }
  if (!source?.capabilities?.includes('thinking')) return null
  return { protocol: 'ollama', choices: /(^|\/)gpt-oss(?=:|$)/.test(model) ? levels(normal) : [{ value: 'off', label: 'Off', wireValue: false }, { value: 'on', label: 'On', wireValue: true }] }
}

export function thinkingWire(selection?: ThinkingSelection): string | number | boolean | undefined {
  if (!selection || selection.value === 'default') return undefined
  return selection.capability.choices.find(choice => choice.value === selection.value)?.wireValue
}

/** Thinking shares the output ceiling on hosted APIs. Reserve room before
 * compiling context, rather than silently consuming the entire reply allowance. */
export function thinkingOutputReservation(base: number, contextSize: number, selection?: ThinkingSelection): number {
  const wire = thinkingWire(selection)
  if (wire === undefined) return base
  const protocol = selection?.capability.protocol
  let requested = base
  if (protocol === 'google-budget' && typeof wire === 'number' && wire > 0) requested += wire
  else if (protocol !== 'ollama' && protocol !== 'claude-cli') {
    requested = Math.max(base, ({ medium: 8192, high: 16384, xhigh: 32768, max: 32768 } as Record<string, number>)[String(wire)] ?? base)
  }
  return Math.max(base, Math.min(requested, 32768, Math.floor(contextSize / 4)))
}
