import { parentPort, workerData } from 'node:worker_threads'
import { verifyMemoryBackup } from './storage-recovery'

// A damaged canonical store must not prevent read-only backup inspection.
// Authenticate large backups off the main loop, returning only counts.
const key = Buffer.from(workerData.key)
try {
  const result = verifyMemoryBackup(workerData.path, workerData.id, key, workerData.schema)
  parentPort!.postMessage({ result: { verified: true, preferences: result.preferences.length, drafts: result.drafts.length } })
} catch (error) {
  parentPort!.postMessage({ error: String(error) })
} finally { key.fill(0) }
