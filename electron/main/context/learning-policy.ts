import { app } from 'electron'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultLearning, learningSettings, type MemoryLearningSettings } from '../../../src/lib/context/learning'

let current = { ...defaultLearning }
let revision = 0
let loading: Promise<void> | undefined
let writing: Promise<void> = Promise.resolve()
const path = (): string => join(app.getPath('userData'), 'context-learning.json')

export async function getLearningPolicy(): Promise<{ settings: MemoryLearningSettings; revision: number }> {
  if (!loading) loading = (async () => {
    try { current = learningSettings(JSON.parse(await readFile(path(), 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Memory learning settings are unavailable. Repair context-learning.json or restore a backup.') }
  })()
  await loading
  return { settings: { ...current }, revision }
}
export function learningPolicyRevision(): number { return revision }
export async function configureLearningPolicy(input: unknown): Promise<MemoryLearningSettings> {
  await getLearningPolicy()
  current = learningSettings(input)
  revision++
  const snapshot = { ...current }
  // Revocation is effective in memory before disk I/O. Serial atomic writes
  // keep a second setting change from splicing or overwriting the first.
  const task = writing.catch(() => undefined).then(async () => {
    const temporary = `${path()}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' })
    await rename(temporary, path())
  })
  writing = task
  await task
  return snapshot
}
