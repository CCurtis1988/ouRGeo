import { thinkingWire } from '@/lib/ai-thinking'
import type { OpenAiAssistantMessage } from '@/store/ai'
import { requestInvocation, reportInvocationUsage, type SendOptions } from '@/lib/ai-client'
import { proxyFetch } from '@/lib/ai-proxy-fetch'

export function chatGptFailure(data: unknown, status?: number): string {
  const body = data as { error?: { code?: string; message?: string; param?: string }; detail?: string }
  const code = body?.error?.code
  const recovery: Record<string, string> = {
    subscription_sharing_usage_limit_exceeded: 'ChatGPT usage limit reached. Review your app limits and credits in ChatGPT Settings → Usage.',
    subscription_sharing_user_not_eligible: 'This ChatGPT account or workspace cannot use its plan in ouRGeo. Check access in ChatGPT settings or select another account.',
    subscription_sharing_usage_unavailable: 'ChatGPT usage is temporarily unavailable. Try again later.',
    subscription_sharing_user_unavailable: 'ChatGPT account information is temporarily unavailable. Try again later.',
    subscription_sharing_unsupported_capability: 'This model or capability is not supported by ChatGPT plan usage. Select another eligible model.',
  }
  const message = (code && recovery[code]) || body?.error?.message || body?.detail
    || (status === 401 ? 'ChatGPT authorisation was refused. Check plan access or sign in again in Settings → AI Assistant.'
      : status === 403 ? 'ChatGPT plan access was refused. Check your account and workspace permissions.'
        : 'ChatGPT could not complete the response. Try again later.')
  return `${status ? `HTTP ${status}: ` : ''}${message}${code ? ` (${code})` : ''}${body?.error?.param ? ` [${body.error.param}]` : ''}`
}

/** Subscription inference uses Responses, with explicit history and no server
 * storage. Main attaches the OAuth credential; the renderer never receives it. */
