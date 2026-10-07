import { estimateTokens } from './budget'

type Wire = Record<string, unknown>
export type ToolProtocol = 'openai' | 'anthropic' | 'google' | 'responses'
interface ResultSlot { batch: number; text: string; replace: (text: string) => void }

/** Compact only completed tool-result bodies. Calls, IDs, arguments, original
 * user instructions and the newest result batch stay intact. The full body
 * moves into the same scoped broker cache used for progressive reads. */
export function compactToolResults(
  messages: unknown[], protocol: ToolProtocol, capacity: number,
  payload: () => unknown, archive: (text: string) => string,
): number {
  if (estimateTokens(payload()) <= capacity * .85) return 0
  const slots: ResultSlot[] = []
  messages.forEach((value, batch) => {
    if (!value || typeof value !== 'object') return
    const message = value as Wire
    const add = (target: Wire, key: string): void => {
      if (typeof target[key] === 'string') slots.push({ batch, text: target[key] as string, replace: text => { target[key] = text } })
    }
    if (protocol === 'responses' && message.type === 'function_call_output') add(message, 'output')
    if (protocol === 'openai' && message.role === 'tool') add(message, 'content')
    if (protocol === 'anthropic' && message.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content as Wire[]) if (block.type === 'tool_result') add(block, 'content')
    }
    if (protocol === 'google' && Array.isArray(message.parts)) {
      for (const part of message.parts as Wire[]) {
        const response = (part.functionResponse as Wire | undefined)?.response
        if (response && typeof response === 'object') add(response as Wire, 'output')
      }
    }
  })
  // OpenAI/Responses encode each result as a separate item. Consecutive result
  // items belong to the same assistant call batch and must all remain current.
  let newest = slots.at(-1)?.batch ?? -1
  if (protocol === 'openai' || protocol === 'responses') {
    const batches = new Set(slots.map(slot => slot.batch))
    while (batches.has(newest - 1)) newest--
  }
  let compacted = 0
  for (const slot of slots) {
    if (slot.batch >= newest || estimateTokens(slot.text) < 400) continue
    // Do not archive the same derived receipt repeatedly on later rounds.
    if (slot.text.startsWith('{"status":"compacted"')) continue
    const replacement = archive(slot.text)
    if (estimateTokens(replacement) >= estimateTokens(slot.text)) continue
    slot.replace(replacement)
    compacted++
    if (estimateTokens(payload()) <= capacity * .70) break
  }
  return compacted
}
