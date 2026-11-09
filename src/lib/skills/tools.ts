// The two skill tools the model gets.
//
// `use_skill` replaces `ourgeo_docs` (kept as an alias in dispatch). Its `name` is
// an enum of the skills in the catalog, so a model cannot invent one, which the
// agentskills.io client guide recommends. The enum changes only when the library
// does, like the catalog in the contract.
//
// `save_skill` is how the assistant writes skills. The maintainer chose to let it
// save without asking; the library refuses what only the user may do, and every
// change is recorded so the user can review and undo it.

import type { AiTool } from '@/lib/ai-client'
import { useSkillStore, type SkillChange } from '@/store/skills'
import { catalogSkills } from './catalog'
import { MAX_AGENT_BODY, parseSkillMarkdown, toSkillName } from './format'

// Descriptions are cut to 120 characters for the model (lib/context/tools.ts), so
// what matters comes first.
export function skillToolDefinition(): AiTool | null {
  const names = catalogSkills().map(s => s.name)
  if (!names.length) return null
  return {
    name: 'use_skill',
    description: 'Load a skill\'s instructions by name before a task it covers. Skills are listed in available_skills. Optional file: a supporting file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', enum: names, description: 'The skill to load.' },
        file: { type: 'string', description: 'A supporting file the skill lists, e.g. references/style.md.' },
      },
      required: ['name'],
    },
  }
}

export const SAVE_SKILL_TOOL: AiTool = {
  name: 'save_skill',
  description: 'Save a reusable workflow as a skill: create (full SKILL.md text), patch (exact find/replace), or archive your own.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      operation: { type: 'string', enum: ['create', 'patch', 'archive'] },
      name: { type: 'string', description: 'Skill name: lower-case words joined by hyphens, e.g. short-report.' },
      content: { type: 'string', description: 'create: the whole SKILL.md, starting with front matter (name, description "Use when …"), then numbered steps.' },
      find: { type: 'string', description: 'patch: the exact text to replace, copied from the skill.' },
      replace: { type: 'string', description: 'patch: the new text.' },
      scope: { type: 'string', enum: ['global', 'project'], description: 'project: saved with the current project instead of on this computer.' },
    },
    required: ['operation', 'name'],
  },
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The stored skill a name refers to; built-in and plugin skills are not stored and cannot be edited. */
function storedByName(name: string) {
  const wanted = toSkillName(name)
  return useSkillStore.getState().library.skills.find(s => s.definition.name === wanted)
}

const done = (change: SkillChange, verb: string): string => {
  if (!change.ok) return `Refused: ${change.error}`
  if (!change.warnings.includes('Nothing changed.')) useSkillStore.getState().noteAgentChange({ id: change.skill.id, name: change.skill.definition.name, verb: verb === 'Saved' ? 'created' : 'updated' })
  const note = change.warnings.length ? ` ${change.warnings.join(' ')}` : ''
  return `${verb} skill "${change.skill.definition.name}".${note} It is marked as written by you; the user can review or undo it in the Skill Manager. Tell them what you saved.`
}

export function runSaveSkill(input: Record<string, unknown>, options: { projectSaved: boolean }): string {
  const operation = str(input.operation), name = str(input.name)
  const store = useSkillStore.getState()
  if (!toSkillName(name)) return 'Refused: give the skill a name, e.g. short-report.'
  if (operation === 'create') {
    // The scope is the model's guess; the user asked for a skill. In scratch, which
    // keeps no project skills, save it on this computer and say so rather than refuse:
    // a refusal here cost the user the skill they asked for (measured with Haiku).
    const wantedProject = input.scope === 'project'
    const scope = wantedProject && options.projectSaved ? 'project' : 'global'
    const parsed = parseSkillMarkdown(str(input.content), { fallbackName: name, maxBody: MAX_AGENT_BODY })
    if (!parsed.ok) return `Refused: ${parsed.error}`
    const reply = done(store.create({ ...parsed.definition, name: toSkillName(name) }, 'agent', scope), 'Saved')
    return wantedProject && scope === 'global' && !reply.startsWith('Refused') ? `${reply} It was saved on this computer, not in a project: this workspace is scratch, which keeps no project skills.` : reply
  }
  const existing = storedByName(name)
  if (!existing) {
    return catalogSkills().some(s => s.name === toSkillName(name))
      ? `Refused: "${name}" is built into ouRGeo or a plugin and cannot be changed. Create a new skill instead.`
      : `Refused: there is no skill called "${name}" that you can change.`
  }
  if (operation === 'patch') return done(store.patch(existing.id, str(input.find), str(input.replace), 'agent'), 'Updated')
  if (operation === 'archive') {
    const change = store.archive(existing.id, 'agent')
    if (change.ok) useSkillStore.getState().noteAgentChange({ id: existing.id, name: existing.definition.name, verb: 'archived' })
    return change.ok ? `Archived skill "${existing.definition.name}". The user can restore it in the Skill Manager.` : `Refused: ${change.error}`
  }
  return 'Refused: operation must be create, patch or archive.'
}