export async function sendChatGptSubscription(opts: SendOptions): Promise<string> {
  if (!opts.model) throw new Error('Choose a ChatGPT model in Settings → AI Assistant first.')
  const account = await window.electronAPI.chatgpt.status()
  if (!account.planEnabled || !account.activeId) throw new Error('Sign in and enable ChatGPT plan usage in Settings → AI Assistant first.')
  const accountId = account.activeId
  const tools = opts.onToolCall ? opts.tools ?? [] : []
  const input: Record<string, unknown>[] = opts.messages.flatMap((m) => m.role === 'assistant' && m.openAiMessages?.length
    ? m.openAiMessages.map((part) => ({ role: m.role, content: part.content, ...(part.phase ? { phase: part.phase } : {}) }))
    : [{ role: m.role, content: m.content }])
  let fullText = ''
  const visibleMessages: OpenAiAssistantMessage[] = []
  for (;;) {
    opts.signal?.throwIfAborted()
    const payload = () => ({
        model: opts.model, instructions: opts.systemPrompt, input, store: false, stream: true,
        ...(opts.maxOutputTokens ? { max_output_tokens: opts.maxOutputTokens } : {}),
        include: ['reasoning.encrypted_content'],
        ...(opts.thinking?.capability.protocol === 'openai' && thinkingWire(opts.thinking) !== undefined ? { reasoning: { effort: thinkingWire(opts.thinking) } } : {}),
        ...(tools.length ? { tools: [{ type: 'namespace', name: 'ourgeo', description: 'Tools for the live ouRGeo session.',
          tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema, strict: false })),
        }] } : {}),
    })
    const response = await requestInvocation(opts, input, 'responses', payload, () => proxyFetch('https://api.openai.com/v1/responses', {
      method: 'POST', billing: 'chatgpt', billingAccountId: accountId, signal: opts.signal,
      body: JSON.stringify(payload()),
    }))
    const diagnostic = response.requestId ? ` [request ${response.requestId}]` : ''
    if (!response.ok) {
      const raw = await response.text()
      let data: unknown
      try { data = JSON.parse(raw) } catch { data = { detail: raw.slice(0, 500) } }
      throw new Error(chatGptFailure(data, response.status) + diagnostic)
    }
    if (!response.body) throw new Error('ChatGPT returned no response stream. Try again.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed: { output?: Record<string, unknown>[]; usage?: { input_tokens?: number } } | null = null
    // Completed items are authoritative too: a terminal summary need not
    // repeat the items already sent. Losing these dropped both final answers
    // and tool calls, leaving a successful but empty (or preamble-only) turn.
    const items = new Map<number, Record<string, unknown>>()
    const textParts = new Map<string, string>()
    let responseText = ''
    const emit = (index: number, part: number, text: string, delta = false) => {
      const key = `${index}:${part}`
      const prior = textParts.get(key) ?? ''
      if (!delta && !text.startsWith(prior)) throw new Error('ChatGPT returned inconsistent response text. Try again.' + diagnostic)
      const suffix = delta ? text : text.slice(prior.length)
      textParts.set(key, delta ? prior + text : text)
      if (suffix) { responseText += suffix; fullText += suffix; opts.onChunk(suffix) }
    }
    const record = (index: number, item: Record<string, unknown>) => {
      items.set(index, item)
      if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
        item.content.forEach((part: { type?: string; text?: string; refusal?: string }, partIndex: number) => {
          if (part.type === 'output_text' || part.type === 'refusal') emit(index, partIndex, part.text ?? part.refusal ?? '')
        })
      }
    }
    const event = (frame: string) => {
      const raw = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!raw || raw === '[DONE]') return
      const data = JSON.parse(raw)
      if (data.type === 'response.output_text.delta' || data.type === 'response.refusal.delta') {
        emit(data.output_index ?? 0, data.content_index ?? 0, data.delta, true)
      } else if (data.type === 'response.output_text.done' || data.type === 'response.refusal.done') {
        emit(data.output_index ?? 0, data.content_index ?? 0, data.text ?? data.refusal ?? '')
      } else if (data.type === 'response.content_part.done') {
        if (data.part?.type === 'output_text' || data.part?.type === 'refusal') {
          emit(data.output_index ?? 0, data.content_index ?? 0, data.part.text ?? data.part.refusal ?? '')
        }
      } else if (data.type === 'response.output_item.added') {
        items.set(data.output_index, data.item)
      } else if (data.type === 'response.output_item.done') {
        record(data.output_index, data.item)
      } else if (data.type === 'response.function_call_arguments.delta') {
        const item = items.get(data.output_index)
        if (item) items.set(data.output_index, { ...item, arguments: String(item.arguments ?? '') + data.delta })
      } else if (data.type === 'response.function_call_arguments.done') {
        const item = items.get(data.output_index)
        if (item) items.set(data.output_index, { ...item, arguments: data.arguments })
      } else if (data.type === 'response.completed') {
        completed = data.response
        data.response?.output?.forEach((item: Record<string, unknown>, index: number) => record(index, item))
      } else if (data.type === 'response.failed' || data.type === 'error') {
        reportInvocationUsage(opts, data.response?.usage, 'openai-responses')
        throw new Error(chatGptFailure(data.response ?? { error: data.error ?? data }) + diagnostic)
      } else if (data.type === 'response.incomplete') {
        reportInvocationUsage(opts, data.response?.usage, 'openai-responses')
        throw new Error(`ChatGPT’s response was incomplete (${data.response?.incomplete_details?.reason ?? 'unknown reason'}). Try again.`)
      }
    }
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let split: number
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        event(buffer.slice(0, split)); buffer = buffer.slice(split + 2)
      }
      if (done) { if (buffer.trim()) event(buffer); break }
    }
    if (!completed) throw new Error('ChatGPT’s stream ended before the response completed. Try again.')
    // Assigned by the event callback; TS cannot follow assignments inside it.
    const result = completed as { output?: Record<string, unknown>[]; usage?: Record<string, unknown> & { input_tokens?: number } }
    if (result.usage?.input_tokens != null) opts.onUsage?.(result.usage.input_tokens, opts.contextSize ?? 128_000)
    reportInvocationUsage(opts, result.usage, 'openai-responses')
    const output = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
    const messages = output.filter((item) => item.type === 'message' && item.role === 'assistant')
    for (const message of messages) {
      const content = (message.content as { type: string; text?: string; refusal?: string }[] ?? [])
        .map((part) => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '').join('')
      if (content) visibleMessages.push({ content, ...(message.phase === 'commentary' || message.phase === 'final_answer' ? { phase: message.phase } : {}) })
    }
    // Some compatible streams omit message items but still provide text.
    if (!messages.length && responseText) visibleMessages.push({ content: responseText })
    opts.onOpenAiMessages?.([...visibleMessages])
    const calls = output.filter((item) => item.type === 'function_call')
    if (!calls.length) {
      if (!responseText.trim() || (messages.length && messages.every((item) => item.phase === 'commentary'))) {
        throw new Error('ChatGPT finished without a final answer. Try again or select another ChatGPT model in Settings → AI Assistant.' + diagnostic)
      }
      return fullText
    }
    input.push(...output)
    for (const call of calls) {
      opts.signal?.throwIfAborted()
      const name = String(call.name ?? '')
      let output: string
      if (!tools.some((t) => t.name === name) || (call.namespace && call.namespace !== 'ourgeo')) {
        output = 'Error: this tool is not enabled for this turn.'
      } else {
        const args = JSON.parse(String(call.arguments ?? '{}'))
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('ChatGPT returned invalid tool arguments.')
        output = await opts.onToolCall!({ id: String(call.call_id), name, input: args })
      }
      input.push({ type: 'function_call_output', call_id: call.call_id, output })
    }
  }
}
