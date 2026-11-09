import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
vi.mock('electron', () => ({ dialog: {} }))
import { readSkillZip } from './skill-files'
import { planSkillArchive } from '../../src/lib/skills/archive'

const SKILL = '---\nname: short-report\ndescription: Use when the user wants a one-page summary.\n---\n1. Summarise.\n'
let dir = ''
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'skill-zip-')) })
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function zipOf(files: Record<string, string | Buffer>, name = 'skill.zip'): string {
  const zip = new AdmZip()
  for (const [path, body] of Object.entries(files)) zip.addFile(path, Buffer.isBuffer(body) ? body : Buffer.from(body))
  const out = join(dir, name)
  zip.writeZip(out)
  return out
}

describe('importing a skill from a zip', () => {
  it('reads a zipped skill folder with its supporting files, and nothing outside them', async () => {
    const read = await readSkillZip(zipOf({
      'short-report/SKILL.md': SKILL,
      'short-report/references/style.md': 'Keep it short.',
      'short-report/scripts/run.R': 'summary(x)',
      'short-report/notes.txt': 'not a resource folder',
      'short-report/.hidden/x.md': 'dot path',
      '__MACOSX/short-report/._SKILL.md': 'junk',
    }))
    expect(read.text).toBe(SKILL)
    expect(read.fallbackName).toBe('short-report')
    expect(read.resources).toEqual({ 'references/style.md': 'Keep it short.', 'scripts/run.R': 'summary(x)' })
  })
  it('reads a SKILL.md at the top level, named after the zip', async () => {
    const read = await readSkillZip(zipOf({ 'SKILL.md': SKILL }, 'my-skill.zip'))
    expect(read.fallbackName).toBe('my-skill')
  })
  it('leaves out binary files and says so', async () => {
    const read = await readSkillZip(zipOf({ 'SKILL.md': SKILL, 'assets/logo.png': Buffer.from([0x89, 0x50, 0, 0, 1]) }))
    expect(read.resources).toEqual({})
    expect(read.skipped).toEqual(['assets/logo.png (not text)'])
  })
  it('refuses a zip that is not a skill, or is not a zip', async () => {
    await expect(readSkillZip(zipOf({ 'README.md': 'hi' }))).rejects.toThrow(/no SKILL.md/)
    await expect(readSkillZip(zipOf({ 'a/SKILL.md': SKILL, 'b/SKILL.md': SKILL }))).rejects.toThrow(/2 skills/)
    const bad = join(dir, 'bad.zip'); writeFileSync(bad, 'not a zip')
    await expect(readSkillZip(bad)).rejects.toThrow(/could not be read as a zip/)
  })
  it('leaves out a file over 512 KB', async () => {
    const read = await readSkillZip(zipOf({ 'SKILL.md': SKILL, 'references/big.md': 'a'.repeat(600 * 1024) }))
    expect(read.resources).toEqual({})
    expect(read.skipped).toEqual(['references/big.md (over 512 KB)'])
  })
  it('does not trust a size the archive declares: the cap is on what actually inflates', async () => {
    const zip = new AdmZip()
    zip.addFile('SKILL.md', Buffer.from(SKILL))
    zip.addFile('references/big.md', Buffer.from('a'.repeat(600 * 1024)))
    const bytes = zip.toBuffer()
    // Rewrite the declared uncompressed size (614400) to 100 in both headers.
    const declared = Buffer.alloc(4); declared.writeUInt32LE(600 * 1024)
    let patched = 0
    for (let i = bytes.indexOf(declared); i !== -1; i = bytes.indexOf(declared, i + 4)) { bytes.writeUInt32LE(100, i); patched++ }
    expect(patched).toBe(2)
    expect(new AdmZip(bytes).getEntry('references/big.md')?.header.size).toBe(100)
    const forged = join(dir, 'forged.zip'); writeFileSync(forged, bytes)
    const read = await readSkillZip(forged)
    expect(read.text).toBe(SKILL)
    expect(read.resources).toEqual({})
    expect(read.skipped).toEqual(['references/big.md (larger than it claims)'])
  })
})

describe('the skill archive plan', () => {
  const file = (name: string, size = 10, extra = {}) => ({ name, size, isDirectory: false, ...extra })
  it('refuses a path that leaves the archive', () => {
    expect(planSkillArchive([file('SKILL.md'), file('../evil.md')])).toMatchObject({ ok: false, error: expect.stringMatching(/leaves it/) })
    expect(planSkillArchive([file('SKILL.md'), file('/etc/passwd')])).toMatchObject({ ok: false })
  })
  it('skips links and over-limit files, and refuses a SKILL.md that is a link or too big', () => {
    const plan = planSkillArchive([file('SKILL.md'), file('references/a.md', 10, { isLink: true }), file('references/b.md', 600 * 1024)])
    expect(plan).toMatchObject({ ok: true, resources: [], skipped: ['references/a.md (a link)', 'references/b.md (over 512 KB)'] })
    expect(planSkillArchive([file('SKILL.md', 10, { isLink: true })])).toMatchObject({ ok: false })
    expect(planSkillArchive([file('SKILL.md', 600 * 1024)])).toMatchObject({ ok: false })
  })
  it('caps the number of files at 64', () => {
    const many = Array.from({ length: 70 }, (_, i) => file(`references/${i}.md`))
    const plan = planSkillArchive([file('SKILL.md'), ...many])
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.resources).toHaveLength(64)
    expect(plan.skipped).toHaveLength(6)
  })
})
