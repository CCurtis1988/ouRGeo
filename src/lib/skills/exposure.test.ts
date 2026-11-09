import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/skills-persistence', () => ({ saveSkillLibrary: vi.fn(async () => undefined), loadSkillLibrary: vi.fn() }))
import { useSkillStore } from '@/store/skills'
import { useAiStore } from '@/store/ai'
import { buildContextContract } from '@/lib/context/compiler'
import type { ContextBroker } from '@/lib/context/broker'
import { buildSkillCatalog, catalogSkills, skillByName } from './catalog'
import { runSaveSkill, skillToolDefinition } from './tools'
import { attachTurnSkills } from './turn'
import { EMPTY_LIBRARY, type SkillDefinition } from './types'

const def = (name: string): SkillDefinition => ({ name, description: `Use when the user wants ${name}.`, body: `Steps for ${name}.`, triggers: [], actions: [], resources: {} })
const SKILL_MD = (name: string) => `---\nname: ${name}\ndescription: Use when the user wants a one-page summary of a dataset.\n---\n1. Summarise each column in R.\n2. Write a short report.\n`

beforeEach(() => {
  useSkillStore.setState({ library: EMPTY_LIBRARY, revision: 0 })
  useAiStore.getState().loadChats([], null)
})

describe('the catalog the model sees', () => {
  it('lists every on, non-manual skill by name and leaves off and manual ones out', () => {
    useSkillStore.getState().create(def('short-report'), 'user')
    useSkillStore.getState().create(def('private-one'), 'user')
    useSkillStore.getState().setControls('@user/private-one', { mode: 'manual' }, 'user')
    useSkillStore.getState().setShipped('skill:maps', { enabled: false }, 'user')
    const catalog = buildSkillCatalog(131_072)
    expect(catalog).toMatch(/- short-report: Use when/)
    expect(catalog).toMatch(/- themes: Use when/)
    expect(catalog).not.toMatch(/private-one|- maps/)
    expect(skillToolDefinition()?.inputSchema.properties).toMatchObject({ name: { enum: catalogSkills().map(s => s.name) } })
  })
  it('is the same text until the library changes, so the prompt stays cacheable', () => {
    const contract = (): string => buildContextContract({ autoPilot: true, web: false, terminal: false, viaMcp: true, skills: buildSkillCatalog(32_000) })
    const first = contract()
    expect(contract()).toBe(first)
    expect(first).toMatch(/use_skill for how ouRGeo works/)
    expect(first).not.toMatch(/ourgeo_docs/)
    useSkillStore.getState().create(def('short-report'), 'user')
    expect(contract()).not.toBe(first)
  })
  it('keeps every name but drops descriptions to fit a small window', () => {
    const small = buildSkillCatalog(4096)
    for (const s of catalogSkills()) expect(small).toContain(`- ${s.name}`)
    expect(small.length).toBeLessThan(buildSkillCatalog(131_072).length)
    expect(buildSkillCatalog(32_768)).toBe(buildSkillCatalog(131_072))
  })
  it('finds a skill however the user writes its name', () => {
    useSkillStore.getState().create(def('short-report'), 'user')
    expect(skillByName('Short Report')?.name).toBe('short-report')
    expect(skillByName('nonsense')).toBeUndefined()
  })
})

describe('save_skill', () => {
  it('creates an agent-made skill that is on and automatic, and says how the user reviews it', () => {
    const reply = runSaveSkill({ operation: 'create', name: 'short-report', content: SKILL_MD('short-report') }, { projectSaved: false })
    expect(reply).toMatch(/Saved skill "short-report".*Skill Manager/)
    expect(useSkillStore.getState().library.skills[0]).toMatchObject({ createdBy: 'agent', enabled: true, mode: 'auto' })
  })
  it('patches its skill, archives its own, and refuses built-in skills and scratch projects', () => {
    runSaveSkill({ operation: 'create', name: 'short-report', content: SKILL_MD('short-report') }, { projectSaved: false })
    expect(runSaveSkill({ operation: 'patch', name: 'short-report', find: 'Write a short report.', replace: 'Write a one-page report.' }, { projectSaved: false })).toMatch(/Updated/)
    expect(useSkillStore.getState().library.skills[0].definition.body).toMatch(/one-page report/)
    expect(runSaveSkill({ operation: 'patch', name: 'maps', find: 'a', replace: 'b' }, { projectSaved: false })).toMatch(/built into ouRGeo/)
    expect(runSaveSkill({ operation: 'create', name: 'x', content: SKILL_MD('x'), scope: 'project' }, { projectSaved: false })).toMatch(/Saved skill "x".*saved on this computer, not in a project/)
    expect(useSkillStore.getState().library.skills.find(s => s.definition.name === 'x')?.scope).toBe('global')
    expect(runSaveSkill({ operation: 'archive', name: 'short-report' }, { projectSaved: false })).toMatch(/Archived/)
  })
  it('passes on the library\'s reason when it refuses', () => {
    expect(runSaveSkill({ operation: 'create', name: 'bad', content: 'no front matter' }, { projectSaved: false })).toMatch(/^Refused: This is not a skill file/)
  })
})

