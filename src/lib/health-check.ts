import type { HealthResult, RHealth } from './health-types'
import { LOCAL_PROVIDERS, LOCAL_PROVIDER_MAP, localApiKey, localBaseUrl, PROVIDER_LABELS, sendMessage } from './ai-client'
import { proxyFetch } from './ai-proxy-fetch'
import { useAiStore, type AiProvider } from '@/store/ai'
import { useApiKeysStore } from '@/store/apiKeys'

export function packageResults(r: RHealth): HealthResult[] {
  const groups = [...new Set(r.packages.map((p) => p.group))]
  return [
    ...groups.map((group): HealthResult => {
      const packages = r.packages.filter((p) => p.group === group)
      const bad = packages.filter((p) => p.reason)
      const blocking = bad.some((p) => !p.loaded) && (group === 'Core' || group === 'Core dependency')
      return {
        id: `packages-${group}`, title: `${group} packages`, status: blocking ? 'error' : bad.length ? 'warning' : 'pass',
        detail: bad.length ? bad.map((p) => `${p.name}: ${p.reason}`).join(' · ') : `${packages.length} packages load successfully and match this R version.`,
      }
    }),
    { id: 'cran', title: 'CRAN package updates', status: r.updatesChecked ? 'pass' : 'warning', detail: r.updatesChecked ? 'Checked compatible package releases on CRAN.' : 'Could not reach the CRAN package index. Loading and R-version compatibility were checked; newer releases could not be checked. Check your network or proxy and rerun.' },
    { id: 'github', title: 'Curved geometry package updates', status: r.githubUpdatesChecked ? 'pass' : 'warning', detail: r.githubUpdatesChecked ? 'Checked sfarc’s current version on its GitHub repository.' : 'Could not check sfarc’s latest GitHub version. Its installation, loading and R-version compatibility were still checked.' },
    { id: 'r-library', title: 'R package library', status: r.libraryWritable ? 'pass' : 'error', detail: r.libraryWritable ? `User library: ${r.library}` : `R cannot write to ${r.library}. Choose a writable R_LIBS_USER library and restart ouRGeo.` },
  ]
}

export interface LocalConnection { provider: AiProvider; models: string[]; error?: string }
export async function inspectLocal(provider: AiProvider, keys: Record<string, string>, signal?: AbortSignal): Promise<LocalConnection> {
  const meta = LOCAL_PROVIDER_MAP[provider]
  const base = localBaseUrl(provider, keys).replace(/\/$/, '')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, 8000)
  try {
    const token = localApiKey(provider, keys)
    const res = await proxyFetch(`${base}${meta.transport === 'ollama' ? '/api/tags' : '/models'}`, { signal: controller.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new Error(`HTTP ${res.status}. Check the server URL and credentials.`)
    const data = await res.json() as { models?: { name: string }[]; data?: { id: string }[] }
    const models = (meta.transport === 'ollama' ? data.models?.map((m) => m.name) : data.data?.map((m) => m.id)) ?? []
    return { provider, models: models.filter((m) => typeof m === 'string' && !!m), ...(models.length ? {} : { error: 'The server is reachable but has no models. Load or download a model.' }) }
  } catch (e) {
    signal?.throwIfAborted()
    return { provider, models: [], error: e instanceof Error && e.name === 'AbortError' ? 'The server did not respond within 8 seconds. Start it and recheck.' : String(e) }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function inspectConnections(signal?: AbortSignal): Promise<LocalConnection[]> {
  await Promise.all([useAiStore.getState().init(), useApiKeysStore.getState().init()])
  signal?.throwIfAborted()
  const { keys } = useApiKeysStore.getState()
  const { provider } = useAiStore.getState()
  // Probe the common default servers plus every explicitly configured local
  // provider. Listing models never requests inference or consumes credits.
  const candidates = LOCAL_PROVIDERS.filter((p) => p.id === provider || keys[p.urlKeyId]?.trim() || p.id === 'ollama' || p.id === 'lmstudio')
  return Promise.all(candidates.map((p) => inspectLocal(p.id, keys, signal)))
}

export async function testAssistant(signal: AbortSignal): Promise<HealthResult> {
  const { provider, currentModel } = useAiStore.getState()
  const model = currentModel()
  const { keys } = useApiKeysStore.getState()
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timer = setTimeout(abort, 60_000)
  try {
    if (!model) throw new Error('Choose a model in AI configuration first.')
    const reply = await sendMessage({
      provider, model, apiKey: keys[provider === 'google' ? 'google_gemini' : provider] ?? '',
      localUrl: localBaseUrl(provider, keys), localApiKey: localApiKey(provider, keys),
      messages: [{ id: 'health-check', role: 'user', content: 'Reply with the word Ready.', timestamp: Date.now() }],
      systemPrompt: 'This is a connection test. Reply briefly, without reasoning or tool calls.',
      tools: [], maxOutputTokens: 512, testConnection: true,
      onChunk: () => {}, signal: controller.signal,
    })
    if (!reply.trim()) throw new Error('The model returned an empty reply. Try a different model or increase its output limit.')
    return { id: 'ai-response', title: 'AI response test', status: 'pass', detail: `${PROVIDER_LABELS[provider]} · ${model} returned a usable text reply. Tool use was not tested.` }
  } catch (e) {
    signal.throwIfAborted()
    return { id: 'ai-response', title: 'AI response test', status: 'warning', detail: controller.signal.aborted ? 'The model did not finish within 60 seconds. Try a smaller model or check the server connection.' : String(e) }
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
