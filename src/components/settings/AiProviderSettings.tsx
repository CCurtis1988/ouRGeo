import React, { useState, useEffect } from 'react'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'
import { SecretField, UrlField } from './fields'
import { ClaudeCliSettings } from './ClaudeCliSettings'
import {
  PROVIDER_MODELS,
  LOCAL_PROVIDERS,
  LOCAL_PROVIDER_MAP,
  isLocalProvider,
  localBaseUrl,
  localApiKey,
  localCtxKeyId,
  fetchLocalModels,
  fetchLocalContextSize,
} from '@/lib/ai-client'

// Cloud providers need a single API key; local providers are configured from
// the LOCAL_PROVIDERS registry (base URL + optional bearer token).
interface CloudProviderDef {
  id: AiProvider
  label: string
  keyId: string
  keyDesc: string
  keyPlaceholder: string
}

const CLOUD_PROVIDERS: CloudProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyId: 'anthropic',
    keyDesc: 'From console.anthropic.com → API Keys',
    keyPlaceholder: 'sk-ant-...',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyId: 'openai',
    keyDesc: 'From platform.openai.com → API Keys',
    keyPlaceholder: 'sk-...',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    keyId: 'google_gemini',
    keyDesc: 'From aistudio.google.com → Get API key',
    keyPlaceholder: 'AIza...',
  },
]


// Manual context-window override. Blank = use the auto-detected value (shown as
// the placeholder) or fall back to 128k.
function ContextWindowField({ id, detected }: { id: string; detected: number | null }) {
  const value = useApiKeysStore((s) => s.keys[id] ?? '')
  const setKey = useApiKeysStore((s) => s.setKey)
  const placeholder = detected != null ? String(detected) : '128000'
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-foreground">Context window (tokens)</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => setKey(id, e.target.value)}
        placeholder={placeholder}
        className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent font-mono"
      />
      <p className="text-[11px] text-geo-muted">
        {detected != null
          ? <>Auto-detected from server: <span className="font-mono">{detected.toLocaleString()}</span>. Override only if wrong.</>
          : 'Server did not report a context size — set it manually if the token bar is off.'}
      </p>
    </div>
  )
}

export function AiProviderSettings(): React.ReactElement {
  const provider = useAiStore((s) => s.provider)
  const setProvider = useAiStore((s) => s.setProvider)
  const currentModel = useAiStore((s) => s.currentModel())
  const setModel = useAiStore((s) => s.setModel)
  const init = useAiStore((s) => s.init)
  const initKeys = useApiKeysStore((s) => s.init)
  const keys = useApiKeysStore((s) => s.keys)

  const local = isLocalProvider(provider)
  const localMeta = LOCAL_PROVIDER_MAP[provider]

  const [localModels, setLocalModels] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [detectedCtx, setDetectedCtx] = useState<number | null>(null)

  useEffect(() => { init(); initKeys() }, [init, initKeys])

  // Resolved URL/key for the active local provider (recompute when the user edits them)
  const resolvedUrl = local ? localBaseUrl(provider, keys) : ''
  const resolvedKey = local ? localApiKey(provider, keys) : ''

  useEffect(() => {
    if (!local) { setLocalError(null); setLocalModels([]); return }
    let cancelled = false
    setLocalLoading(true)
    fetchLocalModels(provider, resolvedUrl, resolvedKey).then(({ models, error }) => {
      if (cancelled) return
      setLocalModels(models)
      setLocalError(error ?? null)
      setLocalLoading(false)
    })
    return () => { cancelled = true }
  }, [provider, local, resolvedUrl, resolvedKey])

  // Probe the server's real context window (shown as the override placeholder)
  useEffect(() => {
    if (!local) { setDetectedCtx(null); return }
    let cancelled = false
    fetchLocalContextSize(provider, resolvedUrl, resolvedKey, currentModel).then((n) => {
      if (!cancelled) setDetectedCtx(n)
    })
    return () => { cancelled = true }
  }, [provider, local, resolvedUrl, resolvedKey, currentModel])

  const cloudDef = CLOUD_PROVIDERS.find((p) => p.id === provider)
  const models = local ? localModels : PROVIDER_MODELS[provider]

  return (
    <div className="flex flex-col gap-4">
      {/* Provider selector */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Provider</span>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as AiProvider)}
          className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
        >
          <optgroup label="Cloud">
            {CLOUD_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
          <optgroup label="On this machine">
            <option value="claude-cli">Claude subscription (Claude Code)</option>
          </optgroup>
          <optgroup label="Local (self-hosted)">
            {LOCAL_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Cloud credential field */}
      {cloudDef && (
        <SecretField
          id={cloudDef.keyId}
          label="API Key"
          description={cloudDef.keyDesc}
          placeholder={cloudDef.keyPlaceholder}
        />
      )}

      {/* The subscription provider: no key, a binary and a sign-in instead. */}
      {provider === 'claude-cli' && <ClaudeCliSettings />}

      {/* Local provider configuration */}
      {local && localMeta && (
        <>
          <p className="text-[11px] text-geo-muted -mt-1">{localMeta.description}</p>
          <UrlField id={localMeta.urlKeyId} placeholder={localMeta.defaultUrl} />
          {localMeta.transport === 'openai' && (
            <SecretField
              id={localMeta.apiKeyId}
              label="API Key (optional)"
              description="Only needed if you started the server with an API key."
              placeholder="leave blank if none"
            />
          )}
          <ContextWindowField
            id={localCtxKeyId(provider)}
            detected={detectedCtx}
          />
        </>
      )}

      {/* Model selector */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-foreground">Default Model</span>
        {models.length > 0 ? (
          <select
            value={currentModel}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-geo-bg border border-geo-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-geo-accent"
          >
            {/* Ensure the saved model is selectable even if not in the fetched list */}
            {currentModel && !models.includes(currentModel) && (
              <option value={currentModel}>{currentModel}</option>
            )}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : local && localLoading ? (
          <p className="text-[11px] text-geo-muted">Connecting to {localMeta?.label}…</p>
        ) : local && localError ? (
          <p className="text-[11px] text-geo-error">{localError}</p>
        ) : (
          <p className="text-[11px] text-geo-muted">Loading…</p>
        )}
      </div>
    </div>
  )
}
