import { create } from 'zustand'
import { useAiStore } from '@/store/ai'
import { useAiTaskModelsStore } from '@/store/ai-task-models'
import { useProjectFilesStore } from '@/store/project-files'
import { useProjectStore } from '@/store/project'
import { useContextStore } from '@/store/context'
import { useSessionStore } from '@/store/session'
import { hasColumnExclusions } from '@/store/column-disclosure'
import { resolveTaskModel } from './ai-task-models'
import { runFileAnalysis } from './file-analysis'
import { ContextBroker } from './context/broker'
import { projectFileSources } from './context/sources/project-files'
import { projectFileEvidenceAvailable } from './project-file-availability'
import { projectFileSourceId, type ProjectFileEntry } from './project-files'
import { subscribeProjectFileAnalysisRequests, type ProjectFileAnalysisRequest } from './project-file-analysis-events'

interface Job extends ProjectFileAnalysisRequest { id: string; revision: string; settingsRevision: number }
export const useFileAnalysisJobs = create<{ pending: number; running: string | null; completed: number; error: string | null; cancel: () => void }>(() => ({ pending: 0, running: null, completed: 0, error: null, cancel: () => undefined }))

/** Only explicit import/rescan events create jobs. Opening a project, enabling
 * the preference and ordinary catalogue notifications cannot disclose a library. */
