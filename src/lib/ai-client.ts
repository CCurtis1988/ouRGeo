import type { AiProvider, ChatMessage, OpenAiAssistantMessage } from '@/store/ai'
import type { REnvironmentInfo } from '@/lib/r-client'
import type { ConsoleEntry } from '@/store/session'
import { selectConversation } from '@/lib/context/compaction'
import { compactToolResults, type ToolProtocol } from '@/lib/context/tool-compaction'
import { estimateTokens, inputCapacity, assertInvocationBudget } from '@/lib/context/budget'
import { redactContext } from '@/lib/context/policy'
import { proxyFetch } from '@/lib/ai-proxy-fetch'
import { parseClaudeLine, claudeFailureMessage, isMissingSession } from '@/lib/ai-claude-stream'
import { sendChatGptSubscription } from '@/lib/ai-chatgpt-transport'
import { normaliseUsage, type UsageProtocol, type UsageReport } from '@/lib/context/usage'

// ── Context window sizes ───────────────────────────────────────────────────
export const CONTEXT_SIZES: Record<string, number> = {
  // Anthropic
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-3-5-sonnet-latest': 200_000,
  'claude-3-5-haiku-latest': 200_000,
  // OpenAI
  'gpt-4.1': 1_000_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o1': 200_000,
  'o3': 200_000,
  'o3-mini': 200_000,
  // Google
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-2.0-flash-lite': 1_000_000,
  'gemini-1.5-pro': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
}

export function getContextSize(model: string): number {
  return CONTEXT_SIZES[model] ?? 32_000
}

/** What to show for a Claude Code alias until the run reports its real
 *  window. Every current Claude model is at least this. */
export const CLAUDE_CLI_MIN_CONTEXT = 200_000

// ── Local provider registry ────────────────────────────────────────────────
// Every local backend below is OpenAI-compatible (exposes /v1/chat/completions
// and /v1/models) EXCEPT Ollama, which uses its native /api/chat + /api/tags.
// `urlKeyId`/`apiKeyId` are keys in the apiKeys store. Models are always fetched
// from the running server, so PROVIDER_MODELS is empty for these providers.
export interface LocalProviderMeta {
  id: AiProvider
  label: string
  /** apiKeys store key holding the base URL */
  urlKeyId: string
  /** apiKeys store key holding an optional bearer token (servers started with one) */
  apiKeyId: string
  /** Pre-populated when the user hasn't entered a URL */
  defaultUrl: string
  /** 'ollama' = native API, 'openai' = OpenAI-compatible /v1 endpoints */
  transport: 'ollama' | 'openai'
  /** Shown under the URL field so the user knows this matches their server */
  description: string
  /** Shown when the server is reachable but has no models loaded */
  modelHint: string
}

export const LOCAL_PROVIDERS: LocalProviderMeta[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    urlKeyId: 'ollama_url',
    apiKeyId: 'ollama_key',
    defaultUrl: 'http://localhost:11434',
    transport: 'ollama',
    description: 'Ollama native API. Start with `ollama serve`.',
    modelHint: 'Ollama is running but no models are installed. Run: ollama pull llama3.1',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    urlKeyId: 'lmstudio_url',
    apiKeyId: 'lmstudio_key',
    defaultUrl: 'http://localhost:1234/v1',
    transport: 'openai',
    description: 'Enable the local server in LM Studio’s Developer tab.',
    modelHint: 'LM Studio is running but no model is loaded. Load a model in LM Studio first.',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    urlKeyId: 'llamacpp_url',
    apiKeyId: 'llamacpp_key',
    defaultUrl: 'http://localhost:8080/v1',
    transport: 'openai',
    description: 'Run `llama-server -m model.gguf`. Set an API key if you used --api-key.',
    modelHint: 'llama.cpp is running but reported no model.',
  },
  {
    id: 'jan',
    label: 'Jan',
    urlKeyId: 'jan_url',
    apiKeyId: 'jan_key',
    defaultUrl: 'http://localhost:1337/v1',
    transport: 'openai',
    description: 'Enable “Local API Server” in Jan → Settings → Advanced.',
    modelHint: 'Jan is running but no model is loaded.',
  },
  {
    id: 'localai',
    label: 'LocalAI',
    urlKeyId: 'localai_url',
    apiKeyId: 'localai_key',
    defaultUrl: 'http://localhost:8080/v1',
    transport: 'openai',
    description: 'LocalAI OpenAI-compatible server. Add an API key if you configured one.',
    modelHint: 'LocalAI is running but no models are installed.',
  },
  {
    id: 'vllm',
    label: 'vLLM',
    urlKeyId: 'vllm_url',
    apiKeyId: 'vllm_key',
    defaultUrl: 'http://localhost:8000/v1',
    transport: 'openai',
    description: 'Run `vllm serve <model>`. Set the API key if you passed --api-key.',
    modelHint: 'vLLM is running but reported no model.',
  },
  {
    id: 'sglang',
    label: 'SGLang',
    urlKeyId: 'sglang_url',
    apiKeyId: 'sglang_key',
    defaultUrl: 'http://localhost:30000/v1',
    transport: 'openai',
    description: 'Run `python -m sglang.launch_server`. Set the API key if you passed --api-key.',
    modelHint: 'SGLang is running but reported no model.',
  },
  {
    id: 'mistralrs',
    label: 'mistral.rs',
    urlKeyId: 'mistralrs_url',
    apiKeyId: 'mistralrs_key',
    defaultUrl: 'http://localhost:1234/v1',
    transport: 'openai',
    description: 'Run `mistralrs-server --port 1234 ...`.',
    modelHint: 'mistral.rs is running but reported no model.',
  },
  {
    id: 'xinference',
    label: 'Xinference',
    urlKeyId: 'xinference_url',
    apiKeyId: 'xinference_key',
    defaultUrl: 'http://localhost:9997/v1',
    transport: 'openai',
    description: 'Run `xinference-local`, then launch a model from its UI.',
    modelHint: 'Xinference is running but no model is launched.',
  },
  {
    id: 'openllm',
    label: 'OpenLLM',
    urlKeyId: 'openllm_url',
    apiKeyId: 'openllm_key',
    defaultUrl: 'http://localhost:3000/v1',
    transport: 'openai',
    description: 'Run `openllm serve <model>`.',
    modelHint: 'OpenLLM is running but reported no model.',
  },
]

export const LOCAL_PROVIDER_MAP: Record<string, LocalProviderMeta> = Object.fromEntries(
  LOCAL_PROVIDERS.map((p) => [p.id, p]),
)

