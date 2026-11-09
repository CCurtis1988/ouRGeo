import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/skills-persistence', () => ({ saveSkillLibrary: vi.fn(async () => undefined), loadSkillLibrary: vi.fn() }))
import { useSkillStore } from '@/store/skills'
import { mergeList, planKeyed, type MergeItem } from '@/lib/project-merge'
import { parseSkillMarkdown } from './format'
import { renameRecord, sameSkillContent, type StoredSkillRecord } from './stored'
import { EMPTY_LIBRARY, type SkillDefinition } from './types'

const def = (name: string, body = `Steps for ${name}.`): SkillDefinition =>
  ({ name, description: `Use when ${name}.`, body, triggers: [], actions: [], resources: {} })

beforeEach(() => { useSkillStore.setState({ library: EMPTY_LIBRARY, revision: 0 }) })

const projectRecord = (name: string, body?: string): StoredSkillRecord => {
  useSkillStore.setState({ library: EMPTY_LIBRARY })
  useSkillStore.getState().create(def(name, body), 'user', 'project')
  return useSkillStore.getState().projectRecords()[0]
}

describe('project skills through the store', () => {
  it('reopening on the device that made them keeps them on', () => {
    useSkillStore.getState().create(def('site-check'), 'user', 'project')
    const records = useSkillStore.getState().projectRecords()
    useSkillStore.getState().clearProject()
    expect(useSkillStore.getState().library.skills).toEqual([])
    expect(useSkillStore.getState().adoptProject(records)).toEqual([])
    expect(useSkillStore.getState().library.skills[0]).toMatchObject({ id: '@project/site-check', enabled: true, scope: 'project' })
  })
  it('opening someone else\'s project leaves its skills off and names them', () => {
    const records = [projectRecord('site-check')]
    useSkillStore.setState({ library: EMPTY_LIBRARY })
    expect(useSkillStore.getState().adoptProject(records)).toEqual(['site-check'])
    expect(useSkillStore.getState().library.skills[0].enabled).toBe(false)
  })
  it('closing a project keeps global skills', () => {
    useSkillStore.getState().create(def('mine'), 'user')
    useSkillStore.getState().create(def('theirs'), 'user', 'project')
    useSkillStore.getState().clearProject()
    expect(useSkillStore.getState().library.skills.map(s => s.id)).toEqual(['@user/mine'])
  })
})

describe('merging project skills', () => {
  it('on/off and usage are not changes; text is', () => {
    const base = projectRecord('site-check')
    expect(planKeyed('skill', [base], [{ ...base, enabled: false, usage: { loads: 9, by: {} } }], [base], r => r.id, r => r.id, sameSkillContent)).toEqual([])
    const edited = projectRecord('site-check', 'Different steps.')
    expect(planKeyed('skill', [base], [base], [edited], r => r.id, r => r.id, sameSkillContent)[0].status).toBe('auto-theirs')
  })
  it('keeping both renames this copy inside its text, where the name lives', () => {
    const mine = projectRecord('site-check', 'My steps.'), theirs = projectRecord('site-check', 'Their steps.')
    const items = planKeyed('skill', [], [mine], [theirs], r => r.id, r => r.id, sameSkillContent) as MergeItem<StoredSkillRecord>[]
    const merged = mergeList(mine ? [mine] : [], [theirs], items, { [`skill:${mine.id}`]: 'both' }, r => r.id, renameRecord)
    const names = merged.map(r => { const p = parseSkillMarkdown(r.text); return p.ok ? p.definition.name : '?' })
    expect(names.sort()).toEqual(['site-check', 'site-check-mine'])
  })
})
