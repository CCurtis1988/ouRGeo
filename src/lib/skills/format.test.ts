import { describe, expect, it } from 'vitest'
import { parseSkillMarkdown, serializeSkillMarkdown, toSkillName } from './format'
import { parseYaml } from './frontmatter'

// Real-world shapes: the agentskills.io example, a Claude Code skill with its own
// keys, a Hermes skill with nested metadata. Each must import as it is.
const AGENTSKILLS = `---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0"
---

# PDF processing

Use pdfplumber for text.
`
const CLAUDE_CODE = `---
name: explain-code
description: Explains code with visual diagrams and analogies. Use when explaining how code works, teaching about a codebase, or when the user asks "how does this work?"
disable-model-invocation: true
allowed-tools: Bash(git *) Read
---
When explaining code, always include an analogy.
`
const HERMES = `---
name: arxiv-summary
description: >
  Use when the user shares an arXiv link.
  Summarises the paper in five bullets.
version: 1.2.0
platforms: [macos, linux]
metadata:
  hermes:
    tags: [research, papers]
    category: research
---
1. Fetch the abstract.
2. Summarise.
`

describe('reading SKILL.md', () => {
  it('reads the agentskills.io example', () => {
    const r = parseSkillMarkdown(AGENTSKILLS)
    expect(r.ok && r.definition.name).toBe('pdf-processing')
    expect(r.ok && r.definition.body).toBe('# PDF processing\n\nUse pdfplumber for text.')
    expect(r.ok && r.warnings).toEqual([])
  })
  it('reads a Claude Code skill, quotes and extra keys included', () => {
    const r = parseSkillMarkdown(CLAUDE_CODE)
    expect(r.ok && r.definition.description).toContain('"how does this work?"')
  })
  it('reads a Hermes skill with a folded description and nested metadata', () => {
    const r = parseSkillMarkdown(HERMES)
    expect(r.ok && r.definition.description).toBe('Use when the user shares an arXiv link. Summarises the paper in five bullets.')
    expect(r.ok && r.definition.category).toBe('research')
  })
  it('keeps an unquoted colon inside a value', () => {
    const r = parseSkillMarkdown('---\nname: a\ndescription: Use when: the user asks for a map\n---\nDo it.')
    expect(r.ok && r.definition.description).toBe('Use when: the user asks for a map')
  })
  it('fixes a bad name with a warning, and uses the file name when there is none', () => {
    const fixed = parseSkillMarkdown('---\nname: Short Report!\ndescription: Use when x.\n---\nBody')
    expect(fixed.ok && fixed.definition.name).toBe('short-report')
    expect(fixed.ok && fixed.warnings[0]).toMatch(/changed to "short-report"/)
    const unnamed = parseSkillMarkdown('---\ndescription: Use when x.\n---\nBody', { fallbackName: 'My Skill.md' })
    expect(unnamed.ok && unnamed.definition.name).toBe('my-skill-md')
  })
  it('refuses a file with no description, no front matter or no body, saying what to add', () => {
    const noDescription = parseSkillMarkdown('---\nname: a\n---\nBody')
    expect(!noDescription.ok && noDescription.error).toMatch(/description: Use when/)
    const plain = parseSkillMarkdown('# Just a note')
    expect(!plain.ok && plain.error).toMatch(/front matter/)
    expect(parseSkillMarkdown('---\nname: a\ndescription: d\n---\n').ok).toBe(false)
  })
  it('refuses a body over the limit', () => {
    const r = parseSkillMarkdown(`---\nname: a\ndescription: d\n---\n${'x'.repeat(30)}`, { maxBody: 20 })
    expect(!r.ok && r.error).toMatch(/limit is 20/)
  })
  it('keeps valid triggers and actions, drops bad action ids with a warning', () => {
    const r = parseSkillMarkdown('---\nname: a\ndescription: d\nmetadata:\n  ourgeo:\n    triggers: ["short report", summary]\n    actions: [editor:newDocument, map.addLayer]\n---\nBody')
    expect(r.ok && r.definition.triggers).toEqual(['short report', 'summary'])
    expect(r.ok && r.definition.actions).toEqual(['editor:newDocument'])
    expect(r.ok && r.warnings.join()).toMatch(/map\.addLayer/)
  })
})

describe('writing SKILL.md', () => {
  it('round-trips, including characters a description can contain', () => {
    const first = parseSkillMarkdown(`---\nname: short-report\ndescription: 'Use when: the user says "short report" — or a one-pager'\nmetadata:\n  ourgeo:\n    triggers: ["short report"]\n---\n# Steps\n\n1. Summarise.\n`)
    if (!first.ok) throw new Error(first.error)
    const again = parseSkillMarkdown(serializeSkillMarkdown(first.definition))
    expect(again.ok && again.definition).toEqual(first.definition)
  })
})

describe('names and YAML', () => {
  it('makes a skill name from free text', () => {
    expect(toSkillName('Résumé  Builder!')).toBe('resume-builder')
    expect(toSkillName('!!!')).toBe('')
  })
  it('reads literal blocks, lists and numbers, and skips lines it cannot read', () => {
    expect(parseYaml('a: |\n  one\n  two\nb:\n  - x\n  - y\nc: 3\nnot a pair\nd: ok')).toEqual({ a: 'one\ntwo', b: ['x', 'y'], c: 3, d: 'ok' })
  })
})