/**
 * Whether this provider needs a key pasted into Settings before it can be used.
 *
 * Not the same question as "is it local": the Claude Code transport runs on
 * this machine but is not a self-hosted server, and it is credential-free
 * because the CLI holds the credentials, not ouRGeo. The chat panel's send
 * gate asked `!isLocalProvider(p) && !apiKey` and therefore refused to send a
 * single message through it — the one failure that makes a whole provider look
 * broken while every part of it works.
 */
export function requiresApiKey(provider: AiProvider): boolean {
  return !isLocalProvider(provider) && provider !== 'claude-cli' && provider !== 'openai-subscription'
}

export function isLocalProvider(provider: AiProvider): boolean {
  return provider in LOCAL_PROVIDER_MAP
}

/** Effective base URL for a local provider, falling back to its system default. */
export function localBaseUrl(provider: AiProvider, keys: Record<string, string>): string {
  const meta = LOCAL_PROVIDER_MAP[provider]
  if (!meta) return ''
  const v = keys[meta.urlKeyId]?.trim()
  return v && v.length > 0 ? v : meta.defaultUrl
}

/** Optional bearer token for a local provider (empty string when unset). */
export function localApiKey(provider: AiProvider, keys: Record<string, string>): string {
  const meta = LOCAL_PROVIDER_MAP[provider]
  return meta ? (keys[meta.apiKeyId]?.trim() ?? '') : ''
}

/** apiKeys-store id holding the user's manual context-window override for a
 *  local provider (parallels `<id>_url` / `<id>_key`). */
export function localCtxKeyId(provider: AiProvider): string {
  return `${provider}_ctx`
}

/** User's manual context-window override (positive integer) or null if unset. */
export function localCtxOverride(provider: AiProvider, keys: Record<string, string>): number | null {
  const raw = keys[localCtxKeyId(provider)]?.trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

// ── Model lists ────────────────────────────────────────────────────────────
export const PROVIDER_MODELS: Record<AiProvider, string[]> = {
  anthropic: [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-latest',
  ],
  openai: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o1'],
  'openai-subscription': [], // The signed-in account supplies its eligible models.
  // Aliases, not dated ids: which model an alias resolves to is the user's
  // plan's business, and the CLI's `result` event reports what answered.
  'claude-cli': ['opus', 'sonnet', 'haiku'],
  google: [
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  // Local providers fetch their model list from the running server
  ollama: [],
  lmstudio: [],
  llamacpp: [],
  jan: [],
  localai: [],
  vllm: [],
  sglang: [],
  mistralrs: [],
  xinference: [],
  openllm: [],
}

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  'openai-subscription': 'OpenAI subscription (ChatGPT)',
  anthropic: 'Anthropic',
  'claude-cli': 'Claude subscription (Claude Code)',
  google: 'Google Gemini',
  ollama: 'Ollama (Local)',
  lmstudio: 'LM Studio (Local)',
  llamacpp: 'llama.cpp (Local)',
  jan: 'Jan (Local)',
  localai: 'LocalAI (Local)',
  vllm: 'vLLM (Local)',
  sglang: 'SGLang (Local)',
  mistralrs: 'mistral.rs (Local)',
  xinference: 'Xinference (Local)',
  openllm: 'OpenLLM (Local)',
}

// ── Tool definitions ───────────────────────────────────────────────────────
/** Provider-neutral tool description. Each transport below maps this onto its
 *  own wire shape (Anthropic `input_schema`, OpenAI `function.parameters`,
 *  Gemini `functionDeclarations`). Web tools live in `ai-web-tools.ts`. */
export interface AiTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

export const EXECUTE_R_TOOL: AiTool = {
  name: 'execute_r_code',
  description:
    'Execute R code in the user\'s live R session. Use this to inspect data, run calculations, ' +
    'create visualizations, or perform any R operations. The output (including print/cat output ' +
    'and errors) will be returned to you.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description: 'The R code to execute',
      },
    },
    required: ['code'],
  },
}

/** One tool invocation, as handed to `SendOptions.onToolCall`. */
export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

function parseToolInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// Per-provider tool-list encodings
const anthropicTools = (tools: AiTool[]) =>
  tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))

const openAiTools = (tools: AiTool[]) =>
  tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))

const geminiTools = (tools: AiTool[]) => [{
  functionDeclarations: tools.map((t) => ({
    name: t.name, description: t.description, parameters: t.inputSchema,
  })),
}]

// ── Environment context builder ────────────────────────────────────────────
/**
 * One object as the prompt renders it — the row, plus its columns when it has
 * any.
 *
 * Lifted out of `buildEnvContext` so `ai-session-context.ts` can diff the
 * listing object by object rather than comparing the whole block. Both callers
 * have to render identically, or an object would read as having changed the
 * first time a delta mentioned it.
 */
export function describeREnvObject(obj: REnvironmentInfo['objects'][number]): string {
  const dimStr = obj.dim ? ` [${obj.dim.join('×')}]` : obj.length != null ? ` (length ${obj.length})` : ''
  const head = `- \`${obj.name}\`: ${obj.class}${dimStr} — ${obj.preview}`
  return obj.columns && obj.columns.length > 0
    ? `${head}\n  columns: ${obj.columns.map((c) => `${c.name} (${c.type})`).join(', ')}`
    : head
}

export function buildEnvContext(environments: REnvironmentInfo[]): string {
  const lines: string[] = []
  const userEnvs = environments.filter((e) => !e.isSearchPath)
  if (userEnvs.length === 0) return ''
  lines.push('## R Environment')
  for (const env of userEnvs) {
    if (env.objects.length === 0) continue
    if (userEnvs.length > 1) lines.push(`\n### ${env.name}`)
    for (const obj of env.objects) lines.push(describeREnvObject(obj))
  }
  return lines.join('\n')
}

// ── Console history context ────────────────────────────────────────────────
/** Truncate large text (head + tail) so a single tool result can't blow the
 *  model's context window. Keeps the start and end, drops the middle. */
export function truncateForModel(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.6)
  const tail = maxChars - head
  const omitted = text.length - maxChars
  return `${text.slice(0, head)}\n… [${omitted} characters truncated] …\n${text.slice(-tail)}`
}

/** Render the tail of the live console as a "Recent Console" block so the model
 *  is aware of commands the user ran by hand (and their output), not just the
 *  code it executed itself. */
