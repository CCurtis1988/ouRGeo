// Every change to the stored skill library, as pure functions that return the next
// state or a refusal that names the way out.
//
// Who may do what (maintainer's decisions, 2026-11-08):
// - The assistant saves skills without asking. They carry an "agent-made" badge and
//   a full history, and the user reviews them afterwards in the Skill Manager.
// - The assistant may create skills, patch user and agent skills, and archive the
//   ones it made. It may NOT edit a locked skill, switch any skill on or off, change
//   when a skill is used, lock or delete one, or restore an old version. Those are
//   the user's controls over what the assistant follows, and an assistant that could
//   change them would be approving its own instructions (CLAUDE.md: never exposed to
//   the assistant: approving anything).
// - An imported skill arrives switched OFF, like a plugin: it is instructions someone
//   else wrote, and the switch is the user's reading of it.
// - A project's skills switch on only when THIS device has approved that exact text.
//   A bundle cannot authorise itself, so a project from someone else arrives with its
//   skills off.

import { contentRevision } from '@/lib/context/policy'
import { MAX_AGENT_BODY, serializeSkillMarkdown } from './format'
import type { SkillAuthor, SkillDefinition, SkillLibraryState, SkillLoader, SkillMode, SkillSettings, StoredSkill } from './types'

const MAX_HISTORY = 20

export interface LibraryContext {
  now: string
  /** Names already used by built-in and plugin skills. A stored skill cannot take one. */
  reservedNames: ReadonlySet<string>
}

export type LibraryResult =
  | { ok: true; state: SkillLibraryState; skill: StoredSkill; warnings: string[] }
  | { ok: false; error: string }

const fail = (error: string): LibraryResult => ({ ok: false, error })

