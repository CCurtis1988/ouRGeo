import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown } from './format'
import {
  adoptProjectSkills, archiveSkill, createSkill, deleteSkill, patchSkill, projectSkillsForBundle, recordUse,
  restoreSkill, revertSkill, setShippedSkillSettings, setSkillControls, skillHash, updateSkill, type LibraryResult,
} from './library'
import { EMPTY_LIBRARY, type SkillDefinition, type SkillLibraryState } from './types'

const ctx = { now: '2026-11-08T00:00:00Z', reservedNames: new Set(['maps', 'themes']) }
const def = (name = 'short-report', body = '1. Summarise the data.'): SkillDefinition =>
  ({ name, description: 'Use when the user wants a one-page summary.', body, triggers: [], actions: [], resources: {} })
const reparse = (text: string): SkillDefinition | string => { const r = parseSkillMarkdown(text); return r.ok ? r.definition : r.error }
const ok = (r: LibraryResult) => { if (!r.ok) throw new Error(r.error); return r }
const made = (by: 'user' | 'agent' | 'import' = 'user', state: SkillLibraryState = EMPTY_LIBRARY) => ok(createSkill(state, def(), { by }, ctx))

describe('creating skills', () => {
  it('a user or assistant skill is on and automatic; an import arrives off', () => {
    expect(made('user').skill).toMatchObject({ enabled: true, mode: 'auto', createdBy: 'user', id: '@user/short-report' })
    expect(made('agent').skill).toMatchObject({ enabled: true, createdBy: 'agent' })
    expect(made('import').skill.enabled).toBe(false)
  })
  it('an import is not trusted until switched on; a user or assistant skill is', () => {
    expect(made('import').state.trusted).toEqual([])
    expect(made('agent').state.trusted).toEqual([skillHash(def())])
  })
  it('refuses a taken or shipped name, except an import, which is re-keyed', () => {
    const first = made('user')
    expect(createSkill(first.state, def(), { by: 'agent' }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/already exists. Patch it/) })
    expect(createSkill(EMPTY_LIBRARY, def('maps'), { by: 'user' }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/ouRGeo or a plugin provides/) })
    const imported = ok(createSkill(first.state, def(), { by: 'import' }, ctx))
    expect(imported.skill.definition.name).toBe('short-report-2')
    expect(imported.warnings[0]).toMatch(/so this one is "short-report-2"/)
  })
  it('holds the assistant to a shorter skill', () => {
    expect(createSkill(EMPTY_LIBRARY, def('long', 'x'.repeat(20_001)), { by: 'agent' }, ctx).ok).toBe(false)
    expect(createSkill(EMPTY_LIBRARY, def('long', 'x'.repeat(20_001)), { by: 'user' }, ctx).ok).toBe(true)
  })
})

describe('changing skills', () => {
  it('keeps the previous text in history, newest first, and can restore it', () => {
    const first = made('user')
    const second = ok(updateSkill(first.state, first.skill.id, def('short-report', '1. New steps.'), { by: 'agent' }, ctx))
    expect(second.skill.updatedBy).toBe('agent')
    expect(second.skill.history[0]).toMatchObject({ by: 'user', text: expect.stringContaining('1. Summarise the data.') })
    const back = ok(revertSkill(second.state, first.skill.id, 0, { by: 'user', reparse }, ctx))
    expect(back.skill.definition.body).toBe('1. Summarise the data.')
    expect(back.skill.history[0].text).toContain('1. New steps.')
  })
  it('patches one exact passage and refuses a missing or repeated one', () => {
    const first = made('user')
    const patched = ok(patchSkill(first.state, first.skill.id, 'Summarise the data.', 'Summarise each column.', { by: 'agent', reparse }, ctx))
    expect(patched.skill.definition.body).toBe('1. Summarise each column.')
    expect(patchSkill(first.state, first.skill.id, 'not there', 'x', { by: 'agent', reparse }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/copy the text exactly/) })
  })
  it('the assistant cannot change a locked or archived skill', () => {
    const first = made('user')
    const locked = ok(setSkillControls(first.state, first.skill.id, { locked: true }, 'user'))
    expect(updateSkill(locked.state, first.skill.id, def('short-report', 'x'), { by: 'agent' }, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/locked/) })
    expect(updateSkill(locked.state, first.skill.id, def('short-report', 'x'), { by: 'user' }, ctx).ok).toBe(true)
  })
  it('renames only to a free name', () => {
    const first = made('user'); const both = ok(createSkill(first.state, def('other'), { by: 'user' }, ctx))
    expect(updateSkill(both.state, first.skill.id, def('other'), { by: 'user' }, ctx).ok).toBe(false)
    expect(ok(updateSkill(both.state, first.skill.id, def('renamed'), { by: 'user' }, ctx)).skill.id).toBe('@user/renamed')
  })
})

