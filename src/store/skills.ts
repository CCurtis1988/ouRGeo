// The skill library's one writer. Every change goes through `commit`, which updates
// the state, bumps `revision` (what the Skill Manager and the catalog read), and
// saves global skills to skills.json. Project skills are saved with their project.
//
// Callers pass who is acting. `by: 'agent'` is the assistant, and the library
// refuses what only the user may do (see lib/skills/library.ts).

import { create } from 'zustand'
import { parseSkillMarkdown } from '@/lib/skills/format'
import {
  adoptProjectSkills, archiveSkill, createSkill, deleteSkill, patchSkill, recordUse, restoreSkill, revertSkill,
  setShippedSkillSettings, setSkillControls, updateSkill, type LibraryContext, type LibraryResult,
} from '@/lib/skills/library'
import { fromRecords, toRecord, type StoredSkillRecord } from '@/lib/skills/stored'
import { saveSkillLibrary } from '@/lib/skills-persistence'
import {
  EMPTY_LIBRARY, type SkillAuthor, type SkillDefinition, type SkillLibraryState, type SkillLoader,
  type SkillMode, type SkillSettings, type StoredSkill,
} from '@/lib/skills/types'

/** Something the assistant just did to a skill, shown in the AI panel until reviewed or dismissed. */
export interface AgentSkillNotice { id: string; name: string; verb: 'created' | 'updated' | 'archived'; at: number }

export type SkillChange = { ok: true; skill: StoredSkill; warnings: string[] } | { ok: false; error: string }

interface SkillState {
  library: SkillLibraryState
  /** Bumped on every change. Subscribe to this, not to the library's contents. */
  revision: number
  loaded: boolean
  /** Not persisted: a prompt to review, for this session. */
  agentNotices: AgentSkillNotice[]
  noteAgentChange: (notice: Omit<AgentSkillNotice, 'at'>) => void
  dismissAgentNotice: (id: string) => void
  /** Reverse the assistant's last change to this skill, as the user. */
  undoAgentChange: (notice: AgentSkillNotice) => SkillChange | { ok: true }
  init: (library: SkillLibraryState) => void
  create: (definition: SkillDefinition, by: SkillAuthor, scope?: StoredSkill['scope']) => SkillChange
  update: (id: string, definition: SkillDefinition, by: SkillAuthor, note?: string) => SkillChange
  patch: (id: string, passage: string, replacement: string, by: SkillAuthor) => SkillChange
  setControls: (id: string, controls: { enabled?: boolean; mode?: SkillMode; locked?: boolean }, by: SkillAuthor) => SkillChange
  setShipped: (sourceId: string, settings: SkillSettings, by: SkillAuthor) => { ok: true } | { ok: false; error: string }
  archive: (id: string, by: SkillAuthor) => SkillChange
  restore: (id: string, by: SkillAuthor) => SkillChange
  remove: (id: string, by: SkillAuthor) => { ok: true } | { ok: false; error: string }
  revert: (id: string, index: number, by: SkillAuthor) => SkillChange
  recordUse: (id: string, by: SkillLoader) => void
  /** Replace the project skills with a newly opened project's. Returns names held off pending approval. */
  adoptProject: (records: unknown) => string[]
  clearProject: () => void
  projectRecords: () => StoredSkillRecord[]
}

/**
 * Names built-in and plugin skills use, read at call time. Provided by
 * lib/skills/catalog.ts rather than imported: the topic registry reaches the action
 * registry, whose project actions import project persistence, which imports this
 * store — a cycle that left `projectActions` undefined at load.
 */
let reservedNames: () => Iterable<string> = () => []
export function provideReservedSkillNames(provider: () => Iterable<string>): void { reservedNames = provider }

const context = (): LibraryContext => ({ now: new Date().toISOString(), reservedNames: new Set(reservedNames()) })

/** Read a SKILL.md during an edit: the definition, or the problem as text. */
export const reparseSkill = (text: string): SkillDefinition | string => {
  const parsed = parseSkillMarkdown(text)
  return parsed.ok ? parsed.definition : parsed.error
}

export const useSkillStore = create<SkillState>((set, get) => {
  const commit = (library: SkillLibraryState, persist = true): void => {
    set(state => ({ library, revision: state.revision + 1 }))
    if (persist) void saveSkillLibrary(library)
  }
  const apply = (result: LibraryResult): SkillChange => {
    if (!result.ok) return result
    commit(result.state)
    return { ok: true, skill: result.skill, warnings: result.warnings }
  }
  return {
    library: EMPTY_LIBRARY,
    revision: 0,
    loaded: false,
    agentNotices: [],
    noteAgentChange: notice => set(state => ({ agentNotices: [...state.agentNotices.filter(n => n.id !== notice.id), { ...notice, at: Date.now() }].slice(-5) })),
    dismissAgentNotice: id => set(state => ({ agentNotices: state.agentNotices.filter(n => n.id !== id) })),
    undoAgentChange: notice => {
      const skill = get().library.skills.find(s => s.id === notice.id)
      const result = !skill ? { ok: true as const }
        : notice.verb === 'created' ? get().remove(notice.id, 'user')
        : notice.verb === 'archived' ? get().restore(notice.id, 'user')
        : skill.history.length ? get().revert(notice.id, 0, 'user') : { ok: true as const }
      // Kept on failure, so the notice can say what went wrong.
      if (result.ok) set(state => ({ agentNotices: state.agentNotices.filter(n => n.id !== notice.id) }))
      return result
    },
    init: library => set(state => ({ library: { ...library, skills: [...library.skills, ...state.library.skills.filter(s => s.scope === 'project')] }, revision: state.revision + 1, loaded: true })),
    create: (definition, by, scope) => apply(createSkill(get().library, definition, { by, scope }, context())),
    update: (id, definition, by, note) => apply(updateSkill(get().library, id, definition, { by, note }, context())),
    patch: (id, passage, replacement, by) => apply(patchSkill(get().library, id, passage, replacement, { by, reparse: reparseSkill }, context())),
    setControls: (id, controls, by) => apply(setSkillControls(get().library, id, controls, by)),
    setShipped: (sourceId, settings, by) => {
      const result = setShippedSkillSettings(get().library, sourceId, settings, by)
      if (result.ok) commit(result.state)
      return result.ok ? { ok: true } : result
    },
    archive: (id, by) => apply(archiveSkill(get().library, id, by, context())),
    restore: (id, by) => apply(restoreSkill(get().library, id, by, context())),
    remove: (id, by) => {
      const result = deleteSkill(get().library, id, by)
      if (result.ok) commit(result.state)
      return result.ok ? { ok: true } : result
    },
    revert: (id, index, by) => apply(revertSkill(get().library, id, index, { by, reparse: reparseSkill }, context())),
    // Usage is bookkeeping, not an edit: saved, but never a history entry.
    recordUse: (id, by) => commit(recordUse(get().library, id, by, new Date().toISOString())),
    adoptProject: records => {
      const incoming = fromRecords(records, 'project', message => console.warn('[Skills] project:', message))
      const { state, heldBack } = adoptProjectSkills(get().library, incoming, context())
      commit(state, false)
      return heldBack
    },
    clearProject: () => commit({ ...get().library, skills: get().library.skills.filter(s => s.scope === 'global') }, false),
    projectRecords: () => get().library.skills.filter(s => s.scope === 'project').map(s => toRecord({ ...s, usage: { loads: 0, by: {} } })),
  }
})
