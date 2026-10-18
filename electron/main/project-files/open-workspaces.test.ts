import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectOpenWorkspaces } from './open-workspaces'

describe('managed project-open temporary workspaces', () => {
  it('releases extracted R snapshots without deleting saved projects or file drafts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ourgeo-open-cleanup-'))
    try {
      const pool = new ProjectOpenWorkspaces(root)
      await writeFile(join(root, 'saved.ourgeoproj'), 'saved original')
      await mkdir(join(root, 'project-files-drafts'))
      await writeFile(join(root, 'project-files-drafts', 'original'), 'recoverable draft')
      const opened = await pool.create(7)
      const snapshot = await open(join(opened.path, 'environment.RData'), 'w')
      try { await snapshot.truncate(100 * 1024 * 1024) } finally { await snapshot.close() }
      await pool.run(opened.token, async () => undefined)
      expect(pool.pending).toBe(true)
      await expect(pool.release(opened.path, 7)).resolves.toBeUndefined()
      await expect(pool.release(opened.token, 99)).rejects.toThrow('another window')
      expect(await readdir(opened.path)).toContain('environment.RData')
      await pool.release(opened.token, 7)
      await pool.release(opened.token, 7)
      expect(await readdir(root)).toEqual(expect.arrayContaining(['saved.ourgeoproj', 'project-files-drafts']))
      expect((await readdir(root)).some(name => name.startsWith('project-open-'))).toBe(false)
      expect(await readFile(join(root, 'saved.ourgeoproj'), 'utf8')).toBe('saved original')
      expect(await readFile(join(root, 'project-files-drafts', 'original'), 'utf8')).toBe('recoverable draft')
      expect(pool.pending).toBe(false)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('removes partial output when an unpack or validation task fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ourgeo-open-cleanup-'))
    try {
      const pool = new ProjectOpenWorkspaces(root), opened = await pool.create(7)
      await expect(pool.run(opened.token, async () => {
        await mkdir(join(opened.path, 'blobs'))
        await writeFile(join(opened.path, 'environment.RData'), 'partial snapshot')
        throw new Error('corrupt archive')
      })).rejects.toThrow('corrupt archive')
      await pool.release(opened.token, 7)
      expect(await readdir(root)).toEqual([])
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('aborts and waits for in-flight workers before quit removes their managed directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ourgeo-open-cleanup-'))
    try {
      const pool = new ProjectOpenWorkspaces(root), opened = await pool.create(7)
      let settled = false
      const task = pool.run(opened.token, async () => {
        await new Promise<void>(resolve => opened.signal.addEventListener('abort', () => resolve(), { once: true }))
        await writeFile(join(opened.path, 'worker-final-output'), 'last write before exit')
        settled = true
      })
      await pool.dispose(); await task
      expect(settled).toBe(true)
      expect(pool.pending).toBe(false)
      expect(await readdir(root)).toEqual([])
      await expect(pool.create(7)).rejects.toThrow('application is closing')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