export function buildConsoleContext(
  entries: ConsoleEntry[], maxEntries = 25, maxChars = 4000,
  // What the block claims to be. The default describes the whole tail, which is
  // what every transport that re-posts the conversation each turn is handed.
  // `ai-session-context.ts` overrides it, because a DELTA introduced as "the
  // user's console history" reads as a console holding only those two lines —
  // and a model that believes that reports output as having been wiped.
  lead = "The user's R console history (most recent last):",
): string {
  const recent = entries.slice(-maxEntries)
  if (recent.length === 0) return ''
  const lines: string[] = []
  for (const e of recent) {
    if (e.type === 'input') lines.push(`> ${e.text}`)
    else if (e.type === 'error') lines.push(`[error] ${e.text}`)
    else lines.push(e.text)
  }
  let body = lines.join('\n')
  if (body.length > maxChars) body = body.slice(-maxChars) // keep most recent
  return `## Recent Console\n${lead}\n\n${body}`
}

// ── Mention detection ─────────────────────────────────────────────────────
/**
 * Objects in the message worth previewing for the model.
 *
 * **The user's environments only.** It used to scan every environment,
 * including the search path — so an ordinary English sentence matched
 * `package:base`, and "Reply with one word" asked R for the first five rows of
 * the `with` FUNCTION. R refused (HTTP 500), the preview was silently dropped,
 * and nothing was visibly wrong; but `base`, `stats` and `utils` are full of
 * words people write in sentences — `with`, `data`, `table`, `max`, `range`,
 * `format`, `file`, `date`, `sort`, `order`, `rev`, `c`, `t` — so a plain
 * question routinely fired several doomed round trips at a SERIAL R server
 * before it could be sent. That wait is the window in which a user, seeing
 * nothing happen, clicks Send again.
 *
 * `!isSearchPath` is the same predicate the Environment panel uses for
 * "an environment whose objects can be named directly in generated R"
 * (see the Environment panel section of CLAUDE.md), and it is the right one
 * twice over: a package function has no rows to preview, and a preview is only
 * useful for something the user put there.
 *
 * A name in brackets is still an explicit request and is kept even when it is
 * only one letter; a bare word must be at least two, because `a` and `b` are
 * ordinary English as well as ordinary column names.
 */
export function detectMentionedObjects(text: string, envs: REnvironmentInfo[]): string[] {
  const names = new Set<string>()
  for (const env of envs) {
    if (env.isSearchPath) continue
    for (const obj of env.objects) {
      names.add(obj.name)
    }
  }
  const bareWords = (text.match(/\b[a-zA-Z_.][a-zA-Z0-9_.]*\b/g) ?? []).filter((w) => w.length > 1)
  const bracketNames = [...text.matchAll(/\[([a-zA-Z_.][a-zA-Z0-9_.]*)\]/g)].map((m) => m[1])
  return [...new Set([...bareWords, ...bracketNames].filter((w) => names.has(w)))]
}

// ── Fetch local model lists ────────────────────────────────────────────────
function isConnectionError(msg: string): boolean {
  return (
    msg.includes('Failed to fetch') || msg.includes('NetworkError') ||
    msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED')
  )
}

/** Ollama native /api/tags listing. */
export async function fetchOllamaModels(ollamaUrl: string): Promise<{ models: string[]; error?: string }> {
  try {
    const base = ollamaUrl.replace(/\/$/, '')
    const res = await proxyFetch(`${base}/api/tags`)
    if (!res.ok) return { models: [], error: `HTTP ${res.status} from Ollama` }
    const data = await res.json() as { models?: { name: string }[] }
    const models = (data.models ?? []).map((m) => m.name)
    return { models, error: models.length === 0 ? LOCAL_PROVIDER_MAP.ollama.modelHint : undefined }
  } catch (e) {
    const msg = String(e)
    if (isConnectionError(msg)) {
      return { models: [], error: `Cannot reach Ollama at ${ollamaUrl} — is it running? (ollama serve)` }
    }
    return { models: [], error: msg }
  }
}

/** OpenAI-compatible /v1/models listing (LM Studio, vLLM, llama.cpp, …). */
async function fetchOpenAIModels(
  baseUrl: string, apiKey: string, meta: LocalProviderMeta,
): Promise<{ models: string[]; error?: string }> {
  try {
    const base = baseUrl.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await proxyFetch(`${base}/models`, { headers })
    if (!res.ok) return { models: [], error: `HTTP ${res.status} from ${meta.label}` }
    const data = await res.json() as { data?: { id: string }[] }
    const models = (data.data ?? []).map((m) => m.id)
    return { models, error: models.length === 0 ? meta.modelHint : undefined }
  } catch (e) {
    const msg = String(e)
    if (isConnectionError(msg)) {
      return { models: [], error: `Cannot reach ${meta.label} at ${baseUrl} — is the server running?` }
    }
    return { models: [], error: msg }
  }
}

/** Dispatch to the right model listing for any local provider. */
export async function fetchLocalModels(
  provider: AiProvider, baseUrl: string, apiKey = '',
): Promise<{ models: string[]; error?: string }> {
  const meta = LOCAL_PROVIDER_MAP[provider]
  if (!meta) return { models: [], error: `Unknown provider: ${provider}` }
  if (meta.transport === 'ollama') return fetchOllamaModels(baseUrl)
  return fetchOpenAIModels(baseUrl, apiKey, meta)
}

// ── Context-window detection ───────────────────────────────────────────────
/** Probe a local server for the loaded model's real context length, in tokens.
 *  Tries llama.cpp's `/props` (n_ctx), then OpenAI `/v1/models` fields
 *  (max_model_len / context_length / meta.n_ctx_train). Returns null if unknown. */
export async function fetchLocalContextSize(
  provider: AiProvider, baseUrl: string, apiKey = '', model = '',
): Promise<number | null> {
  const meta = LOCAL_PROVIDER_MAP[provider]
  if (!meta) return null
  const base = baseUrl.replace(/\/$/, '')
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const pick = (n: unknown): number | null =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null

  if (meta.transport === 'ollama') {
    try {
      const res = await proxyFetch(`${base}/api/ps`, { headers })
      if (res.ok) {
        const data = await res.json() as { models?: { name?: string; model?: string; context_length?: number }[] }
        const entry = data.models?.find(entry => entry.name === model || entry.model === model || entry.name === `${model}:latest`)
        return pick(entry?.context_length)
      }
    } catch { /* A not-yet-loaded runner has no verified allocation. */ }
    return null
  }

  // 1. llama.cpp /props — the actual runtime n_ctx (base URL without the /v1 suffix)
  try {
    const root = base.replace(/\/v1$/, '')
    const res = await proxyFetch(`${root}/props`, { headers })
    if (res.ok) {
      const data = await res.json() as {
        n_ctx?: number
        default_generation_settings?: { n_ctx?: number }
      }
      const n = pick(data.default_generation_settings?.n_ctx) ?? pick(data.n_ctx)
      if (n) return n
    }
  } catch { /* not a llama.cpp server, or unreachable — fall through */ }

  // 2. OpenAI /v1/models — vLLM (max_model_len) and others expose it per model
  try {
    const res = await proxyFetch(`${base}/models`, { headers })
    if (res.ok) {
      const data = await res.json() as {
        data?: { id?: string; max_model_len?: number; context_length?: number; meta?: { n_ctx_train?: number } }[]
      }
      const list = data.data ?? []
      const entry = list.find((m) => m.id === model) ?? (!model ? list[0] : undefined)
      if (entry) {
        const n = pick(entry.max_model_len) ?? pick(entry.context_length) ?? pick(entry.meta?.n_ctx_train)
        if (n) return n
      }
    }
  } catch { /* unreachable — give up */ }

  return null
}