export const skillText = (definition: SkillDefinition): string => serializeSkillMarkdown(definition)
/** Identity of the text a user approved. Resources count: they are read as guidance too. */
export const skillHash = (definition: SkillDefinition): string =>
  contentRevision(`${skillText(definition)}\n${Object.entries(definition.resources).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}\n${v}`).join('\n')}`)

export const idFor = (scope: StoredSkill['scope'], name: string): string => `${scope === 'project' ? '@project' : '@user'}/${name}`

function namesInUse(state: SkillLibraryState, ctx: LibraryContext, except?: string): Set<string> {
  return new Set([...ctx.reservedNames, ...state.skills.filter(s => s.id !== except).map(s => s.definition.name)])
}

/** `short-report`, else `short-report-2`, `-3`… The way imports are re-keyed, as themes are. */
export function freeName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) { const name = `${base.slice(0, 60)}-${n}`; if (!taken.has(name)) return name }
}

const replace = (state: SkillLibraryState, skill: StoredSkill): SkillLibraryState =>
  ({ ...state, skills: state.skills.map(s => (s.id === skill.id ? skill : s)) })

const find = (state: SkillLibraryState, id: string): StoredSkill | undefined => state.skills.find(s => s.id === id)

const trust = (state: SkillLibraryState, definition: SkillDefinition): string[] => {
  const hash = skillHash(definition)
  return state.trusted.includes(hash) ? state.trusted : [...state.trusted, hash]
}

/** Assistant edits must stay short, and must leave a skill the user can still read. */
function agentLimits(definition: SkillDefinition): string | null {
  if (definition.body.length > MAX_AGENT_BODY) return `The skill is ${definition.body.length.toLocaleString()} characters; keep it under ${MAX_AGENT_BODY.toLocaleString()}. Short, step-by-step skills are the ones that help.`
  return null
}

export function createSkill(state: SkillLibraryState, definition: SkillDefinition, options: { by: SkillAuthor; scope?: StoredSkill['scope'] }, ctx: LibraryContext): LibraryResult {
  const scope = options.scope ?? 'global'
  const taken = namesInUse(state, ctx)
  const warnings: string[] = []
  let name = definition.name
  if (taken.has(name)) {
    if (options.by !== 'import') {
      return fail(ctx.reservedNames.has(name)
        ? `"${name}" is the name of a skill ouRGeo or a plugin provides. Choose another name.`
        : `A skill called "${name}" already exists. Patch it instead, or choose another name.`)
    }
    name = freeName(name, taken)
    warnings.push(`A skill called "${definition.name}" already exists, so this one is "${name}".`)
  }
  if (options.by === 'agent') { const limit = agentLimits(definition); if (limit) return fail(limit) }
  const final = { ...definition, name }
  const skill: StoredSkill = {
    id: idFor(scope, name), scope, definition: final,
    // An import is someone else's instructions: off until the user switches it on.
    enabled: options.by !== 'import', mode: 'auto', locked: false, archived: false,
    createdBy: options.by, updatedBy: options.by, createdAt: ctx.now, updatedAt: ctx.now,
    history: [], usage: { loads: 0, by: {} },
  }
  const trusted = options.by === 'import' ? state.trusted : trust(state, final)
  return { ok: true, state: { ...state, skills: [...state.skills, skill], trusted }, skill, warnings }
}

/** Replace a skill's text. Renaming is allowed when the new name is free. */
export function updateSkill(state: SkillLibraryState, id: string, definition: SkillDefinition, options: { by: SkillAuthor; note?: string }, ctx: LibraryContext): LibraryResult {
  const current = find(state, id)
  if (!current) return fail(`There is no skill "${id}".`)
  if (options.by === 'agent') {
    if (current.locked) return fail(`"${current.definition.name}" is locked: the user has asked that the assistant not change it. Suggest the change instead, or create a new skill.`)
    if (current.archived) return fail(`"${current.definition.name}" is archived. Only the user can restore it.`)
    const limit = agentLimits(definition); if (limit) return fail(limit)
  }
  if (definition.name !== current.definition.name && namesInUse(state, ctx, id).has(definition.name)) return fail(`Another skill is already called "${definition.name}".`)
  if (skillText(definition) === skillText(current.definition) && JSON.stringify(definition.resources) === JSON.stringify(current.definition.resources)) {
    return { ok: true, state, skill: current, warnings: ['Nothing changed.'] }
  }
  const revision = { at: ctx.now, by: current.updatedBy, text: skillText(current.definition), ...(options.note ? { note: options.note } : {}) }
  const skill: StoredSkill = {
    ...current, id: definition.name === current.definition.name ? current.id : idFor(current.scope, definition.name),
    definition, updatedBy: options.by, updatedAt: ctx.now,
    history: [revision, ...current.history].slice(0, MAX_HISTORY),
  }
  // The user's own edits are approved by being made. An assistant edit to a skill
  // the user had approved keeps it on: they chose to let it save freely.
  const trusted = options.by === 'import' ? state.trusted : trust(state, definition)
  return { ok: true, state: { ...state, skills: state.skills.map(s => (s.id === id ? skill : s)), trusted }, skill, warnings: [] }
}

/** Replace one exact passage of the SKILL.md text, the way documents are edited. */
export function patchSkill(state: SkillLibraryState, id: string, passage: string, replacement: string, options: { by: SkillAuthor; reparse: (text: string) => SkillDefinition | string }, ctx: LibraryContext): LibraryResult {
  const current = find(state, id)
  if (!current) return fail(`There is no skill "${id}".`)
  const text = skillText(current.definition)
  const count = passage ? text.split(passage).length - 1 : 0
  if (count !== 1) return fail(count === 0 ? 'That passage is not in the skill. Read the skill again and copy the text exactly.' : 'That passage appears more than once. Include more of the surrounding text so it is unique.')
  const parsed = options.reparse(text.replace(passage, replacement))
  if (typeof parsed === 'string') return fail(parsed)
  return updateSkill(state, id, { ...parsed, resources: current.definition.resources }, { by: options.by }, ctx)
}

const userOnly = (by: SkillAuthor, what: string): LibraryResult | null =>
  by === 'agent' ? fail(`Only the user can ${what}, in the Skill Manager. Tell them what you would change and why.`) : null

export function setSkillControls(state: SkillLibraryState, id: string, controls: { enabled?: boolean; mode?: SkillMode; locked?: boolean }, by: SkillAuthor): LibraryResult {
  const refused = userOnly(by, 'switch skills on or off, change when they are used, or lock them'); if (refused) return refused
  const current = find(state, id)
  if (!current) return fail(`There is no skill "${id}".`)
  const skill = { ...current, ...controls }
  // Switching a skill on is the user approving its current text.
  const trusted = controls.enabled ? trust(state, current.definition) : state.trusted
  return { ok: true, state: { ...replace(state, skill), trusted }, skill, warnings: [] }
}

/** Mode and on/off for a built-in or plugin skill, whose text is not stored here. */
export function setShippedSkillSettings(state: SkillLibraryState, sourceId: string, settings: SkillSettings, by: SkillAuthor): { ok: true; state: SkillLibraryState } | { ok: false; error: string } {
  if (by === 'agent') return { ok: false, error: 'Only the user can change when a skill is used, in the Skill Manager.' }
  const next = { ...state.settings[sourceId], ...settings }
  const settingsMap = { ...state.settings }
  if (next.enabled !== false && (next.mode ?? 'auto') === 'auto') delete settingsMap[sourceId]; else settingsMap[sourceId] = next
  return { ok: true, state: { ...state, settings: settingsMap } }
}

export function archiveSkill(state: SkillLibraryState, id: string, by: SkillAuthor, ctx: LibraryContext): LibraryResult {
  const current = find(state, id)
  if (!current) return fail(`There is no skill "${id}".`)
  if (by === 'agent' && (current.createdBy !== 'agent' || current.locked)) return fail(`The assistant can only archive skills it made itself. Ask the user to archive "${current.definition.name}".`)
  const skill = { ...current, archived: true, updatedAt: ctx.now }
  return { ok: true, state: replace(state, skill), skill, warnings: [] }
}

export function restoreSkill(state: SkillLibraryState, id: string, by: SkillAuthor, ctx: LibraryContext): LibraryResult {
  const refused = userOnly(by, 'restore an archived skill'); if (refused) return refused
  const current = find(state, id)
  if (!current) return fail(`There is no skill "${id}".`)
  const skill = { ...current, archived: false, updatedAt: ctx.now }
  return { ok: true, state: replace(state, skill), skill, warnings: [] }
}

export function deleteSkill(state: SkillLibraryState, id: string, by: SkillAuthor): { ok: true; state: SkillLibraryState } | { ok: false; error: string } {
  if (by === 'agent') return { ok: false, error: 'The assistant never deletes skills. Archive one you made instead; the user can delete it in the Skill Manager.' }
  if (!find(state, id)) return { ok: false, error: `There is no skill "${id}".` }
  return { ok: true, state: { ...state, skills: state.skills.filter(s => s.id !== id) } }
}

/** Put back the text a revision recorded. The current text becomes a revision itself, so this can be undone. */
export function revertSkill(state: SkillLibraryState, id: string, index: number, options: { by: SkillAuthor; reparse: (text: string) => SkillDefinition | string }, ctx: LibraryContext): LibraryResult {
  const refused = userOnly(options.by, 'restore an earlier version of a skill'); if (refused) return refused
  const current = find(state, id)
  const revision = current?.history[index]
  if (!current || !revision) return fail('That version is no longer kept.')
  const parsed = options.reparse(revision.text)
  if (typeof parsed === 'string') return fail(parsed)
  return updateSkill(state, id, { ...parsed, resources: current.definition.resources }, { by: options.by, note: `Restored the version from ${revision.at}` }, ctx)
}

export function recordUse(state: SkillLibraryState, id: string, by: SkillLoader, now: string): SkillLibraryState {
  const current = find(state, id)
  if (!current) return state
  return replace(state, { ...current, usage: { loads: current.usage.loads + 1, lastUsed: now, by: { ...current.usage.by, [by]: (current.usage.by[by] ?? 0) + 1 } } })
}

/**
 * Bring in a project's skills, replacing the previous project's. Each one is on only
 * if the bundle says so AND this device approved that exact text. Returns the names
 * that arrived off for that reason, so the user can be told.
 */
export function adoptProjectSkills(state: SkillLibraryState, incoming: StoredSkill[], ctx: LibraryContext): { state: SkillLibraryState; heldBack: string[] } {
  const globals = state.skills.filter(s => s.scope === 'global')
  const taken = new Set([...ctx.reservedNames, ...globals.map(s => s.definition.name)])
  const heldBack: string[] = []
  const adopted = incoming.map(skill => {
    const name = freeName(skill.definition.name, taken); taken.add(name)
    const definition = { ...skill.definition, name }
    const approved = state.trusted.includes(skillHash(skill.definition))
    if (skill.enabled && !approved) heldBack.push(name)
    return { ...skill, id: idFor('project', name), scope: 'project' as const, definition, enabled: skill.enabled && approved }
  })
  return { state: { ...state, skills: [...globals, ...adopted] }, heldBack }
}

/** A project skill as it is written into the bundle: no device usage, no trust. */
export const projectSkillsForBundle = (state: SkillLibraryState): StoredSkill[] =>
  state.skills.filter(s => s.scope === 'project').map(s => ({ ...s, usage: { loads: 0, by: {} } }))

/** What the assistant can be offered: on, not archived. */
export const activeStoredSkills = (state: SkillLibraryState): StoredSkill[] => state.skills.filter(s => s.enabled && !s.archived)
