import type { AiChat, AiProvider, ChatMessage } from '@/store/ai'
import { restoreUsage } from './usage'
import { accountingOnlyTrace, traceExpired } from './retention'

const providers: AiProvider[] = ['openai', 'openai-subscription', 'anthropic', 'claude-cli', 'google', 'ollama', 'lmstudio', 'llamacpp', 'jan', 'localai', 'vllm', 'sglang', 'mistralrs', 'xinference', 'openllm']
const identity = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && [...value].every(character => character.charCodeAt(0) >= 32)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Reject a malformed conversation as a unit. Dropping just its early user
 * constraint would make an apparently successful import change the task. */
export function importChats(input: unknown, portable = false): AiChat[] {
  if (!Array.isArray(input) || input.length > 1000) return []
  const chatIds = new Set<string>()
  let characters = 0
  return input.flatMap(value => {
    const chat = object(value)
    if (!chat || !identity(chat.id) || chatIds.has(chat.id) || !Array.isArray(chat.messages) || chat.messages.length > 100000
      || typeof chat.title !== 'string' || chat.title.length > 1000 || typeof chat.model !== 'string' || chat.model.length > 256
      || !providers.includes(chat.provider as AiProvider) || !timestamp(chat.createdAt) || !timestamp(chat.updatedAt)) return []
    const messageIds = new Set<string>()
    const messages: ChatMessage[] = []
    for (const value of chat.messages) {
      const message = object(value)
      if (!message || !identity(message.id) || messageIds.has(message.id) || !['user', 'assistant'].includes(String(message.role))
        || typeof message.content !== 'string' || !timestamp(message.timestamp)) return []
      characters += message.content.length
      if (characters > 50_000_000) return []
      messageIds.add(message.id)
      const restored: ChatMessage = { id: message.id, role: message.role as ChatMessage['role'], content: message.content, timestamp: message.timestamp }
      for (const key of ['toolCalls', 'toolResults'] as const) {
        if (message[key] === undefined) continue
        const items = message[key]
        const body = key === 'toolCalls' ? 'code' : 'output'
        if (!Array.isArray(items) || items.length > 1000 || items.some(item => !object(item) || !identity(item.id) || typeof item[body] !== 'string')) return []
        characters += items.reduce((total, item) => total + item[body].length, 0)
        if (characters > 50_000_000) return []
        if (key === 'toolCalls') restored.toolCalls = items.map(item => ({ id: item.id, code: item.code }))
        else restored.toolResults = items.map(item => ({ id: item.id, output: item.output }))
      }
      if (message.openAiMessages !== undefined) {
        if (!Array.isArray(message.openAiMessages) || message.openAiMessages.length > 1000) return []
        const parts = message.openAiMessages
        if (parts.some(part => !object(part) || typeof part.content !== 'string' || (part.phase !== undefined && !['commentary', 'final_answer'].includes(part.phase)))) return []
        characters += parts.reduce((total, part) => total + part.content.length, 0)
        if (characters > 50_000_000) return []
        restored.openAiMessages = parts.map(part => ({ content: part.content, ...(part.phase ? { phase: part.phase } : {}) }))
      }
      // Imported claims of delivery are not host acknowledgements. Local crash
      // recovery may retain a structurally valid trace for the inspector.
      if (!portable) {
        const trace = object(message.contextTrace)
        if (trace && typeof trace.target === 'string' && Array.isArray(trace.selected) && trace.selected.length <= 256
          && trace.selected.every(source => object(source) && ['title', 'scope', 'ref', 'sourceId', 'revision', 'content', 'reason'].every(key => typeof source[key] === 'string'))
          && Array.isArray(trace.invocations) && trace.invocations.length <= 256 && trace.invocations.every(call => object(call) && Number.isFinite(call.inputTokens))
          && Number.isFinite(trace.retrievalCalls)) {
          const limitations = Array.isArray(trace.limitations) ? trace.limitations.filter((item): item is string => typeof item === 'string' && item.length <= 200).slice(0, 5) : undefined
          restored.contextTrace = { ...trace, limitations, usage: restoreUsage(trace.usage, trace.invocations.length) } as unknown as ChatMessage['contextTrace']
          if (traceExpired(restored.contextTrace!, message.timestamp)) restored.contextTrace = accountingOnlyTrace(restored.contextTrace!)
        }
      }
      messages.push(restored)
    }
    chatIds.add(chat.id)
    const usage = object(chat.tokenUsage)
    return [{ id: chat.id, title: chat.title, renamed: chat.renamed === true, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
      messages, provider: chat.provider as AiProvider, model: chat.model,
      claudeSessionId: !portable && identity(chat.claudeSessionId) ? chat.claudeSessionId : null,
      lastSessionContext: null,
      tokenUsage: { used: typeof usage?.used === 'number' && Number.isSafeInteger(usage.used) && usage.used >= 0 ? usage.used : 0,
        total: typeof usage?.total === 'number' && Number.isSafeInteger(usage.total) && usage.total > 0 ? usage.total : 0 } }]
  })
}