describe('only the user controls what the assistant follows', () => {
  it.each([
    ['switch on or off', (s: SkillLibraryState, id: string) => setSkillControls(s, id, { enabled: false }, 'agent')],
    ['change the mode', (s: SkillLibraryState, id: string) => setSkillControls(s, id, { mode: 'always' }, 'agent')],
    ['lock', (s: SkillLibraryState, id: string) => setSkillControls(s, id, { locked: false }, 'agent')],
    ['restore an archived skill', (s: SkillLibraryState, id: string) => restoreSkill(s, id, 'agent', ctx)],
    ['revert', (s: SkillLibraryState, id: string) => revertSkill(s, id, 0, { by: 'agent', reparse }, ctx)],
    ['delete', (s: SkillLibraryState, id: string) => deleteSkill(s, id, 'agent')],
  ])('the assistant cannot %s', (_what, act) => {
    const first = made('agent')
    expect(act(first.state, first.skill.id).ok).toBe(false)
  })
  it('the assistant archives only skills it made', () => {
    expect(archiveSkill(made('agent').state, '@user/short-report', 'agent', ctx).ok).toBe(true)
    expect(archiveSkill(made('user').state, '@user/short-report', 'agent', ctx).ok).toBe(false)
  })
  it('the assistant cannot change a shipped skill\'s settings; the user can, sparsely', () => {
    expect(setShippedSkillSettings(EMPTY_LIBRARY, 'skill:maps', { mode: 'always' }, 'agent').ok).toBe(false)
    const always = setShippedSkillSettings(EMPTY_LIBRARY, 'skill:maps', { mode: 'always' }, 'user')
    expect(always.ok && always.state.settings).toEqual({ 'skill:maps': { mode: 'always' } })
    const back = always.ok ? setShippedSkillSettings(always.state, 'skill:maps', { mode: 'auto' }, 'user') : always
    expect(back.ok && back.state.settings).toEqual({})
  })
  it('switching an import on approves its text', () => {
    const imported = made('import')
    const on = ok(setSkillControls(imported.state, imported.skill.id, { enabled: true }, 'user'))
    expect(on.state.trusted).toEqual([skillHash(def())])
  })
})

describe('project skills', () => {
  const projectSkill = (state = EMPTY_LIBRARY) => ok(createSkill(state, def('field-check'), { by: 'user', scope: 'project' }, ctx))
  it('a bundle cannot switch its own skills on: unapproved text arrives off', () => {
    const elsewhere = projectSkillsForBundle(projectSkill().state)
    const here = adoptProjectSkills(EMPTY_LIBRARY, elsewhere, ctx)
    expect(here.state.skills[0].enabled).toBe(false)
    expect(here.heldBack).toEqual(['field-check'])
  })
  it('text this device approved stays on, and an edited copy does not', () => {
    const local = projectSkill()
    const reopened = adoptProjectSkills(local.state, projectSkillsForBundle(local.state), ctx)
    expect(reopened.state.skills[0].enabled).toBe(true)
    const tampered = projectSkillsForBundle(local.state).map(s => ({ ...s, definition: { ...s.definition, body: 'Do something else.' } }))
    expect(adoptProjectSkills(local.state, tampered, ctx).state.skills[0].enabled).toBe(false)
  })
  it('replaces the previous project\'s skills and keeps global ones, re-keying a clash', () => {
    const global = made('user')
    const adopted = adoptProjectSkills(global.state, projectSkillsForBundle(ok(createSkill(EMPTY_LIBRARY, def(), { by: 'user', scope: 'project' }, ctx)).state), ctx)
    expect(adopted.state.skills.map(s => s.id)).toEqual(['@user/short-report', '@project/short-report-2'])
  })
  it('does not carry this device\'s usage into the bundle', () => {
    const local = projectSkill()
    const used = recordUse(local.state, local.skill.id, 'user', ctx.now)
    expect(projectSkillsForBundle(used)[0].usage).toEqual({ loads: 0, by: {} })
  })
})
