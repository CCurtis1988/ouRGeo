import type { ContextKind, ContextSource } from '../types'
import { contentRevision } from '../policy'
import { useEnvironmentStore } from '@/store/environment'
import { useEditorStore } from '@/store/editor'
import { useSessionStore } from '@/store/session'
import { useAiStore } from '@/store/ai'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { OURGEO_TOPICS, topicDescriptors } from '@/lib/ai-skill-ourgeo'
import { buildDocumentSkill } from '@/lib/ai-skill-documents'
import { actionList } from '@/lib/ai-actions/registry'
import { describeAction } from '@/lib/ai-actions/types'
import { languageOf } from '@/lib/markdown/doc-kind'
import { describeDocument } from '@/lib/ai-doc-context'
import { rClient } from '@/lib/r-client'
import { skillPrerequisites } from '../prerequisites'
import { snapshotDocument } from '../document-snapshots'
import { environmentSourceId, conversationSourceId } from '../source-identity'
import { preferenceCategories } from '../preferences'
import { ConsoleIndex } from './console-index'

const consoleIndex = new ConsoleIndex()

/** Only discovery uses UI metadata. R reads are schema-only and never print,
 * evaluate an active binding, sample rows or materialise a lazy table. */
export function workspaceSources(kinds?: ContextKind[]): ContextSource[] {
  const sources: ContextSource[] = []
  const wants = (kind: ContextKind): boolean => !kinds || kinds.includes(kind)
  if (wants('skill')) {
    const descriptors = new Map(topicDescriptors().map(descriptor => [descriptor.topic, descriptor]))
    for (const [topic, body] of Object.entries(OURGEO_TOPICS)) {
      const prerequisites = skillPrerequisites(topic)
      const descriptor = descriptors.get(topic)
      sources.push({ id: `skill:${topic}`, kind: 'skill', scope: 'application', title: topic, summary: `${descriptor?.summary ?? ''} ${descriptor?.triggers.join(' ') ?? ''}`.slice(0, 1000), revision: contentRevision(`${descriptor?.version}:${prerequisites}\n${body}`), prerequisites, trust: 'untrusted', read: () => `${prerequisites}\n\n${topic === 'documents' ? `${buildDocumentSkill({ hasDocumentTools: true })}\n\n${body}` : body}` })
    }
  }
  if (wants('action')) {
    const ai = useAiStore.getState()
    for (const action of actionList()) {
      if (action.requires === 'terminal' && !(ai.terminalEnabled && ai.autoPilotEnabled)) continue
      const body = describeAction(action, action.tier)
      sources.push({ id: `action:${action.id}`, kind: 'action', scope: 'application', title: action.id, summary: action.summary, group: action.group, revision: contentRevision(body), trust: 'host', read: () => body })
    }
  }
  if (wants('environment')) {
    const session = useSessionStore.getState()
    const history = session.consoleHistory
    // Shape-only events miss edits to values, so *any* subsequent execution
    // invalidates observations even if dimensions did not change.
    let latestInput = ''
    for (let index = history.length - 1; index >= 0; index--) { if (history[index].type === 'input') { latestInput = history[index].id; break } }
    const generation = `${useProjectStore.getState().workspaceEpoch}:${session.rGeneration}:${session.rPort}:${session.rStatus}:${latestInput}`
    for (const env of useEnvironmentStore.getState().environments.filter(e => !e.isSearchPath)) {
      for (const object of env.objects) {
        const summary = JSON.stringify({ class: object.class, dim: object.dim, columns: object.columns })
        sources.push({ id: environmentSourceId(env.name, object.name), legacyIds: [`environment:${env.name}:${object.name}`], resource: { environment: env.name, name: object.name }, kind: 'environment', scope: 'workspace', title: `${env.name}::${object.name}`, summary: `${object.name} ${summary} (cached descriptor; verify schema before answering)`, revision: contentRevision(`${generation}:${summary}`), trust: 'observed', read: async (signal) => {
          signal?.throwIfAborted()
          if (useProjectStore.getState().phase === 'loading' || useSessionStore.getState().isExecuting) throw new Error('SOURCE_BUSY: R is executing or loading. Wait or cancel and try again.')
          const result = await rClient.contextSchema(object.name, env.name)
          signal?.throwIfAborted()
          if (!result.success) throw new Error(`SOURCE_UNAVAILABLE: ${result.error ?? 'Schema inspection unavailable.'}`)
          return JSON.stringify({ ...result, observation: 'current schema only; no data values or population statistics', environment: env.name, object: object.name })
        } })
      }
    }
  }
  if (wants('document')) {
    for (const tab of useEditorStore.getState().tabs.filter(t => !t.type || t.type === 'code')) {
      const snapshot = tab.viewMode === 'visual' ? snapshotDocument(tab.id) : tab.content
      const summary = describeDocument(snapshot ?? tab.content, languageOf(tab))
      sources.push({ id: `document:${tab.id}`, kind: 'document', scope: 'workspace', title: tab.fileName, summary: `${tab.fileName} ${summary.headings.slice(0, 12).join(' ')} ${summary.lines} lines`, revision: contentRevision(snapshot ?? tab.content), trust: 'user', read: () => {
        const current = useEditorStore.getState().tabs.find(current => current.id === tab.id)
        if (!current) throw new Error('SOURCE_UNAVAILABLE: this document was closed.')
        const text = current.viewMode === 'visual' ? snapshotDocument(current.id) : current.content
        if (text === null) throw new Error('SOURCE_BUSY: activate this document so its editor can snapshot current Visual changes.')
        return text
      } })
    }
  }
  if (wants('console')) {
    const session = useSessionStore.getState()
    for (const source of consoleIndex.update(session.consoleHistory, `${useProjectStore.getState().workspaceEpoch}:${session.rGeneration}`)) sources.push(source)
  }
  if (wants('conversation')) {
    const ai = useAiStore.getState()
    for (const chat of ai.chats) {
      if (!useProjectStore.getState().path && chat.id !== ai.activeChatId) continue
      const body = chat.messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
      const scope = chat.id === ai.activeChatId ? 'conversation' : 'project'
      sources.push({ id: conversationSourceId(chat.id), legacyIds: [`conversation:${chat.id}`], kind: 'conversation', scope, title: chat.title, summary: body.slice(0, 600), revision: contentRevision(body), timestamp: new Date(chat.updatedAt).toISOString(), trust: 'untrusted', read: () => body })
      for (const message of chat.messages) {
        const text = `${message.role} message ${message.id} at ${new Date(message.timestamp).toISOString()}:\n${message.content}`
        sources.push({ id: conversationSourceId(chat.id, message.id), legacyIds: [`conversation:${chat.id}:${message.id}`], kind: 'conversation', scope, title: `${chat.title} · ${message.role}`, summary: `${message.id} ${message.content.slice(0, 1500)}`, revision: contentRevision(text), timestamp: new Date(message.timestamp).toISOString(), trust: message.role === 'user' ? 'user' : 'untrusted', read: () => text })
      }
    }
  }
  if (wants('memory')) {
    const context = useContextStore.getState()
    for (const record of [...context.projectContext.memories, ...context.globals]) {
      if (record.status !== 'active') continue
      if (record.scope === 'project' && (!useProjectStore.getState().path || record.projectId !== useProjectStore.getState().projectId)) continue
      sources.push({ id: `memory:${record.id}`, kind: 'memory', scope: record.scope, title: record.statement.slice(0, 120), summary: `${record.statement} ${preferenceCategories(record.statement).join(' ')}`, revision: String(record.revision), timestamp: record.updatedAt, trust: record.assertion === 'user-declared' ? 'user' : record.assertion === 'observed' ? 'observed' : 'untrusted', read: () => JSON.stringify(record) })
    }
  }
  return sources
}
