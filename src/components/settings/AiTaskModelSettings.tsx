import { useCallback, useEffect, useRef, useState } from 'react'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { useAiModelCatalogue } from '@/hooks/useAiModelCatalogue'
import { useAiTaskModelsStore } from '@/store/ai-task-models'
import { resolveTaskModel, type TaskKind, type TaskModelSelection } from '@/lib/ai-task-models'
import { imageCapability, isLocalProvider, localApiKey, localBaseUrl, PROVIDER_LABELS, requiresApiKey } from '@/lib/ai-client'

const inputClass = 'min-w-0 w-full rounded border border-geo-border bg-geo-bg px-2 py-1.5 text-xs text-foreground'
const buttonClass = 'rounded border border-geo-border px-2 py-1.5 text-xs text-foreground hover:bg-geo-hover disabled:opacity-50'
const title = { document: 'Document analysis', image: 'Image interpretation' }
const cloudKey: Partial<Record<AiProvider, string>> = { openai: 'openai', anthropic: 'anthropic', google: 'google_gemini' }
const describeError = (error: unknown): string => error instanceof Error ? error.message : String(error)

function TaskModelCard({ kind }: { kind: TaskKind }): React.ReactElement {
  const saved = useAiTaskModelsStore(s => s.selections[kind])
  const initialized = useAiTaskModelsStore(s => s.initialized)
  const assistantProvider = useAiStore(s => s.provider)
  const assistantModel = useAiStore(s => s.currentModel())
  const keys = useApiKeysStore(s => s.keys)
  const [separate, setSeparate] = useState(saved !== null)
  const [provider, setProvider] = useState<AiProvider>(saved?.provider ?? (kind === 'image' ? 'ollama' : assistantProvider))
  const [model, setModel] = useState(saved?.model ?? (kind === 'image' && assistantProvider !== 'ollama' ? '' : assistantModel))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = useRef(0)
  const invalidate = useCallback(() => { ++generation.current }, [])
  const local = isLocalProvider(provider)
  const url = local ? localBaseUrl(provider, keys) : ''
  const apiKey = local ? localApiKey(provider, keys) : keys[cloudKey[provider] ?? ''] ?? ''
  const catalogue = useAiModelCatalogue(provider, model, separate)
  useEffect(() => {
    setSeparate(saved !== null)
    if (saved) { setProvider(saved.provider); setModel(saved.model) }
  }, [saved])
  useEffect(() => {
    invalidate()
    setError(null); setNotice(null); setBusy(false)
    return invalidate
  }, [provider, url, apiKey, invalidate])
  const effective = resolveTaskModel(saved, { provider: assistantProvider, model: assistantModel })
  const invalidImage = kind === 'image' && effective.provider !== 'ollama'
  const missingKey = separate && requiresApiKey(provider) && !apiKey
  const providers = kind === 'image' ? [...new Set<AiProvider>(['ollama', ...(saved && saved.provider !== 'ollama' ? [saved.provider] : [])])] : Object.keys(PROVIDER_LABELS) as AiProvider[]

  const refresh = async (): Promise<void> => {
    const current = ++generation.current
    setBusy(true); setError(null); setNotice(null)
    try {
      await catalogue.refresh()
    } catch (failure) { if (current === generation.current) setError(describeError(failure)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const apply = async (): Promise<void> => {
    const current = ++generation.current
    setBusy(true); setError(null); setNotice(null)
    try {
      const selection: TaskModelSelection = separate ? { provider, model: model.trim() } : null
      if (selection && !selection.model) throw new Error('Enter or choose a model ID.')
      if (selection && missingKey) throw new Error('Configure this provider’s API key in Provider & model first.')
      if (kind === 'image' && selection) {
        if (provider !== 'ollama') throw new Error('Image interpretation currently requires an Ollama vision model.')
        const capability = await imageCapability(provider, selection.model, url, apiKey)
        if (capability !== 'supported') throw new Error(capability === 'unsupported' ? 'This Ollama model does not advertise vision support. Choose a vision model.' : 'Could not verify vision support. Check the Ollama connection and model ID, then retry.')
      }
      if (current !== generation.current) return
      await useAiTaskModelsStore.getState().setSelection(kind, selection)
      if (current === generation.current) setNotice('Saved. Your assistant model and connection are unchanged.')
    } catch (failure) { if (current === generation.current) setError(describeError(failure)) }
    finally { if (current === generation.current) setBusy(false) }
  }
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-geo-border bg-geo-bg/40 p-4" disabled={!initialized}>
    <legend className="px-1 text-xs font-semibold text-foreground">{title[kind]}</legend>
    <p className="break-words text-xs text-foreground">Current: {saved ? '' : 'Use assistant model · '}{PROVIDER_LABELS[effective.provider]} · {effective.model}</p>
    {invalidImage && <p role="status" className="text-xs text-geo-muted">{saved ? 'This saved route cannot interpret images. Choose an Ollama vision model; there is no automatic fallback.' : 'Your current assistant route cannot receive project images. Choose a separate Ollama vision model to interpret them.'}</p>}
    <label className="block space-y-1 text-xs text-foreground"><span>{title[kind]} model</span>
      <select data-ourgeo-id={kind === 'document' ? 'settings.documentModelMode' : 'settings.imageModelMode'} aria-label={`${title[kind]} model`} className={inputClass} value={separate ? 'separate' : 'assistant'} onChange={event => { ++generation.current; setBusy(false); setSeparate(event.target.value === 'separate'); setError(null); setNotice(null) }}>
        <option value="assistant">Use assistant model</option><option value="separate">Use a separate model</option>
      </select>
    </label>
    {separate && <div className="space-y-3">
      <label className="block space-y-1 text-xs text-foreground"><span>Provider</span>
        <select data-ourgeo-id={kind === 'document' ? 'settings.documentModelProvider' : 'settings.imageModelProvider'} aria-label={`${title[kind]} provider`} className={inputClass} value={provider} onChange={event => { setProvider(event.target.value as AiProvider); setModel('') }}>
          {providers.map(value => <option key={value} value={value}>{PROVIDER_LABELS[value]}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs text-foreground"><span>Available models</span>
        <select data-ourgeo-id={kind === 'document' ? 'settings.documentModelChoices' : 'settings.imageModelChoices'} aria-label={`${title[kind]} available models`} className={inputClass} value={catalogue.models.some(choice => choice.id === model) ? model : ''} onChange={event => { if (event.target.value) { ++generation.current; setBusy(false); setModel(event.target.value); setError(null); setNotice(null) } }}>
          <option value="">Choose a listed model or enter a custom ID below</option>
          {catalogue.models.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs text-foreground"><span>Model ID</span>
        <input data-ourgeo-id={kind === 'document' ? 'settings.documentModelId' : 'settings.imageModelId'} aria-label={`${title[kind]} model ID`} className={inputClass} value={model} list={`file-analysis-${kind}-models`} placeholder="Choose a model or enter its exact ID" onChange={event => { ++generation.current; setBusy(false); setModel(event.target.value); setError(null); setNotice(null) }} />
        <datalist id={`file-analysis-${kind}-models`}>{catalogue.models.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</datalist>
      </label>
      {catalogue.canRefresh && <button type="button" className={buttonClass} disabled={busy || catalogue.loading} data-ourgeo-id={kind === 'document' ? 'settings.documentModelRefresh' : 'settings.imageModelRefresh'} onClick={() => void refresh()}>Refresh available models</button>}
      {catalogue.loading && <p role="status" className="text-xs text-geo-muted">Loading models from your existing connection…</p>}
      {catalogue.error && <p role="status" className="text-xs text-geo-muted">{catalogue.error} Saved chat and custom model IDs remain listed; no new connection was created.</p>}
      {local && <p className="break-all text-[11px] text-geo-muted">Configured connection: {url}</p>}
      {missingKey && <p className="text-xs text-geo-muted">This provider needs an API key. Configure it in Provider & model before applying.</p>}
      <p className="text-[11px] text-geo-muted">Uses the same model catalogue, credentials, subscription sign-in and server settings as chat. Saved chat models and custom IDs appear automatically; no separate connection or registration is needed.</p>
    </div>}
    {kind === 'image' && <p className="text-[11px] text-geo-muted">Image interpretation currently supports native Ollama models that advertise vision. Applying a separate model checks this capability without running inference. Other image transports are unavailable.</p>}
    {error && <p role="alert" className="break-words text-xs text-foreground">{error}</p>}
    {notice && <p role="status" className="text-xs text-geo-muted">{notice}</p>}
    <button type="button" className={buttonClass} disabled={busy} data-ourgeo-id={kind === 'document' ? 'settings.documentModelApply' : 'settings.imageModelApply'} onClick={() => void apply()}>{busy ? 'Working…' : `Apply ${kind === 'document' ? 'document model' : 'image model'}`}</button>
  </fieldset>
}

export function AiTaskModelSettings(): React.ReactElement {
  const initialized = useAiTaskModelsStore(s => s.initialized)
  const error = useAiTaskModelsStore(s => s.error)
  const analyseOnImport = useAiTaskModelsStore(s => s.analyseOnImport)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    void useAiTaskModelsStore.getState().init().catch(() => undefined)
    void useApiKeysStore.getState().init()
  }, [])
  return <div className="min-w-0 space-y-4">
    <p className="text-xs text-geo-muted">Choose models for project document analysis and image interpretation independently of the assistant. On demand, selected excerpts or images go to the chosen analysis model; its findings return to the assistant for the answer. Additional model calls have separate usage accounting and may incur charges.</p>
    {error && <div role="alert" className="space-y-2 rounded border border-geo-border p-3 text-xs text-foreground"><p>{error}</p>{!initialized && <><p>No file analysis route will run until these settings are repaired.</p><div className="flex flex-wrap gap-2"><button className={buttonClass} data-ourgeo-id="settings.taskModelsRetry" onClick={() => void useAiTaskModelsStore.getState().init().catch(() => undefined)}>Retry loading settings</button><button className={buttonClass} data-ourgeo-id="settings.taskModelsReset" onClick={() => void useAiTaskModelsStore.getState().resetSelections().catch(() => undefined)}>Reset file analysis models to assistant defaults</button></div></>}</div>}
    {!initialized && !error && <p role="status" className="text-xs text-geo-muted">Loading file analysis settings…</p>}
    {initialized && <><TaskModelCard kind="document" /><TaskModelCard kind="image" /></>}
    <div className="space-y-2 rounded-lg border border-geo-border p-4">
      <label className="flex items-start gap-2 text-xs text-foreground"><input type="checkbox" className="mt-0.5 accent-geo-accent" data-ourgeo-id="settings.analyseFilesOnImport" disabled={!initialized || saving} checked={analyseOnImport} onChange={event => { setSaving(true); void useAiTaskModelsStore.getState().setAnalyseOnImport(event.target.checked).catch(() => undefined).finally(() => setSaving(false)) }} /><span>Generate AI descriptions on import and rescan</span></label>
      <p className="text-[11px] text-geo-muted">Optional background analysis sends selected excerpts or images to the relevant model above and makes additional model calls. AI descriptions are separate from your descriptions; your edits are preserved. Turning this off cancels pending background analysis. On-demand analysis in chat remains available.</p>
    </div>
  </div>
}
