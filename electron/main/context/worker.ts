import { parentPort, workerData } from 'node:worker_threads'
import { MemoryStorage } from './storage'

const store = new MemoryStorage(workerData.path, Buffer.from(workerData.key))
parentPort!.on('message', (message: { id: number; op: string; value?: unknown }) => {
  try {
    let result: unknown
    switch (message.op) {
      case 'list': result = store.list('global'); break
      case 'scopeSnapshot': result = store.scopeSnapshot(String(message.value)); break
      case 'scopeSnapshotCurrent': {
        const value = message.value as { scope: string; generation: number }
        result = store.scopeSnapshotCurrent(value.scope, value.generation); break
      }
      case 'connections': result = store.connections(); break
      case 'connectionCredential': result = store.credential(String(message.value)); break
      case 'claimOutbox': {
        const value = message.value as { now: number; scopes: string[] }
        result = store.claimJob(value.now, value.scopes); break
      }
      case 'claimPendingOutbox': {
        const value = message.value as { now: number; scopes: string[] }
        result = store.claimPendingJob(value.now, value.scopes); break
      }
      case 'currentOutbox': {
        const value = message.value as { id: string; scopes: string[] }
        result = store.currentJob(value.id, value.scopes); break
      }
      case 'completeOutbox': {
        const value = message.value as { id: string; receipt: Parameters<MemoryStorage['completeJob']>[1]; now: number }
        result = store.completeJob(value.id, value.receipt, value.now); break
      }
      case 'removeConnection': result = store.removeConnection(String(message.value)); break
      case 'saveConnection': {
        const value = message.value as { connection: Parameters<MemoryStorage['saveConnection']>[0]; token?: string }
        result = store.saveConnection(value.connection, value.token); break
      }
      case 'save': result = store.save(message.value as Parameters<MemoryStorage['save']>[0]); break
      case 'forget': {
        const deletion = message.value as { id: string; sources: string[]; scope: string }
        result = store.forget(deletion.id, deletion.sources, deletion.scope); break
      }
      case 'learn': result = store.learn(message.value as Parameters<MemoryStorage['learn']>[0]); break
      case 'filterLearningSources': result = store.filterLearningSources(message.value as string[]); break
      case 'saveFileLinks': {
        const input = message.value as { projectId: string; links: Parameters<MemoryStorage['saveFileLinks']>[1] }
        result = store.saveFileLinks(input.projectId, input.links); break
      }
      case 'fileLinks': result = store.fileLinks(String(message.value)); break
      case 'projectLocation': result = store.projectLocation(String(message.value)); break
      case 'saveProjectLocation': {
        const input = message.value as { projectId: string; path: string }
        result = store.saveProjectLocation(input.projectId, input.path); break
      }
      case 'registerProjectReferences': {
        const input = message.value as { projectId: string; ids: string[] }
        result = store.registerProjectReferences(input.projectId, input.ids); break
      }
      case 'filter': result = store.filterDeleted(message.value as string[]); break
      case 'exclusions': result = store.exclusions(String(message.value)); break
      case 'exclude': {
        const input = message.value as { scope: string; id: string; excluded: boolean }
        result = store.exclude(input.scope, input.id, input.excluded); break
      }
      case 'search': result = store.search(String(message.value)); break
      case 'stageProject': {
        const draft = message.value as { projectId: string; baseRevision: number; context: Parameters<MemoryStorage['stageProject']>[2] }
        result = store.stageProject(draft.projectId, draft.baseRevision, draft.context); break
      }
      case 'recoverProject': {
        const source = message.value as { projectId: string; baseRevision: number }
        result = store.recoverProject(source.projectId, source.baseRevision); break
      }
      case 'discardProject': result = store.discardProject(String(message.value)); break
      case 'commitProject': {
        const saved = message.value as { projectId: string; context: Parameters<MemoryStorage['commitProject']>[1] }
        result = store.commitProject(saved.projectId, saved.context); break
      }
      default: throw new Error('Unsupported memory operation.')
    }
    parentPort!.postMessage({ id: message.id, result })
  } catch (error) { parentPort!.postMessage({ id: message.id, error: String(error) }) }
})
