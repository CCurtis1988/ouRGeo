// SKILL.md in and out, compatible with the agentskills.io format that Claude Code,
// Codex and Hermes use, so a skill written for any of them imports as it is.
//
//   ---
//   name: short-report
//   description: Use when the user wants a one-page summary of a dataset …
//   metadata:
//     ourgeo:
//       triggers: ["summary report", "short report"]
//       actions: ["editor:newDocument"]
//   ---
//   # Short report
//   1. …
//
// Mode, on/off and lock are NOT in the file. They are this device's choices about
// the skill, like a theme being selected; a file someone sends cannot set them.

import { splitFrontMatter } from '@/lib/markdown/front-matter'
import { parseYaml, stringifyYaml, type YamlValue } from './frontmatter'
import type { SkillDefinition } from './types'

export const MAX_NAME = 64
export const MAX_DESCRIPTION = 1024
/** Imported files. Long skills help less (SkillsBench), but refusing someone's file outright helps nobody. */
export const MAX_BODY = 50_000
/** What the assistant may write in one skill: short procedures are the ones that work. */
export const MAX_AGENT_BODY = 20_000
const MAX_TRIGGERS = 32, MAX_TRIGGER = 128, MAX_ACTIONS = 64

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ACTION_RE = /^[a-z][a-zA-Z]*:[a-zA-Z][a-zA-Z0-9]*$/

export const isSkillName = (name: string): boolean => name.length <= MAX_NAME && NAME_RE.test(name)

/** `Short Report!` → `short-report`. Empty when nothing usable is left. */
export function toSkillName(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '')
}

export type ParseResult =
  | { ok: true; definition: SkillDefinition; warnings: string[] }
  | { ok: false; error: string }

const strings = (value: YamlValue | undefined): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim()) : []

const section = (value: YamlValue | undefined): { [key: string]: YamlValue } =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/**
 * Read a SKILL.md. `fallbackName` (the file or folder name) is used when the file
 * has no name. Fixable problems are warnings; a skill with no description cannot
 * be found by anyone, so that is an error, as the agentskills.io guide advises.
 */
export function parseSkillMarkdown(text: string, options: { fallbackName?: string; resources?: Record<string, string>; maxBody?: number } = {}): ParseResult {
  const { frontMatter, body } = splitFrontMatter(text.replace(/^\uFEFF/, ''))
  if (!frontMatter) return { ok: false, error: 'This is not a skill file: a SKILL.md starts with front matter between --- lines giving at least a name and a description.' }
  const fields = parseYaml(frontMatter.replace(/^---[ \t]*\r?\n/, '').replace(/\r?\n---[ \t]*\r?\n?$/, ''))
  const warnings: string[] = []

  const rawName = typeof fields.name === 'string' ? fields.name.trim() : ''
  let name = rawName
  if (!isSkillName(name)) {
    name = toSkillName(rawName || options.fallbackName || '')
    if (!name) return { ok: false, error: 'The skill has no usable name. Add `name: my-skill` (lower-case letters, digits and hyphens) to its front matter.' }
    warnings.push(rawName ? `Name "${rawName}" was changed to "${name}": skill names are lower-case letters, digits and hyphens.` : `The file has no name, so it is called "${name}".`)
  }

  let description = typeof fields.description === 'string' ? fields.description.replace(/\s+/g, ' ').trim() : ''
  if (!description) return { ok: false, error: `"${name}" has no description. Add \`description: Use when …\` to its front matter: the description is how the assistant knows when to use it.` }
  if (description.length > MAX_DESCRIPTION) {
    description = description.slice(0, MAX_DESCRIPTION).trimEnd()
    warnings.push(`The description was shortened to ${MAX_DESCRIPTION} characters.`)
  }

  const trimmedBody = body.replace(/^\s*\n/, '').trimEnd()
  const maxBody = options.maxBody ?? MAX_BODY
  if (!trimmedBody.trim()) return { ok: false, error: `"${name}" has no instructions after its front matter.` }
  if (trimmedBody.length > maxBody) return { ok: false, error: `"${name}" is ${trimmedBody.length.toLocaleString()} characters; the limit is ${maxBody.toLocaleString()}. Move reference material into separate files or split the skill.` }

  const ours = section(section(fields.metadata).ourgeo)
  const triggers = strings(ours.triggers)
  if (triggers.length > MAX_TRIGGERS || triggers.some(t => t.length > MAX_TRIGGER)) warnings.push(`Only the first ${MAX_TRIGGERS} triggers of up to ${MAX_TRIGGER} characters are kept.`)
  const actions = strings(ours.actions)
  const badActions = actions.filter(a => !ACTION_RE.test(a))
  if (badActions.length) warnings.push(`Ignored action ids that are not \`group:action\`: ${badActions.join(', ')}.`)
  const category = typeof ours.category === 'string' ? ours.category.trim() : typeof section(section(fields.metadata).hermes).category === 'string' ? String(section(section(fields.metadata).hermes).category).trim() : undefined

  return {
    ok: true,
    warnings,
    definition: {
      name, description, body: trimmedBody,
      triggers: triggers.filter(t => t.length <= MAX_TRIGGER).slice(0, MAX_TRIGGERS),
      actions: actions.filter(a => ACTION_RE.test(a)).slice(0, MAX_ACTIONS),
      ...(category ? { category } : {}),
      resources: { ...(options.resources ?? {}) },
    },
  }
}

/** Write the SKILL.md for a definition. Resources are separate files and are not included. */
export function serializeSkillMarkdown(definition: SkillDefinition): string {
  const ourgeo: { [key: string]: YamlValue } = {}
  if (definition.triggers.length) ourgeo.triggers = definition.triggers
  if (definition.actions.length) ourgeo.actions = definition.actions
  if (definition.category) ourgeo.category = definition.category
  const head: { [key: string]: YamlValue } = { name: definition.name, description: definition.description }
  if (Object.keys(ourgeo).length) head.metadata = { ourgeo }
  return `---\n${stringifyYaml(head)}\n---\n\n${definition.body.trimEnd()}\n`
}
