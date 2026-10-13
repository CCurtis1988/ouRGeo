import { create } from 'zustand'
import { inferenceUsageInputs, type InferenceUsageProvider } from '@/lib/context/inference-usage'
import type { ContextEffort, ContextTrace, MemoryForgetReceipt, MemoryRecord, ProjectContext, ContextScope } from '@/lib/context/types'
import { redactContext } from '@/lib/context/policy'
import { createJsonFileStore } from '@/lib/persistence'
import { useSessionStore } from '@/store/session'
import { useAiStore } from '@/store/ai'
import { useProjectStore } from '@/store/project'
import { clearFolderSources, refreshFolderSources } from '@/lib/context/folder-sources'
import { clearResultCache } from '@/lib/context/result-cache'
import { defaultLearning, memoryCandidate, type MemoryLearningSettings } from '@/lib/context/learning'
import { exclusionScope, type ExclusionSelection } from '@/lib/context/exclusions'
import { applyMemoryRevision } from '@/lib/context/preferences'
import { conversationMemories } from '@/lib/context/conversation-deletion'
import { assertTranscriptForget, applyTranscriptForget, type TranscriptForgetPlan, type TranscriptForgetScope } from '@/lib/context/transcript-forgetting'
import { accountingOnlyTrace, traceExpired, traceRetentionDays } from '@/lib/context/retention'

const preferences = createJsonFileStore('context-preferences.json', 'Context')
let initialisation: Promise<void> | undefined
let usageWrites: Promise<void> = Promise.resolve()
let exclusionGeneration = 0
let lastTraceSweep = 0
let traceTimer: ReturnType<typeof setInterval> | undefined
let folderSubscription: (() => void) | undefined
let retentionSubscription: (() => void) | undefined

interface ContextState {
  effort: ContextEffort
  policyRevision: number
  excluded: string[]
  exclusionsLoaded: boolean
  savedExclusions: ExclusionSelection[]
  traces: Record<string, ContextTrace>
  traceRetentionDays: number
  setTraceRetentionDays: (days: number) => Promise<void>
  sweepTraces: () => void
  projectContext: ProjectContext
  committedRevision: number
  scopeLease: string | null
  projectLease: string | null
  globals: MemoryRecord[]
  error: string | null
  learning: MemoryLearningSettings
  notice: string | null
  ready: boolean
  personalMemoryAvailable: boolean
  memoryStoreAbsent: boolean
  init: () => Promise<void>
  waitForReady: (signal?: AbortSignal) => Promise<void>
  retryLocalMemory: () => Promise<void>
  setEffort: (effort: ContextEffort) => void
  setLearning: (settings: MemoryLearningSettings) => Promise<void>
  learnFromTurn: (messageId: string, text: string) => Promise<void>
  accept: (id: string) => Promise<void>
  setPinned: (id: string, pinned: boolean) => Promise<void>
  exclude: (id: string, scope: ContextScope, projectId: string | null) => Promise<void>
  providerRevision: number
  refreshProviders: () => void
  refreshExclusions: () => Promise<void>
  revokeDelivery: () => void
  setTrace: (trace: ContextTrace) => void
  recordTraceUsage: (trace: ContextTrace, provider: InferenceUsageProvider, final?: boolean, authority?: string) => Promise<void>
  prepareTraceUsage: (trace: ContextTrace, provider: InferenceUsageProvider, outputTokens: number, authority: string) => Promise<void>
  loadProject: (context?: ProjectContext, committedRevision?: number, projectLease?: string) => void
  stageProject: () => Promise<void>
  discardProjectDraft: () => Promise<void>
  remember: (statement: string, scope: 'project' | 'global', evidence?: string[]) => Promise<MemoryRecord>
  forgetEverywhere: (plan: TranscriptForgetPlan) => Promise<void>
  forget: (id: string, preserveActiveTurn?: boolean, extraSources?: string[]) => Promise<MemoryForgetReceipt | undefined>
  deleteConversation: (chatId: string, keepIndependent?: boolean) => Promise<void>
  edit: (id: string, statement: string) => Promise<void>
}

function resetProviderSessions(cancel = true): void {
  clearResultCache()
  if (cancel) useAiStore.getState().cancelStream()
  useAiStore.setState(s => ({ chats: s.chats.map(c => ({ ...c, claudeSessionId: null, lastSessionContext: null })) }))
}

