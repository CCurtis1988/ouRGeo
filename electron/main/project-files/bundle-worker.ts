import { parentPort, workerData } from 'node:worker_threads'
import { readBundle, writeBundle, type BundleWrite } from './bundle'
const task = workerData as { kind: 'open'; path: string; work: string } | { kind: 'save'; input: BundleWrite; work: string }
const controller = new AbortController()
parentPort?.on('message', message => { if (message === 'cancel') controller.abort() })
void (task.kind === 'open' ? readBundle(task.path, task.work, controller.signal) : writeBundle(task.input, task.work, controller.signal)).then(result => parentPort?.postMessage({ result })).catch(error => parentPort?.postMessage({ error: String(error) }))
