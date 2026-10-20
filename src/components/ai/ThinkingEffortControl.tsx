import React, { useEffect, useId } from 'react'
import type { AiProvider } from '@/store/ai'
import { useAiThinkingStore } from '@/store/ai-thinking'
import { thinkingKey, type ThinkingCapability } from '@/lib/ai-thinking'

export function ThinkingEffortControl({ provider, model, capability, disabled }: {
  provider: AiProvider; model: string; capability: ThinkingCapability | null; disabled: boolean
}): React.ReactElement | null {
  const id = useId()
  const init = useAiThinkingStore(state => state.init)
  const initialized = useAiThinkingStore(state => state.initialized)
  const selected = useAiThinkingStore(state => state.selections[thinkingKey(provider, model)])
  const error = useAiThinkingStore(state => state.error)
  useEffect(() => { void init() }, [init])
  if (!capability) return null
  const value = capability.choices.some(choice => choice.value === selected) ? selected : 'default'
  const title = capability.protocol === 'google-budget'
    ? 'Requested thinking-token budget for this model. Applies to new messages; more thinking can take longer and use more tokens. Separate from context retrieval.'
    : 'Requested thinking effort for this model. Applies to new messages; higher effort can take longer and use more tokens. The provider may adapt or limit actual effort. Separate from context retrieval.'
  return <div className="text-[10px] text-geo-muted">
    <div className="flex items-center gap-2" title={title}>
      <label htmlFor={id}>{capability.protocol === 'google-budget' ? 'Thinking budget' : 'Thinking'}</label>
      <select id={id} aria-label={capability.protocol === 'google-budget' ? 'Thinking budget' : 'Thinking effort'}
        data-ourgeo-id="ai.thinkingEffort" disabled={disabled || !initialized} value={value}
        className="min-w-0 max-w-full rounded border border-geo-border bg-geo-bg px-1 py-0.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-geo-accent disabled:opacity-50"
        onChange={event => { void useAiThinkingStore.getState().setEffort(provider, model, event.target.value).catch(() => undefined) }}>
        <option value="default">Provider default{capability.defaultLabel ? ` · ${capability.defaultLabel}` : ''}</option>
        {capability.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="mt-1 text-geo-error">{error}</p>}
  </div>
}
