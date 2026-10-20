import { beforeEach, expect, it, vi } from 'vitest'
import { thinkingKey } from '@/lib/ai-thinking'
let files: Map<string, string>
let fail: boolean
beforeEach(() => {
  vi.resetModules(); files = new Map(); fail = false
  vi.stubGlobal('window', { electronAPI: { app: { getDataPath: async () => '/data' }, file: {
    read: async (path: string) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) },
    write: async (path: string, contents: string) => { if (fail) throw new Error('ENOSPC'); files.set(path, contents) },
  } } })
})
it('keeps provider/model choices through overlapping updates, reopening, and resetting one model', async () => {
  const { useAiThinkingStore: store } = await import('./ai-thinking')
  await Promise.all([store.getState().setEffort('openai', 'o3', 'high'), store.getState().setEffort('openai-subscription', 'o3', 'low')])
  vi.resetModules()
  const { useAiThinkingStore: reopened } = await import('./ai-thinking')
  await reopened.getState().init()
  expect(reopened.getState().selections).toEqual({ [thinkingKey('openai', 'o3')]: 'high', [thinkingKey('openai-subscription', 'o3')]: 'low' })
  await reopened.getState().setEffort('openai', 'o3', 'default')
  expect(reopened.getState().selections).toEqual({ [thinkingKey('openai-subscription', 'o3')]: 'low' })
})
it('retains the saved choice and shows recovery when the disk write fails', async () => {
  const { useAiThinkingStore: store } = await import('./ai-thinking')
  await store.getState().setEffort('openai', 'o3', 'low')
  fail = true
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await expect(store.getState().setEffort('openai', 'o3', 'high')).rejects.toThrow('could not be saved')
  expect(store.getState().selections[thinkingKey('openai', 'o3')]).toBe('low')
  expect(store.getState().error).toContain('retry')
  vi.restoreAllMocks()
})
it('tolerates missing or malformed settings and drops malformed values', async () => {
  files.set('/data/ai-thinking.json', JSON.stringify({ selections: { 'valid': 'high', 'bad': {}, 'long': 'a'.repeat(80) } }))
  const { useAiThinkingStore: store } = await import('./ai-thinking')
  await store.getState().init()
  expect(store.getState().selections).toEqual({ valid: 'high' })
})