describe('telling the user what the assistant saved', () => {
  beforeEach(() => useSkillStore.setState({ agentNotices: [] }))
  it('a save, a patch and an archive each leave a notice; a no-op and a refusal do not', () => {
    runSaveSkill({ operation: 'create', name: 'short-report', content: SKILL_MD('short-report') }, { projectSaved: false })
    expect(useSkillStore.getState().agentNotices.map(n => n.verb)).toEqual(['created'])
    runSaveSkill({ operation: 'patch', name: 'short-report', find: 'nothing like this', replace: 'x' }, { projectSaved: false })
    runSaveSkill({ operation: 'patch', name: 'short-report', find: 'Write a short report.', replace: 'Write a one-page report.' }, { projectSaved: false })
    expect(useSkillStore.getState().agentNotices.map(n => n.verb)).toEqual(['updated'])
  })
  it('undo removes a skill it created, restores the version it changed, and unarchives', () => {
    runSaveSkill({ operation: 'create', name: 'short-report', content: SKILL_MD('short-report') }, { projectSaved: false })
    expect(useSkillStore.getState().undoAgentChange(useSkillStore.getState().agentNotices[0]).ok).toBe(true)
    expect(useSkillStore.getState().library.skills).toEqual([])
    useSkillStore.getState().create(def('field-check'), 'user')
    runSaveSkill({ operation: 'patch', name: 'field-check', find: 'Steps for field-check.', replace: 'New steps.' }, { projectSaved: false })
    useSkillStore.getState().undoAgentChange(useSkillStore.getState().agentNotices[0])
    expect(useSkillStore.getState().library.skills[0].definition.body).toBe('Steps for field-check.')
    expect(useSkillStore.getState().agentNotices).toEqual([])
  })
})

describe('skills the host attaches at the start of a turn', () => {
  const broker = { loadSkill: vi.fn(async (id: string) => JSON.stringify({ status: 'ok', content: `body of ${id}` })) } as unknown as ContextBroker
  const chat = (activeSkills?: string[]) => {
    useAiStore.getState().newChat()
    const id = useAiStore.getState().activeChatId!
    useAiStore.setState(s => ({ chats: s.chats.map(c => (c.id === id ? { ...c, activeSkills } : c)) }))
    return id
  }
  it('attaches a skill the user named, says they invoked it, and keeps it for the chat', async () => {
    useSkillStore.getState().create(def('short-report'), 'user')
    const chatId = chat()
    const turn = await attachTurnSkills(broker, { text: 'Please use your short-report skill to summarize this data', chatId, allowance: 6000 })
    expect(turn.block).toMatch(/The user has invoked the "short-report" skill/)
    expect(turn.attached).toEqual(['skill:@user/short-report'])
    expect(useAiStore.getState().chats.find(c => c.id === chatId)?.activeSkills).toEqual(['skill:@user/short-report'])
    expect(useSkillStore.getState().library.skills[0].usage.by.user).toBe(1)
  })
  it('re-attaches skills already in use and always-on skills, within the cap', async () => {
    useSkillStore.getState().setShipped('skill:themes', { mode: 'always' }, 'user')
    const chatId = chat(['skill:maps', 'skill:documents', 'skill:toolbox', 'skill:layout'])
    const turn = await attachTurnSkills(broker, { text: 'next step', chatId, allowance: 6000 })
    expect(turn.attached[0]).toBe('skill:themes')
    expect(turn.attached).toHaveLength(4)
    expect(turn.block).toMatch(/Always-on skill "themes"/)
  })
  it('says honestly when a named skill does not exist', async () => {
    const turn = await attachTurnSkills(broker, { text: 'use the field-check skill', chatId: chat(), allowance: 6000 })
    expect(turn.unknown).toEqual(['field-check'])
    expect(turn.block).toMatch(/no skill by that name is switched on/)
  })
  it('adds a workflow digest when the user asks to save a skill', async () => {
    const chatId = chat()
    useAiStore.setState(s => ({ chats: s.chats.map(c => (c.id === chatId ? { ...c, messages: [
      { id: 'u1', role: 'user', content: 'Summarise nc', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Done', timestamp: Date.now(), toolCalls: [{ id: 't', code: 'summary(nc)' }] },
      { id: 'u2', role: 'user', content: 'turn that into a skill called short-report', timestamp: Date.now() },
    ] } : c)) }))
    const turn = await attachTurnSkills(broker, { text: 'turn that into a skill called short-report', chatId, allowance: 6000 })
    expect(turn.block).toMatch(/asked to save a skill/)
    expect(turn.block).toMatch(/summary\(nc\)/)
  })
  it('attaches nothing when the allowance is spent', async () => {
    useSkillStore.getState().setShipped('skill:themes', { mode: 'always' }, 'user')
    expect((await attachTurnSkills(broker, { text: 'hi', chatId: chat(), allowance: 100 })).attached).toEqual([])
  })
})