/** Resolve the context window to display/use for a (provider, model):
 *  manual override → verified runtime → model table → conservative fallback.
 *  `detected` is the optional result of fetchLocalContextSize (cached by caller). */
export function resolveContextSize(
  provider: AiProvider, model: string, keys: Record<string, string>, detected?: number | null,
): number {
  if (isLocalProvider(provider)) {
    const override = localCtxOverride(provider, keys)
    if (override) return override
    if (detected && detected > 0) return detected
    if (provider === 'ollama') return 4096
  }
  // The CLI is given an ALIAS — `opus`, `sonnet`, `haiku` — and which model
  // and window that resolves to is the user's plan's business (a `sonnet`
  // alias reported a 1,000,000-token window on the plan this was written
  // against). So this is a floor to draw the first bar against, and the run's
  // own `result` event replaces it with the truth. A table of aliases here
  // would be a number that goes stale the day one moves.
  if (provider === 'claude-cli') return CLAUDE_CLI_MIN_CONTEXT
  return getContextSize(model)
}

// ── Send message to provider ───────────────────────────────────────────────
export interface SendOptions {
  /** Optional bound for short diagnostics and other small responses. */
  beforeInvocation?: (payload: unknown, estimatedInput: number, window: number) => void
  archiveToolResult?: (text: string) => string
  maxOutputTokens?: number
  testConnection?: boolean
  /** Explicit runtime context cap for memory-constrained Ollama setups. */
  ollamaContextSize?: number
  provider: AiProvider
  model: string
  apiKey: string
  /** Base URL for a local provider (Ollama uses its native API; others are OpenAI-compatible) */
  localUrl?: string
  /** Optional bearer token for a local OpenAI-compatible server */
  localApiKey?: string
  messages: ChatMessage[]
  systemPrompt: string
  /** Tools offered to the model this turn. Empty = plain streaming chat.
   *  The caller decides membership (Autopilot → `execute_r_code`, web access →
   *  `web_search`/`web_fetch`), so a disabled capability is simply absent from
   *  the request rather than declined after the fact. */
  tools?: AiTool[]
  /** Resolved context window (tokens) for usage reporting; falls back to the
   *  per-model static size when omitted. */
  contextSize?: number
  onChunk: (text: string) => void
  onToolCall?: (call: ToolCall) => Promise<string>
  onUsage?: (used: number, total: number) => void
  /** Per-request cost accounting, separate from the latest context occupancy. */
  onInvocationUsage?: (report: UsageReport) => void
  /** Visible Responses messages only; encrypted reasoning stays in turn memory. */
  onOpenAiMessages?: (messages: OpenAiAssistantMessage[]) => void
  signal?: AbortSignal
  // ── Claude Code CLI only ────────────────────────────────────────────────
  /** The CLI keeps the transcript, so continuity is a session uuid rather than
   *  a message array. Minted on the first turn of a conversation. */
  claudeSessionId?: string
  /** False on the first turn (`--session-id`), true after (`--resume`). */
  claudeResume?: boolean
  /** R's working directory, so a path in the answer means what it means in the
   *  console. */
  claudeCwd?: string
  /**
   * The volatile half of the prompt — the environment listing, the console
   * tail, the open documents — for a transport that keeps its own transcript.
   *
   * It rides the USER turn rather than the system prompt, and that is a
   * measured cost decision, not a stylistic one. Claude Code caches the prompt
   * prefix; a system prompt that changes invalidates it, and every token of
   * the conversation is then re-sent as a cache WRITE. Measured on a trivial
   * two-turn conversation against CLI 2.1.263: resuming with an identical
   * system prompt read 5,762 tokens from cache and cost $0.0014; resuming with
   * one whose tail had changed read 0, wrote 5,874, and cost $0.0235 — 16×,
   * for the same question. ouRGeo's session context changes on every console
   * line, so on the old shape EVERY turn paid the full price of the whole
   * conversation.
   *
   * Appending to the user turn extends the cached prefix instead of breaking
   * it, and puts the freshest state closest to the question.
   */
  sessionContext?: string
  onClaudeSession?: (sessionId: string) => void
  /** The stored session turned out not to exist on this machine, so the turn
   *  is being replayed as a new one. Lets the caller drop the dead id. */
  onClaudeSessionLost?: () => void
  /** Fraction of the subscription's rolling windows used — the number a
   *  subscriber plans around, where an API user watches tokens. */
  onClaudeRateLimit?: (fiveHour: number, sevenDay: number, resetsAt: number) => void
}

export function checkInvocation(opts: SendOptions, payload: unknown): void {
  opts.signal?.throwIfAborted()
  const window = opts.contextSize ?? getContextSize(opts.model)
  const used = assertInvocationBudget(payload, window, opts.maxOutputTokens ?? 4000)
  opts.beforeInvocation?.(payload, used, window)
}

export function compactInvocation(opts: SendOptions, messages: unknown[], protocol: ToolProtocol, payload: () => unknown): void {
  if (!opts.archiveToolResult) return
  compactToolResults(messages, protocol, inputCapacity(opts.contextSize ?? getContextSize(opts.model), opts.maxOutputTokens ?? 4000), payload, opts.archiveToolResult)
}
export function reportInvocationUsage(opts: SendOptions, value: unknown, protocol: UsageProtocol, scope: UsageReport['scope'] = 'invocation', attempt = 0): void {
  const usage = normaliseUsage(value, protocol)
  if (usage) opts.onInvocationUsage?.({ ...usage, invocation: 1, scope, attempt })
}

