import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/skills-persistence', () => ({ saveSkillLibrary: vi.fn(async () => undefined), loadSkillLibrary: vi.fn() }))
import { useSkillStore } from '@/store/skills'
import { saveSkillLibrary } from '@/lib/skills-persistence'
import { workspaceSources } from '@/lib/context/sources/workspace'
import { allSkills, routableSkills, skillOffered, skillRoutable } from './catalog'
import { fromFile, fromRecords, toFile, toRecord } from './stored'
import { EMPTY_LIBRARY, type SkillDefinition } from './types'

const def = (name: string, triggers: string[] = []): SkillDefinition =>
  ({ name, description: `Use when ${name}.`, body: `Steps for ${name}.`, triggers, actions: [], resources: {} })

beforeEach(() => { useSkillStore.getState().init(EMPTY_LIBRARY); useSkillStore.setState({ library: EMPTY_LIBRARY }); vi.mocked(saveSkillLibrary).mockClear() })

describe('the catalog', () => {
  it('lists built-in topics and stored skills together, and reserves shipped names', () => {
    const created = useSkillStore.getState().create(def('short-report'), 'user')
    expect(created.ok).toBe(true)
    expect(useSkillStore.getState().create(def('maps'), 'user')).toMatchObject({ ok: false })
    const names = allSkills().map(s => s.name)
    expect(names).toContain('maps')
    expect(names).toContain('short-report')
    expect(allSkills().find(s => s.name === 'maps')?.source).toBe('builtin')
  })
  it('a built-in skill switched off is absent from broker sources and routing', () => {
    expect(workspaceSources(['skill']).some(s => s.id === 'skill:maps')).toBe(true)
    useSkillStore.getState().setShipped('skill:maps', { enabled: false }, 'user')
    expect(workspaceSources(['skill']).some(s => s.id === 'skill:maps')).toBe(false)
    expect(skillOffered('skill:maps')).toBe(false)
  })
  it('actions that need a switched-off skill are absent from discovery', () => {
    expect(workspaceSources(['action']).some(s => s.id === 'action:theme:create')).toBe(true)
    useSkillStore.getState().setShipped('skill:themes', { enabled: false }, 'user')
    expect(workspaceSources(['action']).some(s => s.id === 'action:theme:create')).toBe(false)
    expect(workspaceSources(['action']).some(s => s.id === 'action:theme:list')).toBe(true)
  })
  it('a manual skill cannot be found by search, but the host can still load it', async () => {
    const { ContextBroker } = await import('@/lib/context/broker')
    useSkillStore.getState().create(def('board-summary'), 'user')
    useSkillStore.getState().setControls('@user/board-summary', { mode: 'manual' }, 'user')
    const host = { identity: { chatId: 'c', projectId: null, workspaceEpoch: 0, policyRevision: 0 }, target: 't', effort: 'balanced' as const, signal: new AbortController().signal, current: () => true, sources: (kinds?: import('@/lib/context/types').ContextKind[]) => workspaceSources(kinds), excluded: () => [] }
    const broker = new ContextBroker(host)
    const titles = (): string[] => (JSON.parse(broker.search({ query: 'board-summary', kinds: ['skill'] })).results ?? []).map((r: { title: string }) => r.title)
    expect(titles()).not.toContain('board-summary')
    expect(JSON.parse((await broker.loadSkill('skill:@user/board-summary', 'user invoked skill'))!).content).toMatch(/Steps for board-summary/)
    useSkillStore.getState().setControls('@user/board-summary', { mode: 'auto' }, 'user')
    expect(titles()).toContain('board-summary')
  })
  it('only automatic skills are routed at turn start', () => {
    useSkillStore.getState().create(def('field-notes', ['field notes']), 'user')
    expect(routableSkills().some(s => s.topic === '@user/field-notes')).toBe(true)
    useSkillStore.getState().setControls('@user/field-notes', { mode: 'manual' }, 'user')
    expect(skillRoutable('skill:@user/field-notes')).toBe(false)
    useSkillStore.getState().setShipped('skill:themes', { mode: 'always' }, 'user')
    expect(skillRoutable('skill:themes')).toBe(false)
  })
  it('a stored skill is a broker source with an attributed body; an import is absent until switched on', () => {
    useSkillStore.getState().create(def('short-report'), 'agent')
    const source = workspaceSources(['skill']).find(s => s.id === 'skill:@user/short-report')
    expect(source?.read && String(source.read(new AbortController().signal))).toMatch(/written by the assistant and not yet reviewed/)
    useSkillStore.getState().create(def('from-a-friend'), 'import')
    expect(workspaceSources(['skill']).some(s => s.id === 'skill:@user/from-a-friend')).toBe(false)
  })
  it('saves every change to skills.json', () => {
    useSkillStore.getState().create(def('short-report'), 'user')
    expect(saveSkillLibrary).toHaveBeenCalledTimes(1)
  })
})

describe('skills.json', () => {
  it('round-trips global skills and leaves project skills out', () => {
    useSkillStore.getState().create(def('short-report'), 'user')
    useSkillStore.getState().create(def('site-check'), 'user', 'project')
    const back = fromFile(JSON.parse(JSON.stringify(toFile(useSkillStore.getState().library))))
    expect(back?.skills.map(s => s.id)).toEqual(['@user/short-report'])
    expect(back?.skills[0].definition).toEqual(def('short-report'))
  })
  it('drops one bad record and keeps the rest', () => {
    const good = toRecord(useSkillStore.getState().create(def('ok'), 'user').ok ? useSkillStore.getState().library.skills[0] : (null as never))
    const warn = vi.fn()
    expect(fromRecords([{ text: '# not a skill' }, good, good], 'global', warn).map(s => s.definition.name)).toEqual(['ok'])
    expect(warn).toHaveBeenCalledTimes(2)
  })
  it('refuses a file from a newer version rather than reading it as empty', () => {
    expect(fromFile({ version: 99, skills: [] })).toBeNull()
  })
})
