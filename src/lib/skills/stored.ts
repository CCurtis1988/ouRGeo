// A stored skill as it is written to skills.json and into a project bundle: its
// SKILL.md TEXT plus this device's state. The text is re-parsed on the way in, so a
// hand-edited or newer-format file goes through the same checks as an import, and
// one bad entry is dropped on its own rather than costing the user every skill.

import { parseSkillMarkdown } from './format'
import { freeName, skillText } from './library'
import { SKILL_MODES, type SkillAuthor, type SkillLibraryState, type SkillMode, type StoredSkill } from './types'

export const SKILL_FILE_VERSION = 1

export interface StoredSkillRecord {
  id: string
  text: string
  resources?: Record<string, string>
  enabled: boolean
  mode: SkillMode
  locked: boolean
  archived: boolean
  createdBy: SkillAuthor
  updatedBy: SkillAuthor
  createdAt: string
  updatedAt: string
  history: StoredSkill['history']
  usage: StoredSkill['usage']
}

const AUTHORS: readonly SkillAuthor[] = ['user', 'agent', 'import']
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

export function toRecord(skill: StoredSkill): StoredSkillRecord {
  const { definition, scope: _scope, ...state } = skill
  void _scope
  return { ...state, text: skillText(definition), ...(Object.keys(definition.resources).length ? { resources: definition.resources } : {}) }
}

/** A record back to a skill, or the reason it was dropped. */
export function fromRecord(raw: unknown, scope: StoredSkill['scope']): StoredSkill | string {
  if (!isRecord(raw)) return 'not an object'
  const resources = isRecord(raw.resources)
    ? Object.fromEntries(Object.entries(raw.resources).filter((e): e is [string, string] => typeof e[1] === 'string' && !e[0].includes('..') && !e[0].startsWith('/')))
    : {}
  const parsed = parseSkillMarkdown(text(raw.text), { resources })
  if (!parsed.ok) return parsed.error
  const name = parsed.definition.name
  const author = (v: unknown): SkillAuthor => (AUTHORS.includes(v as SkillAuthor) ? v as SkillAuthor : 'import')
  const history = Array.isArray(raw.history)
    ? raw.history.filter(isRecord).filter(r => typeof r.text === 'string' && typeof r.at === 'string')
      .map(r => ({ at: String(r.at), by: author(r.by), text: String(r.text), ...(typeof r.note === 'string' ? { note: r.note } : {}) })).slice(0, 20)
    : []
  const usage = isRecord(raw.usage) && typeof raw.usage.loads === 'number'
    ? { loads: raw.usage.loads, ...(typeof raw.usage.lastUsed === 'string' ? { lastUsed: raw.usage.lastUsed } : {}), by: isRecord(raw.usage.by) ? Object.fromEntries(Object.entries(raw.usage.by).filter(e => typeof e[1] === 'number')) : {} }
    : { loads: 0, by: {} }
  return {
    id: `${scope === 'project' ? '@project' : '@user'}/${name}`, scope, definition: parsed.definition,
    enabled: raw.enabled === true, mode: SKILL_MODES.includes(raw.mode as SkillMode) ? raw.mode as SkillMode : 'auto',
    locked: raw.locked === true, archived: raw.archived === true,
    createdBy: author(raw.createdBy), updatedBy: author(raw.updatedBy ?? raw.createdBy),
    createdAt: text(raw.createdAt, new Date(0).toISOString()), updatedAt: text(raw.updatedAt, text(raw.createdAt, new Date(0).toISOString())),
    history, usage,
  }
}

/** Read a list of records, keeping every one that parses. Names stay unique: a later duplicate is dropped. */
export function fromRecords(raw: unknown, scope: StoredSkill['scope'], warn: (message: string) => void = () => undefined): StoredSkill[] {
  const out: StoredSkill[] = [], seen = new Set<string>()
  for (const one of Array.isArray(raw) ? raw : []) {
    const skill = fromRecord(one, scope)
    if (typeof skill === 'string') { warn(`Dropped a skill: ${skill}`); continue }
    if (seen.has(skill.definition.name)) { warn(`Dropped a second skill called "${skill.definition.name}".`); continue }
    seen.add(skill.definition.name); out.push(skill)
  }
  return out
}

/** skills.json: this device's global skills, shipped-skill settings and approvals. Project skills live in their bundle. */
export function toFile(state: SkillLibraryState): Record<string, unknown> {
  return {
    version: SKILL_FILE_VERSION,
    skills: state.skills.filter(s => s.scope === 'global').map(toRecord),
    settings: state.settings,
    trusted: state.trusted,
  }
}

export function fromFile(data: Record<string, unknown>, warn: (message: string) => void = () => undefined): SkillLibraryState | null {
  if (typeof data.version === 'number' && data.version > SKILL_FILE_VERSION) return null
  const settings = isRecord(data.settings)
    ? Object.fromEntries(Object.entries(data.settings).filter((e): e is [string, Record<string, unknown>] => isRecord(e[1])).map(([id, s]) => [id, {
      ...(typeof s.enabled === 'boolean' ? { enabled: s.enabled } : {}),
      ...(SKILL_MODES.includes(s.mode as SkillMode) ? { mode: s.mode as SkillMode } : {}),
    }]))
    : {}
  return {
    skills: fromRecords(data.skills, 'global', warn),
    settings,
    trusted: Array.isArray(data.trusted) ? data.trusted.filter((h): h is string => typeof h === 'string') : [],
  }
}

/** Same text and files: on/off and usage are this device's, not the project's content. */
export const sameSkillContent = (a: StoredSkillRecord | undefined, b: StoredSkillRecord | undefined): boolean =>
  (a?.text ?? null) === (b?.text ?? null) && JSON.stringify(a?.resources ?? {}) === JSON.stringify(b?.resources ?? {})

/** For a merge that keeps both versions: give this copy a free name, in its text, where the name lives. */
export function renameRecord(record: StoredSkillRecord, taken: ReadonlySet<string>): StoredSkillRecord {
  const parsed = parseSkillMarkdown(record.text)
  if (!parsed.ok) return record
  const names = new Set([...taken].map(id => id.replace(/^@(user|project)\//, '')))
  const name = freeName(`${parsed.definition.name}-mine`, names)
  return { ...record, id: `@project/${name}`, text: skillText({ ...parsed.definition, name }) }
}
