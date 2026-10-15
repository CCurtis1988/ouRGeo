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
import { pluginContextSources } from './plugin'
import { snapshotDocument } from '../document-snapshots'
import { environmentSourceId, conversationSourceId } from '../source-identity'
import { preferenceCategories } from '../preferences'
import { ConsoleIndex } from './console-index'
import { DocumentDescriptorIndex } from './document-index'
import { SnapshotDescriptorIndex } from './snapshot-index'
import type { DescriptorQuery } from '../descriptor-identity'
import { conversationMemories } from '../conversation-memory'
import { memoryRetention } from '../retention'
import { readDocumentRange } from '../document-range'
import { columnExclusions, hasColumnExclusions, useColumnDisclosureStore } from '@/store/column-disclosure'
import { disclosedColumns, disclosedSchema, schemaColumns } from '../column-disclosure'

import { folderSources, folderSourceScan } from '../folder-sources'
import { schemaRevision } from '../schema-revision'

const consoleIndex = new ConsoleIndex()
const documentIndex = new DocumentDescriptorIndex({ tabs: () => useEditorStore.getState().tabs, epoch: () => useProjectStore.getState().workspaceEpoch, snapshot: snapshotDocument, available: () => !hasColumnExclusions() })
const environmentKeys = (): readonly unknown[] => {
    const session = useSessionStore.getState(), columns = useColumnDisclosureStore.getState()
    let latestInput = ''
    for (let index = session.consoleHistory.length - 1; index >= 0; index--) if (session.consoleHistory[index].type === 'input') { latestInput = session.consoleHistory[index].id; break }
    return [useEnvironmentStore.getState().environments, useProjectStore.getState().workspaceEpoch, session.rGeneration, session.rPort, session.rStatus, latestInput, columns.selections, columns.revision, columns.loaded, columns.workspaceEpoch]
}
const environmentIndex = new SnapshotDescriptorIndex({
  epoch: () => useProjectStore.getState().workspaceEpoch,
  keys: environmentKeys,
  freshnessKeys: () => environmentKeys().slice(1),
  sources: () => workspaceSources(['environment'], false),
})

/** Only discovery uses UI metadata. R reads are schema-only and never print,
 * evaluate an active binding, sample rows or materialise a lazy table. */