export async function sendMessage(opts: SendOptions): Promise<string> {
  const window = Math.min(opts.contextSize ?? (opts.provider === 'claude-cli' ? CLAUDE_CLI_MIN_CONTEXT : getContextSize(opts.model)), opts.ollamaContextSize ?? Infinity)
  let invocations = 0, toolCalls = 0
  const beforeInvocation = opts.beforeInvocation
  const invocationUsage = opts.onInvocationUsage
  const originalTool = opts.onToolCall
  opts = { ...opts, contextSize: window, maxOutputTokens: opts.maxOutputTokens ?? Math.min(4000, Math.floor(window / 4)),
    beforeInvocation: (payload, used, capacity) => {
      if (++invocations > 12) throw new Error('BUDGET_LIMIT: invocation limit reached. Continue in another turn if more inspection is needed.')
      beforeInvocation?.(payload, used, capacity)
    },
    onInvocationUsage: report => invocationUsage?.({ ...report, invocation: invocations }),
    onToolCall: originalTool ? async call => {
      opts.signal?.throwIfAborted()
      if (++toolCalls > 24) throw new Error('BUDGET_LIMIT: tool-call limit reached. Continue in another turn.')
      return redactContext(await originalTool(call))
    } : undefined,
    systemPrompt: redactContext(opts.systemPrompt), messages: opts.messages.map(m => ({ id: m.id, role: m.role, timestamp: m.timestamp, content: redactContext(m.content), openAiMessages: m.openAiMessages?.map(p => ({ ...p, content: redactContext(p.content) })) })) }
  const dialogueBudget = inputCapacity(window, opts.maxOutputTokens) - estimateTokens({ system: opts.systemPrompt, tools: opts.tools, context: opts.sessionContext })
  opts.messages = selectConversation(opts.messages, dialogueBudget).messages
  assertInvocationBudget({ system: opts.systemPrompt, messages: opts.messages, tools: opts.tools, context: opts.sessionContext }, opts.contextSize ?? getContextSize(opts.model), opts.maxOutputTokens ?? 4000)
  if (opts.provider === 'openai-subscription') return sendChatGptSubscription(opts)
  if (opts.provider === 'anthropic') return sendAnthropic(opts)
  if (opts.provider === 'claude-cli') return sendClaudeCli(opts)
  if (opts.provider === 'google') return sendGoogle(opts)
  if (opts.provider === 'ollama') return sendOllama(opts)
  if (opts.provider === 'openai') {
    return sendOpenAICompatible(opts, { baseUrl: 'https://api.openai.com/v1', apiKey: opts.apiKey })
  }
  // All remaining providers are local OpenAI-compatible servers
  const meta = LOCAL_PROVIDER_MAP[opts.provider]
  if (meta) {
    const base = (opts.localUrl?.trim() || meta.defaultUrl).replace(/\/$/, '')
    // Many local servers reject an empty Authorization header, so send a dummy token
    return sendOpenAICompatible(opts, { baseUrl: base, apiKey: opts.localApiKey || 'not-needed' })
  }
  throw new Error(`Unsupported provider: ${opts.provider}`)
}

// ── Streaming helpers ──────────────────────────────────────────────────────
interface ByteStream { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } }

/** Read a line-delimited response body, calling `onLine` for each complete line.
 *  Buffers across reads — a single JSON event routinely straddles two chunks,
 *  which matters most for tool arguments streamed as many small deltas. */
async function readLineStream(body: ByteStream, onLine: (line: string) => void): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (;;) {
      const nl = buf.indexOf('\n')
      if (nl < 0) break
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) onLine(line)
    }
  }
  if (buf.trim()) onLine(buf)
}

/** `data: {...}` payload of an SSE line, or null for anything else. */
function ssePayload(line: string): string | null {
  if (!line.startsWith('data:')) return null
  const raw = line.slice(5).trim()
  return !raw || raw === '[DONE]' ? null : raw
}

// ── Anthropic ─────────────────────────────────────────────────────────────
interface AnthropicBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  /** Accumulated `input_json_delta` fragments for a tool_use block */
  json?: string
}

/** Re-encode a streamed block for the assistant turn we echo back. */
function anthropicBlockToWire(b: AnthropicBlock): Record<string, unknown> | null {
  if (b.type === 'text') {
    return b.text?.trim() ? { type: 'text', text: b.text } : null
  }
  return { type: 'tool_use', id: b.id, name: b.name, input: parseToolInput(b.json ?? '') }
}

async function sendAnthropic(opts: SendOptions): Promise<string> {
  const { model, apiKey, messages, systemPrompt, onChunk, onToolCall, onUsage, signal } = opts
  const tools = opts.tools ?? []
  const useTools = tools.length > 0 && !!onToolCall

  const apiMessages: unknown[] = messages.map(toAnthropicMessage)

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxOutputTokens ?? 4000,
    system: systemPrompt,
    messages: apiMessages,
    stream: true,
  }
  if (useTools) body.tools = anthropicTools(tools)

  let fullText = ''
  let inputTokens = 0

  // One streamed assistant turn. Text is forwarded to `onChunk` as it arrives —
  // tool_use blocks arrive as `input_json_delta` fragments and are reassembled
  // here, so Autopilot/web turns stream just like plain chat.
  const streamTurn = async (): Promise<{ blocks: AnthropicBlock[]; stopReason: string }> => {
    compactInvocation(opts, apiMessages, 'anthropic', () => body)
    checkInvocation(opts, body)
    const res = await proxyFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } }
      throw new Error(err.error?.message ?? `HTTP ${res.status}`)
    }

    const byIndex = new Map<number, AnthropicBlock>()
    let stopReason = ''
    let turnOutput = 0
    let reportedUsage: Record<string, unknown> = {}

    await readLineStream(res.body!, (line) => {
      const raw = ssePayload(line)
      if (!raw) return
      let evt: {
        type?: string
        index?: number
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
        usage?: Record<string, unknown> & { output_tokens?: number }
        message?: { usage?: Record<string, unknown> & { input_tokens: number } }
      }
      try { evt = JSON.parse(raw) } catch { return /* malformed chunk */ }

      if (evt.type === 'message_start' && evt.message?.usage) {
        reportedUsage = { ...reportedUsage, ...evt.message.usage }
        inputTokens = normaliseUsage(reportedUsage, 'anthropic')?.inputTokens ?? 0
        reportInvocationUsage(opts, reportedUsage, 'anthropic')
      } else if (evt.type === 'content_block_start' && evt.index != null) {
        const cb = evt.content_block
        if (cb?.type === 'tool_use') {
          byIndex.set(evt.index, { type: 'tool_use', id: cb.id, name: cb.name, json: '' })
        } else if (cb?.type === 'text') {
          byIndex.set(evt.index, { type: 'text', text: '' })
        }
      } else if (evt.type === 'content_block_delta' && evt.index != null) {
        const block = byIndex.get(evt.index)
        if (evt.delta?.type === 'text_delta' && evt.delta.text) {
          fullText += evt.delta.text
          onChunk(evt.delta.text)
          if (block) block.text = (block.text ?? '') + evt.delta.text
        } else if (evt.delta?.type === 'input_json_delta' && block) {
          block.json = (block.json ?? '') + (evt.delta.partial_json ?? '')
        }
      } else if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason
        if (evt.usage?.output_tokens != null) {
          reportedUsage = { ...reportedUsage, ...evt.usage }
          inputTokens = normaliseUsage(reportedUsage, 'anthropic')?.inputTokens ?? inputTokens
          turnOutput = evt.usage.output_tokens
          onUsage?.(inputTokens + turnOutput, opts.contextSize ?? getContextSize(model))
          reportInvocationUsage(opts, reportedUsage, 'anthropic')
        }
      }
    })

    return {
      blocks: [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b),
      stopReason,
    }
  }

  for (;;) {
    const { blocks, stopReason } = await streamTurn()
    const toolUses = blocks.filter((b) => b.type === 'tool_use')
    if (!useTools || stopReason !== 'tool_use' || toolUses.length === 0) break

    // Echo the assistant turn back verbatim, then answer every tool_use block.
    const wire = blocks.map(anthropicBlockToWire).filter((b): b is Record<string, unknown> => b !== null)
    apiMessages.push({ role: 'assistant', content: wire })
    const toolResults: unknown[] = []
    for (const block of toolUses) {
      const output = await onToolCall!({
        id: block.id ?? '',
        name: block.name ?? '',
        input: parseToolInput(block.json ?? ''),
      })
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: output })
    }
    apiMessages.push({ role: 'user', content: toolResults })
  }

  return fullText
}

