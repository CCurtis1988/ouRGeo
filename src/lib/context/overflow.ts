import { estimateTokens } from './budget'
import type { ToolProtocol } from './tool-compaction'

type Wire = Record<string, unknown>

/** An explicit rejected input is safe to rebuild. Never retry rate limits,
 * transport failures, partial streams or an arbitrary HTTP 413 upload error. */
export function contextOverflow(status: number, raw: string): boolean {
  if (![400, 413, 422].includes(status)) return false
  let error: { code?: string; message?: string; type?: string } = {}
  try {
    const data = JSON.parse(raw)
    error = typeof data.error === 'object' && data.error ? data.error : { message: typeof data.error === 'string' ? data.error : data.message }
  } catch { error.message = raw.slice(0, 1000) }
  return ['context_length_exceeded', 'prompt_too_long', 'input_too_long'].includes(error.code ?? '')
    || /(?:prompt|input) (?:is )?too long|(?:exceed\w*|longer than).{0,100}(?:context (?:window|length)|maximum context)|(?:context (?:window|length)).{0,100}(?:exceed\w*|too (?:long|large))/i.test(error.message ?? '')
}

/** Reduce optional earlier assistant prose only. All user text, host rules,
 * schemas, call arguments, result pairs, reasoning and the newest assistant
 * message survive unchanged. Full originals remain in conversation storage. */
export function reduceOverflowMessages(messages: unknown[], protocol: ToolProtocol, payload: () => unknown): boolean {
  const original = estimateTokens(payload())
  const assistant = (message: Wire): boolean => protocol === 'google' ? message.role === 'model' : message.role === 'assistant'
  const plain = (message: Wire): boolean => {
    if (!assistant(message) || message.tool_calls || message.type && message.type !== 'message') return false
    if (typeof message.content === 'string') return !message.content.includes('Derived conversation working state')
    const parts = protocol === 'google' ? message.parts : message.content
    return Array.isArray(parts) && parts.length > 0 && parts.every(part => part && typeof part === 'object'
      && (protocol === 'google' ? typeof part.text === 'string' && !part.thought && !part.functionCall && !part.functionResponse : part.type === 'text' || part.type === 'output_text')
      && !String(part.text).includes('Derived conversation working state'))
  }
  let latest = -1
  messages.forEach((value, index) => { if (value && typeof value === 'object' && assistant(value as Wire)) latest = index })
  const removable = messages.map((value, index) => index < latest && value && typeof value === 'object' && plain(value as Wire) ? index : -1).filter(index => index >= 0)
  if (!removable.length) return false
  const removed: unknown[] = []
  let offset = 0
  for (const index of removable) {
    removed.push(...messages.splice(index - offset++, 1))
    if (estimateTokens(payload()) <= original * .65) break
  }
  const notice = 'Earlier assistant replies were omitted to fit the provider context window. Original user messages and tool exchanges remain unchanged; omitted replies are searchable through context_search in this conversation. Do not assume an omitted reply was verified evidence.'
  const receipt = protocol === 'google' ? { role: 'model', parts: [{ text: notice }] } : { role: 'assistant', content: notice }
  messages.splice(removable[0], 0, receipt)
  if (estimateTokens(payload()) < original) return true
  // A tiny omission plus its receipt can be larger. Restore the exact input
  // rather than issuing an identical or bigger paid request.
  messages.splice(removable[0], 1)
  for (let index = 0; index < removed.length; index++) messages.splice(removable[index], 0, removed[index])
  return false
}
