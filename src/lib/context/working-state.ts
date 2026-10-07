import type { ChatMessage } from '@/store/ai'
import { estimateTokens } from './budget'
import { redactContext } from './policy'

export interface WorkingSpan { messageId: string; text: string }
export interface WorkingState {
  version: 2
  requests: WorkingSpan[]
  constraints: WorkingSpan[]
  objectives: WorkingSpan[]
  decisions: WorkingSpan[]
  questions: WorkingSpan[]
  entities: WorkingSpan[]
  failedAttempts: WorkingSpan[]
  overflow: string[]
  authority: 'derived-from-original-messages'
}

/** Preserve exact spans and lineage instead of recursively summarising a
 * summary. This records user task state, never private model reasoning or
 * automatically promoted analytical facts. Originals remain searchable. */
export function buildWorkingState(messages: ChatMessage[], limit = 800): WorkingState {
  const state: WorkingState = { version: 2, requests: [], constraints: [], objectives: [], decisions: [], questions: [], entities: [], failedAttempts: [], overflow: [], authority: 'derived-from-original-messages' }
  const users = messages.filter(message => message.role === 'user').map(message => ({ ...message, content: redactContext(message.content) }))
  const candidates = users.flatMap(message => {
    const spans = message.content.split(/(?<=[.!?])\s+(?=[\p{Lu}])|\n+/u)
    return spans.filter(span => /\b(?:must|never|always|do not|don't|exactly|only|keep|without)\b/i.test(span)).map(text => ({ messageId: message.id, text: text.trim() }))
  })
  type Field = 'requests' | 'constraints' | 'objectives' | 'decisions' | 'questions' | 'entities' | 'failedAttempts'
  const add = (field: Field, span: WorkingSpan, ceiling = limit - 150): void => {
    if (!span.text || state[field].some(item => item.messageId === span.messageId && item.text === span.text)) return
    if (estimateTokens({ ...state, [field]: [...state[field], span], overflow: [] }) <= ceiling) state[field].push(span)
    else if (!state.overflow.includes(span.messageId)) state.overflow.push(span.messageId)
  }
  for (const span of candidates) add('constraints', span, limit - 250)
  // Exact user spans, not model-inferred intentions. Corrections and conflicting
  // decisions retain their own sources; the card does not silently resolve them.
  for (const message of [users[0], ...users.slice(-2)]) if (message) add('objectives', { messageId: message.id, text: message.content })
  for (const message of [...users].reverse()) {
    for (const text of message.content.split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}])/u)) {
      const span = { messageId: message.id, text: text.trim() }
      if (/\b(?:we (?:decided|agreed|chose)|I (?:decided|chose)|the decision is|use (?:metres|meters|miles|feet|metric|imperial|EPSG)|CRS (?:is|should be))\b/i.test(text)) add('decisions', span)
      // These are questions to check against the originals, not a claim that
      // the assistant never answered them or that a previous answer was true.
      if (text.trim().endsWith('?')) add('questions', span)
    }
    for (const match of message.content.matchAll(/\[[^\]\n]{1,100}\]|\bEPSG\s*:\s*\d{3,6}\b|`[^`\n]{1,100}`/gi)) add('entities', { messageId: message.id, text: match[0] })
  }
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue
    for (const text of redactContext(message.content).split(/\n+/)) {
      if (/\b(?:failed|could not|cannot|timed out|error:)\b/i.test(text)) add('failedAttempts', { messageId: message.id, text: text.trim() })
    }
  }
  for (const message of users.slice(-3).reverse()) {
    const span = { messageId: message.id, text: message.content }
    add('requests', span, limit - 50)
  }
  state.requests.reverse()
  // Overflow contains source IDs only. Limit the visible card without making
  // its references an unbounded second copy of a long conversation.
  state.overflow = state.overflow.slice(-10)
  while (estimateTokens(state) > limit && state.overflow.length) state.overflow.pop()
  return state
}