export const useContextStore = create<ContextState>((set, get) => ({
  scopeLease: null, providerRevision: 0, refreshProviders: () => set(s => ({ providerRevision: s.providerRevision + 1 })),
  effort: 'balanced', policyRevision: 0, excluded: [], exclusionsLoaded: false, savedExclusions: [], traces: {},
  traceRetentionDays: 7,
  setTraceRetentionDays: async days => {
    if (!Number.isSafeInteger(days) || days < 1 || days > 7) throw new Error('Choose between one and seven days for diagnostic evidence.')
    await preferences.merge({ traceRetentionDays: days })
    set({ traceRetentionDays: days })
    traceRetentionDays(days)
    lastTraceSweep = 0
    get().sweepTraces()
  },
  sweepTraces: () => {
    const now = Date.now(), days = get().traceRetentionDays
    if (now - lastTraceSweep < 60_000) return
    lastTraceSweep = now
    set(s => ({ traces: Object.fromEntries(Object.entries(s.traces).filter(([, trace]) => !traceExpired(trace, 0, now, days))) }))
    const chats = useAiStore.getState().chats
    const retained = chats.map(chat => {
      let changed = false
      const messages = chat.messages.map(message => {
        if (!message.contextTrace || message.contextTrace.evidenceExpired || !traceExpired(message.contextTrace, message.timestamp, now, days)) return message
        changed = true
        return { ...message, contextTrace: accountingOnlyTrace(message.contextTrace) }
      })
      return changed ? { ...chat, messages } : chat
    })
    if (retained.some((chat, index) => chat !== chats[index])) useAiStore.setState({ chats: retained })
  },
  projectContext: { version: 1, revision: 0, memories: [] }, committedRevision: 0, projectLease: null, globals: [], error: null, learning: { ...defaultLearning }, notice: null, ready: false, personalMemoryAvailable: false, memoryStoreAbsent: false,
  init: () => {
    // A recovered CLI session may contain content excluded after its last
    // delivery. Do not resume it before the protected policy has been read.
    resetProviderSessions()
    if (!initialisation) initialisation = (async () => {
      if (!traceTimer) traceTimer = setInterval(() => get().sweepTraces(), 60_000)
      if (!folderSubscription && window.electronAPI.context.onFoldersChanged) folderSubscription = window.electronAPI.context.onFoldersChanged(() => {
        get().revokeDelivery()
        clearFolderSources()
        void window.electronAPI.context.lease().then(lease => refreshFolderSources(window.electronAPI.context, lease.id)).catch(error => set({ error: `Context folders unavailable: ${String(error)}. Refresh the folder selection.` }))
      })
      if (!retentionSubscription) retentionSubscription = window.electronAPI.context.onRetentionChanged?.(() => {
        resetProviderSessions()
        set(s => ({ policyRevision: s.policyRevision + 1 }))
        const snapshot = get().globals
        void window.electronAPI.context.listGlobal().then(globals => {
          if (get().globals === snapshot) set({ globals })
        }).catch(error => set({ error: `Expired memory is blocked, but the library could not refresh: ${String(error)}. Retry local memory.` }))
      })
      set({ ready: false, personalMemoryAvailable: false, memoryStoreAbsent: false, globals: [], exclusionsLoaded: false })
      await get().refreshExclusions()
      try {
        const status = await window.electronAPI.context.storageStatus?.()
        set({ memoryStoreAbsent: status?.empty === true })
        const snapshot = get().learning, previousEffort = get().effort, previousGlobals = get().globals
        const prefs = await preferences.read<{ effort?: ContextEffort; traceRetentionDays?: number }>()
        if (Number.isSafeInteger(prefs.traceRetentionDays) && prefs.traceRetentionDays! >= 1 && prefs.traceRetentionDays! <= 7) { set({ traceRetentionDays: prefs.traceRetentionDays }); traceRetentionDays(prefs.traceRetentionDays) }
        lastTraceSweep = 0
        get().sweepTraces()
        if (get().effort === previousEffort && ['efficient', 'balanced', 'thorough'].includes(prefs.effort ?? '')) set({ effort: prefs.effort })
        const learning = await window.electronAPI.context.learningSettings()
        const globals = await window.electronAPI.context.listGlobal()
        if (get().learning === snapshot) set({ learning })
        // A delete or correction completed while startup was reading must win
        // over the older snapshot, particularly after a retry.
        set({ ...(get().globals === previousGlobals ? { globals } : {}), personalMemoryAvailable: true })
      } catch (error) { set({ error: `Personal memories and pinned personal instructions unavailable: ${String(error)}. Restore protected storage to use them.` }) }
      finally { set({ ready: true }) }
    })()
    return initialisation
  },
  retryLocalMemory: async () => {
    if (!get().ready) return initialisation
    initialisation = undefined
    set(s => ({ error: null, policyRevision: s.policyRevision + 1 }))
    return get().init()
  },
  waitForReady: async (signal) => {
    if (get().ready) { signal?.throwIfAborted(); return }
    if (!initialisation) throw new Error('Context is starting. Wait briefly before sending.')
    // Initial pinned instructions are required input, not optional retrieval.
    // Wait only for local metadata, with cancellation; never refresh R here.
    await new Promise<void>((resolve, reject) => {
      let finished = false
      const finish = (error?: unknown): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
        if (error) reject(error)
        else resolve()
      }
      const cancel = (): void => finish(new Error('Context preparation cancelled.'))
      const timer = setTimeout(() => finish(new Error('Local context is still starting. Retry after protected storage becomes available.')), 10000)
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      else void initialisation!.then(() => finish(), finish)
    })
    signal?.throwIfAborted()
  },
  setEffort: (effort) => { set({ effort }); void preferences.write({ effort }) },
  setLearning: async (learning) => {
    set(s => ({ learning, policyRevision: s.policyRevision + 1 }))
    resetProviderSessions()
    try { await window.electronAPI.context.configureLearning(learning) }
    catch (error) { set({ error: `Learning settings could not be saved: ${String(error)}` }); throw error }
  },
  refreshExclusions: async () => {
    const project = useProjectStore.getState(), attempt = ++exclusionGeneration
    const current = (): boolean => attempt === exclusionGeneration
      && useProjectStore.getState().workspaceEpoch === project.workspaceEpoch
      && useProjectStore.getState().projectId === project.projectId
    // Opening a project hydrates twice (blank scope, then recovered memory).
    // A superseded column-policy load must not report the newer load's pending
    // state as an empty Error, or disable all sources after it succeeds.
    try {
      const lease = await window.electronAPI.context.lease()
      if (!current()) return
      if (lease.projectId !== project.projectId) throw new Error('The workspace is changing. Retry source privacy settings once the project has opened.')
      const savedExclusions = await window.electronAPI.context.exclusions(lease.id)
      if (!current()) return
      const { useColumnDisclosureStore } = await import('./column-disclosure')
      if (!current()) return
      await useColumnDisclosureStore.getState().hydrate(lease.id)
      if (!current()) return
      if (!useColumnDisclosureStore.getState().loaded) throw new Error(useColumnDisclosureStore.getState().error || 'Column privacy settings are still loading. Retry source privacy settings.')
      await refreshFolderSources(window.electronAPI.context, lease.id)
      if (!current()) return
      const savedIds = new Set(get().savedExclusions.flatMap(selection => selection.ids))
      const transient = get().excluded.filter(id => !savedIds.has(id))
      set({ scopeLease: lease.id, excluded: [...new Set([...transient, ...savedExclusions.flatMap(selection => selection.ids)])], savedExclusions, exclusionsLoaded: true,
        ...(get().error?.startsWith('Source privacy settings unavailable:') ? { error: null } : {}) })
    } catch (error) {
      if (current()) set({ exclusionsLoaded: false, error: `Source privacy settings unavailable: ${error instanceof Error ? error.message : String(error)}. Retry local memory to reload protected settings; retrieval stays disabled until they load.` })
    }
  },
  exclude: async (id, sourceScope, projectId) => {
    const project = useProjectStore.getState()
    const scope = id.startsWith('result:') ? null : exclusionScope(sourceScope, projectId)
    if (scope !== 'application' && scope !== 'global' && projectId !== project.projectId) throw new Error('SCOPE_CHANGED: open the source’s project before changing its exclusion.')
    const excluded = !get().excluded.includes(id)
    set(s => ({ excluded: excluded ? [...s.excluded, id] : s.excluded.filter(x => x !== id), policyRevision: s.policyRevision + 1 }))
    resetProviderSessions()
    if (!scope) return // Scratch/source-result exclusions are transient.
    try {
      await window.electronAPI.context.exclude({ id, scope, projectId: scope === 'project' ? projectId : null, lease: get().projectLease, excluded })
      if (useProjectStore.getState().workspaceEpoch === project.workspaceEpoch) await get().refreshExclusions()
    } catch (error) {
      if (useProjectStore.getState().workspaceEpoch === project.workspaceEpoch) {
        // A failed allow must not pretend the persistent privacy choice changed.
        if (!excluded) set(s => ({ excluded: [...new Set([...s.excluded, id])], policyRevision: s.policyRevision + 1 }))
        set({ error: `Source exclusion could not be saved: ${String(error)}. The source remains excluded locally; retry when protected storage is available.` })
      }
      throw error
    }
  },
  revokeDelivery: () => { set(s => ({ policyRevision: s.policyRevision + 1 })); resetProviderSessions() },
  setTrace: (trace) => {
    get().sweepTraces()
    const recordedAt = get().traces[trace.turnId]?.recordedAt ?? trace.recordedAt ?? Date.now()
    if (!traceExpired({ ...trace, recordedAt }, 0, Date.now(), get().traceRetentionDays)) set(s => ({ traces: { ...Object.fromEntries(Object.entries(s.traces).slice(-49)), [trace.turnId]: { ...trace, recordedAt } } }))
  },
  recordTraceUsage: (trace, provider, final = false, authority) => {
    const inputs = inferenceUsageInputs(trace, provider, final)
    if (!inputs.length) return Promise.resolve()
    const active = (): boolean => {
      const project = useProjectStore.getState()
      return project.workspaceEpoch === trace.identity.workspaceEpoch && project.projectId === trace.identity.projectId
    }
    const write = usageWrites.then(async () => {
      if (!authority) throw new Error('No host authority was captured before inference.')
      await window.electronAPI.context.recordInferenceUsage(inputs, authority)
    }).catch(error => {
      if (active()) set({ error: `Durable inference accounting is unavailable: ${String(error)}. Available chat receipts remain; totals may be incomplete.` })
    })
    usageWrites = write
    return write
  },
  prepareTraceUsage: (trace, provider, outputTokens, authority) => {
    const input = inferenceUsageInputs(trace, provider).find(input => input.invocation === trace.invocations.length && input.attempt === 0 && input.accountingScope === 'invocation')
    if (!input || !authority) return Promise.reject(new Error('Prepare numeric invocation accounting before sending.'))
    const completed = inferenceUsageInputs(trace, provider, true).filter(receipt => receipt.invocation < input.invocation)
    // Drain streaming snapshots before finalising earlier invocations. Otherwise
    // a slower queued observation can conflict with the newly final receipt.
    const write = usageWrites.then(async () => {
      if (completed.length) await window.electronAPI.context.recordInferenceUsage(completed, authority)
      await window.electronAPI.context.prepareInferenceUsage(input, outputTokens, authority)
    })
    usageWrites = write.catch(() => undefined)
    return write
  },
  loadProject: (context, committedRevision, projectLease) => {
    clearFolderSources()
    clearResultCache()
    set(s => ({ scopeLease: null, projectContext: context ?? { version: 1, revision: 0, memories: [] }, committedRevision: committedRevision ?? context?.revision ?? 0, projectLease: projectLease ?? null, traces: {}, excluded: [], exclusionsLoaded: false, savedExclusions: [], notice: null, policyRevision: s.policyRevision + 1 }))
    void get().refreshExclusions()
  },
  stageProject: async () => {
    const { projectId } = useProjectStore.getState()
    if (!projectId) return // Legacy bundle drafts get an identity on first save.
    const { committedRevision, projectContext, projectLease } = get()
    try {
      if (!projectLease) throw new Error('SCOPE_CHANGED: reopen the project.')
      await window.electronAPI.context.stageProject(projectId, committedRevision, projectContext, projectLease)
    }
    catch (error) {
      set({ error: `Memory is unsaved and recovery is unavailable: ${String(error)}. Save the project bundle to keep it.` })
      throw error
    }
  },
  discardProjectDraft: async () => {
    const { projectId } = useProjectStore.getState()
    if (projectId && get().projectLease) await window.electronAPI.context.discardProject(projectId, get().projectLease!)
  },
  remember: async (statement, scope, evidence = []) => {
    if (redactContext(statement) !== statement) throw new Error('Credentials cannot be remembered. Remove the secret and try again.')
    if (!statement.trim() || statement.length > 4000) throw new Error('Use a memory between 1 and 4,000 characters.')
    const project = useProjectStore.getState()
    if (scope === 'project' && !project.path) throw new Error('Save this workspace as a project to keep project memory.')
    const existing = (scope === 'global' ? get().globals : get().projectContext.memories).find(record => ['active', 'candidate'].includes(record.status) && record.statement.toLocaleLowerCase() === statement.trim().toLocaleLowerCase())
    if (existing) {
      if (existing.status === 'candidate') { await get().accept(existing.id); return { ...existing, status: 'active', revision: existing.revision + 1 } }
      return existing
    }
    const now = new Date().toISOString()
    const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope, projectId: scope === 'project' ? project.projectId : null, category: scope === 'project' ? 'decision' : 'preference', statement: statement.trim(), evidence, assertion: 'user-declared', createdAt: now, updatedAt: now, status: 'active', supersedes: [] }
    if (scope === 'global') {
      const saved = await window.electronAPI.context.saveGlobal(record)
      set({ globals: await window.electronAPI.context.listGlobal(), notice: `Remembered: ${saved.statement}. Edit or Forget in the Memory library.` })
      return saved
    }
    const update = applyMemoryRevision(get().projectContext.memories, record)
    set(s => ({ projectContext: { version: 1, revision: s.projectContext.revision + 1, memories: update.records }, notice: `Remembered: ${record.statement} (awaiting project save). Edit or Forget in the Memory library.` }))
    project.markDirty()
    await get().stageProject()
    return update.record
  },
  forget: async (id, preserveActiveTurn = false, extraSources = []) => {
    const project = useProjectStore.getState(), lease = get().projectLease
    const memory = [...get().globals, ...get().projectContext.memories].find(m => m.id === id)
    if (!memory) throw new Error('This memory is unavailable. Refresh the library.')
    // A tombstone precedes removal, including project drafts. Old bundles must
    // not resurrect a forgotten record on this profile.
    const receipt = await window.electronAPI.context.forget(id, { scope: memory.scope, projectId: memory.projectId, lease, sources: [...new Set([...memory.evidence.filter(source => /^[a-zA-Z0-9_:.-]{1,128}$/.test(source)), ...extraSources])] })
    if (memory.scope === 'project' && (useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch || get().projectLease !== lease)) throw new Error('SCOPE_CHANGED: the old project memory was forgotten; reopen that project to inspect its state.')
    const withoutMemory = (trace: ContextTrace): ContextTrace => ({ ...trace, selected: trace.selected.filter(source => source.sourceId !== `memory:${id}`) })
    set(s => ({ globals: s.globals.filter(m => m.id !== id), ...(memory.scope === 'project' ? { projectContext: { version: 1 as const, revision: s.projectContext.revision + 1, memories: s.projectContext.memories.filter(m => m.id !== id) } } : {}), traces: Object.fromEntries(Object.entries(s.traces).map(([key, trace]) => [key, withoutMemory(trace)])), policyRevision: s.policyRevision + 1, notice: receipt?.managed === 'pending' ? `Memory forgotten from future retrieval. ${receipt.recovery}` : 'Memory forgotten from future retrieval. Already transmitted content and older exports cannot be recalled.' }))
    useAiStore.setState(s => ({ chats: s.chats.map(chat => {
      if (!chat.messages.some(message => message.contextTrace?.selected.some(source => source.sourceId === `memory:${id}`))) return chat
      return { ...chat, messages: chat.messages.map(message => message.contextTrace?.selected.some(source => source.sourceId === `memory:${id}`) ? { ...message, contextTrace: withoutMemory(message.contextTrace) } : message) }
    }) }))
    resetProviderSessions(!preserveActiveTurn)
    if (memory.scope === 'project') { useProjectStore.getState().markDirty(); await get().stageProject() }
    return receipt
  },
  forgetEverywhere: async plan => {
    const scope = (): TranscriptForgetScope => {
      const project = useProjectStore.getState()
      return { workspaceEpoch: project.workspaceEpoch, projectId: project.projectId, savedProject: !!project.path, activeChatId: useAiStore.getState().activeChatId }
    }
    const memory = (): MemoryRecord | undefined => [...get().globals, ...get().projectContext.memories].find(record => record.id === plan.memoryId)
    assertTranscriptForget(plan, memory(), useAiStore.getState().chats, scope())
    get().revokeDelivery()
    const receipt = await get().forget(plan.memoryId, false, plan.sourceIds)
    assertTranscriptForget(plan, memory(), useAiStore.getState().chats, scope(), true)
    useAiStore.setState(state => ({ chats: applyTranscriptForget(plan, state.chats) }))
    set({ traces: {}, notice: `Memory and ${plan.copies.length} selected message copies removed from this workspace. Other projects, exports, backups and already transmitted content are unaffected.${receipt?.managed === 'pending' ? ` ${receipt.recovery}` : ''}` })
    if (useProjectStore.getState().path && plan.copies.length) useProjectStore.getState().markDirty()
    useSessionStore.getState().addConsoleEntry('info', `Context memory: removed ${plan.copies.length} reviewed transcript copies.`)
  },
  deleteConversation: async (chatId, keepIndependent = false) => {
    const project = useProjectStore.getState()
    const chat = useAiStore.getState().chats.find(chat => chat.id === chatId)
    if (!chat) throw new Error('This conversation is unavailable. Reopen the chat list.')
    await get().waitForReady()
    if (useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch) throw new Error('SCOPE_CHANGED: review the deletion in the original workspace.')
    if (chat.messages.length && !get().personalMemoryAvailable) {
      if (!get().memoryStoreAbsent || !(await window.electronAPI.context.storageStatus()).empty) throw new Error('Restore protected memory storage before deleting this chat so its derived memories can also be removed.')
    }
    const { dependent, independent } = conversationMemories(chat, [...get().globals, ...get().projectContext.memories])
    const kept = new Set(keepIndependent ? independent.map(record => record.id) : [])
    const removed = new Set<string>()
    const check = (): void => {
      const current = useAiStore.getState().chats.find(current => current.id === chatId)
      if (useProjectStore.getState().workspaceEpoch !== project.workspaceEpoch || !current
          || current.messages.length !== chat.messages.length || current.messages.some((message, index) => message.id !== chat.messages[index].id || message.content !== chat.messages[index].content)) throw new Error('SCOPE_CHANGED: the conversation changed. Review the deletion again.')
      const records = [...get().globals, ...get().projectContext.memories]
      if (dependent.some(record => !removed.has(record.id) && records.find(current => current.id === record.id)?.revision !== record.revision)) throw new Error('SCOPE_CHANGED: a derived memory changed. Review the deletion again.')
    }
    check()
    for (const record of dependent) {
      check()
      if (!kept.has(record.id)) { await get().forget(record.id); removed.add(record.id) }
    }
    check()
    // Delete the transcript only after durable removal succeeded. A partial
    // failure keeps the chat reviewable and forgotten records remain blocked.
    useAiStore.getState().cancelStream()
    useAiStore.getState().deleteChat(chatId)
    set(s => ({ traces: Object.fromEntries(Object.entries(s.traces).filter(([, trace]) => trace.identity.chatId !== chatId)),
      notice: `Conversation deleted; ${dependent.length - kept.size} derived memories forgotten.${kept.size ? ` ${kept.size} edited or pinned memories retained without their source chat.` : ''}` }))
  },
  edit: async (id, statement) => {
    const memory = [...get().globals, ...get().projectContext.memories].find(m => m.id === id)
    if (!memory) throw new Error('This memory is unavailable. Refresh the library.')
    if (!statement.trim() || statement.length > 4000 || redactContext(statement) !== statement) throw new Error('Use a short statement without credentials.')
    const editedAt = new Date().toISOString()
    let record: MemoryRecord = { ...memory, statement: statement.trim(), revision: memory.revision + 1, updatedAt: editedAt, editedAt }
    if (memory.scope === 'global') record = await window.electronAPI.context.saveGlobal(record, memory.status === 'candidate')
    const globals = memory.scope === 'global' ? await window.electronAPI.context.listGlobal() : get().globals
    set(s => ({ globals, ...(memory.scope === 'project' ? { projectContext: { ...s.projectContext, revision: s.projectContext.revision + 1, memories: applyMemoryRevision(s.projectContext.memories, record).records } } : {}), policyRevision: s.policyRevision + 1,
      notice: `Memory corrected: ${record.statement}${memory.scope === 'project' ? ' (awaiting project save)' : ''}` }))
    resetProviderSessions()
    if (memory.scope === 'project') { useProjectStore.getState().markDirty(); await get().stageProject() }
  },
  accept: async (id) => {
    const memory = [...get().globals, ...get().projectContext.memories].find(record => record.id === id && record.status === 'candidate')
    if (!memory) throw new Error('This suggestion is unavailable. Refresh the library.')
    if (Date.now() - Date.parse(memory.createdAt) > 30 * 86400_000) throw new Error('This suggestion expired. Add a new explicit memory if it is still useful.')
    let record = { ...memory, status: 'active' as const, revision: memory.revision + 1, updatedAt: new Date().toISOString() }
    if (memory.scope === 'global') record = await window.electronAPI.context.saveGlobal(record) as typeof record
    const globals = memory.scope === 'global' ? await window.electronAPI.context.listGlobal() : get().globals
    set(s => ({ globals, ...(memory.scope === 'project' ? { projectContext: { ...s.projectContext, revision: s.projectContext.revision + 1, memories: applyMemoryRevision(s.projectContext.memories, record).records } } : {}), notice: `Remembered: ${record.statement}${record.scope === 'project' ? ' (awaiting project save)' : ''}` }))
    if (memory.scope === 'project') { useProjectStore.getState().markDirty(); await get().stageProject() }
  },
  setPinned: async (id, pinned) => {
    const memory = [...get().globals, ...get().projectContext.memories].find(record => record.id === id && record.status === 'active')
    if (!memory) throw new Error('Accept the memory before marking it Always apply.')
    let record = { ...memory, pinned, revision: memory.revision + 1, updatedAt: new Date().toISOString() }
    if (memory.scope === 'global') record = await window.electronAPI.context.saveGlobal(record) as typeof record
    set(s => ({ globals: s.globals.map(m => m.id === id ? record : m), ...(memory.scope === 'project' ? { projectContext: { ...s.projectContext, revision: s.projectContext.revision + 1, memories: s.projectContext.memories.map(m => m.id === id ? record : m) } } : {}), policyRevision: s.policyRevision + 1 }))
    resetProviderSessions()
    if (memory.scope === 'project') { useProjectStore.getState().markDirty(); await get().stageProject() }
  },
  learnFromTurn: async (messageId, text) => {
    const candidate = memoryCandidate(text)
    if (!candidate) return
    const project = useProjectStore.getState(), settings = get().learning
    if (!project.path && !settings.scratchLearning) return
    if (candidate.scope === 'project' && (!project.path || settings.projectLearning === 'asked')) return
    if (candidate.scope === 'global' && settings.globalLearning === 'asked') return
    const isCurrent = (): boolean => useProjectStore.getState().workspaceEpoch === project.workspaceEpoch && get().learning === settings
    try {
      if (candidate.scope === 'global') {
        const record = await window.electronAPI.context.learnGlobal(messageId, text)
        if (!record || !isCurrent()) return
        const globals = await window.electronAPI.context.listGlobal()
        if (!isCurrent()) return
        set({ globals, notice: `${record.status === 'candidate' ? 'Suggested memory' : 'Remembered'}: ${record.statement}. Review in the Memory library.` })
      } else {
        const permitted = await window.electronAPI.context.filterLearningSources([messageId])
        if (!permitted.length || !isCurrent()) return
        if (get().projectContext.memories.some(m => ['active', 'candidate'].includes(m.status) && m.statement.toLocaleLowerCase() === candidate.statement.toLocaleLowerCase())) return
        const now = new Date().toISOString()
        const record: MemoryRecord = { id: crypto.randomUUID(), revision: 1, scope: 'project', projectId: project.projectId, category: candidate.category, statement: candidate.statement, evidence: [messageId], assertion: 'user-declared', createdAt: now, updatedAt: now, status: settings.projectLearning === 'automatic' ? 'active' : 'candidate', supersedes: [] }
        set(s => ({ projectContext: { ...s.projectContext, revision: s.projectContext.revision + 1, memories: applyMemoryRevision(s.projectContext.memories, record).records }, notice: `${record.status === 'candidate' ? 'Suggested project memory' : 'Remembered on project save'}: ${record.statement}. Review in the Memory library.` }))
        project.markDirty()
        await get().stageProject()
      }
    } catch (error) { set({ error: `Memory learning unavailable: ${String(error)}. Manual remembering remains available.` }) }
  },
}))
