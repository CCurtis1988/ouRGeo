// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
vi.mock('@/lib/skills-persistence', () => ({ saveSkillLibrary: vi.fn(async () => undefined), loadSkillLibrary: vi.fn() }))
// Monaco does not run in jsdom; the editor is checked in the real app. A textarea
// with the same props stands in, so the dialog's own logic is still tested.
vi.mock('./SkillTextEditor', () => ({
  SkillTextEditor: ({ value, onChange, readOnly, ariaLabel }: { value: string; onChange: (v: string) => void; readOnly: boolean; ariaLabel: string }) =>
    <textarea aria-label={ariaLabel} value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />,
}))
import { useSkillStore } from '@/store/skills'
import { SkillManagerDialog } from './SkillManagerDialog'
import { listSkills, testSkill, duplicateShipped, importSkill } from '@/lib/skills/manager'
import { allSkills } from '@/lib/skills/catalog'
import { EMPTY_LIBRARY } from '@/lib/skills/types'

const SKILL = '---\nname: short-report\ndescription: Use when the user wants a one-page summary.\nmetadata:\n  ourgeo:\n    triggers: ["short report"]\n---\n1. Summarise.\n'
const openSkill = vi.fn()

beforeEach(() => {
  useSkillStore.setState({ library: EMPTY_LIBRARY, revision: 0 })
  openSkill.mockReset()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { dialog: { openSkill, exportSkill: vi.fn() } }
})

describe('the Skill Manager', () => {
  it('lists built-in skills, and switching one off takes it out of what the assistant gets', () => {
    render(<SkillManagerDialog open onOpenChange={() => undefined} />)
    const maps = screen.getByRole('switch', { name: /maps/ })
    expect(maps.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(maps)
    expect(allSkills().find(s => s.name === 'maps')?.enabled).toBe(false)
  })
  it('an imported skill arrives switched off, and says so', async () => {
    openSkill.mockResolvedValue({ text: SKILL, fallbackName: 'x', resources: {}, skipped: [] })
    render(<SkillManagerDialog open onOpenChange={() => undefined} />)
    fireEvent.click(screen.getByText(/Import file/))
    await waitFor(() => expect(screen.getByText(/It is switched off: read it, then switch it on/)).toBeTruthy())
    expect(useSkillStore.getState().library.skills[0]).toMatchObject({ createdBy: 'import', enabled: false })
  })
  it('shows what the assistant wrote as such, and a built-in skill as read-only with a way to copy it', () => {
    useSkillStore.getState().create({ name: 'agent-one', description: 'Use when x.', body: 'Steps.', triggers: [], actions: [], resources: {} }, 'agent')
    render(<SkillManagerDialog open onOpenChange={() => undefined} />)
    expect(screen.getAllByText('Written by the assistant').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText(/Details/)[0])
    expect(screen.getByText('Duplicate to edit')).toBeTruthy()
    expect((screen.getByLabelText('Skill text (read-only)') as HTMLTextAreaElement).readOnly).toBe(true)
  })
})

describe('Skill Manager logic', () => {
  it('filters by source and by who wrote it, and searches names and descriptions', () => {
    useSkillStore.getState().create({ name: 'agent-one', description: 'Use when parcels.', body: 'S', triggers: [], actions: [], resources: {} }, 'agent')
    expect(listSkills('agent', '').map(s => s.name)).toEqual(['agent-one'])
    expect(listSkills('builtin', '').every(s => s.source === 'builtin')).toBe(true)
    expect(listSkills('all', 'parcels').map(s => s.name)).toEqual(['agent-one'])
    useSkillStore.getState().archive('@user/agent-one', 'user')
    expect(listSkills('all', 'parcels')).toEqual([])
    expect(listSkills('archived', '').map(s => s.name)).toEqual(['agent-one'])
  })
  it('explains whether a message would bring a skill in', () => {
    const imported = importSkill({ text: SKILL, fallbackName: 'x', resources: {}, skipped: [] }, 'global')
    if (!imported.change.ok) throw new Error(imported.change.error)
    const entry = () => allSkills().find(s => s.name === 'short-report')!
    expect(testSkill(entry(), 'hello')).toEqual(['It is switched off, so the assistant cannot use it at all.'])
    useSkillStore.getState().setControls('@user/short-report', { enabled: true }, 'user')
    expect(testSkill(entry(), 'a short report please').join()).toMatch(/trigger words/)
    expect(testSkill(entry(), 'use your short-report skill').join()).toMatch(/names it/)
    useSkillStore.getState().setControls('@user/short-report', { mode: 'manual' }, 'user')
    expect(testSkill(entry(), 'a short report please').join()).toMatch(/Only when I ask/)
  })
  it('a copy of a built-in skill is an editable user skill with its text', () => {
    const maps = allSkills().find(s => s.name === 'maps')!
    const copy = duplicateShipped(maps)
    expect(copy.name).toBe('my-maps')
    expect(useSkillStore.getState().create(copy, 'user').ok).toBe(true)
  })
})