function toAnthropicMessage(msg: ChatMessage): Record<string, unknown> {
  if (msg.role === 'user') return { role: 'user', content: msg.content }
  // assistant with tool calls already handled in loop above
  return { role: 'assistant', content: msg.content }
}

// ── OpenAI-compatible (OpenAI cloud + all local /v1 servers) ────────────────
async function sendOpenAICompatible(
  opts: SendOptions, conn: { baseUrl: string; apiKey: string },
): Promise<string> {
  const { model, messages, systemPrompt, onChunk, onToolCall, onUsage, signal } = opts
  const tools = opts.tools ?? []
  const useTools = tools.length > 0 && !!onToolCall
  const endpoint = `${conn.baseUrl.replace(/\/$/, '')}/chat/completions`

  const apiMessages: unknown[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(toOpenAIMessage),
  ]

  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    stream: true,
    stream_options: { include_usage: true },
    ...(opts.maxOutputTokens ? { [opts.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: opts.maxOutputTokens } : {}),
  }
  if (useTools) body.tools = openAiTools(tools)

  let fullText = ''

  const doRequest = async (): Promise<void> => {
    compactInvocation(opts, apiMessages, 'openai', () => ({ ...body, messages: apiMessages }))
    checkInvocation(opts, { ...body, messages: apiMessages })
    const res = await proxyFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${conn.apiKey}`,
      },
      body: JSON.stringify({ ...body, messages: apiMessages }),
      signal,
    })
    if (!res.ok) {
      const err = await res.json() as { error?: { message: string } }
      throw new Error(err.error?.message ?? `HTTP ${res.status}`)
    }

    const toolCallBuffers: Record<string, { id: string; name: string; args: string }> = {}
    let finishReason = ''
    // Text from *this* turn only — the assistant message we echo back must not
    // repeat text already sent in an earlier tool round.
    let turnText = ''

    await readLineStream(res.body!, (line) => {
      const raw = ssePayload(line)
      if (!raw) return
      let chunk: {
        choices?: {
          delta?: {
            content?: string
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
          }
          finish_reason?: string
        }[]
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }
      }
      try { chunk = JSON.parse(raw) } catch { return /* malformed chunk */ }

      if (chunk.usage) {
        onUsage?.(chunk.usage.total_tokens, opts.contextSize ?? getContextSize(model))
        reportInvocationUsage(opts, chunk.usage, 'openai-chat')
      }
      const choice = chunk.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (delta?.content) {
        fullText += delta.content
        turnText += delta.content
        onChunk(delta.content)
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallBuffers[tc.index]) {
            toolCallBuffers[tc.index] = { id: tc.id ?? '', name: '', args: '' }
          }
          if (tc.id) toolCallBuffers[tc.index].id = tc.id
          if (tc.function?.name) toolCallBuffers[tc.index].name += tc.function.name
          if (tc.function?.arguments) toolCallBuffers[tc.index].args += tc.function.arguments
        }
      }
    })

    const calls = Object.values(toolCallBuffers)
    if (finishReason === 'tool_calls' && onToolCall && calls.length > 0) {
      // Append the assistant message carrying tool_calls, then one tool message per call
      const assistantMsg: Record<string, unknown> = { role: 'assistant' }
      if (turnText) assistantMsg.content = turnText
      assistantMsg.tool_calls = calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args },
      }))
      apiMessages.push(assistantMsg)
      for (const tc of calls) {
        const result = await onToolCall({ id: tc.id, name: tc.name, input: parseToolInput(tc.args) })
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: result })
      }
      await doRequest() // recurse for next turn
    }
  }

  await doRequest()
  return fullText
}

function toOpenAIMessage(msg: ChatMessage): Record<string, unknown> {
  return { role: msg.role, content: msg.content }
}

// ── Google Gemini ─────────────────────────────────────────────────────────
async function sendGoogle(opts: SendOptions): Promise<string> {
  const { model, apiKey, messages, systemPrompt, onChunk, onToolCall, onUsage, signal } = opts
  const tools = opts.tools ?? []
  const useTools = tools.length > 0 && !!onToolCall

  const buildContents = (msgs: ChatMessage[]) => msgs.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }))

  const contents: any[] = buildContents(messages)
  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    ...(opts.maxOutputTokens ? { generationConfig: { maxOutputTokens: opts.maxOutputTokens } } : {}),
  }
  if (useTools) body.tools = geminiTools(tools)

  let fullText = ''

  const doRequest = async (): Promise<void> => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`
    compactInvocation(opts, contents, 'google', () => ({ ...body, contents }))
    checkInvocation(opts, { ...body, contents })
    const res = await proxyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, contents }),
      signal,
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`)
    }

    const pendingFunctionCalls: { name: string; args: Record<string, unknown> }[] = []

    await readLineStream(res.body!, (line) => {
      const raw = ssePayload(line)
      if (!raw) return
      let chunk: {
        candidates?: {
          content?: {
            parts?: { text?: string; functionCall?: { name: string; args: Record<string, unknown> } }[]
          }
        }[]
        usageMetadata?: Record<string, unknown> & { totalTokenCount: number }
      }
      try { chunk = JSON.parse(raw) } catch { return /* malformed */ }

      if (chunk.usageMetadata) {
        if (chunk.usageMetadata.totalTokenCount != null) onUsage?.(chunk.usageMetadata.totalTokenCount, opts.contextSize ?? getContextSize(model))
        reportInvocationUsage(opts, chunk.usageMetadata, 'google')
      }
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.text) {
          fullText += part.text
          onChunk(part.text)
        }
        if (part.functionCall) pendingFunctionCalls.push(part.functionCall)
      }
    })

    if (pendingFunctionCalls.length > 0 && onToolCall) {
      contents.push({ role: 'model', parts: pendingFunctionCalls.map((fc) => ({ functionCall: fc })) })
      const functionResponses = []
      for (const fc of pendingFunctionCalls) {
        const result = await onToolCall({ id: fc.name, name: fc.name, input: fc.args ?? {} })
        functionResponses.push({ functionResponse: { name: fc.name, response: { output: result } } })
      }
      contents.push({ role: 'user', parts: functionResponses })
      await doRequest()
    }
  }

  await doRequest()
  return fullText
}

// ── Ollama ────────────────────────────────────────────────────────────────
async function sendOllama(opts: SendOptions): Promise<string> {
  const { model, localUrl = 'http://localhost:11434', messages, systemPrompt, onChunk, onToolCall, onUsage, signal } = opts
  const base = localUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.localApiKey) headers.Authorization = `Bearer ${opts.localApiKey}`
  const tools = opts.tools ?? []

  const apiMessages: any[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  const hasTools = tools.length > 0 && !!onToolCall
  const body: Record<string, unknown> = {
    model,
    messages: apiMessages,
    stream: !hasTools,
    ...(opts.testConnection ? { think: false, options: { num_ctx: 4096, num_predict: opts.maxOutputTokens ?? 512 } }
      : { options: { num_predict: opts.maxOutputTokens ?? 4000, ...(opts.ollamaContextSize ? { num_ctx: opts.ollamaContextSize } : {}) } }),
  }
  if (hasTools) body.tools = openAiTools(tools)

  let fullText = ''

  if (hasTools) {
    // Non-streaming for tool calls (Ollama streaming + tools is unreliable)
    while (true) {
      compactInvocation(opts, apiMessages, 'openai', () => ({ ...body, messages: apiMessages }))
      checkInvocation(opts, { ...body, messages: apiMessages })
      const res = await proxyFetch(`${base}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, messages: apiMessages }),
        signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as {
        message?: {
          content?: string
          tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
        }
        prompt_eval_count?: number
        eval_count?: number
        total_duration?: number
        done?: boolean
      }
      const msg = data.message
      if (msg?.content) { fullText += msg.content; onChunk(msg.content) }
      if (data.prompt_eval_count != null && data.eval_count != null) {
        onUsage?.(data.prompt_eval_count + data.eval_count, opts.contextSize ?? getContextSize(model))
      }
      reportInvocationUsage(opts, data, 'ollama')
      if (!msg?.tool_calls?.length) break
      apiMessages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
      for (const tc of msg.tool_calls) {
        const name = tc.function.name
        // Ollama hands back parsed arguments, but some builds send a JSON string
        const args = typeof tc.function.arguments === 'string'
          ? parseToolInput(tc.function.arguments)
          : (tc.function.arguments ?? {})
        const result = await onToolCall!({ id: name, name, input: args })
        apiMessages.push({ role: 'tool', content: result })
      }
    }
    return fullText
  }

  // Streaming (no tools) — NDJSON, one JSON object per line
  checkInvocation(opts, body)
  const res = await proxyFetch(`${base}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  await readLineStream(res.body!, (line) => {
    let chunk: {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
      total_duration?: number
      done?: boolean
    }
    try { chunk = JSON.parse(line) } catch { return /* malformed */ }
    if (chunk.message?.content) {
      fullText += chunk.message.content
      onChunk(chunk.message.content)
    }
    if (chunk.done && chunk.prompt_eval_count != null && chunk.eval_count != null) {
      onUsage?.(chunk.prompt_eval_count + chunk.eval_count, opts.contextSize ?? getContextSize(model))
    }
    if (chunk.done) reportInvocationUsage(opts, chunk, 'ollama')
  })
  return fullText
}


// ── Claude Code CLI (a Claude subscription) ────────────────────────────────
/** How much of an existing conversation to hand a session that is starting
 *  fresh. Enough to answer a follow-up; not so much that the first turn after
 *  a provider switch costs a whole context window. */
export function withEarlierTurns(messages: ChatMessage[], latest: string): string {
  const earlier = messages.slice(0, -1).filter((m) => m.content.trim())
  if (earlier.length === 0) return latest
  const lines = earlier.map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content.trim()}`)
  if (lines.length === 0) return latest
  return `<earlier-conversation>\nThis conversation started with another provider, so you do not have these turns. They are here for reference only — do not answer them again.\n\n${lines.join('\n\n')}\n</earlier-conversation>\n\n${latest}`
}

