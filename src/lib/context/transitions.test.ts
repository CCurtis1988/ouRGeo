import { expect, it } from 'vitest'
import { createWorkspaceQueue } from './transitions'

it('waits for an old R operation before activating another workspace', async () => {
  const enqueue = createWorkspaceQueue(), events: string[] = []
  let complete!: () => void
  const first = enqueue(async () => {
    events.push('old load started')
    await new Promise<void>(resolve => { complete = resolve })
    events.push('old load finished')
  })
  const second = enqueue(async () => { events.push('new project activated') })
  await Promise.resolve()
  expect(events).toEqual(['old load started'])
  complete()
  await Promise.all([first, second])
  expect(events).toEqual(['old load started', 'old load finished', 'new project activated'])
})

it('allows a later open after a failed bundle without overlapping mutations', async () => {
  const enqueue = createWorkspaceQueue()
  await expect(enqueue(async () => { throw new Error('bad bundle') })).rejects.toThrow('bad bundle')
  await expect(enqueue(async () => 'scratch')).resolves.toBe('scratch')
})
