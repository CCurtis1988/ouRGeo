export interface SkillDescriptor {
  id: string
  summary: string
  triggers: string[]
  exclusions: string[]
  bodyFile: string
  actions: string[]
  requiresSources: string[]
}

export function validateSkills(value: unknown): { version: 1; skills: SkillDescriptor[] } {
  if (!value || typeof value !== 'object') throw new Error('Context must declare version 1 and skills.')
  const context = value as { version?: number; skills?: unknown; required?: unknown }
  if (context.required !== undefined && (!Array.isArray(context.required) || context.required.length > 16 || context.required.some(capability => capability !== 'skills'))) throw new Error('This plugin requires unsupported context capabilities. Install a compatible app version before enabling it.')
  if (context.version !== 1 || !Array.isArray(context.skills) || context.skills.length > 100) throw new Error('Context version 1 supports at most 100 declarative skills.')
  const ids = new Set<string>()
  return { version: 1, skills: context.skills.map((input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('A skill must be an object.')
    const skill = input as SkillDescriptor
    if (typeof skill.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(skill.id) || ids.has(skill.id)) throw new Error('Skill IDs must be unique lowercase names.')
    ids.add(skill.id)
    if (typeof skill.summary !== 'string' || skill.summary.length < 1 || skill.summary.length > 500) throw new Error('Skill summaries must be between 1 and 500 characters.')
    if (typeof skill.bodyFile !== 'string' || skill.bodyFile.length > 256 || !/^[a-zA-Z0-9_./-]+\.md$/.test(skill.bodyFile) || skill.bodyFile.startsWith('/') || skill.bodyFile.split('/').some(part => part === '..' || !part)) throw new Error('Skill bodyFile must be a Markdown file inside the plugin.')
    const list = (value: unknown): string[] => {
      if (value === undefined) return []
      if (!Array.isArray(value) || value.length > 32 || value.some(s => typeof s !== 'string' || s.length > 128)) throw new Error('Skill aliases and prerequisites must be bounded string lists.')
      return value
    }
    const actions = list(skill.actions)
    if (actions.some(action => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(action))) throw new Error('Skill actions must name this plugin’s local actions, without another namespace.')
    return { id: skill.id, summary: skill.summary, bodyFile: skill.bodyFile, triggers: list(skill.triggers), exclusions: list(skill.exclusions), actions, requiresSources: list(skill.requiresSources) }
  }) }
}
