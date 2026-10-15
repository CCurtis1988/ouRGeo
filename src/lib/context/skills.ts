import { pluginContextFile, type PluginContextFile } from './sources/plugin'
import { providerContributions, type ProviderContribution } from './providers/contributions'

export interface SkillDescriptor {
  id: string
  summary: string
  triggers: string[]
  exclusions: string[]
  bodyFile: string
  actions: string[]
  requiresSources: string[]
  dependsOn?: string[]
  ourgeoVersion?: string
  sections?: { id: string; summary: string; bodyFile: string; required: boolean }[]
}

export interface PluginContextManifest {
  version: 1
  skills: SkillDescriptor[]
  sources?: PluginContextFile[]
  providers?: ProviderContribution[]
  required?: ('skills' | 'sources' | 'dynamic-sources' | 'skill-sections' | 'skill-dependencies' | 'memory-providers')[]
}
export function validateSkills(value: unknown): PluginContextManifest {
  if (!value || typeof value !== 'object') throw new Error('Context must declare version 1 and skills.')
  const context = value as { version?: number; skills?: unknown; sources?: unknown; providers?: unknown; required?: unknown }
  if (Object.keys(context).some(key => !['version', 'skills', 'sources', 'providers', 'required'].includes(key))) throw new Error('This plugin declares unsupported context fields. Use the supported context SDK.')
  if (context.required !== undefined && (!Array.isArray(context.required) || context.required.length > 16 || context.required.some(capability => !['skills', 'sources', 'dynamic-sources', 'skill-sections', 'skill-dependencies', 'memory-providers'].includes(capability)))) throw new Error('This plugin requires unsupported context capabilities. Install a compatible app version before enabling it.')
  if (context.providers !== undefined && (!Array.isArray(context.required) || !context.required.includes('memory-providers'))) throw new Error('Declare context.required: ["memory-providers"] before contributing reviewed provider profiles.')
  const providers = context.providers === undefined ? undefined : providerContributions(context.providers)
  if (context.version !== 1 || context.skills !== undefined && (!Array.isArray(context.skills) || context.skills.length > 100)) throw new Error('Context version 1 supports at most 100 declarative skills.')
  if (context.sources !== undefined && (!Array.isArray(context.sources) || context.sources.length > 64)) throw new Error('Context version 1 supports at most 64 declarative sources.')
  if (context.sources !== undefined && (!Array.isArray(context.required) || !context.required.includes('sources'))) throw new Error('Declare context.required: ["sources"] so older apps refuse unsupported source contributions.')
  const sources = (context.sources as unknown[] | undefined)?.map(pluginContextFile)
  if (sources && new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Context source IDs must be unique within this plugin.')
  const ids = new Set<string>()
  const skills: SkillDescriptor[] = ((context.skills ?? []) as unknown[]).map((input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('A skill must be an object.')
    const skill = input as SkillDescriptor
    if (Object.keys(skill).some(key => !['id', 'summary', 'triggers', 'exclusions', 'bodyFile', 'actions', 'requiresSources', 'dependsOn', 'ourgeoVersion', 'sections'].includes(key))) throw new Error('A skill cannot set host trust, scope, permissions or injection policy.')
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
    const dependsOn = skill.dependsOn === undefined ? undefined : list(skill.dependsOn)
    if (dependsOn?.some(id => !/^[a-z][a-z0-9-]{0,63}$/.test(id))) throw new Error('Skill dependencies must name this plugin’s local skills.')
    if ((dependsOn?.length || skill.ourgeoVersion !== undefined) && !(context.required as string[] | undefined)?.includes('skill-dependencies')) throw new Error('Declare context.required: ["skill-dependencies"] before using skill dependencies or compatibility requirements.')
    if (skill.ourgeoVersion !== undefined && (typeof skill.ourgeoVersion !== 'string' || !skill.ourgeoVersion.trim() || skill.ourgeoVersion.length > 80)) throw new Error('Skill ourgeoVersion must be a bounded app version requirement.')
    let sections: SkillDescriptor['sections']
    if (skill.sections !== undefined) {
      if (!(context.required as string[] | undefined)?.includes('skill-sections')) throw new Error('Declare context.required: ["skill-sections"] before using addressable skill sections.')
      if (!Array.isArray(skill.sections) || skill.sections.length > 16) throw new Error('A skill supports at most 16 sections.')
      sections = skill.sections.map(value => {
        if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['id', 'summary', 'bodyFile', 'required'].includes(key)) || value.required !== undefined && typeof value.required !== 'boolean') throw new Error('Skill sections need a local id, summary, bodyFile and optional required flag.')
        const file = pluginContextFile({ id: value.id, title: value.id, summary: value.summary, bodyFile: value.bodyFile })
        return { id: file.id, summary: file.summary, bodyFile: file.bodyFile, required: value.required === true }
      })
      if (new Set(sections.map(section => section.id)).size !== sections.length) throw new Error('Skill section IDs must be unique within the skill.')
    }
    return { id: skill.id, summary: skill.summary, bodyFile: skill.bodyFile, triggers: list(skill.triggers), exclusions: list(skill.exclusions), actions, requiresSources: list(skill.requiresSources), ...(dependsOn ? { dependsOn } : {}), ...(skill.ourgeoVersion ? { ourgeoVersion: skill.ourgeoVersion } : {}), ...(sections ? { sections } : {}) }
  })
  const visited = new Set<string>(), visiting = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('Skill dependencies contain a cycle. Use an acyclic local dependency graph.')
    if (visited.has(id)) return
    const skill = skills.find(skill => skill.id === id)
    if (!skill) throw new Error(`Skill dependency "${id}" is missing from this plugin.`)
    visiting.add(id); for (const dependency of skill.dependsOn ?? []) visit(dependency)
    visiting.delete(id); visited.add(id)
  }
  for (const skill of skills) visit(skill.id)
  if (skills.reduce((sum, skill) => sum + (skill.sections?.length ?? 0), 0) > 256) throw new Error('A plugin supports at most 256 addressable skill sections.')
  return { version: 1, skills, ...(sources ? { sources } : {}), ...(providers ? { providers } : {}), ...(context.required ? { required: context.required as PluginContextManifest['required'] } : {}) }
}