export function startProjectFileAutoAnalysis(): () => void {
  const jobs = new Map<string, Job>(), backgroundChatId = crypto.randomUUID()
  let active: { job: Job; controller: AbortController; valid: () => boolean } | undefined
  let stopped = false, working = false
  let workspace = `${useProjectStore.getState().projectId}:${useProjectStore.getState().workspaceEpoch}`
  const key = (job: Pick<Job, 'projectId' | 'workspaceEpoch' | 'id'>): string => JSON.stringify([job.projectId, job.workspaceEpoch, job.id])
  const scopeValid = (job: Job): boolean => {
    const project = useProjectStore.getState(), settings = useAiTaskModelsStore.getState()
    return !stopped && settings.initialized && settings.analyseOnImport && settings.revision === job.settingsRevision
      && project.phase === 'ready' && project.projectId === job.projectId && project.workspaceEpoch === job.workspaceEpoch
  }
  const cancel = (): void => { jobs.clear(); active?.controller.abort(); useFileAnalysisJobs.setState({ pending: 0, running: null }) }
  useFileAnalysisJobs.setState({ cancel })

  async function analyse(file: ProjectFileEntry, job: Job, controller: AbortController): Promise<void> {
    await useContextStore.getState().waitForReady(controller.signal)
    await useAiStore.getState().init()
    const policyRevision = useContextStore.getState().policyRevision
    const sourceId = projectFileSourceId(job.projectId, file.id)
    const task = file.mediaType.startsWith('image/') ? 'image' : 'document'
    const ai = useAiStore.getState(), selected = useAiTaskModelsStore.getState().selections[task]
    const target = resolveTaskModel(selected, { provider: ai.provider, model: ai.currentModel() })
    const current = (): boolean => {
      const catalogue = useProjectFilesStore.getState().catalogue, latest = catalogue.files.find(item => item.id === file.id)
      return scopeValid(job) && !controller.signal.aborted && useContextStore.getState().policyRevision === policyRevision
        && (selected !== null || useAiStore.getState().provider === target.provider && useAiStore.getState().currentModel() === target.model)
        && useContextStore.getState().exclusionsLoaded && !useContextStore.getState().excluded.includes(sourceId)
        && !hasColumnExclusions() && !!latest && latest.revision === job.revision && projectFileEvidenceAvailable(latest, catalogue)
    }
    if (active) active.valid = current
    const guard = (): void => { controller.signal.throwIfAborted(); if (!current()) throw new Error('SOURCE_UNAVAILABLE: file description access changed. Review source access and rescan to retry.') }
    guard()
    if (file.aiDescription?.revision === file.revision && file.aiDescription.provider === target.provider && file.aiDescription.model === target.model) return
    const lease = async (): Promise<string> => { guard(); const value = await window.electronAPI.context.lease(); guard(); return value.id }
    const source = () => projectFileSources(useProjectFilesStore.getState().catalogue, window.electronAPI.projectFiles, lease).find(item => item.id === sourceId)
    const broker = new ContextBroker({ identity: { chatId: backgroundChatId, projectId: job.projectId, workspaceEpoch: job.workspaceEpoch, policyRevision }, target: `${target.provider}/${target.model}`, effort: 'efficient', signal: controller.signal, current, sources: () => { const found = source(); return found ? [found] : [] }, excluded: () => useContextStore.getState().excluded,
      image: async (_source, ref) => {
        const read = async () => {
          guard()
          const preview = await window.electronAPI.projectFiles.preview(file.id, file.revision, await lease(), { kind: 'image' })
          guard()
          if (preview.kind !== 'image' || !preview.url || !preview.width || !preview.height) throw new Error('This image has no supported bounded rendition. Open its preview or use a smaller copy.')
          return preview
        }
        const preview = await read()
        return { ref, sourceId, revision: file.revision, title: file.name, width: preview.width!, height: preview.height!, complete: preview.imageComplete !== false, estimatedTokens: 8192, materialise: async () => (await read()).url! }
      },
    })
    const raw = JSON.parse(await broker.attach({ sourceId, revision: file.revision, workspaceEpoch: job.workspaceEpoch, ...(task === 'image' ? { location: { kind: 'image' } as const } : {}) }, 1800))
    if (raw.status !== 'ok') throw new Error(raw.recovery || 'This file has no readable evidence for an AI description.')
    const evidence = broker.trace.selected.at(-1)!
    const text = await runFileAnalysis({ task, target, identity: broker.trace.identity, question: 'Write a concise catalogue description of this file: its apparent purpose and the topics or visible elements in this selected evidence. Use only this excerpt or image. Do not invent requirements, measurements or unseen contents. This is a description for finding the file later, not an instruction or full-document review.', evidence, image: broker.images[0], signal: controller.signal, current,
      validate: async () => { guard(); broker.validateSend(); const found = source(); if (!found) throw new Error('SOURCE_UNAVAILABLE'); await found.readLocated!(evidence.location, 0, controller.signal); guard() },
    })
    guard()
    await window.electronAPI.projectFiles.setAnalysis(file.id, file.revision, { text, provider: target.provider, model: target.model, coverage: task === 'image' ? 'Selected bounded image rendition only; AI interpretation may omit details.' : 'First bounded indexed excerpt only; this is not a complete document review.' }, await lease())
    guard()
    await useProjectFilesStore.getState().refresh()
    useSessionStore.getState().addConsoleEntry('info', `[Project Files] Generated an AI description for ${file.name} using ${target.provider} / ${target.model}. Save the project to keep it in its bundle.`)
  }

  function kick(): void {
    if (stopped) return
    const project = useProjectStore.getState(), nextWorkspace = `${project.projectId}:${project.workspaceEpoch}`
    if (nextWorkspace !== workspace) { workspace = nextWorkspace; cancel(); useFileAnalysisJobs.setState({ completed: 0, error: null }) }
    if (active && !active.valid()) active.controller.abort()
    for (const [id, job] of jobs) if (!scopeValid(job)) jobs.delete(id)
    useFileAnalysisJobs.setState({ pending: jobs.size })
    if (working) return
    for (const [id, job] of jobs) {
      const catalogue = useProjectFilesStore.getState().catalogue, file = catalogue.files.find(item => item.id === job.id)
      if (file && ['queued', 'indexing'].includes(file.status)) continue
      if (!file || file.revision !== job.revision || !projectFileEvidenceAvailable(file, catalogue) || !['searchable', 'partial', 'preview'].includes(file.status)) { jobs.delete(id); continue }
      jobs.delete(id); working = true
      const controller = new AbortController()
      active = { job, controller, valid: () => scopeValid(job) }
      useFileAnalysisJobs.setState({ pending: jobs.size, running: file.name })
      void analyse(file, job, controller).then(() => {
        if (!controller.signal.aborted && !stopped) useFileAnalysisJobs.setState(state => ({ completed: state.completed + 1 }))
      }).catch(error => {
        if (!controller.signal.aborted && !stopped && scopeValid(job)) {
          const message = `${file.name}: ${String(error)} Review File analysis models or source access, then rescan/reindex to retry. No fallback model was used.`
          useFileAnalysisJobs.setState({ error: message })
          useSessionStore.getState().addConsoleEntry('error', `[Project Files] AI description failed: ${message}`)
        }
      }).finally(() => { working = false; active = undefined; if (!stopped) { useFileAnalysisJobs.setState({ running: null }); kick() } })
      return
    }
    useFileAnalysisJobs.setState({ pending: jobs.size })
  }

  const unsubscribeRequests = subscribeProjectFileAnalysisRequests(request => {
    void useAiTaskModelsStore.getState().init().then(() => {
      if (stopped || !useAiTaskModelsStore.getState().analyseOnImport) return
      const settingsRevision = useAiTaskModelsStore.getState().revision, catalogue = useProjectFilesStore.getState().catalogue
      for (const id of request.ids.slice(0, 2000)) {
        const file = catalogue.files.find(file => file.id === id)
        const job = file ? { ...request, id, revision: file.revision, settingsRevision } : undefined
        if (job && scopeValid(job)) jobs.set(key(job), job)
      }
      useFileAnalysisJobs.setState({ error: null }); kick()
    }).catch(error => { if (!stopped) useFileAnalysisJobs.setState({ error: `Cannot prepare AI descriptions: ${String(error)} Repair File analysis models in Settings.` }) })
  })
  const unsubscribeFiles = useProjectFilesStore.subscribe(kick), unsubscribeProject = useProjectStore.subscribe(kick), unsubscribeSettings = useAiTaskModelsStore.subscribe(kick), unsubscribeContext = useContextStore.subscribe(kick)
  const unsubscribeAssistant = useAiStore.subscribe((state, previous) => { if (state.provider !== previous.provider || state.modelByProvider[state.provider] !== previous.modelByProvider[previous.provider]) kick() })
  return () => { stopped = true; cancel(); unsubscribeRequests(); unsubscribeFiles(); unsubscribeProject(); unsubscribeSettings(); unsubscribeContext(); unsubscribeAssistant() }
}