export function workspaceSources(kinds?: ContextKind[], includeFolders = true): ContextSource[] {
  const sources: ContextSource[] = []
  const privateColumns = hasColumnExclusions()
  const wants = (kind: ContextKind): boolean => (!kinds || kinds.includes(kind)) && (!privateColumns || ['environment', 'skill', 'action'].includes(kind))
  if (wants('skill')) {
    const descriptors = new Map(topicDescriptors().map(descriptor => [descriptor.topic, descriptor]))
    for (const [topic, body] of Object.entries(OURGEO_TOPICS)) {
      const descriptor = descriptors.get(topic)
      const prerequisites = [skillPrerequisites(topic), ...(descriptor?.requiredSkills?.length ? [`Required guidance: ${descriptor.requiredSkills.join(', ')}.`] : []), ...(descriptor?.requiredSources?.length ? [`Required current evidence: ${descriptor.requiredSources.join(', ')}.`] : [])].filter(Boolean).join('\n')
      sources.push({ id: `skill:${topic}`, kind: 'skill', scope: 'application', title: topic, summary: `${descriptor?.summary ?? ''} ${descriptor?.triggers.join(' ') ?? ''}`.slice(0, 1000), revision: contentRevision(`${descriptor?.version}:${prerequisites}\n${body}`), prerequisites, requiredSkills: descriptor?.requiredSkills, requiredSources: descriptor?.requiredSources, trust: 'untrusted', read: () => `${prerequisites}\n\n${topic === 'documents' ? `${buildDocumentSkill({ hasDocumentTools: true })}\n\n${body}` : body}` })
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
        const sourceId = environmentSourceId(env.name, object.name)
        const denied = columnExclusions(sourceId)
        const summary = JSON.stringify({ class: object.class, dim: object.dim, columns: disclosedColumns(schemaColumns(object.columns), denied), ...(denied.length ? { disclosure: 'Some column metadata is excluded.' } : {}) })
        sources.push({ id: sourceId, legacyIds: [`environment:${env.name}:${object.name}`], resource: { environment: env.name, name: object.name }, kind: 'environment', scope: 'workspace', title: `${env.name}::${object.name}`, summary: `${object.name} ${summary} (cached descriptor; verify schema before answering)`, revision: schemaRevision(generation, object, denied), trust: 'observed', read: async (signal) => {
          signal?.throwIfAborted()
          if (useProjectStore.getState().phase === 'loading' || useSessionStore.getState().isExecuting) throw new Error('SOURCE_BUSY: R is executing or loading. Wait or cancel and try again.')
          const result = await rClient.contextSchema(object.name, env.name)
          signal?.throwIfAborted()
          if (!result.success) throw new Error(`SOURCE_UNAVAILABLE: ${result.error ?? 'Schema inspection unavailable.'}`)
          return JSON.stringify({ ...disclosedSchema(result, columnExclusions(sourceId)), observation: 'current schema only; no data values or population statistics', environment: env.name, object: object.name })
        } })
      }
    }
  }
  if (wants('document')) {
    sources.push(...pluginContextSources())
    if (includeFolders) sources.push(...folderSources(window.electronAPI.context))
    for (const tab of useEditorStore.getState().tabs.filter(t => !t.type || t.type === 'code')) {
      const snapshot = tab.viewMode === 'visual' ? snapshotDocument(tab.id) : tab.content
      const summary = describeDocument(snapshot ?? tab.content, languageOf(tab))
      const readCurrent = (): string => {
        const current = useEditorStore.getState().tabs.find(current => current.id === tab.id)
        if (!current) throw new Error('SOURCE_UNAVAILABLE: this document was closed.')
        const text = current.viewMode === 'visual' ? snapshotDocument(current.id) : current.content
        if (text === null) throw new Error('SOURCE_BUSY: activate this document so its editor can snapshot current Visual changes.')
        return text
      }
      sources.push({ id: `document:${tab.id}`, kind: 'document', scope: 'workspace', title: tab.fileName, summary: `${tab.fileName} ${summary.headings.slice(0, 12).join(' ')} ${summary.lines} lines`, revision: contentRevision(snapshot ?? tab.content), trust: 'user', read: readCurrent, readRange: (range, signal) => { signal?.throwIfAborted(); return readDocumentRange(readCurrent(), range) } })
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
    const ai = useAiStore.getState(), chat = ai.chats.find(chat => chat.id === ai.activeChatId)
    if (chat) for (const record of conversationMemories(chat)) {
      const manual = chat.conversationMemories?.some(note => note.id === record.id)
      sources.push({ id: `memory:conversation:${chat.id}:${record.id}`, kind: 'memory', scope: 'conversation',
        title: record.statement.slice(0, 120), summary: record.statement, revision: String(record.revision), timestamp: record.updatedAt, trust: 'user',
        read: () => JSON.stringify({ ...record, scope: 'conversation', pinned: manual === true && record.pinned !== false, assertion: 'user-declared' }) })
    }
    for (const record of [...context.projectContext.memories, ...context.globals]) {
      if (record.status !== 'active' || memoryRetention(record).expired) continue
      if (record.scope === 'project' && (!useProjectStore.getState().path || record.projectId !== useProjectStore.getState().projectId)) continue
      sources.push({ id: `memory:${record.id}`, kind: 'memory', scope: record.scope, title: record.statement.slice(0, 120), summary: `${record.statement} ${preferenceCategories(record.statement).join(' ')}`, revision: String(record.revision), timestamp: record.updatedAt, trust: record.assertion === 'user-declared' ? 'user' : record.assertion === 'observed' ? 'observed' : 'untrusted', read: () => JSON.stringify(record) })
    }
  }
  return sources
}

/** Broker discovery streams the potentially large authorised folder catalogue.
 * UI pickers retain their ordinary stable array API. */
export function* workspaceSourceScan(kinds?: ContextKind[], beforeEnvironmentRead?: () => void, query?: DescriptorQuery): Generator<ContextSource> {
  const localKinds = (kinds ?? ['skill', 'action', 'environment', 'console', 'document', 'conversation', 'memory', 'result']).filter(kind => kind !== 'document' && kind !== 'environment') as ContextKind[]
  yield* workspaceSources(localKinds, false)
  if (!kinds || kinds.includes('environment')) yield* environmentIndex.scan(beforeEnvironmentRead, query)
  if ((!kinds || kinds.includes('document')) && !hasColumnExclusions()) {
    yield* pluginContextSources()
    yield* documentIndex.scan(query)
    yield* folderSourceScan(window.electronAPI.context)
  }
}
