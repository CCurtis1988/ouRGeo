import type { AiTool } from '@/lib/ai-client'
import type { ContextBroker } from '@/lib/context/broker'
import { useContextStore } from '@/store/context'
import { rememberIntent, forgetIntent } from '@/lib/context/memory-intent'
import { useProjectStore } from '@/store/project'

export const CONTEXT_TOOLS: AiTool[] = [
  { name: 'context_search', description: 'Discover authorised resources, skills and memories. Missing indexed results do not prove a source does not exist.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, kinds: { type: 'array', items: { type: 'string' } }, scope: { type: 'string', enum: ['all', 'available', 'conversation', 'project', 'global', 'application', 'workspace'] }, group: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, cursor: { type: 'string' } }, required: ['query'] } },
  { name: 'context_read', description: 'Read a scoped opaque source reference. Bounded pages report completeness; use the next cursor to expand.', inputSchema: { type: 'object', properties: { ref: { type: 'string' }, cursor: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['ref'] } },
  { name: 'context_remember', description: 'Save only a preference or decision the user explicitly asked to remember. Project records await project save.', inputSchema: { type: 'object', properties: { content: { type: 'string' }, scope: { type: 'string', enum: ['project', 'global'] } }, required: ['content', 'scope'] } },
  { name: 'context_forget', description: 'Forget one authorised memory the user explicitly asked to remove. Search first to obtain its reference.', inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } },
]
export const CONTEXT_TOOL_NAMES = new Set(CONTEXT_TOOLS.map(t => t.name))

export async function runContextTool(broker: ContextBroker, name: string, input: Record<string, unknown>, userText: string, messageId?: string): Promise<string> {
  try {
    broker.validateSend()
    if (name === 'context_search') return await broker.searchWithMemory(input)
    if (name === 'context_read') return await broker.read(input)
    // Retrieved prose cannot supply intent for a write. Automatic learning is
    // not enabled here; explicit requests remain useful without an extractor.
    if (name === 'context_remember') {
      if (!/\b(?:remember|save (?:this|that)|keep (?:this|that))\b/i.test(userText)) return JSON.stringify({ status: 'rejected', recovery: 'Ask the user whether this should be remembered.' })
      if (input.scope !== 'project' && input.scope !== 'global') return JSON.stringify({ status: 'rejected' })
      const request = rememberIntent(userText, Boolean(useProjectStore.getState().path))
      if (!request) return JSON.stringify({ status: 'rejected', recovery: 'Use Remember in the Memory library to choose the exact statement.' })
      const { scope } = request
      if (input.scope !== scope) return JSON.stringify({ status: 'rejected', recovery: `The user authorised ${scope} memory. Retry in that scope.` })
      // The model cannot substitute a statement found in malicious source text.
      const record = await useContextStore.getState().remember(request.statement, scope, messageId ? [messageId] : [])
      return JSON.stringify({ status: record.scope === 'project' ? 'awaiting-project-save' : 'saved', id: record.id, scope: record.scope, statement: record.statement, recovery: 'Edit or Forget in the Memory library.' })
    }
    if (name === 'context_forget') {
      const context = useContextStore.getState()
      const selected = forgetIntent(userText, [...context.globals, ...context.projectContext.memories])
      if (!selected) return JSON.stringify({ status: 'review-required', recovery: 'Open the Memory library and select the exact memory or memories to forget. No memory was removed.' })
      const result = JSON.parse(await broker.read(input))
      if (result.kind !== 'memory' || result.status !== 'ok') return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
      if (result.sourceId !== `memory:${selected.id}`) return JSON.stringify({ status: 'rejected', recovery: 'This reference does not match the user’s forget request. Search for the specified memory.' })
      const receipt = await useContextStore.getState().forget(result.sourceId.replace(/^memory:/, ''))
      return JSON.stringify({ status: 'forgotten', local: 'excluded', managed: receipt?.managed ?? 'unknown', recovery: receipt?.recovery ?? 'Already transmitted content and older exported copies cannot be recalled.' })
    }
    return JSON.stringify({ status: 'SOURCE_UNAVAILABLE' })
  } catch (error) {
    return JSON.stringify({ status: String(error).match(/STALE_REFERENCE|SOURCE_BUSY|SOURCE_UNAVAILABLE|BUDGET_LIMIT|SCOPE_CHANGED/)?.[0] ?? 'SOURCE_UNAVAILABLE', recovery: String(error) })
  }
}