/**
 * The one transport that is not an HTTP request.
 *
 * A Claude subscription cannot be turned into an API key, but it authenticates
 * the CLI the user already installed — and `claude -p --output-format
 * stream-json` wraps the **verbatim Anthropic Messages streaming events** this
 * file already parses. So the work here is demultiplexing, plus the two things
 * that are genuinely different:
 *
 * - **The CLI owns the agent loop.** It does not hand a tool call back to its
 *   caller; it calls tools it can see. `SendOptions.tools` therefore reaches
 *   it as an MCP server on loopback (`electron/main/claude-mcp.ts`), and
 *   `onToolCall` is what answers — so the switches, the confirm modal and the
 *   console echo are the same ones, decided in the same place, as for every
 *   other provider.
 * - **The CLI owns the transcript.** Every other transport posts the whole
 *   conversation each turn; this one sends the newest turn and names a session
 *   to resume. `SendOptions.messages` is therefore read for its LAST user
 *   message only, and `claudeSessionId` on the store is what continuity means.
 */
/**
 * One run of the CLI, plus the recovery that makes a stored session id safe to
 * keep.
 *
 * A chat carries `claudeSessionId` so its transcript survives a restart — but
 * that id names a file on THIS machine, and a project is a portable document.
 * Open a `.ourgeoproj` somewhere else and every chat in it resumes a session
 * that does not exist; the CLI exits 1 with `No conversation found`, and since
 * the dead id is what we stored, the conversation is finished for good.
 *
 * So the resume is attempted once and, if the session is gone, the whole run
 * is repeated as a NEW one carrying the catch-up block `withEarlierTurns`
 * already builds for a conversation the CLI has not seen. The user is told
 * nothing, because nothing went wrong from where they are sitting: they asked
 * a question and got an answer with the history intact.
 */
