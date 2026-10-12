import { parentPort, workerData } from 'node:worker_threads'
import { MemoryStorage } from './storage'

const store = new MemoryStorage(workerData.path, Buffer.from(workerData.key))
parentPort!.on('message', (message: { id: number; op: string; value?: unknown }) => {
  const retentionRevision = store.retentionRevision
  try {
    let result: unknown
    switch (message.op) {
      case 'indexRepairReceipt': result = store.indexRepair; break
      case 'chatBudgetStatus': result = { policy: store.chatBudget().policy(), summary: store.chatBudget().summary() }; break
      case 'configureChatBudget': result = store.chatBudget().configure(message.value as Parameters<ReturnType<MemoryStorage['chatBudget']>['configure']>[0]); break
      case 'chatCostSummary': {
        const input = message.value as { scope: string; chatId?: string }
        result = store.chatBudget().summary(input.scope, input.chatId); break
      }
      case 'prepareInferenceUsage': {
        const input = message.value as { input: Parameters<MemoryStorage['prepareInferenceUsage']>[0]; scope: Parameters<MemoryStorage['prepareInferenceUsage']>[1]; model: string; outputTokens: number }
        result = store.prepareInferenceUsage(input.input, input.scope, input.model, input.outputTokens); break
      }
      case 'recordInferenceUsage': {
        const input = message.value as { input: Parameters<MemoryStorage['recordInferenceUsage']>[0]; scope: Parameters<MemoryStorage['recordInferenceUsage']>[1] }
        result = store.recordInferenceUsage(input.input, input.scope); break
      }
      case 'inferenceUsageSummary': {
        const input = message.value as { scope: Parameters<MemoryStorage['inferenceUsageSummary']>[0]; chatId?: string }
        result = store.inferenceUsageSummary(input.scope, input.chatId); break
      }
      case 'inferenceUsagePage': {
        const input = message.value as { scope: Parameters<MemoryStorage['inferenceUsagePage']>[0]; chatId?: string; after?: string; limit?: number }
        result = store.inferenceUsagePage(input.scope, input.chatId, input.after, input.limit); break
      }
      case 'backups': result = store.backups(); break
      case 'createBackup': result = store.createBackup(); break
      case 'inspectBackup': result = store.inspectBackup(String(message.value)); break
      case 'restoreBackup': {
        const input = message.value as { id: string; scopes: string[] }
        result = store.restoreBackup(input.id, input.scopes); break
      }
      case 'probeWritable': result = store.probeWritable(); break
      case 'sweepRetention': result = store.sweepRetention(); break
      case 'cleanupJobs': result = store.cleanupJobs(); break
      case 'cleanupStatus': result = store.cleanupStatus(message.value as string[]); break
      case 'retryCleanup': result = store.retryCleanup(message.value as string[]); break
      case 'completeCleanup': {
        const input = message.value as { job: Parameters<MemoryStorage['completeCleanup']>[0]; success: boolean; now: number }
        result = store.completeCleanup(input.job, input.success, input.now); break
      }
      case 'maintenanceStatus': result = { policy: store.maintenance().policy(), summary: store.maintenance().summary() }; break
      case 'configureMaintenance': result = store.maintenance().configure(message.value as Parameters<ReturnType<MemoryStorage['maintenance']>['configure']>[0]); break
      case 'reserveMaintenance': result = store.maintenance().reserve(message.value as Parameters<ReturnType<MemoryStorage['maintenance']>['reserve']>[0]); break
      case 'dispatchMaintenance': result = store.maintenance().markDispatched(String(message.value)); break
      case 'settleMaintenance': {
        const input = message.value as { id: string; result: Parameters<ReturnType<MemoryStorage['maintenance']>['settle']>[1]; dispatched: boolean; prepared?: boolean }
        result = store.maintenance().settle(input.id, input.result, input.dispatched, input.prepared); break
      }
      case 'list': result = store.list('global'); break
      case 'scopeSnapshot': result = store.scopeSnapshot(String(message.value)); break
      case 'bindingSnapshotCurrent': {
        const input = message.value as { bindingId: string; scope: string; generation: number }
        result = store.bindingSnapshotCurrent(input.bindingId, input.scope, input.generation); break
      }
      case 'bindingSnapshot': {
        const input = message.value as { bindingId: string; scope: string }
        result = store.bindingSnapshot(input.bindingId, input.scope); break
      }
      case 'scopeSnapshotCurrent': {
        const value = message.value as { scope: string; generation: number }
        result = store.scopeSnapshotCurrent(value.scope, value.generation); break
      }
      case 'connections': result = store.connections(); break
      case 'scopedProviderState': {
        const scopes = message.value as string[]
        result = { connections: store.connections().filter(connection => scopes.includes(connection.scope)), bindings: store.bindings().filter(binding => scopes.includes(binding.scope)) }; break
      }
      case 'importBinding': {
        const input = message.value as { binding: Parameters<MemoryStorage['importBinding']>[0]; generation: number; ids: string[]; connectionRevision: number }
        result = store.importBinding(input.binding, input.generation, input.ids, input.connectionRevision); break
      }
      case 'activateBinding': {
        const input = message.value as { binding: Parameters<MemoryStorage['activateBinding']>[0]; generation: number; ids: string[]; connectionRevision: number }
        result = store.activateBinding(input.binding, input.generation, input.ids, input.connectionRevision); break
      }
      case 'configureBinding': result = store.configureBinding(message.value as Parameters<MemoryStorage['configureBinding']>[0]); break
      case 'scopedConnection': {
        const input = message.value as { id: string; scopes: string[] }
        const connection = store.connection(input.id)
        result = connection && input.scopes.includes(connection.scope) ? connection : undefined; break
      }
      case 'scopedCredential': {
        const input = message.value as { reference: string; scopes: string[] }
        result = store.connections().some(connection => connection.credentialRef === input.reference && connection.state !== 'disconnected' && input.scopes.includes(connection.scope)) ? store.credential(input.reference) : undefined; break
      }
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
      case 'columnPolicies': result = store.columnPolicies(String(message.value)); break
      case 'saveColumnPolicies': {
        const input = message.value as { projectId: string; policy: Parameters<MemoryStorage['saveColumnPolicies']>[1] }
        result = store.saveColumnPolicies(input.projectId, input.policy); break
      }
      case 'forkColumnPolicies': {
        const input = message.value as { fromProjectId: string; projectId: string }
        result = store.forkColumnPolicies(input.fromProjectId, input.projectId); break
      }
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
    parentPort!.postMessage({ id: message.id, result, retentionChanged: retentionRevision !== store.retentionRevision })
  } catch (error) { parentPort!.postMessage({ id: message.id, error: String(error), retentionChanged: retentionRevision !== store.retentionRevision }) }
})
