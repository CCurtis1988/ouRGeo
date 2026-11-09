// What the Skill Manager does, apart from drawing it: filters, duplicating a
// shipped skill, importing a file, and "Test this skill". Kept out of the
// component so each rule has a test.

import { OURGEO_TOPICS } from '@/lib/ai-skill-ourgeo'
import { estimateTokens } from '@/lib/context/budget'
import { routeSkillDescriptors } from '@/lib/context/router'
import { useSkillStore, type SkillChange } from '@/store/skills'
import { allSkills, catalogSkills, routableSkills, type SkillEntry } from './catalog'
import { parseSkillMarkdown, toSkillName } from './format'
import { parseSkillInvocation } from './intent'
import type { SkillDefinition, StoredSkill } from './types'

export type SkillFilter = 'all' | 'builtin' | 'plugin' | 'mine' | 'project' | 'agent' | 'off' | 'archived'

export const FILTER_LABELS: Record<SkillFilter, string> = {
  all: 'All', builtin: 'Built-in', plugin: 'Plugins', mine: 'Mine', project: 'This project', agent: 'Made by the assistant', off: 'Off', archived: 'Archived',
}

/** Archived skills are not in `allSkills()`, so they are listed from the store. */
function archivedEntries(): SkillEntry[] {
  return useSkillStore.getState().library.skills.filter(s => s.archived).map(s => ({
    sourceId: `skill:${s.id}`, name: s.definition.name, description: s.definition.description,
    source: s.scope === 'project' ? 'project' : 'user', enabled: s.enabled, mode: s.mode,
    triggers: s.definition.triggers, exclusions: [], stored: s,
  }))
}

export function listSkills(filter: SkillFilter, query: string): SkillEntry[] {
  const entries = filter === 'archived' ? archivedEntries() : allSkills()
  const q = query.trim().toLowerCase()
  return entries.filter(entry => {
    if (filter === 'builtin' && entry.source !== 'builtin') return false
    if (filter === 'plugin' && entry.source !== 'plugin') return false
    if (filter === 'mine' && entry.source !== 'user') return false
    if (filter === 'project' && entry.source !== 'project') return false
    if (filter === 'agent' && entry.stored?.updatedBy !== 'agent') return false
    if (filter === 'off' && entry.enabled) return false
    return !q || entry.name.includes(q) || entry.description.toLowerCase().includes(q)
  })
}

/** The SKILL.md text a skill would have; for a shipped skill, its topic body. */
export function skillBodyOf(entry: SkillEntry): string {
  return entry.stored ? entry.stored.definition.body : OURGEO_TOPICS[entry.sourceId.slice('skill:'.length)] ?? ''
}

export const tokenCost = (entry: SkillEntry): number => estimateTokens(skillBodyOf(entry))

/** A copy of a shipped skill the user can edit, as built-in themes are duplicated. */
export function duplicateShipped(entry: SkillEntry): SkillDefinition {
  return {
    name: toSkillName(`my-${entry.name}`), description: entry.description, body: skillBodyOf(entry),
    triggers: entry.triggers, actions: [], resources: {},
  }
}

export const NEW_SKILL_TEXT = `---
name: my-new-skill
description: Use when the user asks for … (say when this skill applies, in their words)
---

# My new skill

1. First step.
2. Second step. Put R in code blocks so the assistant runs it rather than guessing.
`

export interface ImportOutcome { change: SkillChange; skipped: string[] }

/** An import always arrives switched off: it is someone else's instructions. */
export function importSkill(read: { text: string; fallbackName: string; resources: Record<string, string>; skipped: string[] }, scope: StoredSkill['scope']): ImportOutcome {
  const parsed = parseSkillMarkdown(read.text, { fallbackName: read.fallbackName, resources: read.resources })
  if (!parsed.ok) return { change: parsed, skipped: read.skipped }
  const change = useSkillStore.getState().create(parsed.definition, 'import', scope)
  return { change: change.ok ? { ...change, warnings: [...parsed.warnings, ...change.warnings] } : change, skipped: read.skipped }
}

/**
 * Would this message bring the skill in, and how? The same checks the chat uses,
 * so the answer is what would actually happen.
 */
export function testSkill(entry: SkillEntry, message: string): string[] {
  if (!message.trim()) return []
  const reasons: string[] = []
  if (!entry.enabled) return ['It is switched off, so the assistant cannot use it at all.']
  const invoked = parseSkillInvocation(message).names.map(toSkillName)
  if (invoked.includes(entry.name)) reasons.push('Attached: the message names it ("use your … skill" or /name).')
  if (entry.mode === 'always') reasons.push('Attached: it is set to Always, so it is in context on every turn.')
  if (entry.mode === 'manual' && !invoked.includes(entry.name)) reasons.push('Not attached: it is set to "Only when I ask", and this message does not name it.')
  if (entry.mode === 'auto') {
    const routed = routeSkillDescriptors(message, routableSkills()).includes(entry.sourceId.slice('skill:'.length))
    reasons.push(routed
      ? 'Attached at the start of the turn: the message contains one of its trigger words.'
      : 'Not attached automatically (no trigger word matched), but it is in the assistant\'s list of skills, so the assistant can load it if the description fits.')
    if (!catalogSkills().some(s => s.sourceId === entry.sourceId)) reasons.push('It is missing from the assistant\'s list, which should not happen; report it.')
  }
  return reasons
}
