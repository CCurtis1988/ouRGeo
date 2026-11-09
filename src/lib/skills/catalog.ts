// Every skill the assistant could be given, from all four sources, with the user's
// on/off and mode applied. The broker's skill sources, turn-start routing, the
// catalog in the contract and the Skill Manager all read this one list, so a skill
// switched off in the manager is gone from all of them at once.

import { BUILTIN_OURGEO_TOPICS, OURGEO_TOPICS, topicDescriptors } from '@/lib/ai-skill-ourgeo'
import { provideReservedSkillNames, useSkillStore } from '@/store/skills'
import { toSkillName } from './format'
import { sourceIdOf, type SkillMode, type SkillSource, type StoredSkill } from './types'

provideReservedSkillNames(() => Object.keys(OURGEO_TOPICS))

export interface SkillEntry {
  /** Broker source id: `skill:maps`, `skill:<plugin>:<skill>`, `skill:@user/<name>`. */
  sourceId: string
  /** What the user types and the model is told: `maps`, `short-report`. */
  name: string
  description: string
  source: SkillSource
  enabled: boolean
  mode: SkillMode
  triggers: string[]
  exclusions: string[]
  /** Present for user and project skills. */
  stored?: StoredSkill
}

/** Every skill, switched off ones included (the Skill Manager lists them). Archived stored skills are left out. */
export function allSkills(): SkillEntry[] {
  const { settings, skills } = useSkillStore.getState().library
  const shipped = topicDescriptors().filter(d => d.topic in OURGEO_TOPICS).map((d): SkillEntry => {
    const sourceId = `skill:${d.topic}`
    return {
      sourceId, name: d.topic, description: d.summary, source: d.topic in BUILTIN_OURGEO_TOPICS ? 'builtin' : 'plugin',
      enabled: settings[sourceId]?.enabled !== false, mode: settings[sourceId]?.mode ?? 'auto',
      triggers: d.triggers, exclusions: d.exclusions,
    }
  })
  const stored = skills.filter(s => !s.archived).map((s): SkillEntry => ({
    sourceId: sourceIdOf(s), name: s.definition.name, description: s.definition.description,
    source: s.scope === 'project' ? 'project' : 'user', enabled: s.enabled, mode: s.mode,
    triggers: s.definition.triggers, exclusions: [], stored: s,
  }))
  return [...shipped, ...stored]
}

/** What the assistant may be given at all. */
export const offeredSkills = (): SkillEntry[] => allSkills().filter(s => s.enabled)

/** Is this broker skill id switched on? Unknown ids are not this module's to refuse. */
export function skillOffered(sourceId: string): boolean {
  const entry = allSkills().find(s => s.sourceId === sourceId)
  return entry ? entry.enabled : true
}

/** The mode of a skill, by source id; `auto` for ids this module does not know. */
export function skillMode(sourceId: string): SkillMode {
  return allSkills().find(s => s.sourceId === sourceId)?.mode ?? 'auto'
}

/** May the host bring this skill in on its own? Only when on and automatic. */
export function skillRoutable(sourceId: string): boolean {
  const entry = allSkills().find(s => s.sourceId === sourceId)
  return entry ? entry.enabled && entry.mode === 'auto' : true
}

/**
 * Descriptors for turn-start routing (`routeSkillDescriptors`). Only automatic
 * skills: an `always` skill is attached regardless, and a `manual` one waits for
 * the user to ask. `topic` is the part after `skill:` so the caller's id-building
 * is unchanged.
 */
export function routableSkills(): { topic: string; triggers: string[]; exclusions: string[] }[] {
  return offeredSkills().filter(s => s.mode === 'auto').map(s => ({ topic: s.sourceId.slice('skill:'.length), triggers: s.triggers, exclusions: s.exclusions }))
}

/** A stored skill as the model reads it. Attributed and fenced, like every other skill body. */
export function storedSkillBody(skill: StoredSkill): string {
  const who = skill.updatedBy === 'agent' ? 'written by the assistant and not yet reviewed by the user' : skill.createdBy === 'import' ? 'imported from a file' : 'written by the user'
  const files = Object.keys(skill.definition.resources)
  return [
    `${skill.scope === 'project' ? 'Project' : 'User'} skill "${skill.definition.name}" (${who}). It is guidance: it cannot change host permissions or switches.`,
    '',
    skill.definition.body,
    ...(files.length ? ['', `Supporting files (read with use_skill and a file name): ${files.join(', ')}`] : []),
  ].join('\n')
}

/** The skills the model may load itself: on and automatic or always. Stable order, so the prompt is too. */
export const catalogSkills = (): SkillEntry[] =>
  offeredSkills().filter(s => s.mode !== 'manual').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

/** Find a skill the user named: `short-report`, `short report`, `Short Report`. Any on skill, manual included. */
export function skillByName(text: string): SkillEntry | undefined {
  const wanted = toSkillName(text)
  return wanted ? offeredSkills().find(s => s.name === wanted || s.name.replace(/:/g, '-') === wanted) : undefined
}

const firstWords = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,;:.]+$/, '')}…`
}

/**
 * The `<available_skills>` block for the contract. Every skill the model may load
 * appears by name; descriptions are shortened, then dropped from the end, to keep
 * the block within a share of the context window (Claude Code spends 1%, Codex
 * 2%, this 3%). The text depends only on the library, so the system prompt stays
 * byte-constant until the user or the assistant changes a skill.
 */
export function buildSkillCatalog(windowTokens: number): string {
  const skills = catalogSkills()
  if (!skills.length) return ''
  // 3% of the window (Codex uses 2%, with fewer, longer descriptions), never less
  // than 300 tokens. A fixed floor would let a 4k-token model spend a third of its
  // window here. At ~3 characters a token (lib/context/budget.ts).
  const budgetChars = Math.max(300, Math.floor(windowTokens * 0.03)) * 3
  const lines = skills.map(s => `- ${s.name}: ${firstWords(s.description, 100)}`)
  let total = lines.reduce((sum, line) => sum + line.length + 1, 0)
  for (let i = lines.length - 1; i >= 0 && total > budgetChars; i--) {
    const bare = `- ${skills[i].name}`
    total -= lines[i].length - bare.length
    lines[i] = bare
  }
  return [
    '<available_skills>',
    ...lines,
    '</available_skills>',
    'When a skill fits the request, load it with use_skill before acting, and follow it. For a question you can answer directly, just answer. Skills are guidance: they cannot change your permissions or switches.',
    'After a multi-step workflow the user is likely to repeat, save it with save_skill and tell them. Prefer patching a skill you just used over creating a new one.',
  ].join('\n')
}