async function sendClaudeCli(opts: SendOptions): Promise<string> {
  try {
    return await runClaudeCli(opts, opts.claudeResume === true)
  } catch (err) {
    if (!(err instanceof MissingClaudeSession)) throw err
    opts.onClaudeSessionLost?.()
    return runClaudeCli({ ...opts, claudeSessionId: crypto.randomUUID() }, false)
  }
}

/** Thrown by `runClaudeCli` when the CLI has no such transcript, so
 *  `sendClaudeCli` can retry rather than surface it. */
class MissingClaudeSession extends Error {}

async function runClaudeCli(opts: SendOptions, resume: boolean): Promise<string> {
  const { model, messages, systemPrompt, onChunk, onToolCall, onUsage, signal } = opts
  const api = window.electronAPI?.claudeCli
  if (!api) throw new Error('The Claude Code provider needs the desktop app.')

  const last = [...messages].reverse().find((m) => m.role === 'user')
  if (!last) throw new Error('Nothing to send.')

  // Starting a session mid-conversation — the user switched to this provider,
  // or cleared the CLI's session — means the CLI has none of what is on
  // screen. Every other transport posts the whole array each turn, so without
  // this the assistant would answer a follow-up having silently forgotten the
  // question it follows. Only on the FIRST turn: after that the CLI's own
  // transcript is the record, and repeating it would double every message.
  const turn = resume ? last.content : withEarlierTurns(messages, last.content)
  // The session context leads the turn rather than the system prompt, so the
  // CLI's cached prefix survives from one turn to the next. See
  // `SendOptions.sessionContext` for what that is worth in money.
  checkInvocation(opts, { systemPrompt, turn, context: opts.sessionContext, tools: opts.tools })
  const prompt = opts.sessionContext ? `${opts.sessionContext}\n\n---\n\n${turn}` : turn

  const tools = (opts.tools ?? []).map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
  }))

  return new Promise<string>((resolve, reject) => {
    let answer = ''
    let sawResult = false
    let settled = false
    let resultSubtype: string | null = null
    let resultIsError = false
    // The context the LAST API call carried, and that call's output so far.
    // Kept rather than summed: the agent loop makes several calls per turn and
    // each one re-sends the conversation, so adding them up measures how many
    // tool calls happened, not how full the window is.
    let contextTokens = 0
    let outputTokens = 0
    let contextWindow = opts.contextSize ?? CLAUDE_CLI_MIN_CONTEXT
    const reportUsage = (): void => onUsage?.(contextTokens + outputTokens, contextWindow)
    const finish = (fn: () => void): void => { if (!settled) { settled = true; fn() } }

    const abort = api.start(
      {
        prompt,
        systemPrompt,
        model: model || 'sonnet',
        sessionId: opts.claudeSessionId ?? crypto.randomUUID(),
        resume,
        tools,
        cwd: opts.claudeCwd ?? '.',
      },
      {
        onLine: (line) => {
          const ev = parseClaudeLine(line)
          if (ev.kind === 'text') { answer += ev.text; onChunk(ev.text) }
          else if (ev.kind === 'init') {
            opts.onClaudeSession?.(ev.sessionId)
            // An MCP server that failed to connect is why every tool call is
            // about to fail, and it is invisible from inside the model.
            if (ev.mcpFailed.length > 0 && tools.length > 0) {
              finish(() => reject(new Error(
                'ouRGeo could not offer its tools to Claude Code (the local bridge did not connect). '
                + 'Nothing was run.'
              )))
              abort()
            }
          } else if (ev.kind === 'usage') {
            // A delta may carry only the output count; the prompt cannot
            // shrink mid-call, so the last figure stands.
            if (ev.contextTokens > 0) contextTokens = ev.contextTokens
            outputTokens = ev.outputTokens
            reportUsage()
          } else if (ev.kind === 'rateLimit') {
            opts.onClaudeRateLimit?.(ev.fiveHour, ev.sevenDay, ev.resetsAt)
          } else if (ev.kind === 'result') {
            // The CLI result sums its internal calls. Keep it distinct from
            // host invocation counts and the latest context-window occupancy.
            let rawUsage: unknown
            try { rawUsage = JSON.parse(line).usage } catch { /* Malformed lines carry no receipt. */ }
            reportInvocationUsage(opts, rawUsage, 'anthropic', 'transport-run')
            sawResult = true
            resultSubtype = ev.subtype
            resultIsError = ev.isError
            // The window the model that answered actually has. Its token
            // counts are cumulative across the run's API calls and are NOT
            // the context — that comes from the per-call `usage` events.
            if (ev.contextWindow) { contextWindow = ev.contextWindow; reportUsage() }
            // The CLI assembles the final text itself; prefer it over the
            // deltas, which omit anything it emitted without streaming.
            if (ev.text) answer = ev.text
            // A resume that failed is CLASSIFIED BY `onDone`, which is the
            // only place stderr — the thing that says "No conversation found"
            // — is available. Settling here would reject first and turn a cold
            // session cache into a permanent failure, which is the whole bug
            // the retry exists to prevent.
            if (ev.isError && !(resume && ev.subtype === 'error_during_execution')) {
              finish(() => reject(new Error(
                ev.errorStatus
                  ? `Claude Code reported an API error (${ev.errorStatus}).`
                  : 'Claude Code did not complete the turn.'
              )))
            }
          }
        },
        onToolCall: async (call) => {
          if (!onToolCall) return 'Error: no tools are available in this session.'
          return onToolCall({ id: call.name, name: call.name, input: call.input })
        },
        onDone: (code, stderr) => {
          finish(() => {
            if (code === 0 && sawResult && !resultIsError) { resolve(answer); return }
            // A cold cache, not a failure — `sendClaudeCli` retries this one.
            if (resume && isMissingSession(stderr, resultSubtype)) {
              reject(new MissingClaudeSession('the stored Claude Code session is gone'))
              return
            }
            reject(new Error(claudeFailureMessage(code, stderr, sawResult)))
          })
        },
        onError: (message) => finish(() => reject(new Error(message))),
      },
    )

    const onAbort = (): void => {
      abort()
      finish(() => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
      })
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}
